import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OperationRequest, PlayerSession } from '../src/player/types';
import type { ChainPort } from '../src/game-wallet/chain';
import { WalletEngine } from '../src/game-wallet/operations';
import { previewPolicy, type PolicyCatalog } from '../src/game-wallet/policy';
import { finalReceipt } from '../src/game-wallet/receipts';
import {
  playerProfile,
  refreshWallet,
  readBalance,
  readClaim,
} from '../src/player/profile';
import type { WalletFunctionCall } from '../src/wallet/nearConnector';
import { caseCatalog } from '../src/case/catalog';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;
let actor: PlayerSession;
let other: PlayerSession;
let chain: FixtureChain;
let engine: WalletEngine;
const token = 'usdi-needmore-1-near.testnet';
const game = 'game.testnet';
const external = 'outside.testnet';
const catalog: PolicyCatalog = {
  tokens: [
    {
      contractId: token,
      name: 'USDI',
      symbol: 'USDI',
      decimals: 6,
      unofficial: true,
    },
  ],
  cases: [caseCatalog[0]],
  paymentToken: token,
  codeHashes: new Map([
    [token, 'reviewed-code'],
    [caseCatalog[0].contractId, 'reviewed-code'],
  ]),
};
class FixtureChain implements ChainPort {
  network: 'sandbox' | 'testnet' = 'sandbox';
  storage: unknown = { total: '125', available: '0' };
  code = 'reviewed-code';
  gas = '100000000';
  amount = '10000000000000000000000000';
  balance = '100000000000';
  metadata = { symbol: 'USDI', decimals: 6 };
  claimed = false;
  tx: unknown = null;
  keys: unknown = {
    keys: [
      {
        public_key: 'ed25519:controlled',
        access_key: { permission: 'FullAccess' },
      },
    ],
  };
  async assertNetwork() {}
  async broadcast() {
    throw Error('Tests must not broadcast');
  }
  async call(method: string, params: unknown): Promise<unknown> {
    if (method === 'query') {
      if (
        params &&
        typeof params === 'object' &&
        'request_type' in params &&
        params.request_type === 'view_access_key_list'
      )
        return this.keys;
      return { amount: this.amount, storage_usage: 0, code_hash: this.code };
    }
    if (method === 'block')
      return { header: { hash: 'final-block', height: 100 } };
    if (method === 'gas_price') return { gas_price: this.gas };
    if (method === 'EXPERIMENTAL_protocol_config')
      return {
        runtime_config: {
          storage_amount_per_byte: '10000000000000000000',
          min_gas_purchase_price: '1000000000',
          transaction_costs: {
            action_receipt_creation_config: {
              send_sir: 1,
              send_not_sir: 1,
              execution: 1,
            },
            action_creation_config: {
              function_call_cost: {
                send_sir: 1,
                send_not_sir: 1,
                execution: 1,
              },
              function_call_cost_per_byte: {
                send_sir: 1,
                send_not_sir: 1,
                execution: 1,
              },
            },
          },
        },
      };
    if (method === 'tx') {
      if (this.tx instanceof Error) throw this.tx;
      return this.tx;
    }
    throw Error(`Unexpected RPC ${method}`);
  }
  async view(_contract: string, method: string): Promise<unknown> {
    if (method === 'ft_metadata') return this.metadata;
    if (method === 'ft_balance_of') return this.balance;
    if (method === 'storage_balance_of') return this.storage;
    if (method === 'storage_balance_bounds') return { min: '125' };
    if (method === 'has_claimed') return this.claimed;
    if (method === 'claim_storage_cost') return '125';
    if (method === 'get_pool')
      return { storage_per_opening: '100', storage_account_cost: '25' };
    if (method === 'get_quote')
      return { can_open: true, nonce: '1', revision: '2', expires_at: '120' };
    if (method === 'get_opening')
      return { account_id: game, status: 'Claimable' };
    throw Error(`Unexpected view ${method}`);
  }
}
async function user(name: string): Promise<PlayerSession> {
  const u = await temp.db.user.create({
    data: {
      nickname: name,
      nicknameKey: name,
      gameWallet: {
        create: {
          status: 'active',
          accountId: name === 'player' ? game : 'othergame.testnet',
          publicKey: 'ed25519:controlled',
        },
      },
    },
  });
  const s = await temp.db.session.create({
    data: {
      userId: u.id,
      tokenHash: `hash-${name}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return {
    sessionId: s.id,
    userId: u.id,
    tokenHash: s.tokenHash,
    authVersion: 0,
    authMethod: 'password',
    authenticatedAt: s.authenticatedAt,
    expiresAt: s.expiresAt,
  };
}
beforeEach(async () => {
  temp = openTempDb();
  actor = await user('player');
  other = await user('other');
  chain = new FixtureChain();
  engine = new WalletEngine(temp.db, chain, catalog);
  await temp.db.externalWallet.create({
    data: {
      userId: actor.userId,
      accountId: external,
      verifiedPublicKey: 'ed25519:controlled',
    },
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await temp.close();
});
const withdrawal: OperationRequest = {
  kind: 'withdraw',
  tokenId: token,
  recipient: external,
  amount: '1.000001',
};
const deposit = {
  kind: 'deposit',
  tokenId: token,
  sourceAccountId: external,
  amount: '1',
};
async function grant(operationId: string) {
  const op = await temp.db.walletOperation.findUniqueOrThrow({
    where: { id: operationId },
  });
  return temp.db.walletAuthorization.create({
    data: {
      userId: actor.userId,
      sessionId: actor.sessionId,
      scope: 'withdraw',
      scopeHash: op.intentHash,
      method: 'password',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}
function receipt(
  call: WalletFunctionCall,
  hash = 'A'.repeat(44),
  signer = external,
) {
  return {
    final_execution_status: 'FINAL',
    transaction: {
      hash,
      signer_id: signer,
      receiver_id: call.receiverId,
      actions: [
        {
          FunctionCall: {
            method_name: call.methodName,
            args: Buffer.from(JSON.stringify(call.args)).toString('base64'),
            gas: call.gas,
            deposit: call.deposit,
          },
        },
      ],
    },
    transaction_outcome: {
      id: hash,
      block_hash: 'final-block',
      outcome: {
        receipt_ids: ['execution'],
        tokens_burnt: '2',
        status: { SuccessReceiptId: 'execution' },
      },
    },
    receipts_outcome: [
      {
        id: 'execution',
        outcome: {
          receipt_ids: ['refund'],
          tokens_burnt: '3',
          status: { SuccessValue: '' },
        },
      },
      {
        id: 'refund',
        outcome: {
          receipt_ids: [],
          tokens_burnt: '1',
          status: { SuccessValue: '' },
        },
      },
    ],
    status: { SuccessValue: '' },
  };
}
it('persists an exact preview and idempotently returns the same operation', async () => {
  const first = await engine.prepare(actor, withdrawal, 'stable-key');
  const second = await engine.prepare(actor, withdrawal, 'stable-key');
  expect(second.id).toBe(first.id);
  expect(first.amountAtomic).toBe('1000001');
  expect(first.amountDisplay).toBe('1.000001');
  expect(first.steps).toEqual([
    {
      receiverId: token,
      methodName: 'ft_transfer',
      args: { receiver_id: external, amount: '1000001' },
      gas: '50000000000000',
      deposit: '1',
    },
  ]);
  expect(await temp.db.walletOperation.count()).toBe(1);
  await expect(
    engine.prepare(actor, { ...withdrawal, amount: '2' }, 'stable-key'),
  ).rejects.toMatchObject({ code: 'idempotency_conflict' });
});
it('requires fresh authorization bound to the exact withdrawal and session', async () => {
  const op = await engine.prepare(actor, withdrawal, 'reauth-key');
  await expect(
    engine.confirm(actor, op.id, op.intentHash),
  ).rejects.toMatchObject({ code: 'reauth_required' });
  const wrong = await grant(op.id);
  await temp.db.walletAuthorization.update({
    where: { id: wrong.id },
    data: { scopeHash: 'different-intent' },
  });
  await expect(
    engine.confirm(actor, op.id, op.intentHash, wrong.id),
  ).rejects.toMatchObject({ code: 'reauth_required' });
  const valid = await grant(op.id);
  expect(
    (await engine.confirm(actor, op.id, op.intentHash, valid.id)).status,
  ).toBe('authorized');
  expect(
    (
      await temp.db.walletAuthorization.findUniqueOrThrow({
        where: { id: valid.id },
      })
    ).consumedAt,
  ).not.toBeNull();
  expect(
    (await engine.confirm(actor, op.id, op.intentHash, valid.id)).status,
  ).toBe('authorized');
});
it('does not expose another players operation or accept another sessions grant', async () => {
  const op = await engine.prepare(actor, withdrawal, 'isolation-key');
  await expect(engine.owned(other, op.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    engine.confirm(other, op.id, op.intentHash),
  ).rejects.toMatchObject({ status: 404 });
  expect(await engine.list(other)).toEqual([]);
  const valid = await grant(op.id);
  await temp.db.walletAuthorization.update({
    where: { id: valid.id },
    data: { sessionId: other.sessionId },
  });
  await expect(
    engine.confirm(actor, op.id, op.intentHash, valid.id),
  ).rejects.toMatchObject({ code: 'reauth_required' });
});
it('rejects expired previews, changed intent hashes and expired reauth grants', async () => {
  const op = await engine.prepare(actor, withdrawal, 'expiry-key');
  await expect(engine.confirm(actor, op.id, 'changed')).rejects.toMatchObject({
    code: 'intent_changed',
  });
  const auth = await grant(op.id);
  await temp.db.walletAuthorization.update({
    where: { id: auth.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    engine.confirm(actor, op.id, op.intentHash, auth.id),
  ).rejects.toMatchObject({ code: 'reauth_required' });
  await temp.db.walletOperation.update({
    where: { id: op.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    engine.confirm(actor, op.id, op.intentHash),
  ).rejects.toMatchObject({ code: 'operation_expired' });
});
it('enforces one unresolved spending operation and frees only unsigned cancelled previews', async () => {
  const first = await engine.prepare(actor, withdrawal, 'first-key');
  await expect(
    engine.prepare(actor, withdrawal, 'second-key'),
  ).rejects.toMatchObject({ code: 'operation_pending' });
  await engine.cancel(actor, first.id);
  const second = await engine.prepare(actor, withdrawal, 'second-key');
  const auth = await grant(second.id);
  await engine.confirm(actor, second.id, second.intentHash, auth.id);
  await expect(engine.cancel(actor, second.id)).rejects.toMatchObject({
    code: 'cannot_cancel',
  });
  await expect(
    engine.prepare(actor, withdrawal, 'third-key'),
  ).rejects.toMatchObject({ code: 'operation_pending' });
});
it('rejects stale sessions even for idempotent reads and existing confirmed operations', async () => {
  const op = await engine.prepare(actor, withdrawal, 'stale-key');
  const auth = await grant(op.id);
  await engine.confirm(actor, op.id, op.intentHash, auth.id);
  await temp.db.session.delete({ where: { id: actor.sessionId } });
  await expect(
    engine.confirm(actor, op.id, op.intentHash),
  ).rejects.toMatchObject({ status: 401 });
  await expect(engine.list(actor)).rejects.toMatchObject({ status: 401 });
});
it('concurrent preparations cannot leave two active spending operations', async () => {
  const result = await Promise.allSettled([
    engine.prepare(actor, withdrawal, 'concurrent-a'),
    engine.prepare(actor, withdrawal, 'concurrent-b'),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await temp.db.walletOperation.count()).toBe(1);
  expect(
    (
      await temp.db.gameWallet.findUniqueOrThrow({
        where: { userId: actor.userId },
      })
    ).activeOperationId,
  ).not.toBeNull();
});
it('an expired unsigned preview can be replaced without unlocking a signed operation', async () => {
  const old = await engine.prepare(actor, withdrawal, 'old-expired');
  await temp.db.walletOperation.update({
    where: { id: old.id },
    data: { expiresAt: new Date(0) },
  });
  const next = await engine.prepare(actor, withdrawal, 'new-after-expiry');
  expect(
    (await temp.db.walletOperation.findUniqueOrThrow({ where: { id: old.id } }))
      .status,
  ).toBe('cancelled');
  expect(
    (
      await temp.db.gameWallet.findUniqueOrThrow({
        where: { userId: actor.userId },
      })
    ).activeOperationId,
  ).toBe(next.id);
});
it('deposit requires explicit confirmation and an exact final receipt before crediting history', async () => {
  const op = await engine.prepare(actor, deposit, 'deposit-key');
  await expect(
    engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44)),
  ).rejects.toMatchObject({ code: 'not_external' });
  expect((await engine.confirm(actor, op.id, op.intentHash)).status).toBe(
    'awaiting_external',
  );
  chain.tx = receipt(op.steps[0]);
  const final = await engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44));
  expect(final.status).toBe('confirmed');
  expect(final.completedSteps).toBe(1);
  expect(
    (
      await temp.db.gameWallet.findUniqueOrThrow({
        where: { userId: actor.userId },
      })
    ).activeOperationId,
  ).toBeNull();
});
it('unknown deposits remain locked and never accept a different hash for the same step', async () => {
  const op = await engine.prepare(actor, deposit, 'unknown-deposit');
  await engine.confirm(actor, op.id, op.intentHash);
  chain.tx = new Error('RPC timeout');
  expect(
    (await engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44))).status,
  ).toBe('unknown');
  await expect(
    engine.externalReceipt(actor, op.id, 0, 'B'.repeat(44)),
  ).rejects.toMatchObject({ code: 'hash_conflict' });
  await expect(
    engine.prepare(actor, withdrawal, 'unknown-block'),
  ).rejects.toMatchObject({ code: 'operation_pending' });
  chain.tx = receipt(op.steps[0]);
  expect((await engine.reconcileExternal(actor, op.id)).status).toBe(
    'confirmed',
  );
});
it('storage registration is a distinct finalized prerequisite before external transfer', async () => {
  chain.storage = null;
  const op = await engine.prepare(actor, deposit, 'storage-deposit');
  expect(op.steps).toHaveLength(2);
  expect(op.steps[0]).toMatchObject({
    methodName: 'storage_deposit',
    args: { account_id: game, registration_only: true },
    deposit: '125',
  });
  await engine.confirm(actor, op.id, op.intentHash);
  await expect(
    engine.externalReceipt(actor, op.id, 1, 'B'.repeat(44)),
  ).rejects.toMatchObject({ code: 'step_order' });
  chain.tx = receipt(op.steps[0]);
  expect(
    (await engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44))).status,
  ).toBe('awaiting_external');
  chain.tx = receipt(op.steps[1], 'B'.repeat(44));
  expect(
    (await engine.externalReceipt(actor, op.id, 1, 'B'.repeat(44))).status,
  ).toBe('confirmed');
});
it('contract pinning, metadata, amount, spend and native funding limits fail closed', async () => {
  chain.code = 'unreviewed';
  await expect(
    previewPolicy(
      chain,
      { kind: 'withdraw', tokenId: token, recipient: external, amount: '1' },
      game,
      catalog,
    ),
  ).rejects.toMatchObject({ code: 'contract_changed' });
  chain.code = 'reviewed-code';
  chain.metadata.decimals = 24;
  await expect(
    engine.prepare(actor, withdrawal, 'bad-metadata'),
  ).rejects.toMatchObject({ code: 'token_changed' });
  chain.metadata.decimals = 6;
  await expect(
    engine.prepare(actor, { ...withdrawal, amount: '1001' }, 'too-many-tokens'),
  ).rejects.toMatchObject({ code: 'transfer_limit' });
  chain.amount = '1';
  await expect(
    engine.prepare(actor, withdrawal, 'too-little-near'),
  ).rejects.toMatchObject({ code: 'insufficient_near' });
  chain.amount = '10000000000000000000000000';
  chain.gas = '100000000000';
  await expect(
    engine.prepare(actor, withdrawal, 'too-much-gas'),
  ).rejects.toMatchObject({ code: 'native_limit' });
});
it.each([
  'add_key',
  'delete_account',
  'ft_transfer',
  'mint',
  'deploy_contract',
])('denies arbitrary game-wallet method %s', async (methodName) => {
  await expect(
    engine.prepare(
      actor,
      {
        kind: 'game-call',
        call: {
          receiverId: token,
          methodName,
          args: { receiver_id: 'attacker.testnet', amount: '1' },
          gas: '30000000000000',
          deposit: '0',
        },
      },
      `malicious-${methodName}`,
    ),
  ).rejects.toMatchObject({ code: 'call_not_allowed' });
});
it('allows only exact starter claims for the real game identity', async () => {
  const c = {
    receiverId: token,
    methodName: 'claim_starter',
    args: {},
    gas: '50000000000000',
    deposit: '125',
  };
  expect(
    await previewPolicy(chain, { kind: 'game-call', call: c }, game, catalog),
  ).toMatchObject({
    kind: 'claim',
    recipient: game,
    amountAtomic: '1000000000',
  });
  await expect(
    previewPolicy(
      chain,
      {
        kind: 'game-call',
        call: { ...c, args: { account_id: 'attacker.testnet' } },
      },
      game,
      catalog,
    ),
  ).rejects.toMatchObject({ code: 'call_not_allowed' });
  chain.claimed = true;
  await expect(
    previewPolicy(chain, { kind: 'game-call', call: c }, game, catalog),
  ).rejects.toMatchObject({ code: 'already_claimed' });
});
it('complete receipts require exact signer/action/finality and all graph descendants', () => {
  const call = {
    receiverId: token,
    methodName: 'ft_transfer',
    args: { receiver_id: game, amount: '1000000' },
    gas: '50000000000000',
    deposit: '1',
  };
  const expected = { hash: 'A'.repeat(44), signer: external, call };
  const good = receipt(call);
  expect(finalReceipt(good, expected)).toMatchObject({
    success: true,
    feeYocto: '6',
  });
  const pending = structuredClone(good);
  pending.final_execution_status = 'EXECUTED_OPTIMISTIC';
  expect(() => finalReceipt(pending, expected)).toThrow();
  const missing = structuredClone(good);
  missing.receipts_outcome.pop();
  expect(() => finalReceipt(missing, expected)).toThrow('Incomplete');
  const unrelated = structuredClone(good);
  unrelated.receipts_outcome.push({
    id: 'unrelated',
    outcome: {
      receipt_ids: [],
      tokens_burnt: '0',
      status: { SuccessValue: '' },
    },
  });
  expect(() => finalReceipt(unrelated, expected)).toThrow('Unrelated');
  const wrong = structuredClone(good);
  wrong.transaction.signer_id = 'attacker.testnet';
  expect(() => finalReceipt(wrong, expected)).toThrow('identity');
  const altered = structuredClone(good);
  altered.transaction.actions[0].FunctionCall.deposit = '0';
  expect(() => finalReceipt(altered, expected)).toThrow('actions');
});
it('a descendant failure cannot be reported as a successful transfer', () => {
  const call = {
    receiverId: token,
    methodName: 'ft_transfer',
    args: { receiver_id: game, amount: '1000000' },
    gas: '50000000000000',
    deposit: '1',
  };
  const value = receipt(call);
  const malformed: unknown = {
    ...value,
    receipts_outcome: [
      {
        id: 'execution',
        outcome: {
          receipt_ids: ['refund'],
          tokens_burnt: '3',
          status: { Failure: { error: 'failed' } },
        },
      },
      value.receipts_outcome[1],
    ],
  };
  expect(
    finalReceipt(malformed, { hash: 'A'.repeat(44), signer: external, call })
      .success,
  ).toBe(false);
});
it('public profile never reveals provider key references or another players linked accounts', async () => {
  await temp.db.gameWallet.update({
    where: { userId: actor.userId },
    data: {
      keyVersion:
        'projects/private/locations/global/keyRings/test/cryptoKeys/private/cryptoKeyVersions/1',
    },
  });
  const p = await playerProfile(temp.db, actor, 'csrf-session-token');
  expect(p.externalWallets.map((w) => w.accountId)).toEqual([external]);
  expect(p.gameWallet.custody).toBe('managed-custodial');
  expect(JSON.stringify(p)).not.toContain('keyVersion');
  expect(JSON.stringify(p)).not.toContain('projects/private');
});
it('refresh activates only the expected sole FullAccess key', async () => {
  expect((await refreshWallet(temp.db, actor.userId, chain)).status).toBe(
    'active',
  );
  chain.keys = {
    keys: [
      {
        public_key: 'ed25519:controlled',
        access_key: { permission: 'FullAccess' },
      },
      {
        public_key: 'ed25519:attacker',
        access_key: { permission: 'FullAccess' },
      },
    ],
  };
  expect((await refreshWallet(temp.db, actor.userId, chain)).status).toBe(
    'blocked',
  );
});
it('claim status is derived from chain and balance failures remain independent', async () => {
  chain.claimed = true;
  expect(await readClaim(temp.db, actor.userId, chain)).toMatchObject({
    claimed: true,
    eligible: false,
  });
  expect(
    (
      await temp.db.starterClaim.findUniqueOrThrow({
        where: { userId: actor.userId },
      })
    ).observedClaimed,
  ).toBe(true);
  await expect(
    readBalance(temp.db, actor.userId, 'unlisted.testnet', chain),
  ).rejects.toMatchObject({ code: 'unsupported_token' });
  expect(await readBalance(temp.db, actor.userId, 'near', chain)).toMatchObject(
    { balance: chain.amount, source: 'finalized-rpc', blockHeight: '100' },
  );
});

it('reserves the protocol gas purchase floor rather than the smaller burn price', async () => {
  const preview = await previewPolicy(chain, withdrawal, game, catalog);
  expect(BigInt(preview.nativeCostCapYocto)).toBeGreaterThan(
    100000000000000000000000n,
  );
  chain.amount = '60000000000000000000000';
  await expect(
    previewPolicy(chain, withdrawal, game, catalog),
  ).rejects.toMatchObject({ code: 'insufficient_near' });
});

it('never confirms an FT transfer-call when the final resolver refunded some or all of the price', () => {
  const call = {
    receiverId: token,
    methodName: 'ft_transfer_call',
    args: {
      receiver_id: catalog.cases[0].contractId,
      amount: '10000000',
      msg: '{}',
    },
    gas: '250000000000000',
    deposit: '1',
  };
  const value = receipt(call, 'test-hash');
  value.status = {
    SuccessValue: Buffer.from(JSON.stringify('0')).toString('base64'),
  };
  expect(
    finalReceipt(value, {
      hash: 'test-hash',
      signer: external,
      call,
      allowHandledFailure: true,
    }).success,
  ).toBe(false);
  value.status = {
    SuccessValue: Buffer.from(JSON.stringify('10000000')).toString('base64'),
  };
  expect(
    finalReceipt(value, {
      hash: 'test-hash',
      signer: external,
      call,
      allowHandledFailure: true,
    }).success,
  ).toBe(true);
});
it('background worker reconciles a persisted external deposit after its session ends without signing', async () => {
  const op = await engine.prepare(actor, deposit, 'background-deposit');
  await engine.confirm(actor, op.id, op.intentHash);
  chain.tx = new Error('Timeout');
  await engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44));
  await temp.db.session.delete({ where: { id: actor.sessionId } });
  chain.tx = receipt(op.steps[0]);
  const { SigningWorker } = await import('../src/game-wallet/worker');
  const signer = { allocate: vi.fn(), signHash: vi.fn() };
  await new SigningWorker(temp.db, chain, signer, catalog).tick();
  expect(
    (await temp.db.walletOperation.findUniqueOrThrow({ where: { id: op.id } }))
      .status,
  ).toBe('confirmed');
  expect(signer.signHash).not.toHaveBeenCalled();
});
it('racing duplicate external receipt attachments cannot move a finalized deposit backwards', async () => {
  const op = await engine.prepare(actor, deposit, 'racing-deposit');
  await engine.confirm(actor, op.id, op.intentHash);
  chain.tx = receipt(op.steps[0]);
  await Promise.allSettled([
    engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44)),
    engine.externalReceipt(actor, op.id, 0, 'A'.repeat(44)),
  ]);
  const final = await engine.owned(actor, op.id);
  expect(final.status).toBe('confirmed');
  expect(final.stepIndex).toBe(1);
  expect(await temp.db.gameTransaction.count()).toBe(1);
});
it.each(['signing', 'submitted', 'unknown'])(
  'a stale worker cannot release the lock after a lease takeover signs the operation during delayed policy checks (%s)',
  async (takeoverStatus) => {
    const op = await engine.prepare(actor, withdrawal, 'lease-takeover');
    const auth = await grant(op.id);
    await engine.confirm(actor, op.id, op.intentHash, auth.id);
    await temp.db.gameWallet.update({
      where: { userId: actor.userId },
      data: { keyVersion: 'controlled-test-version' },
    });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = chain.view.bind(chain);
    chain.view = async (contract: string, method: string) => {
      if (method === 'ft_metadata') {
        entered();
        await waiting;
      }
      return original(contract, method);
    };
    const { SigningWorker } = await import('../src/game-wallet/worker');
    const worker = new SigningWorker(
      temp.db,
      chain,
      { allocate: vi.fn(), signHash: vi.fn() },
      catalog,
    );
    const running = worker.tick();
    await started;
    const wallet = await temp.db.gameWallet.findUniqueOrThrow({
      where: { userId: actor.userId },
    });
    await temp.db.gameWallet.update({
      where: { id: wallet.id },
      data: {
        leaseToken: 'newer-worker',
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    });
    await temp.db.gameTransaction.create({
      data: {
        operationId: op.id,
        stepIndex: 0,
        callJson: '{}',
        nonce: '1',
        blockHash: 'controlled',
        unsignedBase64: 'controlled',
        signedBase64: 'persisted-by-newer-worker',
        txHash: 'A'.repeat(44),
        sendAttemptedAt: new Date(),
        status: 'submitted',
      },
    });
    await temp.db.walletOperation.update({
      where: { id: op.id },
      data: { status: takeoverStatus },
    });
    chain.storage = null;
    release();
    await running;
    expect(
      (
        await temp.db.walletOperation.findUniqueOrThrow({
          where: { id: op.id },
        })
      ).status,
    ).toBe(takeoverStatus);
    expect(
      (await temp.db.gameWallet.findUniqueOrThrow({ where: { id: wallet.id } }))
        .activeOperationId,
    ).toBe(op.id);
  },
);
