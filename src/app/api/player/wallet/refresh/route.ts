import { playerRoute } from '@/player/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return playerRoute(request, 'refresh');
}
