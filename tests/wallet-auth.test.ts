import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  createAccount,
  resolvePlayerSession,
  revokeSession,
} from '../src/auth/service';
import {
  issueWalletChallenge,
  passwordAuthorization,
  verifyWalletChallenge,
} from '../src/auth/wallet-service';
import { rateLimit } from '../src/auth/rate-limit';
import { openTempDb } from './temp-sqlite';

let temp: ReturnType<typeof openTempDb>;
beforeEach(() => {
  temp = openTempDb();
});
afterEach(async () => {
  await temp.close();
});
const origin = 'https://iroh.example';
const binding = 'controlled-browser-binding';
const keys = generateKeyPairSync('ed25519');
function encodeBase58(bytes: Buffer) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${bytes.toString('hex')}`);
  let out = '';
  while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}
const publicKey = `ed25519:${encodeBase58(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))}`;
function signed(
  challenge: {
    id: string;
    message: string;
    recipient: string;
    nonceBase64: string;
  },
  accountId = 'alice.testnet',
) {
  const str = (s: string) => {
    const b = Buffer.from(s);
    const l = Buffer.alloc(4);
    l.writeUInt32LE(b.length);
    return Buffer.concat([l, b]);
  };
  const bytes = Buffer.concat([
    Buffer.from([0x9d, 0x01, 0x00, 0x80]),
    str(challenge.message),
    Buffer.from(challenge.nonceBase64, 'base64'),
    str(challenge.recipient),
    Buffer.from([0]),
  ]);
  const signature = sign(
    null,
    createHash('sha256').update(bytes).digest(),
    keys.privateKey,
  ).toString('base64');
  return { challengeId: challenge.id, accountId, publicKey, signature };
}
const keyVerifier = async (account: string, key: string) => {
  expect(account).toBe('alice.testnet');
  expect(key).toBe(publicKey);
};
async function actor() {
  const account = await createAccount(temp.db, 'Player', 'correct horse');
  const session = await resolvePlayerSession(temp.db, account.token);
  if (!session) throw Error('missing session');
  return { account, session };
}
it('uses a real signed challenge for stable wallet-only login and persistent game wallet', async () => {
  const context = { origin, binding, actor: null };
  const first = await issueWalletChallenge(
    temp.db,
    { purpose: 'login', accountId: 'alice.testnet' },
    context,
  );
  const result = await verifyWalletChallenge(
    temp.db,
    signed(first),
    context,
    keyVerifier,
  );
  expect(result.kind).toBe('login');
  if (result.kind !== 'login') throw Error('wrong result');
  const second = await issueWalletChallenge(
    temp.db,
    { purpose: 'login', accountId: 'alice.testnet' },
    context,
  );
  const again = await verifyWalletChallenge(
    temp.db,
    signed(second),
    context,
    keyVerifier,
  );
  expect(again.kind).toBe('login');
  if (again.kind !== 'login') throw Error('wrong result');
  expect(again.result.user.id).toBe(result.result.user.id);
  expect(await temp.db.gameWallet.count()).toBe(1);
  expect(
    await temp.db.gameWallet.findUnique({
      where: { userId: result.result.user.id },
    }),
  ).toMatchObject({ accountId: null, status: 'unconfigured' });
  await expect(
    verifyWalletChallenge(temp.db, signed(first), context, keyVerifier),
  ).rejects.toThrow('expired');
});
it('rejects tampered signatures, wrong account, wrong browser and wrong origin', async () => {
  const context = { origin, binding, actor: null };
  const challenge = await issueWalletChallenge(
    temp.db,
    { purpose: 'login', accountId: 'alice.testnet' },
    context,
  );
  const proof = signed(challenge);
  await expect(
    verifyWalletChallenge(
      temp.db,
      { ...proof, signature: Buffer.alloc(64).toString('base64') },
      context,
      keyVerifier,
    ),
  ).rejects.toThrow('proof');
  await expect(
    verifyWalletChallenge(
      temp.db,
      { ...proof, accountId: 'bob.testnet' },
      context,
      keyVerifier,
    ),
  ).rejects.toThrow();
  await expect(
    verifyWalletChallenge(
      temp.db,
      proof,
      { ...context, binding: 'other' },
      keyVerifier,
    ),
  ).rejects.toThrow();
  await expect(
    verifyWalletChallenge(
      temp.db,
      proof,
      { ...context, origin: 'https://evil.example' },
      keyVerifier,
    ),
  ).rejects.toThrow();
  expect(await temp.db.user.count()).toBe(0);
});
it('rejects revoked chain keys and expired challenges without consuming valid proofs', async () => {
  const context = { origin, binding, actor: null };
  const challenge = await issueWalletChallenge(
    temp.db,
    { purpose: 'login', accountId: 'alice.testnet' },
    context,
  );
  await expect(
    verifyWalletChallenge(temp.db, signed(challenge), context, async () => {
      throw Error('key revoked');
    }),
  ).rejects.toThrow('revoked');
  await temp.db.walletChallenge.update({
    where: { id: challenge.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    verifyWalletChallenge(temp.db, signed(challenge), context, keyVerifier),
  ).rejects.toThrow('expired');
});
it('requires target-bound fresh password authorization before linking and does not merge profiles', async () => {
  const { session } = await actor();
  const context = { origin, binding, actor: session };
  await expect(
    issueWalletChallenge(
      temp.db,
      {
        purpose: 'link',
        accountId: 'alice.testnet',
        authorizationId: 'invented',
      },
      context,
    ),
  ).rejects.toThrow('Fresh');
  const authorizationId = await passwordAuthorization(
    temp.db,
    session,
    { scope: 'link', targetAccountId: 'alice.testnet' },
    'correct horse',
  );
  await expect(
    issueWalletChallenge(
      temp.db,
      { purpose: 'link', accountId: 'bob.testnet', authorizationId },
      context,
    ),
  ).rejects.toThrow('Fresh');
  const challenge = await issueWalletChallenge(
    temp.db,
    { purpose: 'link', accountId: 'alice.testnet', authorizationId },
    context,
  );
  await expect(
    issueWalletChallenge(
      temp.db,
      { purpose: 'link', accountId: 'alice.testnet', authorizationId },
      context,
    ),
  ).rejects.toThrow('Fresh');
  expect(
    await verifyWalletChallenge(
      temp.db,
      signed(challenge),
      context,
      keyVerifier,
    ),
  ).toEqual({ kind: 'link' });
  const other = await createAccount(temp.db, 'Another', 'another password');
  const otherSession = await resolvePlayerSession(temp.db, other.token);
  if (!otherSession) throw Error('session');
  const grant = await passwordAuthorization(
    temp.db,
    otherSession,
    { scope: 'link', targetAccountId: 'alice.testnet' },
    'another password',
  );
  await expect(
    issueWalletChallenge(
      temp.db,
      { purpose: 'link', accountId: 'alice.testnet', authorizationId: grant },
      { ...context, actor: otherSession },
    ),
  ).rejects.toThrow('cannot be linked');
  expect(await temp.db.user.count()).toBe(2);
});
it('rejects unknown and another players withdrawal operations during reauthentication', async () => {
  const { session } = await actor();
  await expect(
    passwordAuthorization(
      temp.db,
      session,
      { scope: 'withdraw', operationId: 'unknown' },
      'correct horse',
    ),
  ).rejects.toThrow('cannot be authorized');
  await expect(
    passwordAuthorization(
      temp.db,
      session,
      { scope: 'link', targetAccountId: 'alice.testnet' },
      'incorrect',
    ),
  ).rejects.toThrow('authenticate');
});
it('logout consumes pending grants and challenges and invalidates session', async () => {
  const { account, session } = await actor();
  const authorizationId = await passwordAuthorization(
    temp.db,
    session,
    { scope: 'link', targetAccountId: 'alice.testnet' },
    'correct horse',
  );
  const challenge = await issueWalletChallenge(
    temp.db,
    {
      purpose: 'authorize',
      accountId: 'alice.testnet',
      authorization: { scope: 'link', targetAccountId: 'bob.testnet' },
    },
    { origin, binding, actor: session },
  ).catch(() => null);
  expect(challenge).toBeNull();
  await revokeSession(temp.db, account.token);
  expect(
    (
      await temp.db.walletAuthorization.findUniqueOrThrow({
        where: { id: authorizationId },
      })
    ).consumedAt,
  ).not.toBeNull();
  expect(await resolvePlayerSession(temp.db, account.token)).toBeNull();
});
it('persists rate limits in real SQLite across repeated requests', async () => {
  await rateLimit(temp.db, 'test', 'identity', 2);
  await rateLimit(temp.db, 'test', 'identity', 2);
  await expect(rateLimit(temp.db, 'test', 'identity', 2)).rejects.toMatchObject(
    { status: 429 },
  );
  expect(await temp.db.authRateLimit.count()).toBe(1);
});

it('withdraw reauthentication binds the exact immutable owned operation and session', async () => {
  const { account, session } = await actor();
  const wallet = await temp.db.gameWallet.findUniqueOrThrow({
    where: { userId: session.userId },
  });
  const op = await temp.db.walletOperation.create({
    data: {
      userId: session.userId,
      walletId: wallet.id,
      sessionId: session.sessionId,
      authVersion: session.authVersion,
      idempotencyKey: 'op-one',
      kind: 'withdraw',
      requestJson: '{}',
      requestHash: 'request',
      previewJson: '{}',
      intentHash: 'literal-immutable-intent',
      stepsJson: '[]',
      sourceAccountId: 'game.testnet',
      nativeCostCapYocto: '1',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const id = await passwordAuthorization(
    temp.db,
    session,
    { scope: 'withdraw', operationId: op.id },
    'correct horse',
  );
  expect(
    await temp.db.walletAuthorization.findUnique({ where: { id } }),
  ).toMatchObject({
    userId: session.userId,
    sessionId: session.sessionId,
    scope: 'withdraw',
    scopeHash: 'literal-immutable-intent',
    consumedAt: null,
  });
  const second = await createAccount(temp.db, 'Another', 'another password');
  const another = await resolvePlayerSession(temp.db, second.token);
  if (!another) throw Error('session');
  await expect(
    passwordAuthorization(
      temp.db,
      another,
      { scope: 'withdraw', operationId: op.id },
      'another password',
    ),
  ).rejects.toMatchObject({ status: 403 });
  const sameUser = await import('../src/auth/service').then((s) =>
    s.login(temp.db, 'Player', 'correct horse'),
  );
  const otherSession = await resolvePlayerSession(temp.db, sameUser.token);
  if (!otherSession) throw Error('session');
  await expect(
    passwordAuthorization(
      temp.db,
      otherSession,
      { scope: 'withdraw', operationId: op.id },
      'correct horse',
    ),
  ).rejects.toMatchObject({ status: 403 });
  await revokeSession(temp.db, account.token);
  expect(
    (await temp.db.walletOperation.findUniqueOrThrow({ where: { id: op.id } }))
      .status,
  ).toBe('cancelled');
});
it('an already linked wallet can issue a fresh link grant, but cannot reuse the proof', async () => {
  const { session } = await actor();
  await temp.db.externalWallet.create({
    data: {
      userId: session.userId,
      accountId: 'alice.testnet',
      verifiedPublicKey: publicKey,
    },
  });
  const context = { origin, binding, actor: session };
  const challenge = await issueWalletChallenge(
    temp.db,
    {
      purpose: 'authorize',
      accountId: 'alice.testnet',
      authorization: { scope: 'link', targetAccountId: 'bob.testnet' },
    },
    context,
  );
  const result = await verifyWalletChallenge(
    temp.db,
    signed(challenge),
    context,
    keyVerifier,
  );
  expect(result.kind).toBe('authorize');
  if (result.kind !== 'authorize') throw Error('wrong result');
  const grant = await temp.db.walletAuthorization.findUniqueOrThrow({
    where: { id: result.authorizationId },
  });
  expect(grant).toMatchObject({
    scope: 'link',
    method: 'wallet',
    sessionId: session.sessionId,
  });
  await expect(
    verifyWalletChallenge(temp.db, signed(challenge), context, keyVerifier),
  ).rejects.toThrow('expired');
});
it('concurrent verification of the same proof can create only one session and wallet', async () => {
  const context = { origin, binding, actor: null };
  const challenge = await issueWalletChallenge(
    temp.db,
    { purpose: 'login', accountId: 'alice.testnet' },
    context,
  );
  const proof = signed(challenge);
  const results = await Promise.allSettled([
    verifyWalletChallenge(temp.db, proof, context, keyVerifier),
    verifyWalletChallenge(temp.db, proof, context, keyVerifier),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(await temp.db.user.count()).toBe(1);
  expect(await temp.db.gameWallet.count()).toBe(1);
  expect(await temp.db.session.count()).toBe(1);
});
