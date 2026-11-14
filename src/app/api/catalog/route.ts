import registry from "../../../../config/cases.native.testnet.json";
import { supportedTokens } from "../../../player/tokens";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    {
      network: "testnet",
      paymentAsset: "NEAR",
      economyUnit: "microNEAR",
      contractVersion: "native-v1",
      cases: registry.cases,
      tokens: supportedTokens.filter((token) => token.symbol !== "USDI"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
