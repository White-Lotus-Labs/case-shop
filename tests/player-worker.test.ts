import { generateKeyPairSync, sign } from 'node:crypto';
import { baseEncode } from 'near-api-js';
import { expect, it, vi } from 'vitest';
import { openTempDb } from './temp-sqlite';
import { SigningWorker } from '../src/game-wallet/worker';
import { stableJson } from '../src/player/validation';
import type { ChainPort } from '../src/game-wallet/chain';

it('persists before sending and never rebroadcasts or allocates a new nonce after an unknown send', async () => {
  const { db, close } = openTempDb();
  const pair = generateKeyPairSync('ed25519');
  const x = pair.publicKey.export({ format: 'jwk' }).x!;
  const publicKey = 'ed25519:' + baseEncode(Buffer.from(x, 'base64url'));
  let signed = 0;
  const call = {
    receiverId: 'token.testnet',
    methodName: 'ft_transfer',
    args: { amount: '1', receiver_id: 'recipient.testnet' },
    gas: '50000000000000',
    deposit: '1',
  };
  const chain: ChainPort = {
    network: 'sandbox',
    assertNetwork: async () => {},
    view: async () => {
      throw Error('Unexpected view');
    },
    call: vi.fn(async () => {
      throw Error('RPC timeout');
    }),
    broadcast: vi.fn(async () => {
      const persisted = await db.gameTransaction.findFirstOrThrow();
      expect(persisted.signedBase64).toBeTruthy();
      expect(persisted.sendAttemptedAt).not.toBeNull();
      throw Error('Unknown network send');
    }),
  };
  try {
    const user = await db.user.create({
      data: { nickname: 'worker', nicknameKey: 'worker' },
    });
    const wallet = await db.gameWallet.create({
      data: {
        userId: user.id,
        status: 'active',
        accountId: 'game.testnet',
        publicKey,
        keyVersion: 'controlled-test-version',
      },
    });
    await db.session.create({
      data: {
        id: 'test',
        userId: user.id,
        tokenHash: 'controlled-test-token',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const op = await db.walletOperation.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        sessionId: 'test',
        authVersion: 0,
        idempotencyKey: 'worker-operation',
        kind: 'withdraw',
        requestJson: '{}',
        requestHash: 'test',
        previewJson: '{}',
        intentHash: 'test',
        stepsJson: stableJson([call]),
        sourceAccountId: 'game.testnet',
        nativeCostCapYocto: '1',
        expiresAt: new Date(Date.now() + 60000),
        status: 'signing',
      },
    });
    const { prepareNearTransaction, finalizeNearTransaction } = await import(
      '../src/game-wallet/chain'
    );
    const unsigned = prepareNearTransaction({
      signerId: 'game.testnet',
      publicKey,
      nonce: '7',
      blockHash: baseEncode(new Uint8Array(32).fill(3)),
      call,
    });
    await db.gameTransaction.create({
      data: {
        operationId: op.id,
        stepIndex: 0,
        callJson: stableJson(call),
        nonce: '7',
        blockHash: baseEncode(new Uint8Array(32).fill(3)),
        signedBase64: finalizeNearTransaction(
          unsigned.unsignedBase64,
          sign(null, unsigned.hash, pair.privateKey),
          publicKey,
        ).signedBase64,
        unsignedBase64: unsigned.unsignedBase64,
        txHash: unsigned.txHash,
      },
    });
    await db.gameWallet.update({
      where: { id: wallet.id },
      data: { activeOperationId: op.id },
    });
    const worker = new SigningWorker(db, chain, {
      allocate: async () => {
        throw Error('Never allocate');
      },
      signHash: async (_version, key, hash) => {
        expect(key).toBe(publicKey);
        signed++;
        return sign(null, hash, pair.privateKey);
      },
    });
    const stored = await db.gameTransaction.findFirstOrThrow();
    const tampered = prepareNearTransaction({
      signerId: 'game.testnet',
      publicKey,
      nonce: '7',
      blockHash: baseEncode(new Uint8Array(32).fill(3)),
      call: { ...call, receiverId: 'forbidden.testnet' },
    });
    await db.gameTransaction.update({
      where: { id: stored.id },
      data: { unsignedBase64: tampered.unsignedBase64 },
    });
    await worker.tick();
    expect(chain.broadcast).not.toHaveBeenCalled();
    expect(signed).toBe(0);
    await db.gameTransaction.update({
      where: { id: stored.id },
      data: { unsignedBase64: unsigned.unsignedBase64 },
    });
    await worker.tick();
    await worker.tick();
    expect(chain.broadcast).toHaveBeenCalledTimes(1);
    expect(signed).toBe(0);
    expect(
      (await db.walletOperation.findUniqueOrThrow({ where: { id: op.id } }))
        .status,
    ).toBe('unknown');
    expect(
      (await db.gameWallet.findUniqueOrThrow({ where: { id: wallet.id } }))
        .activeOperationId,
    ).toBe(op.id);
    expect(await db.gameTransaction.count()).toBe(1);
  } finally {
    await close();
  }
});
it('refuses public signing before even contacting a chain or provider when activation is disabled', async () => {
  const { db, close } = openTempDb();
  const assertNetwork = vi.fn();
  const allocate = vi.fn();
  try {
    const worker = new SigningWorker(
      db,
      {
        network: 'testnet',
        assertNetwork,
        call: vi.fn(),
        view: vi.fn(),
        broadcast: vi.fn(),
      },
      { allocate, signHash: vi.fn() },
    );
    await expect(worker.tick()).rejects.toThrow('disabled');
    expect(assertNetwork).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});

it('rotates beyond the first25 unresolved wallets instead of starving new allocations', async () => {
  const { db, close } = openTempDb();
  let allocated = 0;
  try {
    for (let i = 0; i < 26; i++) {
      const user = await db.user.create({
        data: { nickname: `queued${i}`, nicknameKey: `queued${i}` },
      });
      await db.gameWallet.create({
        data: {
          userId: user.id,
          status: i === 25 ? 'allocating' : 'active',
          activeOperationId: i === 25 ? null : `unresolved-${i}`,
          updatedAt: new Date(i === 25 ? '2001-01-01' : '2000-01-01'),
        },
      });
    }
    const worker = new SigningWorker(
      db,
      {
        network: 'sandbox',
        assertNetwork: async () => {},
        call: vi.fn(),
        view: vi.fn(),
        broadcast: vi.fn(),
      },
      {
        allocate: async () => {
          allocated++;
          return {
            accountId: 'a'.repeat(64),
            publicKey: 'ed25519:controlled',
            keyVersion: 'controlled-key',
          };
        },
        signHash: vi.fn(),
      },
    );
    await worker.tick();
    expect(allocated).toBe(0);
    await worker.tick();
    expect(allocated).toBe(1);
    expect(await db.gameWallet.count({ where: { status: 'allocated' } })).toBe(
      1,
    );
  } finally {
    await close();
  }
});
