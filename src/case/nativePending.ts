import { z } from "zod";
import { transactionHash } from "./client";
import {
  nativeAccountId,
  nativeInteger,
  nativeU64,
  type NativeCaseDefinition,
} from "./nativeCatalog";
import {
  walletAccountId,
  type NativeOpening,
  type NativeQuote,
} from "./nativeClient";
const callSchema = z.object({
  receiverId: nativeAccountId,
  methodName: z.enum([
    "open",
    "retry_payout",
    "advance_opening",
    "storage_deposit",
  ]),
  args: z.record(z.string(), z.unknown()),
  gas: nativeU64,
  deposit: nativeInteger,
});
const pendingSchema = z.object({
  accountId: walletAccountId,
  caseContractId: nativeAccountId,
  caseId: z.string(),
  action: z.enum(["open", "register", "recover"]),
  nonce: nativeU64.nullable(),
  openingId: nativeU64.nullable(),
  call: callSchema,
  afterBlockHeight: nativeU64,
  hash: z
    .string()
    .refine((value) => {
      try {
        transactionHash(value);
        return true;
      } catch {
        return false;
      }
    })
    .nullable(),
});
export type NativePending = z.infer<typeof pendingSchema>;
type NativeStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function nativePendingKey(
  definition: NativeCaseDefinition,
  account: string,
) {
  return `case-shop:native-v1:testnet:${definition.contractId}:${walletAccountId.parse(account)}`;
}
export function readNativePending(
  store: Pick<NativeStore, "getItem">,
  key: string,
): NativePending | null {
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    if (raw.length > 40000) throw new Error("Oversized pending transaction.");
    const pending = pendingSchema.parse(JSON.parse(raw));
    if (
      key !==
      `case-shop:native-v1:testnet:${pending.caseContractId}:${pending.accountId}`
    )
      throw new Error("Saved transaction key mismatch.");
    return pending;
  } catch {
    throw new Error(
      "Saved transaction information is unavailable or invalid. Check the wallet transaction before signing again.",
    );
  }
}
export function validateNativePending(
  pending: NativePending,
  definition: NativeCaseDefinition,
  account: string,
) {
  pendingSchema.parse(pending);
  if (
    pending.accountId !== account ||
    pending.caseContractId !== definition.contractId ||
    pending.caseId !== definition.id
  )
    throw new Error("Saved transaction belongs to another wallet or case.");
  if (pending.action === "open") {
    if (
      pending.call.methodName !== "open" ||
      pending.call.receiverId !== definition.contractId ||
      pending.nonce === null ||
      pending.call.args.nonce !== pending.nonce ||
      pending.openingId !== null ||
      BigInt(pending.call.deposit) < BigInt(definition.price)
    )
      throw new Error("Saved purchase does not match this case.");
  } else if (pending.action === "recover") {
    if (
      !["advance_opening", "retry_payout"].includes(pending.call.methodName) ||
      pending.call.receiverId !== definition.contractId ||
      pending.openingId === null ||
      pending.call.args.opening_id !== pending.openingId ||
      pending.call.deposit !== "1"
    )
      throw new Error("Saved recovery does not match this case.");
  } else if (
    pending.call.methodName !== "storage_deposit" ||
    pending.call.args.account_id !== account ||
    pending.call.args.registration_only !== true ||
    !definition.bonusRewards.some(
      (reward) => reward.token_contract_id === pending.call.receiverId,
    )
  ) {
    throw new Error(
      "Saved registration does not match this wallet and configured reward.",
    );
  }
  return pending;
}
export function saveNativePending(
  store: Pick<NativeStore, "setItem">,
  key: string,
  pending: NativePending,
) {
  const validated = pendingSchema.parse(pending);
  if (
    key !==
    `case-shop:native-v1:testnet:${pending.caseContractId}:${pending.accountId}`
  )
    throw new Error("Saved transaction key mismatch.");
  try {
    store.setItem(key, JSON.stringify(validated));
  } catch {
    throw new Error(
      "Cannot save transaction recovery information. Enable browser storage before signing.",
    );
  }
}
export function clearNativePending(
  store: Pick<NativeStore, "removeItem">,
  key: string,
) {
  store.removeItem(key);
}
export function observeNativePending(
  pending: NativePending,
  openings: NativeOpening[],
): NativeOpening | null {
  return (
    openings.find(
      (opening) =>
        opening.account_id === pending.accountId &&
        opening.caseId === pending.caseId &&
        (pending.action === "open"
          ? opening.nonce === pending.nonce
          : pending.action === "recover" &&
            opening.opening_id === pending.openingId &&
            opening.status === "Completed"),
    ) ?? null
  );
}

/** Renew the quote, retaining the original nonce so only one attempt can open. */
export function retryOriginalNativeCall(
  pending: NativePending,
  definition: NativeCaseDefinition,
  account: string,
  currentQuote: NativeQuote,
) {
  validateNativePending(pending, definition, account);
  if (
    pending.action !== "open" ||
    currentQuote.caseId !== definition.id ||
    currentQuote.nonce !== pending.nonce
  )
    throw new Error(
      "Check finalized history for the original opening before retrying.",
    );
  if (!currentQuote.can_open || currentQuote.required_deposit !== pending.call.deposit)
    throw new Error(currentQuote.reason ?? "The original purchase deposit changed. Verify its transaction first.");
  return {
    ...structuredClone(pending.call),
    args: {
      nonce: pending.nonce,
      quote: { revision: currentQuote.revision, expires_at: currentQuote.expires_at },
    },
  };
}
