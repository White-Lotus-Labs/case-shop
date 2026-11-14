import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PlayerWalletError } from './errors';
export const uint = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(39)
  .refine((v) => BigInt(v) < 2n ** 128n);
export const callSchema = z
  .object({
    receiverId: z.string().max(64),
    methodName: z.string().max(64),
    args: z.record(z.string(), z.unknown()),
    gas: uint,
    deposit: uint,
  })
  .strict();
export const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('game-call'), call: callSchema }).strict(),
  z
    .object({
      kind: z.literal('withdraw'),
      tokenId: z.string().max(64),
      recipient: z.string().max(64),
      amount: z.string().max(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal('deposit'),
      tokenId: z.string().max(64),
      sourceAccountId: z.string().max(64),
      amount: z.string().max(80),
    })
    .strict(),
]);
export function testnetAddress(value: unknown): string {
  const text = z.string().min(2).max(64).parse(value);
  if (
    !/^[0-9a-f]{64}$/.test(text) &&
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(text)
  )
    throw new PlayerWalletError(
      400,
      'invalid_recipient',
      'Use an existing NEAR Testnet account.',
    );
  return text;
}
export function decimalAtomic(input: string, decimals: number): string {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 24 ||
    input.length > 80
  )
    throw new PlayerWalletError(
      400,
      'invalid_amount',
      'Invalid token precision.',
    );
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(input);
  if (!match || (match[2]?.length ?? 0) > decimals)
    throw new PlayerWalletError(
      400,
      'invalid_amount',
      `Use at most ${decimals} decimal places.`,
    );
  const amount =
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt((match[2] ?? '').padEnd(decimals, '0') || '0');
  if (amount <= 0n || amount >= 2n ** 128n)
    throw new PlayerWalletError(
      400,
      'invalid_amount',
      'Amount is outside the supported range.',
    );
  return amount.toString();
}
export function stableJson(value: unknown): string {
  const normalized = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalized)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, normalized(x)]),
          )
        : v;
  return JSON.stringify(normalized(value));
}
export function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
export function unknownAccount(error: unknown): boolean {
  if (!(error instanceof Error) || !('rpcError' in error)) return false;
  const value = stableJson(error.rpcError);
  return (
    value.includes('UNKNOWN_ACCOUNT') || value.includes('UNKNOWN_ACCESS_KEY')
  );
}
export const object = z.record(z.string(), z.unknown());
export function integer(value: unknown): string {
  return uint.parse(
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value,
  );
}
