import { loadConnector } from "../../../src/wallet/nearConnector";
import {
  nativeCaseCatalog,
  type NativeCaseDefinition,
} from "../../../src/case/nativeCatalog";

type Connector = Awaited<ReturnType<typeof loadConnector>>;
declare global {
  interface Window {
    __CASE_SHOP_TEST_CONNECTOR__?: Connector;
    __CASE_SHOP_TEST_DEPLOYMENTS__?: {
      rpcUrl: string;
      contracts: Record<string, string>;
    };
  }
}

/** Browser tests may connect only to an explicitly enabled, local Sandbox. */
const sandbox =
  import.meta.env.DEV &&
  import.meta.env.VITE_NATIVE_SANDBOX === "1" &&
  location.hostname === "127.0.0.1";
export function runtimeCases(): NativeCaseDefinition[] {
  const overrides = sandbox ? window.__CASE_SHOP_TEST_DEPLOYMENTS__ : undefined;
  if (!overrides) return nativeCaseCatalog;
  const rpc = new URL(overrides.rpcUrl);
  if (rpc.protocol !== "http:" || rpc.hostname !== "127.0.0.1")
    throw new Error("Sandbox RPC must be local.");
  return nativeCaseCatalog.map((definition) => {
    const contractId = overrides.contracts[definition.id];
    if (
      !contractId ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(contractId) ||
      contractId.length > 64
    )
      throw new Error("Invalid Sandbox case deployment.");
    return {
      ...definition,
      contractId,
      rpcUrl: rpc.href,
      deploymentStatus: "verified-live",
    };
  });
}
export async function runtimeConnector(): Promise<Connector> {
  if (sandbox && window.__CASE_SHOP_TEST_CONNECTOR__)
    return window.__CASE_SHOP_TEST_CONNECTOR__;
  return loadConnector();
}
