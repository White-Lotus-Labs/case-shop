import { afterEach, expect, it, vi } from 'vitest';
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('../src/auth/db', () => ({ db: { session: { findUnique: lookup } } }));
import {
  csrfForToken,
  mutationAuth,
  readBoundedJson,
  requireSameOrigin,
  safeEqual,
} from '../src/auth/player-auth';
afterEach(() => vi.unstubAllEnvs());
it('requires the configured exact Origin and rejects cross-site requests', () => {
  vi.stubEnv('IROH_PLAYER_APP_ORIGIN', 'https://iroh.example');
  expect(() =>
    requireSameOrigin(
      new Request('https://iroh.example/api', {
        headers: { origin: 'https://iroh.example' },
      }),
    ),
  ).not.toThrow();
  expect(() =>
    requireSameOrigin(new Request('https://iroh.example/api')),
  ).toThrow('origin');
  expect(() =>
    requireSameOrigin(
      new Request('https://iroh.example/api', {
        headers: { origin: 'https://evil.example' },
      }),
    ),
  ).toThrow('origin');
  expect(() =>
    requireSameOrigin(
      new Request('https://iroh.example/api', {
        headers: {
          origin: 'https://iroh.example',
          'sec-fetch-site': 'cross-site',
        },
      }),
    ),
  ).toThrow('origin');
});
it('fails closed when a production origin is absent', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('IROH_PLAYER_APP_ORIGIN', '');
  expect(() =>
    requireSameOrigin(
      new Request('https://iroh.example/api', {
        headers: { origin: 'https://iroh.example' },
      }),
    ),
  ).toThrow('not configured');
});
it('bounds actual body bytes even when Content-Length is absent', async () => {
  await expect(
    readBoundedJson(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ data: 'x'.repeat(100) }),
      }),
      20,
    ),
  ).rejects.toMatchObject({ status: 413 });
  expect(
    await readBoundedJson(
      new Request('http://localhost/api', { method: 'POST', body: '{"a":1}' }),
    ),
  ).toEqual({ a: 1 });
});
it('CSRF tokens are session-derived and comparison rejects differing lengths', () => {
  expect(csrfForToken('first')).not.toBe(csrfForToken('second'));
  expect(safeEqual(csrfForToken('first'), csrfForToken('first'))).toBe(true);
  expect(safeEqual('x', 'xx')).toBe(false);
});
it('financial mutation rejects unauthenticated requests before accepting csrf', async () => {
  vi.stubEnv('IROH_PLAYER_APP_ORIGIN', 'https://iroh.example');
  await expect(
    mutationAuth(
      new Request('https://iroh.example/api', {
        method: 'POST',
        headers: {
          origin: 'https://iroh.example',
          'x-player-csrf': 'invented',
        },
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
});

it('financial mutations require the CSRF token for the exact live cookie session', async () => {
  vi.stubEnv('IROH_PLAYER_APP_ORIGIN', 'https://iroh.example');
  const raw = 'a'.repeat(43);
  const future = new Date(Date.now() + 60_000);
  lookup.mockResolvedValue({
    id: 'session',
    userId: 'player',
    tokenHash: 'stored-hash',
    authVersion: 0,
    authMethod: 'password',
    authenticatedAt: new Date(),
    expiresAt: future,
    user: { authVersion: 0, disabledAt: null },
  });
  const make = (csrf: string) =>
    new Request('https://iroh.example/api', {
      method: 'POST',
      headers: {
        origin: 'https://iroh.example',
        cookie: `tea_session=${raw}`,
        'x-player-csrf': csrf,
      },
    });
  await expect(mutationAuth(make('invented'))).rejects.toMatchObject({
    status: 403,
  });
  expect(await mutationAuth(make(csrfForToken(raw)))).toMatchObject({
    userId: 'player',
    sessionId: 'session',
  });
});
