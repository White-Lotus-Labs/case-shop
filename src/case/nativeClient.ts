import { z } from "zod";
import {
  CaseClient,
  transactionHash,
  formatUnits,
  percent,
  walletTransactionHash,
} from "./client";
import type { ExpectedTransaction } from "./client";
import type { WalletFunctionCall } from "../shared/wallet";
import {
  nativeAccountId,
  nativeInteger,
  nativeTier,
  nativeU64,
  type NativeCaseDefinition,
} from "./nativeCatalog";
export { formatUnits, percent, walletTransactionHash };
export type { NativeCaseDefinition } from "./nativeCatalog";
export const walletAccountId = z.union([
  nativeAccountId,
  z.string().regex(/^[a-f0-9]{64}$/),
]);
const count = z.number().int().min(0).max(0xffffffff);
const oddsSchema = z
  .object({
    common: count,
    rare: count,
    legendary: count,
    denominator: z.literal(1_000_000),
  })
  .refine(
    (value) =>
      value.common + value.rare + value.legendary === value.denominator,
    "Invalid probabilities",
  );
const quoteSchema = oddsSchema.and(
  z.object({
    case_id: z.string(),
    revision: nativeU64,
    expires_at: nativeU64,
    nonce: nativeU64,
    target_ev: nativeInteger,
    expected_numerator: nativeInteger,
    available: nativeInteger,
    can_open: z.boolean(),
    reason: z.string().nullable(),
    storage_deposit: nativeInteger,
    required_deposit: nativeInteger,
  }),
);
export type NativeQuote = z.infer<typeof quoteSchema> & { caseId: string };
const poolSchema = z.object({
  pool_funds: nativeInteger,
  reserved_rewards: nativeInteger,
  available: nativeInteger,
  target: nativeInteger,
  health: z.enum(["Healthy", "Caution", "Critical"]),
  pending_fees: nativeInteger,
  treasury_available: nativeInteger,
  in_flight_payouts: nativeInteger,
  pending_openings: count,
  completed_payouts: nativeU64,
  total_paid: nativeInteger,
  revision: nativeU64,
  paused: z.boolean(),
  can_open: z.boolean(),
  storage_per_opening: nativeInteger,
  storage_account_cost: nativeInteger,
});
export type NativePool = z.infer<typeof poolSchema>;
const bonusSchema = z
  .object({
    reward_id: z.string(),
    token_contract_id: nativeAccountId,
    token_symbol: z.string(),
    token_decimals: count,
    display_name: z.string(),
    amount: nativeInteger,
    tier: nativeTier,
    chance_in_tier_bps: z.literal(10000),
    funds: nativeInteger,
    available: nativeInteger,
    reserved: nativeInteger,
    in_flight: nativeInteger,
  })
  .passthrough();
export type NativeTokenReward = z.infer<typeof bonusSchema>;
const openingSchema = oddsSchema.and(
  z.object({
    case_id: z.string(),
    opening_id: nativeU64,
    account_id: walletAccountId,
    nonce: nativeU64,
    accepted_height: nativeU64,
    accepted_timestamp: nativeU64,
    accepted_revision: nativeU64,
    status: z.enum(["RandomnessPending", "Paying", "Claimable", "Completed"]),
    reward: nativeInteger.nullable(),
    draw: count.nullable(),
    attempt: nativeU64,
    reserved: nativeInteger,
    near_paid: z.boolean(),
    bonus_paid: z.boolean(),
    bonus: bonusSchema.nullable(),
  }),
);
export type NativeOpening = z.infer<typeof openingSchema> & {
  caseId: string;
  tier: z.infer<typeof nativeTier> | null;
  nearPaid: boolean;
  bonusPaid: boolean;
};
export function parseNativeBonus(
  raw: unknown,
  definition: NativeCaseDefinition,
): NativeTokenReward {
  const reward = bonusSchema.parse(raw);
  if (
    !definition.bonusRewards.some(
      (expected) =>
        expected.token_contract_id === reward.token_contract_id &&
        expected.amount === reward.amount &&
        expected.tier === reward.tier &&
        expected.token_decimals === reward.token_decimals &&
        expected.token_symbol === reward.token_symbol,
    )
  )
    throw new Error("Unconfigured reward token.");
  if (
    BigInt(reward.available) + BigInt(reward.reserved) !==
      BigInt(reward.funds) ||
    BigInt(reward.in_flight) > BigInt(reward.reserved)
  )
    throw new Error("Inconsistent token prize reserves.");
  return reward;
}
export function parseNativeOpening(
  raw: unknown,
  definition: NativeCaseDefinition,
): NativeOpening {
  const opening = openingSchema.parse(raw);
  if (opening.case_id !== definition.id)
    throw new Error("Opening belongs to another case.");
  const tier =
    opening.draw === null
      ? null
      : opening.draw < opening.common
        ? "Common"
        : opening.draw < opening.common + opening.rare
          ? "Rare"
          : "Legendary";
  if (
    (opening.status === "RandomnessPending") !== (opening.reward === null) ||
    (opening.reward === null) !== (opening.draw === null) ||
    (opening.draw !== null && opening.draw >= 1_000_000)
  )
    throw new Error("Inconsistent opening draw.");
  if (
    opening.reward !== null &&
    definition.rewards.find((reward) => reward.tier === tier)?.amount !==
      opening.reward
  )
    throw new Error("Opening draw does not match native reward.");
  const bonus =
    opening.bonus === null ? null : parseNativeBonus(opening.bonus, definition);
  if (
    (opening.reward === null) !== (bonus === null) ||
    (bonus !== null && bonus.tier !== tier) ||
    (opening.status === "Completed" &&
      (!opening.near_paid || !opening.bonus_paid)) ||
    (opening.status === "RandomnessPending" &&
      (opening.near_paid || opening.bonus_paid))
  )
    throw new Error("Inconsistent opening payout.");
  return {
    ...opening,
    bonus,
    caseId: definition.id,
    tier,
    nearPaid: opening.near_paid,
    bonusPaid: opening.bonus_paid,
  };
}
export class NativeCaseClient {
  private readonly transport: CaseClient;
  private identityVerified = false;
  constructor(
    readonly definition: NativeCaseDefinition,
    request?: typeof fetch,
  ) {
    this.transport = new CaseClient(
      {
        network: "testnet",
        rpcUrl: definition.rpcUrl,
        tokenContractId: definition.contractId,
        caseContractId: definition.contractId,
      },
      request,
    );
  }
  view(contract: string, method: string, args: object, signal?: AbortSignal) {
    return this.transport.view(contract, method, args, signal);
  }
  private caseView(method: string, args: object, signal?: AbortSignal) {
    return this.view(this.definition.contractId, method, args, signal);
  }
  async caseInfo(signal?: AbortSignal) {
    const info = z
      .object({
        case_id: z.string(),
        name: z.string(),
        payment_asset: z.literal("NEAR"),
        contract_version: z.literal("native-v1"),
        price: nativeInteger,
        pool_contribution: nativeInteger,
        platform_fee: nativeInteger,
        target: nativeInteger,
        probability_denominator: z.literal(1_000_000),
        rewards: z.array(z.object({ tier: nativeTier, amount: nativeInteger })),
        bonus_rewards: z.array(bonusSchema),
        randomness: z.string(),
        quote_policy: z.string(),
      })
      .parse(await this.caseView("get_case", {}, signal));
    const definition = this.definition;
    if (
      info.case_id !== definition.id ||
      info.price !== definition.price ||
      info.target !== definition.target ||
      info.pool_contribution !== definition.poolContribution ||
      info.platform_fee !== definition.platformFee ||
      info.rewards.length !== 3 ||
      definition.rewards.some(
        (expected, index) =>
          info.rewards[index]?.tier !== expected.tier ||
          info.rewards[index]?.amount !== expected.amount,
      ) ||
      info.bonus_rewards.length !== definition.bonusRewards.length
    )
      throw new Error(
        "Contract does not match the native NEAR deployment registry.",
      );
    const bonuses = info.bonus_rewards.map((reward) =>
      parseNativeBonus(reward, definition),
    );
    if (
      new Set(bonuses.map((reward) => reward.token_contract_id)).size !==
      bonuses.length
    )
      throw new Error("Duplicate configured reward.");
    this.identityVerified = true;
    return { ...info, caseId: info.case_id, bonusRewards: bonuses };
  }
  async pool(signal?: AbortSignal): Promise<NativePool> {
    const pool = poolSchema.parse(await this.caseView("get_pool", {}, signal));
    if (
      pool.target !== this.definition.target ||
      BigInt(pool.pool_funds) - BigInt(pool.reserved_rewards) !==
        BigInt(pool.available) ||
      BigInt(pool.in_flight_payouts) > BigInt(pool.reserved_rewards)
    )
      throw new Error("Inconsistent native NEAR reserve accounting.");
    return pool;
  }
  async quote(account: string, signal?: AbortSignal): Promise<NativeQuote> {
    const quote = quoteSchema.parse(
      await this.caseView(
        "get_quote",
        { account_id: walletAccountId.parse(account) },
        signal,
      ),
    );
    if (
      quote.case_id !== this.definition.id ||
      BigInt(quote.required_deposit) !==
        BigInt(this.definition.price) + BigInt(quote.storage_deposit)
    )
      throw new Error("Incorrect native NEAR purchase deposit.");
    const numerator = this.definition.rewards.reduce(
      (sum, reward) =>
        sum + BigInt(reward.amount) * BigInt(quote[reward.probability]),
      0n,
    );
    if (numerator.toString() !== quote.expected_numerator)
      throw new Error("Inconsistent native NEAR probabilities.");
    return { ...quote, caseId: quote.case_id };
  }
  async nearBalance(account: string, signal?: AbortSignal) {
    const [accountRaw, protocolRaw] = await Promise.all([
      this.transport.rpc(
        "query",
        {
          request_type: "view_account",
          account_id: walletAccountId.parse(account),
          finality: "final",
        },
        signal,
      ),
      this.transport.rpc(
        "EXPERIMENTAL_protocol_config",
        { finality: "final" },
        signal,
      ),
    ]);
    const result = z
      .object({
        amount: nativeInteger,
        locked: nativeInteger,
        storage_usage: z.number().int().nonnegative().safe(),
      })
      .parse(accountRaw);
    const protocol = z
      .object({
        runtime_config: z.object({ storage_amount_per_byte: nativeInteger }),
      })
      .parse(protocolRaw);
    const storageLocked =
      BigInt(result.storage_usage) *
      BigInt(protocol.runtime_config.storage_amount_per_byte);
    const liquid = BigInt(result.amount);
    const stake = BigInt(result.locked);
    const liquidStorageReserve =
      storageLocked > stake ? storageLocked - stake : 0n;
    return {
      total: (liquid + stake).toString(),
      available: (liquid > liquidStorageReserve
        ? liquid - liquidStorageReserve
        : 0n
      ).toString(),
      storageLocked: storageLocked.toString(),
      staked: result.locked,
    };
  }
  async active(account: string, signal?: AbortSignal) {
    const raw = await this.caseView(
      "get_account_opening",
      { account_id: walletAccountId.parse(account) },
      signal,
    );
    if (raw === null) return null;
    const opening = parseNativeOpening(raw, this.definition);
    if (opening.account_id !== account)
      throw new Error("Opening belongs to another wallet.");
    return opening;
  }
  async opening(id: string, signal?: AbortSignal) {
    const raw = await this.caseView(
      "get_opening",
      { opening_id: nativeU64.parse(id) },
      signal,
    );
    return raw === null ? null : parseNativeOpening(raw, this.definition);
  }
  async history(
    account: string,
    signal?: AbortSignal,
  ): Promise<NativeOpening[]> {
    const raw = z
      .array(z.unknown())
      .max(20)
      .parse(
        await this.caseView(
          "get_history",
          { account_id: walletAccountId.parse(account), limit: 20 },
          signal,
        ),
      );
    return raw.map((value) => {
      const opening = parseNativeOpening(value, this.definition);
      if (opening.account_id !== account)
        throw new Error("History belongs to another wallet.");
      return opening;
    });
  }
  private async page(
    method: string,
    cursor: string | null,
    account: string | null,
    signal?: AbortSignal,
  ) {
    const raw = z
      .object({
        openings: z.array(z.unknown()).max(20),
        next_cursor: nativeU64.nullable(),
      })
      .parse(
        await this.caseView(
          method,
          {
            ...(account === null
              ? {}
              : { account_id: walletAccountId.parse(account) }),
            before_opening_id: cursor === null ? null : nativeU64.parse(cursor),
            limit: 20,
          },
          signal,
        ),
      );
    const openings = raw.openings.map((value) =>
      parseNativeOpening(value, this.definition),
    );
    if (
      account !== null &&
      openings.some((opening) => opening.account_id !== account)
    )
      throw new Error("History belongs to another wallet.");
    if (
      (cursor !== null &&
        openings.length > 0 &&
        openings[0].opening_id !== cursor) ||
      (raw.next_cursor !== null &&
        (openings.length === 0 ||
          openings.some(
            (opening) =>
              BigInt(opening.opening_id) <= BigInt(raw.next_cursor ?? "0"),
          )))
    )
      throw new Error("Repeating or malformed history cursor.");
    return {
      openings,
      nextCursor: raw.next_cursor,
      complete: raw.next_cursor === null,
      source: "Finalized case contract" as const,
    };
  }
  historyPage(
    account: string,
    cursor: string | null = null,
    signal?: AbortSignal,
  ) {
    return this.page("get_history_page", cursor, account, signal);
  }
  globalHistory(cursor: string | null = null, signal?: AbortSignal) {
    return this.page("get_global_history_page", cursor, null, signal);
  }
  async findOpeningByNonce(
    account: string,
    nonce: string,
    signal?: AbortSignal,
  ): Promise<NativeOpening | null> {
    nativeU64.parse(nonce);
    let cursor: string | null = null;
    do {
      const page = await this.historyPage(account, cursor, signal);
      const match = page.openings.find((opening) => opening.nonce === nonce);
      if (match) return match;
      if (
        page.openings.some((opening) => BigInt(opening.nonce) < BigInt(nonce))
      )
        return null;
      cursor = page.nextCursor;
    } while (cursor !== null);
    return null;
  }

  async registrationCalls(
    account: string,
    signal?: AbortSignal,
  ): Promise<WalletFunctionCall[]> {
    walletAccountId.parse(account);
    const calls = await Promise.all(
      this.definition.bonusRewards.map(async (reward) => {
        const registration = await this.view(
          reward.token_contract_id,
          "storage_balance_of",
          { account_id: account },
          signal,
        );
        if (registration !== null) {
          z.object({ total: nativeInteger, available: nativeInteger }).parse(
            registration,
          );
          return null;
        }
        const bounds = z
          .object({ min: nativeInteger })
          .parse(
            await this.view(
              reward.token_contract_id,
              "storage_balance_bounds",
              {},
              signal,
            ),
          );
        return {
          receiverId: reward.token_contract_id,
          methodName: "storage_deposit",
          args: { account_id: account, registration_only: true },
          gas: "30000000000000",
          deposit: bounds.min,
        } satisfies WalletFunctionCall;
      }),
    );
    return calls.filter((call) => call !== null);
  }
  openCall(quote: NativeQuote): WalletFunctionCall {
    if (!this.identityVerified)
      throw new Error(
        "Verify this native NEAR contract before signing a purchase.",
      );
    if (quote.caseId !== this.definition.id || !quote.can_open)
      throw new Error(quote.reason ?? "Case is unavailable.");
    if (
      BigInt(quote.required_deposit) !==
      BigInt(this.definition.price) + BigInt(quote.storage_deposit)
    )
      throw new Error("Incorrect purchase deposit.");
    return {
      receiverId: this.definition.contractId,
      methodName: "open",
      args: {
        nonce: quote.nonce,
        quote: { revision: quote.revision, expires_at: quote.expires_at },
      },
      gas: "250000000000000",
      deposit: quote.required_deposit,
    };
  }
  recoverCall(opening: NativeOpening): WalletFunctionCall {
    if (
      opening.caseId !== this.definition.id ||
      (opening.status !== "Claimable" && opening.status !== "RandomnessPending")
    )
      throw new Error(
        "Only a pending draw or confirmed failed payout can recover.",
      );
    return {
      receiverId: this.definition.contractId,
      methodName:
        opening.status === "Claimable" ? "retry_payout" : "advance_opening",
      args: { opening_id: opening.opening_id },
      gas: "200000000000000",
      deposit: "1",
    };
  }
  finalBlockHeight(signal?: AbortSignal) {
    return this.transport.finalBlockHeight(signal);
  }
  rawTransaction(hash: string, account: string) {
    return this.transport.rpc('tx', { tx_hash: transactionHash(hash), sender_account_id: walletAccountId.parse(account), wait_until: 'FINAL' });
  }
  transaction(
    hash: string,
    account: string,
    signal?: AbortSignal,
    expected?: ExpectedTransaction,
  ) {
    return this.transport.transaction(hash, account, signal, expected, true);
  }
}
