import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { AuthError, normalizeNickname, validatePassword } from './validation';
import type { PlayerSession } from '../player/types';

export type PublicUser = { id: string; nickname: string };
export type AuthResult = { user: PublicUser; token: string };
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
// A real cost-12 hash keeps missing-user work comparable to a wrong password.
const DUMMY_HASH =
  '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export async function createSession(
  db: PrismaClient,
  user: PublicUser,
  authMethod = 'password',
): Promise<AuthResult> {
  const token = randomBytes(32).toString('base64url');
  const owner = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (owner.disabledAt) throw new AuthError('Unable to authenticate.', 401);
  await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      authVersion: owner.authVersion,
      authMethod,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });
  return { user, token };
}
export async function createAccount(
  db: PrismaClient,
  rawNickname: unknown,
  rawPassword: unknown,
): Promise<AuthResult> {
  const { nickname, nicknameKey } = normalizeNickname(rawNickname);
  const passwordHash = await hash(validatePassword(rawPassword), 12);
  try {
    const user = await db.user.create({
      data: { nickname, nicknameKey, passwordHash, gameWallet: { create: {} } },
      select: { id: true, nickname: true },
    });
    return createSession(db, user);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new AuthError(
        'Unable to create account with those credentials.',
        409,
      );
    throw error;
  }
}
export async function verifyPassword(
  db: PrismaClient,
  userId: string,
  password: unknown,
): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId } });
  const bounded =
    typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 72;
  const valid = await compare(
    bounded ? password : '',
    user?.passwordHash ?? DUMMY_HASH,
  );
  return !!(bounded && valid && user?.passwordHash && !user.disabledAt);
}
export async function login(
  db: PrismaClient,
  rawNickname: unknown,
  rawPassword: unknown,
): Promise<AuthResult> {
  const invalid = new AuthError('Invalid nickname or password.', 401);
  let nicknameKey: string | null = null;
  try {
    nicknameKey = normalizeNickname(rawNickname).nicknameKey;
  } catch {
    /* Still perform the KDF. */
  }
  const user = nicknameKey
    ? await db.user.findUnique({ where: { nicknameKey } })
    : null;
  const bounded =
    typeof rawPassword === 'string' &&
    Buffer.byteLength(rawPassword, 'utf8') <= 72;
  const valid = await compare(
    bounded ? rawPassword : '',
    user?.passwordHash ?? DUMMY_HASH,
  );
  if (!bounded || !valid || !user?.passwordHash || user.disabledAt)
    throw invalid;
  await db.gameWallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });
  return createSession(db, { id: user.id, nickname: user.nickname });
}
export async function resolvePlayerSession(
  db: PrismaClient,
  token: string | undefined,
): Promise<PlayerSession | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (
    !session ||
    session.expiresAt <= new Date() ||
    session.user.disabledAt ||
    session.authVersion !== session.user.authVersion
  )
    return null;
  return {
    sessionId: session.id,
    userId: session.userId,
    tokenHash: session.tokenHash,
    authVersion: session.authVersion,
    authMethod: session.authMethod,
    authenticatedAt: session.authenticatedAt,
    expiresAt: session.expiresAt,
  };
}
export async function resolveSession(
  db: PrismaClient,
  token: string | undefined,
): Promise<PublicUser | null> {
  const session = await resolvePlayerSession(db, token);
  if (!session) return null;
  return db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, nickname: true },
  });
}
export async function revokeSession(
  db: PrismaClient,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await db.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session) return;
    await tx.walletAuthorization.updateMany({
      where: { sessionId: session.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.walletChallenge.updateMany({
      where: { sessionId: session.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.walletOperation.updateMany({
      where: {
        sessionId: session.id,
        status: { in: ['prepared', 'authorized'] },
      },
      data: { status: 'cancelled', errorCode: 'session_revoked' },
    });
    const cancelled = await tx.walletOperation.findMany({
      where: { sessionId: session.id, status: 'cancelled' },
      select: { id: true },
    });
    await tx.gameWallet.updateMany({
      where: {
        activeOperationId: { in: cancelled.map((operation) => operation.id) },
      },
      data: { activeOperationId: null },
    });
    await tx.session.delete({ where: { id: session.id } });
  });
}
