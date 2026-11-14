import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { PlayerSession, WalletChallengeView } from '../player/types';
import { AuthError } from './validation';
import {
  createSession,
  hashToken,
  verifyPassword,
  type AuthResult,
} from './service';
import {
  testnetAccount,
  verifyNep413,
  verifyFinalizedFullAccessKey,
  type KeyVerifier,
} from './wallet-proof';
import { rateLimit } from './rate-limit';

export function linkScopeHash(accountId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        network: 'testnet',
        accountId: testnetAccount(accountId),
        purpose: 'link',
      }),
    )
    .digest('hex');
}
type Scope =
  | { scope: 'withdraw'; operationId: string }
  | { scope: 'link'; targetAccountId: string };
export function parseScope(input: Record<string, unknown>): Scope {
  if (input.scope === 'withdraw' && typeof input.operationId === 'string')
    return { scope: 'withdraw', operationId: input.operationId };
  if (input.scope === 'link')
    return {
      scope: 'link',
      targetAccountId: testnetAccount(input.targetAccountId),
    };
  throw new AuthError('Invalid authorization scope.');
}
async function currentSession(
  tx: Prisma.TransactionClient,
  actor: PlayerSession,
) {
  const session = await tx.session.findUnique({
    where: { id: actor.sessionId },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== actor.userId ||
    session.expiresAt <= new Date() ||
    session.user.disabledAt ||
    session.user.authVersion !== actor.authVersion ||
    session.authVersion !== actor.authVersion
  )
    throw new AuthError('Authentication required.', 401);
}
async function scopeHash(
  db: Prisma.TransactionClient,
  actor: PlayerSession,
  scope: Scope,
): Promise<string> {
  if (scope.scope === 'link') return linkScopeHash(scope.targetAccountId);
  const operation = await db.walletOperation.findUnique({
    where: { id: scope.operationId },
  });
  if (
    !operation ||
    operation.userId !== actor.userId ||
    operation.sessionId !== actor.sessionId ||
    operation.authVersion !== actor.authVersion ||
    operation.kind !== 'withdraw' ||
    operation.status !== 'prepared' ||
    operation.expiresAt <= new Date()
  )
    throw new AuthError('Operation cannot be authorized.', 403);
  return operation.intentHash;
}
export async function passwordAuthorization(
  db: PrismaClient,
  actor: PlayerSession,
  scope: Scope,
  password: unknown,
): Promise<string> {
  await rateLimit(db, 'reauth', actor.userId, 8);
  if (!(await verifyPassword(db, actor.userId, password)))
    throw new AuthError('Unable to authenticate.', 401);
  return db.$transaction(async (tx) => {
    await currentSession(tx, actor);
    const hash = await scopeHash(tx, actor, scope);
    return (
      await tx.walletAuthorization.create({
        data: {
          userId: actor.userId,
          sessionId: actor.sessionId,
          scope: scope.scope,
          scopeHash: hash,
          method: 'password',
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      })
    ).id;
  });
}
export type ChallengeInput =
  | { purpose: 'login'; accountId: string }
  | { purpose: 'link'; accountId: string; authorizationId: string }
  | { purpose: 'authorize'; accountId: string; authorization: Scope };
export async function issueWalletChallenge(
  db: PrismaClient,
  input: ChallengeInput,
  context: { origin: string; binding: string; actor: PlayerSession | null },
): Promise<WalletChallengeView> {
  const accountId = testnetAccount(input.accountId);
  await rateLimit(db, 'wallet-challenge-global', 'application', 300, 60_000);
  await rateLimit(db, 'wallet-challenge', accountId, 15);
  const actor = context.actor;
  if (input.purpose !== 'login' && !actor)
    throw new AuthError('Authentication required.', 401);
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const nonceBase64 = randomBytes(32).toString('base64');
  const recipient = new URL(context.origin).host;
  return db.$transaction(async (tx) => {
    if (actor) await currentSession(tx, actor);
    let scope: string | null = null;
    let hash: string | null = null;
    let operationId: string | null = null;
    let targetAccountId: string | null = null;
    if (input.purpose === 'link' && actor) {
      hash = linkScopeHash(accountId);
      scope = 'link';
      targetAccountId = accountId;
      const used = await tx.walletAuthorization.updateMany({
        where: {
          id: input.authorizationId,
          userId: actor.userId,
          sessionId: actor.sessionId,
          scope: 'link',
          scopeHash: hash,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (used.count !== 1)
        throw new AuthError(
          'Fresh account-link authorization is required.',
          403,
        );
      const linked = await tx.externalWallet.findUnique({
        where: { network_accountId: { network: 'testnet', accountId } },
      });
      if (linked) throw new AuthError('Wallet cannot be linked.', 409);
    }
    if (input.purpose === 'authorize' && actor) {
      const link = await tx.externalWallet.findUnique({
        where: { network_accountId: { network: 'testnet', accountId } },
      });
      if (!link || link.userId !== actor.userId)
        throw new AuthError('Use an already linked wallet.', 403);
      scope = input.authorization.scope;
      hash = await scopeHash(tx, actor, input.authorization);
      if (input.authorization.scope === 'withdraw')
        operationId = input.authorization.operationId;
      else targetAccountId = input.authorization.targetAccountId;
    }
    const message = `IROH authentication\nNetwork: testnet\nOrigin: ${context.origin}\nPurpose: ${input.purpose}\nAccount: ${accountId}\nScope: ${hash ?? 'login'}\nExpires: ${expiresAt.toISOString()}\nChallenge: ${randomBytes(16).toString('hex')}`;
    const row = await tx.walletChallenge.create({
      data: {
        purpose: input.purpose,
        accountId,
        origin: context.origin,
        recipient,
        message,
        nonceBase64,
        bindingHash: hashToken(context.binding),
        userId: input.purpose === 'login' ? null : actor?.userId,
        sessionId: input.purpose === 'login' ? null : actor?.sessionId,
        scope,
        scopeHash: hash,
        operationId,
        targetAccountId,
        expiresAt,
      },
    });
    return {
      id: row.id,
      message,
      recipient,
      nonceBase64,
      expiresAt: expiresAt.toISOString(),
    };
  });
}
export async function verifyWalletChallenge(
  db: PrismaClient,
  proof: {
    challengeId: string;
    accountId: string;
    publicKey: string;
    signature: string;
  },
  context: { origin: string; binding: string; actor: PlayerSession | null },
  verifyKey: KeyVerifier = verifyFinalizedFullAccessKey,
): Promise<
  | { kind: 'login'; result: AuthResult }
  | { kind: 'link' }
  | { kind: 'authorize'; authorizationId: string }
> {
  await rateLimit(db, 'wallet-verify-global', 'application', 300, 60_000);
  await rateLimit(db, 'wallet-verify', proof.accountId, 15);
  const challenge = await db.walletChallenge.findUnique({
    where: { id: proof.challengeId },
  });
  const invalid = new AuthError(
    'Wallet proof expired or was not accepted.',
    401,
  );
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt <= new Date() ||
    challenge.accountId !== testnetAccount(proof.accountId) ||
    challenge.origin !== context.origin ||
    challenge.bindingHash !== hashToken(context.binding)
  )
    throw invalid;
  if (
    challenge.purpose !== 'login' &&
    (!context.actor ||
      context.actor.sessionId !== challenge.sessionId ||
      context.actor.userId !== challenge.userId)
  )
    throw invalid;
  verifyNep413(
    proof,
    challenge.message,
    challenge.recipient,
    challenge.nonceBase64,
  );
  await verifyKey(proof.accountId, proof.publicKey);
  try {
    const result = await db.$transaction(async (tx) => {
      if (context.actor && challenge.purpose !== 'login')
        await currentSession(tx, context.actor);
      const consumed = await tx.walletChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw invalid;
      if (challenge.purpose === 'login') {
        const linked = await tx.externalWallet.findUnique({
          where: {
            network_accountId: {
              network: 'testnet',
              accountId: proof.accountId,
            },
          },
          include: { user: true },
        });
        if (linked) {
          if (linked.user.disabledAt) throw invalid;
          return {
            kind: 'login' as const,
            user: { id: linked.user.id, nickname: linked.user.nickname },
          };
        }
        const nickname = `player_${randomBytes(6).toString('hex')}`;
        const user = await tx.user.create({
          data: {
            nickname,
            nicknameKey: nickname,
            gameWallet: { create: {} },
            externalWallets: {
              create: {
                accountId: proof.accountId,
                verifiedPublicKey: proof.publicKey,
              },
            },
          },
          select: { id: true, nickname: true },
        });
        return { kind: 'login' as const, user };
      }
      const actor = context.actor;
      if (!actor) throw invalid;
      if (challenge.purpose === 'link') {
        await tx.externalWallet.create({
          data: {
            userId: actor.userId,
            accountId: proof.accountId,
            verifiedPublicKey: proof.publicKey,
          },
        });
        return { kind: 'link' as const };
      }
      if (
        challenge.purpose !== 'authorize' ||
        !challenge.scopeHash ||
        !challenge.scope
      )
        throw invalid;
      const link = await tx.externalWallet.findUnique({
        where: {
          network_accountId: { network: 'testnet', accountId: proof.accountId },
        },
      });
      if (!link || link.userId !== actor.userId) throw invalid;
      const scope = parseScope({
        scope: challenge.scope,
        operationId: challenge.operationId,
        targetAccountId: challenge.targetAccountId,
      });
      if ((await scopeHash(tx, actor, scope)) !== challenge.scopeHash)
        throw invalid;
      const auth = await tx.walletAuthorization.create({
        data: {
          userId: actor.userId,
          sessionId: actor.sessionId,
          scope: challenge.scope,
          scopeHash: challenge.scopeHash,
          method: 'wallet',
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });
      return { kind: 'authorize' as const, authorizationId: auth.id };
    });
    if (result.kind === 'login')
      return {
        kind: 'login',
        result: await createSession(db, result.user, 'wallet'),
      };
    return result;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new AuthError('Wallet cannot be linked.', 409);
    throw error;
  }
}
