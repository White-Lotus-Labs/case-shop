import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { SESSION_COOKIE } from './cookie';
import { resolvePlayerSession } from './service';
import { AuthError } from './validation';
import type { PlayerSession } from '../player/types';
import { PlayerWalletError } from '../player/errors';

export function cookieToken(
  request: Request,
  name = SESSION_COOKIE,
): string | undefined {
  const value = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value;
}
export function appOrigin(request: Request): string {
  const configured = process.env.IROH_PLAYER_APP_ORIGIN;
  if (configured) {
    const url = new URL(configured);
    if (
      url.origin !== configured ||
      (url.protocol !== 'https:' &&
        !(
          process.env.NODE_ENV !== 'production' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    )
      throw new AuthError(
        'Player authentication origin is not configured.',
        503,
      );
    return url.origin;
  }
  const url = new URL(request.url);
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1'].includes(url.hostname)
  )
    throw new AuthError('Player authentication origin is not configured.', 503);
  return url.origin;
}
export function requireSameOrigin(request: Request): void {
  const origin = appOrigin(request);
  if (
    request.headers.get('origin') !== origin ||
    !['same-origin', 'none', null].includes(
      request.headers.get('sec-fetch-site'),
    )
  )
    throw new AuthError('Request origin was not accepted.', 403);
}
export function csrfForToken(rawSessionToken: string): string {
  return createHash('sha256')
    .update(`iroh-player-csrf-v1\0${rawSessionToken}`)
    .digest('base64url');
}
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function playerSession(
  request: Request,
): Promise<PlayerSession | null> {
  return resolvePlayerSession(db, cookieToken(request));
}
export async function mutationAuth(request: Request): Promise<PlayerSession> {
  requireSameOrigin(request);
  const token = cookieToken(request);
  const session = await resolvePlayerSession(db, token);
  if (!session || !token) throw new AuthError('Authentication required.', 401);
  if (
    !safeEqual(request.headers.get('x-player-csrf') ?? '', csrfForToken(token))
  )
    throw new AuthError('Request authorization failed.', 403);
  return session;
}
export async function readBoundedJson(
  request: Request,
  limit = 8192,
): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new AuthError('Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('Invalid request body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new AuthError('Request is too large.', 413);
    }
    chunks.push(item.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AuthError('Invalid request body.');
  }
}
export function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AuthError('Invalid request body.');
  return Object.fromEntries(Object.entries(value));
}
export function playerError(error: unknown): Response {
  return Response.json(
    {
      error:
        error instanceof AuthError || error instanceof PlayerWalletError
          ? error.message
          : 'Unable to complete the request.',
      ...(error instanceof PlayerWalletError ? { code: error.code } : {}),
    },
    {
      status:
        error instanceof AuthError || error instanceof PlayerWalletError
          ? error.status
          : 500,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
