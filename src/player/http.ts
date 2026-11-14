import { z } from 'zod';
import { db } from '../auth/db';
import {
  cookieToken,
  csrfForToken,
  mutationAuth,
  playerSession,
  playerError,
  readBoundedJson,
} from '../auth/player-auth';
import { PlayerWalletError } from './errors';
import {
  playerProfile,
  readBalance,
  readClaim,
  refreshWallet,
  requestProvision,
  publicWallet,
} from './profile';
import { TestnetRpc } from '../game-wallet/chain';
import { WalletEngine } from '../game-wallet/operations';
import { requestSchema } from './validation';
const chain = new TestnetRpc();
const engine = new WalletEngine(db, chain);
export async function playerRoute(
  request: Request,
  action: string,
  id?: string,
): Promise<Response> {
  try {
    const actor =
      request.method === 'GET'
        ? await playerSession(request)
        : await mutationAuth(request);
    if (!actor)
      throw new PlayerWalletError(
        401,
        'authentication_required',
        'Sign in to view your player wallet.',
      );
    if (
      request.method === 'POST' &&
      ['provision', 'refresh', 'cancel'].includes(action)
    )
      z.object({})
        .strict()
        .parse(await readBoundedJson(request));
    let result: unknown;
    if (action === 'profile')
      result = await playerProfile(
        db,
        actor,
        csrfForToken(cookieToken(request)!),
      );
    else if (action === 'balance')
      result = await readBalance(
        db,
        actor.userId,
        new URL(request.url).searchParams.get('token') ?? '',
        chain,
      );
    else if (action === 'claim')
      result = await readClaim(db, actor.userId, chain);
    else if (action === 'provision')
      result = { gameWallet: await requestProvision(db, actor) };
    else if (action === 'refresh')
      result = {
        gameWallet: publicWallet(await refreshWallet(db, actor.userId, chain)),
      };
    else if (action === 'list')
      result = { operations: await engine.list(actor) };
    else if (action === 'prepare') {
      const body = z
        .record(z.string(), z.unknown())
        .parse(await readBoundedJson(request));
      const { idempotencyKey, ...input } = body;
      result = {
        operation: await engine.prepare(
          actor,
          requestSchema.parse(input),
          z.string().parse(idempotencyKey),
        ),
      };
    } else if (action === 'get')
      result = { operation: await engine.reconcileExternal(actor, id!) };
    else if (action === 'confirm') {
      const b = z
        .object({
          intentHash: z.string().regex(/^[a-f0-9]{64}$/),
          authorizationId: z.string().optional(),
        })
        .strict()
        .parse(await readBoundedJson(request));
      result = {
        operation: await engine.confirm(
          actor,
          id!,
          b.intentHash,
          b.authorizationId,
        ),
      };
    } else if (action === 'receipt') {
      const b = z
        .object({
          stepIndex: z.number().int().min(0).max(10),
          hash: z.string(),
        })
        .strict()
        .parse(await readBoundedJson(request));
      result = {
        operation: await engine.externalReceipt(
          actor,
          id!,
          b.stepIndex,
          b.hash,
        ),
      };
    } else if (action === 'cancel')
      result = { operation: await engine.cancel(actor, id!) };
    else throw new PlayerWalletError(404, 'not_found', 'Not found.');
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return playerError(
      error instanceof z.ZodError
        ? new PlayerWalletError(400, 'invalid_request', 'Invalid request.')
        : error,
    );
  }
}
