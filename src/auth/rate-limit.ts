import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AuthError } from './validation';

export async function rateLimit(
  db: PrismaClient,
  category: string,
  subject: string,
  limit = 10,
  windowMs = 15 * 60_000,
) {
  const key = createHash('sha256')
    .update(`${category}\0${subject}`)
    .digest('hex');
  const now = new Date();
  await db.authRateLimit.upsert({
    where: { key },
    create: { key, count: 0, windowStartedAt: now },
    update: {},
  });
  await db.authRateLimit.updateMany({
    where: {
      key,
      windowStartedAt: { lte: new Date(now.getTime() - windowMs) },
    },
    data: { count: 0, windowStartedAt: now },
  });
  const result = await db.authRateLimit.updateMany({
    where: { key, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });
  if (result.count !== 1)
    throw new AuthError('Too many attempts. Try again later.', 429);
}
export async function credentialRateLimit(
  db: PrismaClient,
  request: Request,
  nickname: unknown,
  action: string,
) {
  // Do not trust arbitrary forwarding headers; deployments may supply a verified edge identity.
  const subject =
    typeof nickname === 'string'
      ? nickname.trim().toLowerCase().slice(0, 128)
      : 'invalid';
  await rateLimit(db, `${action}-global`, 'application', 300, 60_000);
  await rateLimit(
    db,
    `${action}-identity`,
    subject,
    action === 'register' ? 5 : 10,
  );
}
