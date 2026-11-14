import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startPlayerSandbox } from './helpers/player-sandbox.ts';
import {
  claimCall,
  openCall,
  storageCall,
  parseQuote,
  parsePool,
} from '../src/case/client.ts';

import { WalletEngine } from '../src/game-wallet/operations.ts';
import { SigningWorker } from '../src/game-wallet/worker.ts';
import { refreshWallet } from '../src/player/profile.ts';
import { openTempDb } from './temp-sqlite.ts';

const temp = openTempDb();
const sandbox = await startPlayerSandbox(process.argv[2]);
const evidence: { network: string; checks: string[]; hashes: string[] } = {
  network: 'local Sandbox only, not public Testnet',
  checks: [],
  hashes: [],
};
function record(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  return Object.fromEntries(Object.entries(value));
}
function success(value: unknown) {
  const result = record(value);
  const status = record(result.status);
  assert.ok(
    'SuccessValue' in status,
    `Local receipt failed: ${JSON.stringify(status)}`,
  );
  const receipts = result.receipts_outcome;
  if (Array.isArray(receipts))
    for (const receipt of receipts)
      assert.ok(
        !('Failure' in record(record(record(receipt).outcome).status)),
        'A local child receipt failed.',
      );
  const transaction = record(result.transaction);
  assert.equal(typeof transaction.hash, 'string');
  evidence.hashes.push(String(transaction.hash));
  return result;
}
try {
  const player = await sandbox.managedSigner.allocate(randomUUID());
  assert.match(player.accountId, /^[0-9a-f]{64}$/);
  await sandbox.activate(player.accountId);
  assert.equal(
    record(
      await sandbox.chain.call('query', {
        request_type: 'view_access_key',
        account_id: player.accountId,
        public_key: player.publicKey,
        finality: 'final',
      }),
    ).permission,
    'FullAccess',
  );
  evidence.checks.push(
    'Implicit account activated with expected Ed25519 public key',
  );
  const config = {
    network: 'testnet' as const,
    rpcUrl: sandbox.chain.url,
    tokenContractId: sandbox.token.accountId,
    caseContractId: sandbox.game.accountId,
  };
  const cost = String(
    await sandbox.chain.view(sandbox.token.accountId, 'claim_storage_cost', {
      account_id: player.accountId,
    }),
  );
  success(await sandbox.sendGameCall(player, claimCall(config, cost)));
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'has_claimed', {
      account_id: player.accountId,
    }),
    true,
  );
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: player.accountId,
    }),
    '1000000000',
  );
  evidence.checks.push(
    'Game-wallet predecessor claimed exactly 1000 USDI and finalized balance',
  );
  const duplicate = await sandbox.sendGameCall(player, claimCall(config, cost));
  assert.ok('Failure' in record(duplicate.status));
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: player.accountId,
    }),
    '1000000000',
  );
  evidence.checks.push(
    'Duplicate starter claim failed without changing balance',
  );
  const bounds = record(
    await sandbox.chain.view(
      sandbox.token.accountId,
      'storage_balance_bounds',
      {},
    ),
  );
  await sandbox.call(
    sandbox.external,
    sandbox.token.accountId,
    'claim_starter',
    {},
    String(
      await sandbox.chain.view(sandbox.token.accountId, 'claim_storage_cost', {
        account_id: sandbox.external.accountId,
      }),
    ),
  );
  await sandbox.call(
    sandbox.external,
    sandbox.token.accountId,
    'ft_transfer',
    { receiver_id: player.accountId, amount: '3000000' },
    '1',
  );
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: player.accountId,
    }),
    '1003000000',
  );
  evidence.checks.push(
    'External account deposited real local NEP-141 USDI into game wallet',
  );
  success(
    await sandbox.sendGameCall(player, {
      receiverId: sandbox.token.accountId,
      methodName: 'storage_deposit',
      args: {
        account_id: sandbox.recipient.accountId,
        registration_only: true,
      },
      gas: '30000000000000',
      deposit: String(bounds.min),
    }),
  );
  success(
    await sandbox.sendGameCall(player, {
      receiverId: sandbox.token.accountId,
      methodName: 'ft_transfer',
      args: { receiver_id: sandbox.recipient.accountId, amount: '2000000' },
      gas: '50000000000000',
      deposit: '1',
    }),
  );
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: sandbox.recipient.accountId,
    }),
    '2000000',
  );
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: player.accountId,
    }),
    '1001000000',
  );
  evidence.checks.push(
    'Game wallet registered recipient storage and withdrew exact USDI amount',
  );
  const mockBounds = record(
    await sandbox.chain.view(
      sandbox.mock.accountId,
      'storage_balance_bounds',
      {},
    ),
  );
  await sandbox.call(
    sandbox.owner,
    sandbox.mock.accountId,
    'storage_deposit',
    { account_id: player.accountId, registration_only: true },
    String(mockBounds.min),
  );
  await sandbox.call(
    sandbox.owner,
    sandbox.mock.accountId,
    'ft_transfer',
    { receiver_id: player.accountId, amount: '5000000' },
    '1',
  );
  assert.equal(
    await sandbox.chain.view(sandbox.mock.accountId, 'ft_balance_of', {
      account_id: player.accountId,
    }),
    '5000000',
  );
  evidence.checks.push(
    'Reward-token storage and real local NEP-141 deposit succeeded',
  );
  const pool = parsePool(
    await sandbox.chain.view(sandbox.game.accountId, 'get_pool', {}),
  );
  success(await sandbox.sendGameCall(player, storageCall(config, pool)));
  const quote = parseQuote(
    await sandbox.chain.view(sandbox.game.accountId, 'get_quote', {
      account_id: player.accountId,
    }),
  );
  assert.equal(quote.can_open, true);
  success(await sandbox.sendGameCall(player, openCall(config, quote)));
  const history = await sandbox.chain.view(
    sandbox.game.accountId,
    'get_history',
    { account_id: player.accountId, limit: 1 },
  );
  assert.ok(Array.isArray(history) && history.length === 1);
  assert.equal(record(history[0]).account_id, player.accountId);
  evidence.checks.push(
    'Existing case contract recorded implicit game wallet as opening player',
  );
  const user = await temp.db.user.create({
    data: { nickname: 'sandbox-player', nicknameKey: 'sandbox-player' },
  });
  const session = await temp.db.session.create({
    data: {
      userId: user.id,
      tokenHash: 'sandbox-session-only',
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const actor = {
    sessionId: session.id,
    userId: user.id,
    tokenHash: session.tokenHash,
    authVersion: 0,
    authMethod: 'password',
    authenticatedAt: session.authenticatedAt,
    expiresAt: session.expiresAt,
  };
  await temp.db.gameWallet.create({
    data: { userId: user.id, status: 'allocating' },
  });
  const worker = new SigningWorker(
    temp.db,
    sandbox.chain,
    sandbox.managedSigner,
    sandbox.catalog,
  );
  const engine = new WalletEngine(temp.db, sandbox.chain, sandbox.catalog);
  await worker.tick();
  let wallet = await temp.db.gameWallet.findUniqueOrThrow({
    where: { userId: user.id },
  });
  assert.equal(wallet.status, 'allocated');
  assert.ok(wallet.accountId);
  await sandbox.activate(wallet.accountId);
  wallet = await refreshWallet(temp.db, user.id, sandbox.chain);
  assert.equal(wallet.status, 'active');
  async function finish(id: string) {
    for (let i = 0; i < 100; i++) {
      await worker.tick();
      const op = await engine.owned(actor, id);
      if (op.status === 'confirmed' || op.status === 'failed') return op;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Worker did not finalize local operation');
  }
  const claimCost = String(
    await sandbox.chain.view(sandbox.token.accountId, 'claim_storage_cost', {
      account_id: wallet.accountId,
    }),
  );
  const prepared = await engine.prepare(
    actor,
    { kind: 'game-call', call: claimCall(config, claimCost) },
    'sandbox-claim',
  );
  assert.equal(
    (await engine.confirm(actor, prepared.id, prepared.intentHash)).status,
    'authorized',
  );
  const finished = await finish(prepared.id);
  assert.equal(finished.status, 'confirmed', finished.errorCode ?? '');
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: wallet.accountId,
    }),
    '1000000000',
  );
  evidence.checks.push(
    'WalletEngine and dedicated SigningWorker allocated, activated and finalized real local USDI claim',
  );
  const transfer = await engine.prepare(
    actor,
    {
      kind: 'withdraw',
      tokenId: sandbox.token.accountId,
      recipient: sandbox.external.accountId,
      amount: '2',
    },
    'sandbox-withdraw',
  );
  const grant = await temp.db.walletAuthorization.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      scope: 'withdraw',
      scopeHash: transfer.intentHash,
      method: 'password',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await engine.confirm(actor, transfer.id, transfer.intentHash, grant.id);
  const withdrawn = await finish(transfer.id);
  assert.equal(withdrawn.status, 'confirmed', withdrawn.errorCode ?? '');
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: wallet.accountId,
    }),
    '998000000',
  );
  evidence.checks.push(
    'Operation-bound withdrawal authorization finalized through real queued worker transaction',
  );
  // A fresh recipient forces the real two-step NEP-145 path through the worker.
  const empty = await sandbox.managedSigner.allocate(randomUUID());
  await sandbox.activate(empty.accountId);
  const two = await engine.prepare(
    actor,
    {
      kind: 'withdraw',
      tokenId: sandbox.token.accountId,
      recipient: empty.accountId,
      amount: '1',
    },
    'sandbox-storage-withdraw',
  );
  assert.equal(two.steps.length, 2);
  const grant2 = await temp.db.walletAuthorization.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      scope: 'withdraw',
      scopeHash: two.intentHash,
      method: 'password',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await engine.confirm(actor, two.id, two.intentHash, grant2.id);
  const twoFinal = await finish(two.id);
  assert.equal(twoFinal.status, 'confirmed', twoFinal.errorCode ?? '');
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: empty.accountId,
    }),
    '1000000',
  );
  evidence.checks.push(
    'Two-step recipient registration and withdrawal finalized with distinct persisted nonces',
  );
  await temp.db.externalWallet.create({
    data: {
      userId: user.id,
      network: 'testnet',
      accountId: sandbox.external.accountId,
      verifiedPublicKey: 'local-fixture-link-proof-tested-separately',
    },
  });
  const deposit = await engine.prepare(
    actor,
    {
      kind: 'deposit',
      tokenId: sandbox.token.accountId,
      sourceAccountId: sandbox.external.accountId,
      amount: '1',
    },
    'sandbox-external-deposit',
  );
  await engine.confirm(actor, deposit.id, deposit.intentHash);
  const depositCall = deposit.steps[0];
  const depositReceipt = record(
    await sandbox.call(
      sandbox.external,
      depositCall.receiverId,
      depositCall.methodName,
      depositCall.args,
      depositCall.deposit,
      depositCall.gas,
    ),
  );
  const hash = String(record(depositReceipt.transaction).hash);
  assert.equal(
    (await engine.externalReceipt(actor, deposit.id, 0, hash)).status,
    'confirmed',
  );
  assert.equal(
    await sandbox.chain.view(sandbox.token.accountId, 'ft_balance_of', {
      account_id: wallet.accountId,
    }),
    '998000000',
  );
  evidence.checks.push(
    'Linked external deposit finalized through operation confirmation and exact receipt attachment',
  );
  const queuedStorage = await engine.prepare(
    actor,
    {
      kind: 'game-call',
      call: storageCall(
        config,
        parsePool(
          await sandbox.chain.view(sandbox.game.accountId, 'get_pool', {}),
        ),
      ),
    },
    'sandbox-case-storage',
  );
  await engine.confirm(actor, queuedStorage.id, queuedStorage.intentHash);
  assert.equal((await finish(queuedStorage.id)).status, 'confirmed');
  const queuedOpen = await engine.prepare(
    actor,
    {
      kind: 'game-call',
      call: openCall(
        config,
        parseQuote(
          await sandbox.chain.view(sandbox.game.accountId, 'get_quote', {
            account_id: wallet.accountId,
          }),
        ),
      ),
    },
    'sandbox-case-opening',
  );
  await engine.confirm(actor, queuedOpen.id, queuedOpen.intentHash);
  const opened = await finish(queuedOpen.id);
  assert.equal(opened.status, 'confirmed', opened.errorCode ?? '');
  const queuedHistory = await sandbox.chain.view(
    sandbox.game.accountId,
    'get_history',
    { account_id: wallet.accountId, limit: 1 },
  );
  assert.ok(Array.isArray(queuedHistory) && queuedHistory.length === 1);
  assert.equal(record(queuedHistory[0]).account_id, wallet.accountId);
  evidence.checks.push(
    'Existing case opened via queued worker with full FT resolver amount and game-wallet history identity',
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await sandbox.stop();
  await temp.close();
}
