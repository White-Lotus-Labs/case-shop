import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createAccount,
  resolveSession,
  revokeSession,
} from '../src/auth/service';
import { openTempDb } from './temp-sqlite';
let temp: ReturnType<typeof openTempDb>;
beforeEach(() => {
  temp = openTempDb();
});
afterEach(async () => {
  await temp.close();
});
it('creates one persistent unconfigured wallet without inventing an address', async () => {
  const { user } = await createAccount(temp.db, 'Player', 'correct horse');
  expect(
    await temp.db.gameWallet.findUnique({ where: { userId: user.id } }),
  ).toMatchObject({ status: 'unconfigured', accountId: null, publicKey: null });
});
it('rejects a session after auth epoch changes', async () => {
  const account = await createAccount(temp.db, 'Player', 'correct horse');
  await temp.db.user.update({
    where: { id: account.user.id },
    data: { authVersion: { increment: 1 } },
  });
  expect(await resolveSession(temp.db, account.token)).toBeNull();
});
it('rejects every existing session when the player is disabled', async () => {
  const account = await createAccount(temp.db, 'Player', 'correct horse');
  await temp.db.user.update({
    where: { id: account.user.id },
    data: { disabledAt: new Date() },
  });
  expect(await resolveSession(temp.db, account.token)).toBeNull();
});

it('logout cancels unsigned authorization and releases its wallet lock while retaining submitted locks', async () => {
  const account = await createAccount(temp.db, 'LogoutPlayer', 'correct horse');
  const session = await temp.db.session.findFirstOrThrow({
    where: { userId: account.user.id },
  });
  const wallet = await temp.db.gameWallet.findUniqueOrThrow({
    where: { userId: account.user.id },
  });
  const op = await temp.db.walletOperation.create({
    data: {
      userId: account.user.id,
      walletId: wallet.id,
      sessionId: session.id,
      authVersion: 0,
      idempotencyKey: 'logout-operation',
      kind: 'withdraw',
      requestJson: '{}',
      requestHash: 'hash',
      previewJson: '{}',
      intentHash: 'intent',
      stepsJson: '[]',
      sourceAccountId: 'test.testnet',
      nativeCostCapYocto: '1',
      expiresAt: new Date(Date.now() + 60000),
      status: 'authorized',
    },
  });
  await temp.db.gameWallet.update({
    where: { id: wallet.id },
    data: { activeOperationId: op.id },
  });
  await revokeSession(temp.db, account.token);
  expect(
    (await temp.db.walletOperation.findUniqueOrThrow({ where: { id: op.id } }))
      .status,
  ).toBe('cancelled');
  expect(
    (await temp.db.gameWallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .activeOperationId,
  ).toBeNull();
});
