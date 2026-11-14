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
      title="Admiral's Vault · My Openings"
      toolbar={
        <div className="flex items-center justify-between pb-2 border-b border-purple-500/15">
          <span className="text-[13px] text-label-2">
            Decentralized rewards sent directly to your connected NEAR account.
          </span>
          <span className="text-[11px] font-mono text-[#00EC97] bg-[#00EC97]/10 px-2 py-0.5 rounded border border-[#00EC97]/25 flex items-center gap-1.5">
            <img src="/near-badge.webp" alt="NEAR" className="size-3.5 object-contain" />
            {items.length} Finalized
          </span>
        </div>
      }
    >
      {error && (
        <p role="status" className="t-footnote py-3 text-red-400">
          {error}
        </p>
      )}
      {!items.length && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20 mb-2">
            <Glyph name="dice" className="size-8" />
          </div>
          <div className="font-display text-[18px] font-bold text-white">No Openings Yet</div>
          <div className="t-subheadline text-label-2 max-w-sm">
            Roll the dice with Admiral Fujitora. Open a case to summon on-chain NEAR tokens and bonus assets.
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {items.map((entry) => {
          const tier = tierOf(entry.caseId);
          return (
            <article
              key={entry.id}
              className="flex flex-col gap-3 rounded-[18px] bg-[#12163b]/70 border border-purple-500/20 p-4 shadow-[0_8px_24px_rgba(0,0,0,0.3)] hover:border-purple-400/40 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full shadow-[0_0_8px_currentColor]"
                    style={{ color: tier.ui, background: tier.ui }}
                  />
                  <span className="font-display text-[14px] font-bold text-white truncate">
                    {CASES.find((c) => c.id === entry.caseId)?.name ?? entry.caseId}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  #{entry.openingId}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-label-3">
                <span>Block {entry.height}</span>
                <span className="text-[#00EC97] font-semibold">{entry.status}</span>
              </div>
              <BundleList assets={entry.assets} />
              {(entry.status === "Claimable" ||
                entry.status === "RandomnessPending") && (
                <Button
                  variant="tinted"
                  size="small"
                  disabled={busy}
                  onClick={() => onRecover(entry)}
                  className="mt-1"
                >
                  {entry.status === "Claimable"
                    ? "Retry Reward Payout"
                    : "Continue Opening"}
                </Button>
              )}
            </article>
          );
        })}
      </div>
      {onMore && (
        <Button
          className="mt-5 w-full"
          variant="gray"
          onClick={onMore}
          disabled={busy}
        >
          Load More Openings
        </Button>
      )}
    </Sheet>
  );
}
