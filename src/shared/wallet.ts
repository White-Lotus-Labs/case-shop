/** One NEAR function-call action, expressed in atomic units. */
export type WalletFunctionCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};
