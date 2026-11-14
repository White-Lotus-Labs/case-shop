import type { PrismaClient, GameWallet } from '@prisma/client';
import { z } from 'zod';
import type {
  BalanceReading,
  PlayerProfile,
  PlayerSession,
  PublicGameWallet,
} from './types';
import { ensureGameWallet } from './accounts';
import { PlayerWalletError } from './errors';
import { integer, object } from './validation';
import { supportedTokens } from './tokens';
import {
  publicTestnetWritesEnabled,
  signerConfiguration,
} from '../game-wallet/config';
import type { ChainPort } from '../game-wallet/chain';
import {
  accountState,
  finalBlock,
  defaultCatalog,
} from '../game-wallet/policy';
import { unknownAccount } from './validation';
import { validSession } from '../game-wallet/operations';

export function publicWallet(row: GameWallet): PublicGameWallet {
  const status = z
    .enum(['unconfigured', 'allocating', 'allocated', 'active', 'blocked'])
    .parse(row.status);
  const reason = row.errorCode
    ? 'Wallet verification or provisioning requires operator attention.'
    : status === 'unconfigured'
      ? 'Managed signing needs operator configuration.'
      : status === 'allocating'
        ? 'Wallet allocation is queued.'
        : status === 'allocated'
          ? 'Send authorized native Testnet NEAR to activate this address and fund gas.'
          : status === 'blocked'
            ? 'Wallet signing is blocked.'
            : null;
  return {
    id: row.id,
    accountId: row.accountId,
    publicKey: row.publicKey,
    status,
    reason,
    custody: 'managed-custodial',
  };
}
export async function playerProfile(
  db: PrismaClient,
  actor: PlayerSession,
  csrfToken: string,
): Promise<PlayerProfile> {
  await db.$transaction((tx) => validSession(tx, actor));
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    include: { externalWallets: true },
  });
  const wallet = await ensureGameWallet(db, user.id);
  const config = signerConfiguration();
  const heartbeat = await db.signerWorkerStatus.findUnique({
    where: { id: 'player-signer' },
  });
  const live =
    heartbeat &&
    heartbeat.lastSeenAt.getTime() > Date.now() - 60_000 &&
    heartbeat.status === 'available';
  return {
    id: user.id,
    nickname: user.nickname,
    createdAt: user.createdAt.toISOString(),
    authMethods: [
      ...(user.passwordHash ? ['password' as const] : []),
      ...(user.externalWallets.length ? ['wallet' as const] : []),
    ],
    externalWallets: user.externalWallets.map((w) => ({
      accountId: w.accountId,
      linkedAt: w.linkedAt.toISOString(),
    })),
    gameWallet: publicWallet(wallet),
    csrfToken,
    signer: {
      status: !config.configured
        ? 'unconfigured'
        : live
          ? 'available'
          : 'offline',
      reason: !config.configured
        ? config.reason
        : !publicTestnetWritesEnabled()
          ? 'Public Testnet actions require an authorized activation scope.'
          : !live
            ? 'Signing worker is offline.'
            : null,
      writesEnabled: publicTestnetWritesEnabled(),
    },
  };
}
export async function requestProvision(db: PrismaClient, actor: PlayerSession) {
  await db.$transaction((tx) => validSession(tx, actor));
  const row = await ensureGameWallet(db, actor.userId);
  if (row.accountId) return publicWallet(row);
  if (!signerConfiguration().configured || !publicTestnetWritesEnabled())
    throw new PlayerWalletError(
      503,
      'activation_required',
      'Managed signing and an authorized Testnet activation scope must be configured first.',
    );
  return publicWallet(
    await db.gameWallet.update({
      where: { id: row.id },
      data: {
        status: 'allocating',
        provisionRequestedAt: row.provisionRequestedAt ?? new Date(),
        errorCode: null,
      },
    }),
  );
}
export async function refreshWallet(
  db: PrismaClient,
  userId: string,
  chain: ChainPort,
): Promise<GameWallet> {
  const row = await ensureGameWallet(db, userId);
  if (!row.accountId || !row.publicKey) return row;
  await chain.assertNetwork();
  const block = await finalBlock(chain);
  const account = await accountState(chain, row.accountId, block.hash);
  if (!account)
    return db.gameWallet.update({
      where: { id: row.id },
      data: {
        status: 'allocated',
        lastVerifiedBlock: block.height,
        errorCode: null,
      },
    });
  let correct = false;
  try {
    const keys = z
      .object({
        keys: z.array(
          z.object({
            public_key: z.string(),
            access_key: z.object({ permission: z.unknown() }),
          }),
        ),
      })
      .parse(
        await chain.call('query', {
          request_type: 'view_access_key_list',
          account_id: row.accountId,
          block_id: block.hash,
        }),
      );
    correct =
      keys.keys.length === 1 &&
      keys.keys[0].public_key === row.publicKey &&
      keys.keys[0].access_key.permission === 'FullAccess';
  } catch (error) {
    if (!unknownAccount(error)) throw error;
  }
  return db.gameWallet.update({
    where: { id: row.id },
    data: {
      status: correct ? 'active' : 'blocked',
      lastVerifiedBlock: block.height,
      errorCode: correct ? null : 'access_key_changed',
    },
  });
}
export async function readBalance(
  db: PrismaClient,
  userId: string,
  tokenId: string,
  chain: ChainPort,
): Promise<BalanceReading> {
  const wallet = await ensureGameWallet(db, userId);
  if (!wallet.accountId)
    throw new PlayerWalletError(
      409,
      'wallet_unallocated',
      'The game wallet has not been allocated.',
    );
  await chain.assertNetwork();
  const block = await finalBlock(chain);
  if (tokenId === 'near') {
    const account = await accountState(chain, wallet.accountId, block.hash);
    if (!account)
      throw new PlayerWalletError(
        409,
        'wallet_unfunded',
        'This address is not an active NEAR Testnet account yet.',
      );
    return {
      tokenId: 'near',
      symbol: 'Testnet NEAR',
      decimals: 24,
      balance: integer(account.amount),
      blockHeight: block.height,
      source: 'finalized-rpc',
    };
  }
  const token = supportedTokens.find((t) => t.contractId === tokenId);
  if (!token)
    throw new PlayerWalletError(
      400,
      'unsupported_token',
      'Unsupported Testnet token.',
    );
  const metadata = z
    .object({ symbol: z.string(), decimals: z.number() })
    .parse(await chain.view(tokenId, 'ft_metadata', {}, block.hash));
  if (metadata.symbol !== token.symbol || metadata.decimals !== token.decimals)
    throw new PlayerWalletError(
      409,
      'token_changed',
      'Token metadata does not match the supported registry.',
    );
  return {
    tokenId,
    symbol: token.symbol,
    decimals: token.decimals,
    balance: integer(
      await chain.view(
        tokenId,
        'ft_balance_of',
        { account_id: wallet.accountId },
        block.hash,
      ),
    ),
    blockHeight: block.height,
    source: 'finalized-rpc',
  };
}
export async function readClaim(
  db: PrismaClient,
  userId: string,
  chain: ChainPort,
) {
  const wallet = await ensureGameWallet(db, userId);
  if (!wallet.accountId)
    return {
      claimed: null,
      eligible: null,
      costYocto: null,
      reason: 'Wallet allocation and native funding are required.',
    };
  await chain.assertNetwork();
  const block = await finalBlock(chain);
  const claimed = z
    .boolean()
    .parse(
      await chain.view(
        defaultCatalog.paymentToken,
        'has_claimed',
        { account_id: wallet.accountId },
        block.hash,
      ),
    );
  const cost = integer(
    await chain.view(
      defaultCatalog.paymentToken,
      'claim_storage_cost',
      { account_id: wallet.accountId },
      block.hash,
    ),
  );
  await db.starterClaim.upsert({
    where: { userId },
    create: {
      userId,
      walletId: wallet.id,
      observedClaimed: claimed,
      observedBlock: block.height,
      checkedAt: new Date(),
    },
    update: {
      observedClaimed: claimed,
      observedBlock: block.height,
      checkedAt: new Date(),
    },
  });
  const active = wallet.status === 'active';
  return {
    claimed,
    eligible: !claimed && active,
    costYocto: cost,
    reason: claimed
      ? 'Starter already claimed.'
      : !active
        ? 'Activate and verify the game wallet first.'
        : null,
  };
}
