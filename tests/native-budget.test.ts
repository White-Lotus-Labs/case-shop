import { describe, expect, it } from "vitest";
import registry from "../config/cases.native.testnet.json";
import manifest from "../docs/native/deployment/manifest.json";
import { nativeCaseCatalog } from "../src/case/nativeCatalog";

describe("native deployment budget", () => {
  it("uses the intended lower NEAR prices for the five cases", () => {
    expect(nativeCaseCatalog.map((entry) => entry.price)).toEqual([
      "50000000000000000000000",
      "100000000000000000000000",
      "200000000000000000000000",
      "500000000000000000000000",
      "1000000000000000000000000",
    ]);
  });

  it("funds two maximum native prizes per case and fits 150 NEAR with storage and a 10 NEAR gas allowance", () => {
    const unit = 10n ** 24n;
    const rounds = BigInt(manifest.reservedConcurrentOpenings);
    const requiredRewards = registry.cases.reduce(
      (sum, entry) =>
        sum + BigInt(entry.config.economy.rewards[2]) * 10n ** 18n * rounds,
      0n,
    );
    expect(rounds).toBe(2n);
    expect(BigInt(manifest.nativeRewardFundingYocto)).toBe(requiredRewards);
    expect(requiredRewards).toBe(49_800_000_000_000_000_000_000_000n);
    const registration = registry.cases
      .flatMap((entry) => entry.config.bonus_rewards)
      .reduce((sum, reward) => {
        const token = manifest.tokens.find(
          (item) => item.tokenContractId === reward.token_contract_id,
        );
        if (!token)
          throw new Error(
            `Missing storage requirement for ${reward.token_contract_id}`,
          );
        return sum + BigInt(token.storageMinimum);
      }, 0n);
    const budget =
      requiredRewards +
      BigInt(manifest.accountCreationNear) * unit +
      registration +
      10n * unit;
    expect(BigInt(manifest.tokenStorageFundingYocto)).toBe(registration);
    expect(BigInt(manifest.gasAllowanceYocto)).toBe(10n * unit);
    expect(BigInt(manifest.budgetEstimateYocto)).toBe(budget);
    expect(BigInt(manifest.budgetLimitYocto)).toBe(150n * unit);
    expect(budget).toBeLessThanOrEqual(150n * unit);
  });
});
