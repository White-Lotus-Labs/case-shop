import { z } from "zod";
import registry from "../../config/cases.native.testnet.json";

export const nativeAccountId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/);
export const nativeInteger = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) < 2n ** 128n, "Amount exceeds u128");
export const nativeU64 = nativeInteger.refine(
  (value) => BigInt(value) < 2n ** 64n,
  "Integer exceeds u64",
);
export const nativeTier = z.enum(["Common", "Rare", "Legendary"]);
export type NativeTier = z.infer<typeof nativeTier>;
const rewardConfig = z.object({
  token_contract_id: nativeAccountId,
  token_symbol: z.string().min(1).max(32),
  display_name: z.string().min(1),
  token_decimals: z.number().int().min(0).max(24),
  amount: nativeInteger,
  tier: z.number().int().min(0).max(2),
});
const registrySchema = z.object({
  network: z.literal("testnet"),
  paymentAsset: z.literal("NEAR"),
  contractVersion: z.literal("native-v1"),
  economyUnit: z.literal("microNEAR"),
  rpcUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        contractId: nativeAccountId,
        deploymentStatus: z.enum(["planned", "verified-live"]),
        theme: z.string(),
        description: z.string(),
        config: z.object({
          case_id: z.string(),
          name: z.string(),
          economy: z
            .object({
              price: nativeInteger,
              rewards: z.tuple([nativeInteger, nativeInteger, nativeInteger]),
              target: nativeInteger,
            })
            .passthrough(),
          bonus_rewards: z.array(rewardConfig).min(3),
        }),
      }),
    )
    .length(5),
});
const parsed = registrySchema.parse(registry);
const tiers: NativeTier[] = ["Common", "Rare", "Legendary"];
const probabilities = ["common", "rare", "legendary"] satisfies Array<
  "common" | "rare" | "legendary"
>;
const yocto = (value: string) =>
  nativeInteger.parse((BigInt(value) * 10n ** 18n).toString());
export const nativeCaseCatalog = parsed.cases.map((entry) => {
  if (entry.config.case_id !== entry.id || entry.config.name !== entry.name)
    throw new Error("Native case registry identity mismatch.");
  const price = yocto(entry.config.economy.price);
  return {
    id: entry.id,
    name: entry.name,
    contractId: entry.contractId,
    deploymentStatus: entry.deploymentStatus,
    theme: entry.theme,
    description: entry.description,
    rpcUrl: parsed.rpcUrl,
    price,
    target: yocto(entry.config.economy.target),
    poolContribution: ((BigInt(price) * 95n) / 100n).toString(),
    platformFee: ((BigInt(price) * 5n) / 100n).toString(),
    rewards: entry.config.economy.rewards.map((amount, index) => ({
      tier: nativeTier.parse(tiers[index]),
      amount: yocto(amount),
      probability: probabilities[index],
    })),
    bonusRewards: entry.config.bonus_rewards.map((reward) => ({
      ...reward,
      tier: nativeTier.parse(tiers[reward.tier]),
    })),
  };
});
if (
  new Set(nativeCaseCatalog.map((entry) => entry.contractId)).size !== 5 ||
  new Set(nativeCaseCatalog.map((entry) => entry.id)).size !== 5
)
  throw new Error("Duplicate native case registry entry.");
export type NativeCaseDefinition = (typeof nativeCaseCatalog)[number];
export function nativeCaseById(id: string): NativeCaseDefinition {
  const definition = nativeCaseCatalog.find((entry) => entry.id === id);
  if (!definition) throw new Error("Unknown native NEAR case.");
  return definition;
}
