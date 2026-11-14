import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { ChainPort } from './chain';
import {
  finalizeNearTransaction,
  prepareNearTransaction,
  decodeBase64,
} from './chain';
import type { ManagedSigner } from './kms';
import {
  callSchema,
  integer,
  object,
  requestSchema,
  stableJson,
} from '../player/validation';
import {
  defaultCatalog,
  finalBlock,
  previewPolicy,
  type PolicyCatalog,
} from './policy';
import { refreshWallet } from '../player/profile';
import { reconcileExternalOperation } from './operations';
import { finalReceipt } from './receipts';
import { publicTestnetWritesEnabled, signerConfiguration } from './config';
import { SignedTransaction } from 'near-api-js';

/** Dedicated process only. No HTTP signing endpoint. Unknown sends remain fenced. */
export class SigningWorker {
  constructor(
    readonly db: PrismaClient,
    readonly chain: ChainPort,
    readonly signer: ManagedSigner,
    readonly catalog: PolicyCatalog = defaultCatalog,
  ) {}
  async tick() {
    if (
      this.chain.network === 'testnet' &&
      (!publicTestnetWritesEnabled() || !signerConfiguration().configured)
    )
      throw new Error('Public player signing is disabled.');
    await this.chain.assertNetwork();
    await this.db.signerWorkerStatus.upsert({
      where: { id: 'player-signer' },
      create: {
        id: 'player-signer',
        provider: 'google-kms',
        status: 'available',
        lastSeenAt: new Date(),
      },
      update: { status: 'available', lastSeenAt: new Date() },
    });
    const rows = await this.db.gameWallet.findMany({
      where: {
        OR: [{ status: 'allocating' }, { activeOperationId: { not: null } }],
      },
      // Lease acquisition updates updatedAt, rotating pending and unknown wallets fairly.
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });
    for (const row of rows) {
      const token = randomUUID();
      const lease = await this.db.gameWallet.updateMany({
        where: {
          id: row.id,
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      if (!lease.count) continue;
      try {
        await this.process(row.id, token);
      } catch {
        await this.db.gameWallet.updateMany({
          where: { id: row.id, leaseToken: token },
          data: { errorCode: 'worker_retry_required' },
        });
      } finally {
        await this.db.gameWallet.updateMany({
          where: { id: row.id, leaseToken: token },
          data: { leaseToken: null, leaseExpiresAt: null },
        });
      }
    }
  }
  private async fence(id: string, token: string) {
    const wallet = await this.db.gameWallet.findFirst({
      where: { id, leaseToken: token, leaseExpiresAt: { gt: new Date() } },
    });
    if (!wallet) throw new Error('Worker lease expired.');
    return wallet;
  }
  private async process(id: string, token: string) {
    let wallet = await this.fence(id, token);
    if (wallet.status === 'allocating' && !wallet.accountId) {
      const allocated = await this.signer.allocate(wallet.id);
      await this.fence(id, token);
      await this.db.gameWallet.updateMany({
        where: { id, leaseToken: token, accountId: null },
        data: { ...allocated, status: 'allocated', errorCode: null },
      });
      return;
    }
    if (!wallet.activeOperationId) return;
    let op = await this.db.walletOperation.findUniqueOrThrow({
      where: { id: wallet.activeOperationId },
    });
    if (op.kind === 'deposit') {
      await reconcileExternalOperation(this.db, this.chain, op);
      return;
    }
    if (!['authorized', 'signing', 'submitted', 'unknown'].includes(op.status))
      return;
    if (!wallet.accountId || !wallet.publicKey || !wallet.keyVersion)
      throw new Error('Unallocated signer.');
    const steps = z.array(callSchema).parse(JSON.parse(op.stepsJson));
    const call = steps[op.stepIndex];
    if (!call) throw new Error('Missing operation step.');
    let attempt = await this.db.gameTransaction.findUnique({
      where: {
        operationId_stepIndex: { operationId: op.id, stepIndex: op.stepIndex },
      },
    });
    if (!attempt) {
      const session = await this.db.session.findUnique({
        where: { id: op.sessionId },
        include: { user: true },
      });
      if (
        !session ||
        session.userId !== op.userId ||
        session.expiresAt <= new Date() ||
        session.authVersion !== op.authVersion ||
        session.user.authVersion !== op.authVersion ||
        session.user.disabledAt ||
        op.expiresAt <= new Date()
      )
        return this.fail(op.id, wallet.id, token, 'authorization_expired');
      wallet = await refreshWallet(this.db, op.userId, this.chain);
      if (wallet.status !== 'active')
        return this.fail(op.id, wallet.id, token, 'access_key_changed');
      const request = requestSchema.parse(JSON.parse(op.requestJson));
      const fresh = await previewPolicy(
        this.chain,
        request,
        wallet.accountId!,
        this.catalog,
      );
      // Re-evaluate the full intent immediately before creating the immutable transaction.
      const previous = object.parse(JSON.parse(op.previewJson));
      if (
        stableJson(fresh.steps) !== stableJson(steps.slice(op.stepIndex)) ||
        BigInt(fresh.nativeCostCapYocto) >
          BigInt(String(previous.nativeCostCapYocto)) ||
        fresh.accountId !== op.sourceAccountId
      )
        return this.fail(op.id, wallet.id, token, 'preview_changed');
      const block = await finalBlock(this.chain);
      const key = object.parse(
        await this.chain.call('query', {
          request_type: 'view_access_key',
          account_id: wallet.accountId,
          public_key: wallet.publicKey,
          block_id: block.hash,
        }),
      );
      if (key.permission !== 'FullAccess')
        return this.fail(op.id, wallet.id, token, 'access_key_changed');
      const nonce = (BigInt(integer(key.nonce)) + 1n).toString();
      const unsigned = prepareNearTransaction({
        signerId: wallet.accountId!,
        publicKey: wallet.publicKey!,
        nonce,
        blockHash: block.hash,
        call,
      });
      await this.fence(id, token);
      attempt = await this.db.$transaction(async (tx) => {
        const currentSession = await tx.session.findUnique({
          where: { id: op.sessionId },
          include: { user: true },
        });
        if (
          !currentSession ||
          currentSession.userId !== op.userId ||
          currentSession.expiresAt <= new Date() ||
          currentSession.authVersion !== op.authVersion ||
          currentSession.user.authVersion !== op.authVersion ||
          currentSession.user.disabledAt
        )
          throw new Error('Authorization revoked.');
        const acquired = await tx.walletOperation.updateMany({
          where: {
            id: op.id,
            status: 'authorized',
            stepIndex: op.stepIndex,
            expiresAt: { gt: new Date() },
          },
          data: { status: 'signing', txHash: unsigned.txHash },
        });
        if (acquired.count !== 1)
          throw new Error('Operation authorization changed.');
        const row = await tx.gameTransaction.create({
          data: {
            operationId: op.id,
            stepIndex: op.stepIndex,
            callJson: stableJson(call),
            nonce,
            blockHash: block.hash,
            unsignedBase64: unsigned.unsignedBase64,
            txHash: unsigned.txHash,
            status: 'unsigned',
          },
        });
        await tx.walletOperation.update({
          where: { id: op.id },
          data: { status: 'signing', txHash: unsigned.txHash },
        });
        return row;
      });
    }
    // Reconstruct the exact bytes on every resume. A stored blob is not a signing policy.
    const canonical = prepareNearTransaction({
      signerId: wallet.accountId!,
      publicKey: wallet.publicKey!,
      nonce: attempt.nonce,
      blockHash: attempt.blockHash,
      call,
    });
    if (
      canonical.unsignedBase64 !== attempt.unsignedBase64 ||
      canonical.txHash !== attempt.txHash ||
      stableJson(call) !== attempt.callJson
    )
      throw new Error('Persisted transaction intent mismatch.');
    if (!attempt.signedBase64) {
      const fresh = await previewPolicy(
        this.chain,
        requestSchema.parse(JSON.parse(op.requestJson)),
        wallet.accountId!,
        this.catalog,
      );
      if (
        fresh.kind !== op.kind ||
        fresh.accountId !== op.sourceAccountId ||
        stableJson(fresh.steps) !== stableJson(steps.slice(op.stepIndex)) ||
        BigInt(fresh.nativeCostCapYocto) > BigInt(op.nativeCostCapYocto)
      )
        return this.fail(op.id, wallet.id, token, 'preview_changed');
      const session = await this.db.session.findUnique({
        where: { id: op.sessionId },
        include: { user: true },
      });
      if (
        !session ||
        session.userId !== op.userId ||
        session.expiresAt <= new Date() ||
        session.authVersion !== op.authVersion ||
        session.user.authVersion !== op.authVersion ||
        session.user.disabledAt ||
        op.expiresAt <= new Date()
      )
        return this.fail(op.id, wallet.id, token, 'authorization_expired');
      const hash = canonical.hash;
      const signature = await this.signer.signHash(
        wallet.keyVersion!,
        wallet.publicKey!,
        hash,
      );
      const signed = finalizeNearTransaction(
        attempt.unsignedBase64,
        signature,
        wallet.publicKey!,
      );
      if (signed.txHash !== attempt.txHash)
        throw new Error('Signed hash changed.');
      await this.fence(id, token);
      await this.db.gameTransaction.updateMany({
        where: { id: attempt.id, signedBase64: null },
        data: { signedBase64: signed.signedBase64, status: 'signed' },
      });
      attempt = await this.db.gameTransaction.findUniqueOrThrow({
        where: { id: attempt.id },
      });
    }
    const persistedSigned = SignedTransaction.decode(
      decodeBase64(attempt.signedBase64!),
    );
    const verifiedSigned = finalizeNearTransaction(
      attempt.unsignedBase64,
      persistedSigned.signature.data,
      wallet.publicKey!,
    );
    if (
      verifiedSigned.signedBase64 !== attempt.signedBase64 ||
      verifiedSigned.txHash !== attempt.txHash
    )
      throw new Error('Persisted signature mismatch.');
    await this.fence(id, token);
    // Persist the one send attempt before IO. A crash or timeout only permits hash reconciliation.
    const send = await this.db.gameTransaction.updateMany({
      where: { id: attempt.id, sendAttemptedAt: null },
      data: { sendAttemptedAt: new Date(), status: 'submitted' },
    });
    if (send.count) {
      await this.db.walletOperation.update({
        where: { id: op.id },
        data: { status: 'submitted' },
      });
      try {
        await this.chain.broadcast(attempt.signedBase64!);
      } catch {
        /* Never resend or choose another nonce. */
      }
    }
    try {
      const result = await this.chain.call('tx', {
        tx_hash: attempt.txHash,
        sender_account_id: wallet.accountId,
        wait_until: 'FINAL',
      });
      const receipt = finalReceipt(result, {
        hash: attempt.txHash!,
        signer: wallet.accountId!,
        publicKey: wallet.publicKey!,
        nonce: attempt.nonce,
        call,
        allowHandledFailure:
          op.kind === 'case-open' || op.kind === 'case-recover',
      });
      await this.fence(id, token);
      await this.db.$transaction(async (tx) => {
        const advanced = await tx.walletOperation.updateMany({
          where: {
            id: op.id,
            stepIndex: op.stepIndex,
            status: { in: ['signing', 'submitted', 'unknown'] },
          },
          data: {
            stepIndex: receipt.success ? op.stepIndex + 1 : op.stepIndex,
            status: receipt.success
              ? op.stepIndex + 1 === steps.length
                ? 'confirmed'
                : 'authorized'
              : 'failed',
            errorCode: receipt.success ? null : 'receipt_failed',
          },
        });
        if (!advanced.count) return;
        await tx.gameTransaction.update({
          where: { id: attempt!.id },
          data: {
            status: receipt.success ? 'confirmed' : 'failed',
            receiptJson: stableJson(receipt.receipt),
            feeYocto: receipt.feeYocto,
          },
        });
        if (!receipt.success || op.stepIndex + 1 === steps.length)
          await tx.gameWallet.updateMany({
            where: { id, activeOperationId: op.id },
            data: { activeOperationId: null, errorCode: null },
          });
      });
    } catch {
      await this.db.walletOperation.updateMany({
        where: { id: op.id, status: { in: ['signing', 'submitted'] } },
        data: { status: 'unknown', errorCode: 'awaiting_final_receipt' },
      });
    }
  }
  private async fail(
    operationId: string,
    walletId: string,
    leaseToken: string,
    code: string,
  ) {
    await this.db.$transaction(async (tx) => {
      const now = new Date();
      const wallet = await tx.gameWallet.findFirst({
        where: {
          id: walletId,
          activeOperationId: operationId,
          leaseToken,
          leaseExpiresAt: { gt: now },
        },
      });
      if (!wallet) return;
      const operation = await tx.walletOperation.findUnique({
        where: { id: operationId },
      });
      if (!operation || !['authorized', 'signing'].includes(operation.status))
        return;
      const attempt = await tx.gameTransaction.findUnique({
        where: {
          operationId_stepIndex: {
            operationId,
            stepIndex: operation.stepIndex,
          },
        },
      });
      // A stale worker must never unlock bytes another worker has signed or tried sending.
      if (
        attempt &&
        (attempt.signedBase64 !== null || attempt.sendAttemptedAt !== null)
      )
        return;
      const changed = await tx.walletOperation.updateMany({
        where: {
          id: operationId,
          status: { in: ['authorized', 'signing'] },
          stepIndex: operation.stepIndex,
        },
        data: { status: 'failed', errorCode: code },
      });
      if (changed.count)
        await tx.gameWallet.updateMany({
          where: {
            id: walletId,
            activeOperationId: operationId,
            leaseToken,
            leaseExpiresAt: { gt: now },
          },
          data: { activeOperationId: null },
        });
    });
  }
}
