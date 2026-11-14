import { playerRoute } from '@/player/http';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return playerRoute(request, 'cancel', (await context.params).id);
}
