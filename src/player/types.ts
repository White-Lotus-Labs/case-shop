import type { WalletFunctionCall } from '../shared/wallet';

export type GameWalletStatus =
  | 'unconfigured'
  | 'allocating'
  | 'allocated'
  | 'active'
  | 'blocked';
export type OperationStatus =
  | 'prepared'
  | 'authorized'
  | 'signing'
  | 'awaiting_external'
  | 'submitted'
  | 'unknown'
  | 'confirmed'
  | 'failed'
  | 'cancelled';
export type PlayerSession = {
  sessionId: string;
  userId: string;
  tokenHash: string;
  authVersion: number;
  authMethod: string;
  authenticatedAt: Date;
  expiresAt: Date;
};
export type PublicGameWallet = {
  id: string;
  accountId: string | null;
  publicKey: string | null;
  status: GameWalletStatus;
  reason: string | null;
  custody: 'managed-custodial';
};
export type PlayerProfile = {
  id: string;
  nickname: string;
  createdAt: string;
  authMethods: ('password' | 'wallet')[];
  externalWallets: { accountId: string; linkedAt: string }[];
  gameWallet: PublicGameWallet;
  csrfToken: string;
  signer: {
    status: 'unconfigured' | 'offline' | 'available';
    reason: string | null;
    writesEnabled: boolean;
  };
};
export type SupportedToken = {
  contractId: string;
  name: string;
  symbol: string;
  decimals: number;
  unofficial: boolean;
};
export type BalanceReading = {
  tokenId: string;
  symbol: string;
  decimals: number;
  balance: string;
  blockHeight: string;
  source: 'finalized-rpc';
};
export type OperationRequest =
  | { kind: 'game-call'; call: WalletFunctionCall }
  | { kind: 'withdraw'; tokenId: string; recipient: string; amount: string }
  | {
      kind: 'deposit';
      tokenId: string;
      sourceAccountId: string;
      amount: string;
    };
export type OperationView = {
  id: string;
  kind: string;
  status: OperationStatus;
  accountId: string;
  tokenId: string | null;
  symbol: string | null;
  amountAtomic: string | null;
  amountDisplay: string | null;
  recipient: string | null;
  steps: WalletFunctionCall[];
  completedSteps: number;
  nativeCostCapYocto: string;
  intentHash: string;
  expiresAt: string;
  createdAt: string;
  txHash: string | null;
  requiresReauthentication: boolean;
  errorCode: string | null;
};
export type WalletChallengeView = {
  id: string;
  message: string;
  recipient: string;
  nonceBase64: string;
  expiresAt: string;
};
