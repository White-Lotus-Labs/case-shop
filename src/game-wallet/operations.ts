import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
  type WalletOperation,
} from '@prisma/client';
import { z } from 'zod';
import type {
  OperationRequest,
  OperationView,
  PlayerSession,
} from '../player/types';
import { ensureGameWallet } from '../player/accounts';
import { PlayerWalletError } from '../player/errors';
import {
  callSchema,
  digest,
  object,
  requestSchema,
  stableJson,
} from '../player/validation';
import {
  defaultCatalog,
  finalBlock,
  intentHash,
  previewPolicy,
  type PolicyCatalog,
  type PolicyPreview,
} from './policy';
import type { ChainPort } from './chain';
import { publicTestnetWritesEnabled, signerConfiguration } from './config';
import { finalReceipt } from './receipts';

const statuses = z.enum([
  'prepared',
  'authorized',
  'signing',
  'awaiting_external',
  'submitted',
  'unknown',
  'confirmed',
  'failed',
  'cancelled',
]);
export const pendingStatuses = [
  'prepared',
  'authorized',
  'signing',
  'awaiting_external',
  'submitted',
  'unknown',
];
export function operationView(row: WalletOperation): OperationView {
  const p = z
    .object({
      accountId: z.string(),
      tokenId: z.string().nullable(),
      symbol: z.string().nullable(),
      amountAtomic: z.string().nullable(),
      amountDisplay: z.string().nullable(),
      recipient: z.string().nullable(),
      steps: z.array(callSchema),
      nativeCostCapYocto: z.string(),
    })
    .passthrough()
    .parse(JSON.parse(row.previewJson));
  return {
    id: row.id,
    kind: row.kind,
    status: statuses.parse(row.status),
    accountId: p.accountId,
    tokenId: p.tokenId,
    symbol: p.symbol,
    amountAtomic: p.amountAtomic,
    amountDisplay: p.amountDisplay,
    recipient: p.recipient,
    steps: p.steps,
    completedSteps: row.stepIndex,
    nativeCostCapYocto: row.nativeCostCapYocto,
    intentHash: row.intentHash,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    txHash: row.txHash,
    requiresReauthentication: row.kind === 'withdraw',
    errorCode: row.errorCode,
  };
}
export async function validSession(
  db: Prisma.TransactionClient,
  actor: PlayerSession,
) {
  const session = await db.session.findUnique({
    where: { id: actor.sessionId },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== actor.userId ||
    session.tokenHash !== actor.tokenHash ||
    session.authVersion !== actor.authVersion ||
    session.user.authVersion !== actor.authVersion ||
    session.user.disabledAt ||
    session.expiresAt <= new Date()
  )
    throw new PlayerWalletError(
      401,
      'authentication_required',
      'Sign in again before authorizing an operation.',
    );
  return session;
}
export class WalletEngine {
  constructor(
    readonly db: PrismaClient,
    readonly chain: ChainPort,
    readonly catalog: PolicyCatalog = defaultCatalog,
  ) {}
  async owned(actor: PlayerSession, id: string) {
    await this.db.$transaction((tx) => validSession(tx, actor));
    const row = await this.db.walletOperation.findFirst({
      where: { id, userId: actor.userId },
    });
    if (!row)
      throw new PlayerWalletError(
        404,
        'operation_not_found',
        'Operation not found.',
      );
    return row;
  }
  async list(actor: PlayerSession) {
    await this.db.$transaction((tx) => validSession(tx, actor));
    return (
      await this.db.walletOperation.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      })
    ).map(operationView);
  }
  async prepare(
    actor: PlayerSession,
    raw: unknown,
    idempotencyKey: string,
  ): Promise<OperationView> {
    const input = requestSchema.parse(raw);
    z.string()
      .regex(/^[A-Za-z0-9_-]{8,100}$/)
      .parse(idempotencyKey);
    const requestHash = digest(input);
    await this.db.$transaction((tx) => validSession(tx, actor));
    const previous = await this.db.walletOperation.findUnique({
      where: {
        userId_idempotencyKey: { userId: actor.userId, idempotencyKey },
      },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new PlayerWalletError(
          409,
          'idempotency_conflict',
          'That request key belongs to a different operation.',
        );
      return operationView(previous);
    }
    const wallet = await ensureGameWallet(this.db, actor.userId);
    if (!wallet.accountId || !wallet.publicKey || wallet.status !== 'active')
      throw new PlayerWalletError(
        409,
        'wallet_inactive',
        'Activate and verify your game wallet first.',
      );
    if (wallet.activeOperationId) {
      const active = await this.db.walletOperation.findUnique({
        where: { id: wallet.activeOperationId },
      });
      if (active?.status === 'prepared' && active.expiresAt <= new Date()) {
        await this.db.$transaction(async (tx) => {
          const cancelled = await tx.walletOperation.updateMany({
            where: {
              id: active.id,
              status: 'prepared',
              expiresAt: { lte: new Date() },
            },
            data: { status: 'cancelled', errorCode: 'expired' },
          });
          if (cancelled.count !== 1)
            throw new PlayerWalletError(
              409,
              'operation_pending',
              'The existing operation is already being signed.',
            );
          await tx.gameWallet.updateMany({
            where: { id: wallet.id, activeOperationId: active.id },
            data: { activeOperationId: null },
          });
        });
      } else
        throw new PlayerWalletError(
          409,
          'operation_pending',
          'Resolve the existing wallet operation first.',
        );
    }
    if (
      input.kind === 'deposit' &&
      !(await this.db.externalWallet.findFirst({
        where: {
          userId: actor.userId,
          network: 'testnet',
          accountId: input.sourceAccountId,
        },
      }))
    )
      throw new PlayerWalletError(
        403,
        'source_not_linked',
        'Verify and link the external deposit wallet first.',
      );
    const preview = await previewPolicy(
      this.chain,
      input,
      wallet.accountId,
      this.catalog,
    );
    const block = await finalBlock(this.chain);
    const storedPreview = { ...preview, preparedBlockHeight: block.height };
    const hash = intentHash(input, preview, wallet.id);
    const id = randomUUID();
    try {
      return operationView(
        await this.db.$transaction(async (tx) => {
          await validSession(tx, actor);
          if (
            input.kind === 'deposit' &&
            !(await tx.externalWallet.findFirst({
              where: {
                userId: actor.userId,
                network: 'testnet',
                accountId: input.sourceAccountId,
              },
            }))
          )
            throw new PlayerWalletError(
              403,
              'source_not_linked',
              'Verify and link the external deposit wallet first.',
            );
          const row = await tx.walletOperation.create({
            data: {
              id,
              userId: actor.userId,
              walletId: wallet.id,
              sessionId: actor.sessionId,
              authVersion: actor.authVersion,
              idempotencyKey,
              kind: preview.kind,
              requestJson: stableJson(input),
              requestHash,
              previewJson: stableJson(storedPreview),
              intentHash: hash,
              stepsJson: stableJson(preview.steps),
              sourceAccountId: preview.accountId,
              nativeCostCapYocto: preview.nativeCostCapYocto,
              expiresAt: new Date(Date.now() + 120_000),
            },
          });
          if (input.kind !== 'game-call') {
            const locked = await tx.gameWallet.updateMany({
              where: { id: wallet.id, activeOperationId: null },
              data: { activeOperationId: id },
            });
            if (locked.count !== 1)
              throw new PlayerWalletError(
                409,
                'operation_pending',
                'Resolve the existing wallet operation first.',
              );
          }
          return row;
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const row = await this.db.walletOperation.findUniqueOrThrow({
          where: {
            userId_idempotencyKey: { userId: actor.userId, idempotencyKey },
          },
        });
        if (row.requestHash !== requestHash)
          throw new PlayerWalletError(
            409,
            'idempotency_conflict',
            'Request key conflict.',
          );
        return operationView(row);
      }
      throw error;
    }
  }
  async confirm(
    actor: PlayerSession,
    id: string,
    expectedHash: string,
    authorizationId?: string,
  ) {
    const row = await this.owned(actor, id);
    if (row.intentHash !== expectedHash)
      throw new PlayerWalletError(
        409,
        'intent_changed',
        'The operation preview changed.',
      );
    if (row.status !== 'prepared') return operationView(row);
    if (
      this.chain.network === 'testnet' &&
      (!publicTestnetWritesEnabled() ||
        (row.kind !== 'deposit' && !signerConfiguration().configured))
    )
      throw new PlayerWalletError(
        503,
        'activation_required',
        'Public Testnet signing is not activated.',
      );
    return operationView(
      await this.db.$transaction(async (tx) => {
        await validSession(tx, actor);
        const current = await tx.walletOperation.findUniqueOrThrow({
          where: { id: row.id },
        });
        if (current.status !== 'prepared') return current;
        if (
          current.sessionId !== actor.sessionId ||
          current.authVersion !== actor.authVersion ||
          current.expiresAt <= new Date()
        )
          throw new PlayerWalletError(
            409,
            'operation_expired',
            'Prepare a new operation after signing in again.',
          );
        if (current.kind === 'withdraw') {
          const used = await tx.walletAuthorization.updateMany({
            where: {
              id: authorizationId ?? '',
              userId: actor.userId,
              sessionId: actor.sessionId,
              scope: 'withdraw',
              scopeHash: current.intentHash,
              consumedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { consumedAt: new Date() },
          });
          if (used.count !== 1)
            throw new PlayerWalletError(
              403,
              'reauth_required',
              'Fresh authorization for this exact withdrawal is required.',
            );
        }
        const lock = await tx.gameWallet.updateMany({
          where: {
            id: current.walletId,
            OR: [
              { activeOperationId: null },
              { activeOperationId: current.id },
            ],
          },
          data: { activeOperationId: current.id },
        });
        if (lock.count !== 1)
          throw new PlayerWalletError(
            409,
            'operation_pending',
            'Another operation is unresolved.',
          );
        return tx.walletOperation.update({
          where: { id: current.id },
          data: {
            status:
              current.kind === 'deposit' ? 'awaiting_external' : 'authorized',
            authorizedAt: new Date(),
            authorizationId: authorizationId ?? null,
          },
        });
      }),
    );
  }
  async cancel(actor: PlayerSession, id: string) {
    const row = await this.owned(actor, id);
    await this.db.$transaction(async (tx) => {
      await validSession(tx, actor);
      const changed = await tx.walletOperation.updateMany({
        where: { id: row.id, status: 'prepared' },
        data: { status: 'cancelled' },
      });
      if (changed.count !== 1)
        throw new PlayerWalletError(
          409,
          'cannot_cancel',
          'A signed or pending operation must be reconciled.',
        );
      await tx.gameWallet.updateMany({
        where: { id: row.walletId, activeOperationId: row.id },
        data: { activeOperationId: null },
      });
    });
    return operationView(await this.owned(actor, id));
  }
  async externalReceipt(
    actor: PlayerSession,
    id: string,
    stepIndex: number,
    hash: string,
  ) {
    z.string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .parse(hash);
    const row = await this.owned(actor, id);
    if (
      row.kind !== 'deposit' ||
      !row.authorizedAt ||
      !['awaiting_external', 'submitted', 'unknown'].includes(row.status)
    )
      throw new PlayerWalletError(
        409,
        'not_external',
        'This is not an authorized pending external deposit.',
      );
    if (stepIndex < row.stepIndex) return operationView(row);
    if (stepIndex !== row.stepIndex)
      throw new PlayerWalletError(
        409,
        'step_order',
        'Wait for the previous step to finalize.',
      );
    const steps = z.array(callSchema).parse(JSON.parse(row.stepsJson));
    const step = steps[stepIndex];
    if (!step)
      throw new PlayerWalletError(400, 'step_order', 'Invalid transfer step.');
    await this.db.$transaction(async (tx) => {
      await validSession(tx, actor);
      const current = await tx.walletOperation.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (current.stepIndex > stepIndex) return;
      if (
        current.stepIndex !== stepIndex ||
        !['awaiting_external', 'submitted', 'unknown'].includes(current.status)
      )
        throw new PlayerWalletError(
          409,
          'step_order',
          'This operation step is no longer awaiting a receipt.',
        );
      const existing = await tx.gameTransaction.findUnique({
        where: { operationId_stepIndex: { operationId: row.id, stepIndex } },
      });
      if (existing && existing.txHash !== hash)
        throw new PlayerWalletError(
          409,
          'hash_conflict',
          'This step already has a transaction hash.',
        );
      if (!existing)
        await tx.gameTransaction.create({
          data: {
            operationId: row.id,
            stepIndex,
            callJson: stableJson(step),
            nonce: '0',
            blockHash: 'external',
            unsignedBase64: 'external',
            txHash: hash,
            status: 'submitted',
            sendAttemptedAt: new Date(),
          },
        });
      await tx.walletOperation.update({
        where: { id: row.id },
        data: { status: 'submitted', txHash: hash },
      });
    });
    return this.reconcileExternal(actor, row.id);
  }
  async reconcileExternal(actor: PlayerSession, id: string) {
    const row = await this.owned(actor, id);
    return reconcileExternalOperation(this.db, this.chain, row);
  }
}

/** Reconcile persisted external hashes without signing, even after the authorizing session ends. */
export async function reconcileExternalOperation(
  db: PrismaClient,
  chain: ChainPort,
  row: WalletOperation,
) {
  if (row.kind !== 'deposit' || !['submitted', 'unknown'].includes(row.status))
    return operationView(row);
  const attempt = await db.gameTransaction.findUnique({
    where: {
      operationId_stepIndex: {
        operationId: row.id,
        stepIndex: row.stepIndex,
      },
    },
  });
  if (!attempt?.txHash) return operationView(row);
  try {
    const result = await chain.call('tx', {
      tx_hash: attempt.txHash,
      sender_account_id: row.sourceAccountId,
      wait_until: 'FINAL',
    });
    const receipt = finalReceipt(result, {
      hash: attempt.txHash,
      signer: row.sourceAccountId,
      call: callSchema.parse(JSON.parse(attempt.callJson)),
    });
    const p = object.parse(JSON.parse(row.previewJson));
    const outcome = object.parse(receipt.receipt.transaction_outcome);
    const blockHash = z.string().parse(outcome.block_hash);
    const block = object.parse(
      await chain.call('block', { block_id: blockHash }),
    );
    const height = object.parse(block.header).height;
    if (BigInt(String(height)) < BigInt(String(p.preparedBlockHeight)))
      throw new Error('Receipt predates the deposit intent.');
    const total = z.array(callSchema).parse(JSON.parse(row.stepsJson)).length;
    const next = row.stepIndex + 1;
    await db.$transaction(async (tx) => {
      const advanced = await tx.walletOperation.updateMany({
        where: {
          id: row.id,
          stepIndex: row.stepIndex,
          status: { in: ['submitted', 'unknown'] },
        },
        data: {
          stepIndex: receipt.success ? next : row.stepIndex,
          status: !receipt.success
            ? 'failed'
            : next === total
              ? 'confirmed'
              : 'awaiting_external',
          errorCode: receipt.success ? null : 'receipt_failed',
        },
      });
      if (advanced.count === 1) {
        await tx.gameTransaction.update({
          where: { id: attempt.id },
          data: {
            status: receipt.success ? 'confirmed' : 'failed',
            receiptJson: stableJson(receipt.receipt),
            feeYocto: receipt.feeYocto,
          },
        });
        if (!receipt.success || next === total)
          await tx.gameWallet.updateMany({
            where: { id: row.walletId, activeOperationId: row.id },
            data: { activeOperationId: null },
          });
      }
    });
  } catch {
    await db.walletOperation.updateMany({
      where: { id: row.id, status: 'submitted' },
      data: { status: 'unknown', errorCode: 'awaiting_final_receipt' },
    });
  }
  return operationView(
    await db.walletOperation.findUniqueOrThrow({ where: { id: row.id } }),
  );
}
