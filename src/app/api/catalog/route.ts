import { caseCatalog } from "../../../case/catalog";
import { supportedTokens } from "../../../player/tokens";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { network: "testnet", cases: caseCatalog, tokens: supportedTokens },
    { headers: { "Cache-Control": "no-store" } },
  );
}
