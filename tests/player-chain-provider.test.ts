import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseEncode, SignedTransaction } from 'near-api-js';
import {
  finalizeNearTransaction,
  prepareNearTransaction,
  TestnetRpc,
} from '../src/game-wallet/chain';
import {
  createKmsManagedSigner,
  crc32c,
  type KmsTransport,
} from '../src/game-wallet/kms';
import { signerConfiguration } from '../src/game-wallet/config';

const ring = 'projects/test-project/locations/global/keyRings/iroh';
const walletId = '12345678-1234-4234-8234-123456789abc';
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const jwk = pair.publicKey.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('Missing fixture public key.');
  const publicKey = `ed25519:${baseEncode(Buffer.from(jwk.x, 'base64url'))}`;
  const pem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const client: KmsTransport = {
    createCryptoKey: vi.fn(async () => ({})),
    getCryptoKeyVersion: vi.fn(async ({ name }) => ({
      name,
      state: 'ENABLED',
      algorithm: 'EC_SIGN_ED25519',
      protectionLevel: 'SOFTWARE',
    })),
    getPublicKey: vi.fn(async ({ name }) => ({
      name,
      algorithm: 'EC_SIGN_ED25519',
      protectionLevel: 'SOFTWARE',
      pem,
      pemCrc32c: { value: crc32c(Buffer.from(pem)) },
    })),
    asymmetricSign: vi.fn(async ({ name, data, dataCrc32c }) => {
      expect(dataCrc32c.value).toBe(crc32c(data));
      const signature = sign(null, data, pair.privateKey);
      return {
        name,
        signature,
        signatureCrc32c: { value: crc32c(signature) },
        verifiedDataCrc32c: true,
      };
    }),
  };
  return {
    pair,
    publicKey,
    client,
    signer: createKmsManagedSigner(ring, client),
  };
}
function prepared(publicKey: string) {
  return prepareNearTransaction({
    signerId: 'game.testnet',
    publicKey,
    nonce: '7',
    blockHash: baseEncode(new Uint8Array(32).fill(4)),
    call: {
      receiverId: 'usdi-needmore-1-near.testnet',
      methodName: 'ft_transfer',
      args: { receiver_id: 'alice.testnet', amount: '1000000' },
      gas: '30000000000000',
      deposit: '1',
    },
  });
}
afterEach(() => vi.unstubAllEnvs());

describe('offline NEAR transaction boundary', () => {
  it('serializes through official NEAR code and verifies a real Ed25519 signature over its hash', () => {
    const { pair, publicKey } = fixture();
    const tx = prepared(publicKey);
    expect(Buffer.from(tx.hash)).toEqual(
      createHash('sha256')
        .update(Buffer.from(tx.unsignedBase64, 'base64'))
        .digest(),
    );
    const result = finalizeNearTransaction(
      tx.unsignedBase64,
      sign(null, tx.hash, pair.privateKey),
      publicKey,
    );
    expect(result.txHash).toBe(tx.txHash);
    const decoded = SignedTransaction.decode(
      Buffer.from(result.signedBase64, 'base64'),
    );
    expect(decoded.transaction.signerId).toBe('game.testnet');
    expect(decoded.transaction.receiverId).toBe('usdi-needmore-1-near.testnet');
    expect(decoded.transaction.nonce).toBe(7n);
    expect(decoded.transaction.actions[0].functionCall?.deposit).toBe(1n);
  });
  it('rejects another key, invalid signatures and noncanonical base64', () => {
    const first = fixture(),
      second = fixture(),
      tx = prepared(first.publicKey);
    const signature = sign(null, tx.hash, first.pair.privateKey);
    expect(() =>
      finalizeNearTransaction(tx.unsignedBase64, signature, second.publicKey),
    ).toThrow('key mismatch');
    expect(() =>
      finalizeNearTransaction(
        tx.unsignedBase64,
        new Uint8Array(64),
        first.publicKey,
      ),
    ).toThrow('signature');
    expect(() =>
      finalizeNearTransaction(
        `${tx.unsignedBase64}\n`,
        signature,
        first.publicKey,
      ),
    ).toThrow('encoding');
  });
});

describe('managed signing adapter', () => {
  it('allocates the same version1 reference after a create conflict and signs only a pinned key', async () => {
    const { signer, client, publicKey } = fixture();
    vi.mocked(client.createCryptoKey).mockRejectedValueOnce({ code: 6 });
    const allocation = await signer.allocate(walletId);
    expect(allocation.keyVersion).toBe(
      `${ring}/cryptoKeys/player-12345678123442348234123456789abc/cryptoKeyVersions/1`,
    );
    expect(allocation.publicKey).toBe(publicKey);
    expect(allocation.accountId).toMatch(/^[0-9a-f]{64}$/);
    const tx = prepared(publicKey);
    const signature = await signer.signHash(
      allocation.keyVersion,
      publicKey,
      tx.hash,
    );
    expect(
      finalizeNearTransaction(tx.unsignedBase64, signature, publicKey).txHash,
    ).toBe(tx.txHash);
    expect(await signer.allocate(walletId)).toEqual(allocation);
  });
  it('checks the standard CRC32C vector', () => {
    expect(crc32c(Buffer.from('123456789'))).toBe(0xe3069283);
  });
  it('fails closed on public key CRC corruption and disabled versions', async () => {
    const { signer, client } = fixture();
    vi.mocked(client.getPublicKey).mockResolvedValueOnce({
      name: `${ring}/cryptoKeys/player-12345678123442348234123456789abc/cryptoKeyVersions/1`,
      algorithm: 40,
      protectionLevel: 1,
      pem: 'bad',
      pemCrc32c: { value: 0 },
    });
    await expect(signer.allocate(walletId)).rejects.toThrow('integrity');
    vi.mocked(client.getCryptoKeyVersion).mockResolvedValueOnce({
      name: 'wrong',
      state: 'DISABLED',
    });
    await expect(signer.allocate(walletId)).rejects.toThrow(
      'configuration mismatch',
    );
  });
  it('rejects wrong public keys, versions, hash length, CRC and unverified requests', async () => {
    const { signer, client, publicKey } = fixture();
    const allocation = await signer.allocate(walletId);
    await expect(
      signer.signHash(
        allocation.keyVersion,
        fixture().publicKey,
        new Uint8Array(32),
      ),
    ).rejects.toThrow('Pinned');
    await expect(
      signer.signHash(
        allocation.keyVersion.replace('/1', '/2'),
        publicKey,
        new Uint8Array(32),
      ),
    ).rejects.toThrow('version');
    await expect(
      signer.signHash(allocation.keyVersion, publicKey, new Uint8Array(31)),
    ).rejects.toThrow('32-byte');
    vi.mocked(client.asymmetricSign).mockResolvedValueOnce({
      name: allocation.keyVersion,
      verifiedDataCrc32c: false,
    });
    await expect(
      signer.signHash(allocation.keyVersion, publicKey, new Uint8Array(32)),
    ).rejects.toThrow('integrity');
    vi.mocked(client.asymmetricSign).mockResolvedValueOnce({
      name: allocation.keyVersion,
      verifiedDataCrc32c: true,
      signature: new Uint8Array(64),
      signatureCrc32c: { value: 0 },
    });
    await expect(
      signer.signHash(allocation.keyVersion, publicKey, new Uint8Array(32)),
    ).rejects.toThrow('integrity');
    const badSignature = new Uint8Array(64);
    vi.mocked(client.asymmetricSign).mockResolvedValueOnce({
      name: allocation.keyVersion,
      verifiedDataCrc32c: true,
      signature: badSignature,
      signatureCrc32c: { value: crc32c(badSignature) },
    });
    await expect(
      signer.signHash(allocation.keyVersion, publicKey, new Uint8Array(32)),
    ).rejects.toThrow('verification');
  });
});

describe('fixed Testnet RPC', () => {
  it('rejects mainnet/local endpoints and write-method bypasses', async () => {
    expect(() => new TestnetRpc('https://rpc.mainnet.near.org')).toThrow(
      'Testnet',
    );
    expect(() => new TestnetRpc('http://localhost:3030')).toThrow('Testnet');
    const request = vi.fn<typeof fetch>();
    await expect(
      new TestnetRpc(undefined, request).call('broadcast_tx_commit', []),
    ).rejects.toThrow('read-only');
    expect(request).not.toHaveBeenCalled();
  });
  it('requires reported chain_id testnet and never retries a broadcast timeout', async () => {
    vi.stubEnv('IROH_PLAYER_TESTNET_WRITES_ENABLED', '1');
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: { chain_id: 'testnet' } }))
      .mockRejectedValueOnce(new Error('timeout'));
    const rpc = new TestnetRpc(undefined, request);
    await expect(rpc.broadcast('AQ==')).rejects.toThrow('timeout');
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).method).toBe(
      'broadcast_tx_async',
    );
    const wrong = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ result: { chain_id: 'mainnet' } }));
    await expect(
      new TestnetRpc(undefined, wrong).assertNetwork(),
    ).rejects.toThrow('Testnet');
  });
  it('disables public writes by default, retries reads once and parses final view bytes', async () => {
    vi.stubEnv('IROH_PLAYER_TESTNET_WRITES_ENABLED', '');
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(
        Response.json({ result: { result: Array.from(Buffer.from('"123"')) } }),
      );
    const rpc = new TestnetRpc(undefined, request);
    await expect(rpc.broadcast('AQ==')).rejects.toThrow('disabled');
    expect(
      await rpc.view('token.testnet', 'ft_balance_of', {
        account_id: 'alice.testnet',
      }),
    ).toBe('123');
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(request.mock.calls[1][1]?.body)).params.finality,
    ).toBe('final');
  });
  it('reports missing configuration without loading provider credentials', () => {
    vi.stubEnv('IROH_PLAYER_KMS_KEY_RING', '');
    expect(signerConfiguration()).toEqual({
      configured: false,
      reason: 'Managed signing is not configured.',
    });
  });
});
