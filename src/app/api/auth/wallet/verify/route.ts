import { NextResponse } from 'next/server';
import { db } from '@/auth/db';
import {
  appOrigin,
  cookieToken,
  inputObject,
  mutationAuth,
  playerError,
  playerSession,
  readBoundedJson,
  requireSameOrigin,
} from '@/auth/player-auth';
import { verifyWalletChallenge } from '@/auth/wallet-service';
import { AuthError } from '@/auth/validation';
import { revokeSession } from '@/auth/service';
import { SESSION_COOKIE, sessionCookieOptions } from '@/auth/cookie';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = inputObject(await readBoundedJson(request));
    if (
      typeof input.challengeId !== 'string' ||
      typeof input.accountId !== 'string' ||
      typeof input.publicKey !== 'string' ||
      typeof input.signature !== 'string'
    )
      throw new AuthError('Invalid wallet proof.');
    const binding = cookieToken(request, 'iroh_wallet_binding');
    if (!binding)
      throw new AuthError('Wallet authentication must be restarted.', 401);
    const challenge = await db.walletChallenge.findUnique({
      where: { id: input.challengeId },
    });
    const actor =
      challenge?.purpose === 'login'
        ? await playerSession(request)
        : await mutationAuth(request);
    const result = await verifyWalletChallenge(
      db,
      {
        challengeId: input.challengeId,
        accountId: input.accountId,
        publicKey: input.publicKey,
        signature: input.signature,
      },
      { origin: appOrigin(request), binding, actor },
    );
    if (result.kind === 'login') {
      await revokeSession(db, cookieToken(request));
      const response = NextResponse.json(
        { user: result.result.user },
        { headers: { 'cache-control': 'no-store' } },
      );
      response.cookies.set(
        SESSION_COOKIE,
        result.result.token,
        sessionCookieOptions(process.env.NODE_ENV === 'production'),
      );
      return response;
    }
    return NextResponse.json(
      result.kind === 'link'
        ? { linked: true }
        : { authorizationId: result.authorizationId },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return playerError(error);
  }
}
