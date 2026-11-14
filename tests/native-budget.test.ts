import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

  it("allocates the whole 150 NEAR budget and funds at least four maximum prizes in every case", () => {
    const unit = 10n ** 24n;
    const rounds = BigInt(manifest.reservedConcurrentOpenings);
    expect(rounds).toBe(4n);
    const requiredRewards = manifest.cases.reduce(
      (sum, entry) => sum + BigInt(entry.nativeFundingYocto),
      0n,
    );
    expect(BigInt(manifest.nativeRewardFundingYocto)).toBe(requiredRewards);
    expect(requiredRewards).toBe(114_968_750_000_000_000_000_000_000n);
    for (const entry of registry.cases) {
      const planned = manifest.cases.find((row) => row.id === entry.id);
      if (!planned) throw new Error(`Missing funding for ${entry.id}`);
      expect(BigInt(planned.nativeFundingYocto)).toBeGreaterThanOrEqual(
        BigInt(entry.config.economy.rewards[2]) * 10n ** 18n * 4n,
      );
    }
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
    expect(budget).toBe(150n * unit);
  });

  it("prepares the same pool transfers and four token rewards that appear in the manifest", () => {
    const commands = readFileSync(
      "docs/native/deployment/commands.review.txt",
      "utf8",
    ).split("\n");
    for (const entry of manifest.cases) {
      const transfer = commands.find((line) =>
        line.includes(`'${entry.contractId}' 'fund_pool'`),
      );
      expect(transfer).toContain(`'${entry.nativeFundingYocto} yoctoNEAR'`);
      const definition = registry.cases.find((item) => item.id === entry.id);
      if (!definition) throw new Error(`Missing case ${entry.id}`);
      for (const reward of definition.config.bonus_rewards) {
        const funding = commands.find(
          (line) =>
            line.includes(`'${reward.token_contract_id}' 'ft_transfer_call'`) &&
            line.includes(`"receiver_id":"${entry.contractId}"`),
        );
        expect(funding).toContain(`"amount":"${BigInt(reward.amount) * 4n}"`);
      }
    }
    for (const token of manifest.tokens) {
      const required = registry.cases
        .flatMap((entry) => entry.config.bonus_rewards)
        .filter((reward) => reward.token_contract_id === token.tokenContractId)
        .reduce((sum, reward) => sum + BigInt(reward.amount) * 4n, 0n);
      expect(BigInt(token.amount)).toBe(required);
    }
  });
});
