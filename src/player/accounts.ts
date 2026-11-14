import type { PrismaClient } from '@prisma/client';
export async function ensureGameWallet(database: PrismaClient, userId: string) {
  return database.gameWallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}
