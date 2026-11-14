import { playerRoute } from '@/player/http';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return playerRoute(request, 'get', (await context.params).id);
}
