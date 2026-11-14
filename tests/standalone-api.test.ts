import { expect, it } from "vitest";
import { GET as catalog } from "../src/app/api/catalog/route";
import { GET as root } from "../src/app/route";
it("exposes the configured Testnet catalog without inventing balances", async () => {
  const response = catalog();
  const data = await response.json();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(data.network).toBe("testnet");
  expect(data.cases).toHaveLength(5);
  expect(data.tokens).toHaveLength(13);
  expect(
    data.cases.every((item: { contractId: string }) =>
      item.contractId.endsWith(".testnet"),
    ),
  ).toBe(true);
  expect(data).not.toHaveProperty("balances");
});
it("identifies the standalone service without assuming live wallet readiness", async () => {
  const data = await root().json();
  expect(data.service).toBe("Iroh Case Shop API");
  expect(data.network).toBe("testnet");
  expect(data.catalog).toBe("/api/catalog");
  expect(data).not.toHaveProperty("walletReady");
});
