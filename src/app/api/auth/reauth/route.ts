import { db } from '@/auth/db';
import {
  inputObject,
  mutationAuth,
  playerError,
  readBoundedJson,
} from '@/auth/player-auth';
import { parseScope, passwordAuthorization } from '@/auth/wallet-service';
export async function POST(request: Request) {
  try {
    const actor = await mutationAuth(request);
    const input = inputObject(await readBoundedJson(request));
    const authorizationId = await passwordAuthorization(
      db,
      actor,
      parseScope(input),
      input.password,
    );
    return Response.json(
      { authorizationId },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return playerError(error);
  }
}
