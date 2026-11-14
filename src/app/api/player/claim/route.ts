import { playerRoute } from '@/player/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return playerRoute(request, 'claim');
}
