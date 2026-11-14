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
  status: string;
  assets: BundleAsset[];
}
