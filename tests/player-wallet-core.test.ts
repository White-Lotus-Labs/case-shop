import { describe, expect, it } from 'vitest';
import {
  decimalAtomic,
  testnetAddress,
  stableJson,
} from '../src/player/validation';
import { ensureGameWallet } from '../src/player/accounts';
import { openTempDb } from './temp-sqlite';

describe('player wallet input boundaries', () => {
  it('uses exact integer arithmetic for6/18/24-decimal tokens', () => {
    expect(decimalAtomic('1.000001', 6)).toBe('1000001');
    expect(decimalAtomic('0.000000000000000001', 18)).toBe('1');
    expect(decimalAtomic('2.5', 24)).toBe('2500000000000000000000000');
    for (const amount of [
      '1e6',
      '-1',
      '0',
      '01',
      '1.0000001',
      'NaN',
      'Infinity',
    ])
      expect(() => decimalAtomic(amount, 6)).toThrow();
    expect(() =>
      decimalAtomic('9999999999999999999999999999999999999999', 24),
    ).toThrow();
  });
  it('acceptsTestnet names and Ed25519 implicit addresses only', () => {
    expect(testnetAddress('player.testnet')).toBe('player.testnet');
    expect(testnetAddress('a'.repeat(64))).toBe('a'.repeat(64));
    for (const value of [
      'player.near',
      'near',
      '0x1234',
      'evil.testnet.near',
      'https://rpc.testnet.near.org',
    ])
      expect(() => testnetAddress(value)).toThrow();
  });
  it('canonicalizes request order without losing JSON types', () => {
    expect(stableJson({ b: 1, a: true })).toBe('{"a":true,"b":1}');
    expect(stableJson({ a: true })).not.toBe(stableJson({ a: 1 }));
  });
});
it('persists exactly one wallet association across sessions and never invents an address', async () => {
  const { db, close } = openTempDb();
  try {
    const user = await db.user.create({
      data: {
        nickname: 'walletuser',
        nicknameKey: 'walletuser',
        passwordHash: 'controlled-test-hash',
      },
    });
    const first = await ensureGameWallet(db, user.id);
    const second = await ensureGameWallet(db, user.id);
    expect(second.id).toBe(first.id);
    expect(first.accountId).toBeNull();
    expect(first.publicKey).toBeNull();
    expect(first.status).toBe('unconfigured');
    expect(await db.gameWallet.count({ where: { userId: user.id } })).toBe(1);
  } finally {
    await close();
  }
});
