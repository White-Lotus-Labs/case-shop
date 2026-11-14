export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    {
      service: "Iroh Case Shop API",
      network: "testnet",
      catalog: "/api/catalog",
      documentation: "See docs/frontend-integration.md",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
