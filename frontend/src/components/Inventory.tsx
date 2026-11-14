import { BundleList } from "@/components/Bundle";
import type { HistoryEntry } from "@/lib/api";
import { CASES } from "@/lib/cases";
import { tierOf } from "@/lib/tiers";
import { Button, Glyph, Sheet } from "@/ui/kit";

export function Inventory({
  open,
  onOpenChange,
  items,
  error,
  onRecover,
  onMore,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: HistoryEntry[];
  error?: string | null;
  onRecover: (entry: HistoryEntry) => void;
  onMore?: () => void;
  busy: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      title="My openings"
      toolbar={
        <span className="t-footnote text-label-2">
          Rewards are sent directly to your connected wallet.
        </span>
      }
    >
      {error && (
        <p role="status" className="t-footnote py-3 text-label-2">
          {error}
        </p>
      )}
      {!items.length && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <Glyph name="shippingbox" className="mb-2 size-10 text-label-3" />
          <div className="t-title-3">No openings yet</div>
          <div className="t-subheadline text-label-2">
            Your actual Testnet case openings will appear here.
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((entry) => (
          <article
            key={entry.id}
            className="flex flex-col gap-3 rounded-[18px] bg-bg-3/60 p-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ background: tierOf(entry.caseId).ui }}
              />
              <span className="t-subheadline font-semibold">
                {CASES.find((c) => c.id === entry.caseId)?.name ?? entry.caseId}
              </span>
            </div>
            <span className="t-caption text-label-2">
              Opening #{entry.openingId} · {entry.status} · block {entry.height}
            </span>
            <BundleList assets={entry.assets} />
            {(entry.status === "Claimable" ||
              entry.status === "RandomnessPending") && (
              <Button
                variant="tinted"
                size="small"
                disabled={busy}
                onClick={() => onRecover(entry)}
              >
                {entry.status === "Claimable"
                  ? "Retry reward payout"
                  : "Continue opening"}
              </Button>
            )}
          </article>
        ))}
      </div>
      {onMore && (
        <Button
          className="mt-4"
          variant="gray"
          onClick={onMore}
          disabled={busy}
        >
          Load more openings
        </Button>
      )}
    </Sheet>
  );
}
