import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/auth/db';
import {
  appOrigin,
  cookieToken,
  inputObject,
  mutationAuth,
  playerError,
  readBoundedJson,
  requireSameOrigin,
} from '@/auth/player-auth';
import {
  issueWalletChallenge,
  parseScope,
  type ChallengeInput,
} from '@/auth/wallet-service';
import { testnetAccount } from '@/auth/wallet-proof';
import { AuthError } from '@/auth/validation';
import { sessionCookieOptions } from '@/auth/cookie';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = inputObject(await readBoundedJson(request));
    const accountId = testnetAccount(input.accountId);
    let parsed: ChallengeInput;
    if (input.purpose === 'login') parsed = { purpose: 'login', accountId };
    else if (
      input.purpose === 'link' &&
      typeof input.authorizationId === 'string'
    )
      parsed = {
        purpose: 'link',
        accountId,
        authorizationId: input.authorizationId,
      };
    else if (input.purpose === 'authorize')
      parsed = {
        purpose: 'authorize',
        accountId,
        authorization: parseScope(input),
      };
    else throw new AuthError('Invalid wallet challenge purpose.');
    const actor =
      parsed.purpose === 'login' ? null : await mutationAuth(request);
    const existing = cookieToken(request, 'iroh_wallet_binding');
    const binding =
      existing && /^[A-Za-z0-9_-]{43}$/.test(existing)
        ? existing
        : randomBytes(32).toString('base64url');
    const challenge = await issueWalletChallenge(db, parsed, {
      origin: appOrigin(request),
      binding,
      actor,
    });
    const response = NextResponse.json(
      { challenge },
      { headers: { 'cache-control': 'no-store' } },
    );
    response.cookies.set('iroh_wallet_binding', binding, {
      ...sessionCookieOptions(process.env.NODE_ENV === 'production'),
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return playerError(error);
  }
}
