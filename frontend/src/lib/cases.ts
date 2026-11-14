import { nativeCaseCatalog } from "../../../src/case/nativeCatalog";

export const CASES = nativeCaseCatalog;

/** Format atomic quantities without converting balances to floating point. */
export function formatAmount(amount: string, decimals = 24, precision = 6) {
  const value = BigInt(amount);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, precision)
    .replace(/0+$/, "");
  if (value !== 0n && whole === 0n && !fraction)
    return `<0.${"0".repeat(Math.max(0, precision - 1))}1`;
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
export const fmt = (amount: string) => `${formatAmount(amount)} NEAR`;
