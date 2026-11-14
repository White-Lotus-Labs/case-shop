export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    {
      service: "NEAR Case Shop API",
      network: "testnet",
      catalog: "/api/catalog",
      documentation: "See docs/native-near-deployment.md",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
