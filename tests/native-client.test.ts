import { describe, expect, it } from "vitest";
import {
  NativeCaseClient,
  parseNativeOpening,
  type NativeQuote,
} from "../src/case/nativeClient";
import { nativeCaseCatalog } from "../src/case/nativeCatalog";
import {
  clearNativePending,
  nativePendingKey,
  observeNativePending,
  readNativePending,
  retryOriginalNativeCall,
  saveNativePending,
  validateNativePending,
  type NativePending,
} from "../src/case/nativePending";
const definition = nativeCaseCatalog[0];
function bonus() {
  return {
    ...definition.bonusRewards[0],
    reward_id: "token-0",
    chance_in_tier_bps: 10000,
    funds: "1000000000",
    available: "975000000",
    reserved: "25000000",
    in_flight: "0",
  };
}
function opening() {
  return {
    case_id: definition.id,
    opening_id: "1",
    account_id: "alice.testnet",
    nonce: "0",
    accepted_height: "100",
    accepted_timestamp: "1794693195272190981",
    accepted_revision: "1",
    common: 700000,
    rare: 250000,
    legendary: 50000,
    denominator: 1000000,
    status: "Completed",
    reward: definition.rewards[0].amount,
    draw: 1234,
    attempt: "1",
    reserved: "0",
    near_paid: true,
    bonus_paid: true,
    bonus: bonus(),
  };
}
function info() {
  return {
    case_id: definition.id,
    name: definition.name,
    payment_asset: "NEAR",
    contract_version: "native-v1",
    price: definition.price,
    pool_contribution: definition.poolContribution,
    platform_fee: definition.platformFee,
    target: definition.target,
    probability_denominator: 1000000,
    rewards: definition.rewards,
    bonus_rewards: definition.bonusRewards.map((reward, index) => ({
      ...reward,
      reward_id: `token-${index}`,
      chance_in_tier_bps: 10000,
      funds: "0",
      available: "0",
      reserved: "0",
      in_flight: "0",
    })),
    randomness: "NEAR protocol randomness; Testnet demonstration",
    quote_policy: "Exact revision",
  };
}
function quote(): NativeQuote {
  return {
    caseId: definition.id,
    case_id: definition.id,
    common: 700000,
    rare: 250000,
    legendary: 50000,
    denominator: 1000000,
    nonce: "0",
    revision: "1",
    expires_at: "220",
    target_ev: "0",
    expected_numerator: definition.rewards
      .reduce(
        (sum, reward, index) =>
          sum + BigInt(reward.amount) * BigInt([700000, 250000, 50000][index]),
        0n,
      )
      .toString(),
    available: definition.target,
    can_open: true,
    reason: null,
    storage_deposit: "40960000000000000000000",
    required_deposit: (
      BigInt(definition.price) + 40960000000000000000000n
    ).toString(),
  };
}
function rpcFixture(
  handler: (method: string, args: unknown) => unknown,
): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const args = body.params.args_base64
      ? JSON.parse(atob(body.params.args_base64))
      : body.params;
    const value = handler(
      body.params.method_name ?? body.params.request_type ?? body.method,
      args,
    );
    const result =
      body.params.request_type === "call_function"
        ? {
            result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
          }
        : value;
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
}
function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function pending(): NativePending {
  return {
    accountId: "alice.testnet",
    caseContractId: definition.contractId,
    caseId: definition.id,
    action: "open",
    nonce: "0",
    openingId: null,
    afterBlockHeight: "99",
    hash: null,
    call: {
      receiverId: definition.contractId,
      methodName: "open",
      args: { nonce: "0", quote: { revision: "1", expires_at: "220" } },
      gas: "250000000000000",
      deposit: quote().required_deposit,
    },
  };
}
describe("native NEAR client", () => {
  it("converts original microNEAR case economics to exact yoctoNEAR without USD values", () => {
    expect(nativeCaseCatalog.map((entry) => entry.price)).toEqual([
      "50000000000000000000000",
      "100000000000000000000000",
      "200000000000000000000000",
      "500000000000000000000000",
      "1000000000000000000000000",
    ]);
    expect(
      nativeCaseCatalog.every((entry) =>
        entry.contractId.startsWith("native-"),
      ),
    ).toBe(true);
  });
  it("verifies native contract identity before creating an exact payable wallet purchase", async () => {
    const client = new NativeCaseClient(
      definition,
      rpcFixture((method) => (method === "get_case" ? info() : quote())),
    );
    expect(() => client.openCall(quote())).toThrow("Verify");
    await client.caseInfo();
    const call = client.openCall(await client.quote("alice.testnet"));
    expect(call).toEqual(pending().call);
    expect(call.receiverId).toBe(definition.contractId);
    expect(call.methodName).toBe("open");
  });
  it("refuses historical USDI deployments and changed onchain economics", async () => {
    const usdi = new NativeCaseClient(
      definition,
      rpcFixture(() => ({ ...info(), payment_asset: "USDI" })),
    );
    await expect(usdi.caseInfo()).rejects.toThrow();
    const changed = new NativeCaseClient(
      definition,
      rpcFixture(() => ({ ...info(), price: "1" })),
    );
    await expect(changed.caseInfo()).rejects.toThrow("registry");
  });
  it("rejects quotes with incorrect probabilities or bundled storage", async () => {
    await expect(
      new NativeCaseClient(
        definition,
        rpcFixture(() => ({ ...quote(), common: 1 })),
      ).quote("alice.testnet"),
    ).rejects.toThrow();
    await expect(
      new NativeCaseClient(
        definition,
        rpcFixture(() => ({ ...quote(), required_deposit: definition.price })),
      ).quote("alice.testnet"),
    ).rejects.toThrow("deposit");
  });
  it("reads actual available NEAR after account storage lock", async () => {
    const client = new NativeCaseClient(
      definition,
      rpcFixture((method) =>
        method === "EXPERIMENTAL_protocol_config"
          ? {
              runtime_config: {
                storage_amount_per_byte: "10000000000000000000",
              },
            }
          : {
              amount: "2000000000000000000000000",
              locked: "0",
              storage_usage: 1000,
            },
      ),
    );
    expect(await client.nearBalance("alice.testnet")).toEqual({
      total: "2000000000000000000000000",
      available: "1990000000000000000000000",
      storageLocked: "10000000000000000000000",
      staked: "0",
    });
  });
  it("uses each configured token actual storage bounds and skips existing registrations", async () => {
    const client = new NativeCaseClient(
      definition,
      rpcFixture((method) =>
        method === "storage_balance_of"
          ? null
          : { min: "1250000000000000000000" },
      ),
    );
    const calls = await client.registrationCalls("alice.testnet");
    expect(calls.length).toBe(definition.bonusRewards.length);
    expect(calls[0]).toEqual({
      receiverId: definition.bonusRewards[0].token_contract_id,
      methodName: "storage_deposit",
      args: { account_id: "alice.testnet", registration_only: true },
      gas: "30000000000000",
      deposit: "1250000000000000000000",
    });
    expect(
      await new NativeCaseClient(
        definition,
        rpcFixture(() => ({ total: "1", available: "0" })),
      ).registrationCalls("alice.testnet"),
    ).toEqual([]);
  });
  it("accepts genuine matching native and FT payouts and rejects fake rewards/double-claim states", () => {
    expect(parseNativeOpening(opening(), definition)).toMatchObject({
      nearPaid: true,
      bonusPaid: true,
      tier: "Common",
    });
    expect(() =>
      parseNativeOpening({ ...opening(), bonus_paid: false }, definition),
    ).toThrow("payout");
    expect(() =>
      parseNativeOpening(
        { ...opening(), reward: definition.rewards[1].amount },
        definition,
      ),
    ).toThrow("draw");
    expect(() =>
      parseNativeOpening(
        {
          ...opening(),
          bonus: { ...bonus(), token_contract_id: "fake.testnet" },
        },
        definition,
      ),
    ).toThrow("Unconfigured");
  });
  it("verifies finality, signer, exact native deposit and nonce before trusting a wallet hash", async () => {
    const hash = "4".repeat(44),
      blockHash = "3".repeat(44),
      call = pending().call;
    const receipt = {
      transaction: {
        hash,
        signer_id: "alice.testnet",
        receiver_id: definition.contractId,
        actions: [
          {
            FunctionCall: {
              method_name: "open",
              args: btoa(JSON.stringify(call.args)),
              gas: call.gas,
              deposit: call.deposit,
            },
          },
        ],
      },
      status: { SuccessValue: btoa(JSON.stringify("1")) },
      final_execution_status: "FINAL",
      transaction_outcome: { block_hash: blockHash },
    };
    const expected = { ...call, afterBlockHeight: "99" };
    const client = new NativeCaseClient(
      definition,
      rpcFixture((method) =>
        method === "block"
          ? {
              header: {
                hash: blockHash,
                height: 100,
                timestamp_nanosec: "1000000000",
              },
            }
          : receipt,
      ),
    );
    expect(
      await client.transaction(hash, "alice.testnet", undefined, expected),
    ).toMatchObject({ hash, success: true, inclusion: { height: "100" } });
    await expect(
      client.transaction(hash, "bob.testnet", undefined, expected),
    ).rejects.toThrow("account");
    await expect(
      client.transaction(hash, "alice.testnet", undefined, {
        ...expected,
        deposit: "1",
      }),
    ).rejects.toThrow("pending contract action");
    await expect(
      client.transaction(hash, "alice.testnet", undefined, {
        ...expected,
        args: { ...call.args, nonce: "2" },
      }),
    ).rejects.toThrow("pending contract action");
    await expect(
      client.transaction(hash, "alice.testnet", undefined, {
        ...expected,
        afterBlockHeight: "100",
      }),
    ).rejects.toThrow("predates");
  });
  it("does not expose retries for completed/in-flight transfers", () => {
    const client = new NativeCaseClient(definition);
    expect(() =>
      client.recoverCall(parseNativeOpening(opening(), definition)),
    ).toThrow("confirmed failed");
    const claimable = parseNativeOpening(
      {
        ...opening(),
        status: "Claimable",
        near_paid: false,
        bonus_paid: false,
      },
      definition,
    );
    expect(client.recoverCall(claimable)).toMatchObject({
      methodName: "retry_payout",
      deposit: "1",
      args: { opening_id: "1" },
    });
  });
  it("reads finalized global history and rejects another wallet in personal history", async () => {
    const client = new NativeCaseClient(
      definition,
      rpcFixture(() => ({ openings: [opening()], next_cursor: null })),
    );
    expect(await client.globalHistory()).toMatchObject({
      openings: [{ account_id: "alice.testnet" }],
      source: "Finalized case contract",
      complete: true,
    });
    await expect(client.historyPage("bob.testnet")).rejects.toThrow(
      "another wallet",
    );
  });
});
describe("native wallet recovery", () => {
  it("persists intent before signing and isolates wallet/case keys", () => {
    const store = memoryStore(),
      key = nativePendingKey(definition, "alice.testnet");
    saveNativePending(store, key, pending());
    expect(
      validateNativePending(
        readNativePending(store, key)!,
        definition,
        "alice.testnet",
      ),
    ).toEqual(pending());
    expect(
      readNativePending(store, nativePendingKey(definition, "bob.testnet")),
    ).toBeNull();
    expect(() =>
      validateNativePending(pending(), definition, "bob.testnet"),
    ).toThrow("another wallet");
    clearNativePending(store, key);
    expect(readNativePending(store, key)).toBeNull();
  });
  it("only unlocks a submitted purchase when that wallet nonce is observed", () => {
    const verified = parseNativeOpening(opening(), definition);
    expect(observeNativePending(pending(), [verified])).toEqual(verified);
    expect(
      observeNativePending({ ...pending(), nonce: "2" }, [verified]),
    ).toBeNull();
    expect(
      observeNativePending({ ...pending(), accountId: "bob.testnet" }, [
        verified,
      ]),
    ).toBeNull();
  });
  it("recovers a no-hash timeout by re-signing exactly the saved nonce without creating a second purchase", () => {
    const original = pending();
    const retry = retryOriginalNativeCall(
      original,
      definition,
      "alice.testnet",
      quote(),
    );
    expect(retry).toEqual(original.call);
    expect(retry).not.toBe(original.call);
    expect(() =>
      retryOriginalNativeCall(original, definition, "alice.testnet", {
        ...quote(),
        nonce: "1",
      }),
    ).toThrow("finalized history");
    expect(() =>
      retryOriginalNativeCall(original, definition, "bob.testnet", quote()),
    ).toThrow("another wallet");
  });
  it("blocks corrupted persistence instead of allowing a duplicate purchase", () => {
    const store = memoryStore(),
      key = nativePendingKey(definition, "alice.testnet");
    store.setItem(key, "not-json");
    expect(() => readNativePending(store, key)).toThrow("Check the wallet");
    expect(() =>
      saveNativePending(
        store,
        nativePendingKey(definition, "bob.testnet"),
        pending(),
      ),
    ).toThrow("key mismatch");
  });
});

it('preserves the finalized contract timestamp for opening history', () => {
  expect(parseNativeOpening({ ...opening(), accepted_timestamp: '1794693195272190981' }, definition))
    .toHaveProperty('accepted_timestamp', '1794693195272190981');
});

it('renews an expired quote while preserving the original purchase nonce', () => {
  const original = pending();
  const retry = retryOriginalNativeCall(original, definition, 'alice.testnet', {
    ...quote(), revision: '7', expires_at: '900',
  });
  expect(retry.args).toEqual({ nonce: '0', quote: { revision: '7', expires_at: '900' } });
  expect(retry.deposit).toBe(original.call.deposit);
  expect(original.call.args).toEqual({ nonce: '0', quote: { revision: '1', expires_at: '220' } });
});
