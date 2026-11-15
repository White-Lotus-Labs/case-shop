/** Display records derived exclusively from finalized case contract views. */
export interface BundleAsset {
  symbol: string;
  contractId: string | null;
  amount: string;
  decimals: number;
  paid: boolean;
}

export interface HistoryEntry {
  id: string;
  accountId: string;
  caseId: string;
  openingId: string;
  height: string;
  nonce: string;
  transactionHash?: string;
  timestamp: string;
  tier: string | null;
  spent: string;
  status: string;
  assets: BundleAsset[];
}

export function openingTime(timestamp: string) {
  const date = new Date(Number(BigInt(timestamp) / 1_000_000n));
  return { iso: date.toISOString(), label: date.toLocaleString() };
}
