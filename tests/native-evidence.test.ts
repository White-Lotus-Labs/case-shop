import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nativeAccountId, nativeCaseCatalog } from "../src/case/nativeCatalog";
import { NativeCaseClient, parseNativeOpening } from "../src/case/nativeClient";

const report = z
  .object({
    network: z.literal("local NEAR Sandbox"),
    payment_asset: z.literal("NEAR"),
    live_testnet_transactions: z.literal(false),
    cases: z
      .array(
        z.object({
          case_id: z.string(),
          case: z
            .object({
              bonus_rewards: z.array(
                z.object({ token_contract_id: nativeAccountId }).passthrough(),
              ),
            })
            .passthrough(),
          quote: z.unknown(),
          pool: z.unknown(),
          opening: z.unknown(),
        }),
      )
      .length(5),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../docs/evidence/native-sandbox.json", import.meta.url),
        "utf8",
      ),
    ),
  );

describe("native client compatibility with actual all-five Sandbox artifacts", () => {
  for (const row of report.cases) {
    it(`validates real serialized contract views and paid opening for ${row.case_id}`, async () => {
      const canonical = nativeCaseCatalog.find(
        (definition) => definition.id === row.case_id,
      );
      if (!canonical)
        throw new Error("Sandbox case missing from native registry.");
      const definition = {
        ...canonical,
        bonusRewards: canonical.bonusRewards.map((reward, index) => ({
          ...reward,
          token_contract_id: row.case.bonus_rewards[index].token_contract_id,
        })),
      };
      const client = new NativeCaseClient(definition, async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        const view =
          body.params.method_name === "get_case"
            ? row.case
            : body.params.method_name === "get_pool"
              ? row.pool
              : row.quote;
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            result: Array.from(new TextEncoder().encode(JSON.stringify(view))),
          },
        });
      });
      expect((await client.caseInfo()).payment_asset).toBe("NEAR");
      expect((await client.pool()).reserved_rewards).toBe("0");
      expect((await client.quote("player.testnet")).caseId).toBe(row.case_id);
      expect(parseNativeOpening(row.opening, definition)).toMatchObject({
        status: "Completed",
        nearPaid: true,
        bonusPaid: true,
      });
    });
  }
});
