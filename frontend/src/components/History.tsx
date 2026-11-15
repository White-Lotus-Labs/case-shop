import { useEffect, useRef, useState } from "react";
import { BundleList } from "@/components/Bundle";
import { openingTime, type HistoryEntry } from "@/lib/api";
import { CASES } from "@/lib/cases";
import { sound } from "@/lib/sound";
import { tierOf } from "@/lib/tiers";
import { Glyph } from "@/ui/kit";

export function History({
  entries,
  me,
  error,
  onMore,
  className = "",
}: {
  entries: HistoryEntry[];
  me?: string;
  error?: string | null;
  onMore?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        root.current &&
        !root.current.contains(event.target)
      )
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className={`relative ${className}`}>
      {open && (
        <section
          id="live-activity"
          aria-label="Activity from all players"
          className="material-regular appear absolute bottom-full left-0 mb-3 flex max-h-[min(540px,65dvh)] w-[min(580px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] border border-purple-500/30 shadow-[0_30px_70px_rgba(0,0,0,0.8),0_0_30px_rgba(157,78,221,0.2)]"
        >
          <div className="hairline-b px-5 py-4 bg-[#0a0d24]/90 flex items-center justify-between">
            <div>
              <div className="font-display text-[15px] font-bold tracking-wide text-white flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#d7bd89] animate-ping" />
                Live On-Chain Openings
              </div>
              <p className="t-caption mt-0.5 text-label-2">
                Finalized on-chain records · Latest {entries.length} vault activations
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#d7bd89]/15 text-[#d7bd89] text-[11px] font-semibold border border-[#d7bd89]/30">
              <img src="/near-badge.webp" alt="NEAR" className="size-3.5 object-contain" />
              <span>NEAR Verified</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
            {error && (
              <p role="status" className="t-footnote py-3 text-red-400">
                {error}
              </p>
            )}
            {!entries.length && !error && (
              <div className="py-8 text-center text-label-3">
                <Glyph name="gravity" className="mx-auto size-8 mb-2 opacity-50" />
                <p className="t-footnote">Awaiting first on-chain case opening...</p>
              </div>
            )}
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`hairline-b flex items-start gap-3 py-3 hover:bg-white/[0.02] transition-colors rounded-lg px-2 ${entry.tier === "Legendary" ? "border border-amber-300/40 bg-amber-400/5" : ""}`}
              >
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
                  style={{ color: tierOf(entry.caseId).ui, background: tierOf(entry.caseId).ui }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-footnote font-semibold truncate text-white">
                      {entry.accountId === me ? "You" : `${entry.accountId.slice(0, 8)}…${entry.accountId.slice(-8)}`}
                    </span>
                    <span className="text-[11px] font-mono text-[#d7bd89] bg-[#d7bd89]/10 px-2 py-0.5 rounded border border-[#d7bd89]/20">
                      Block #{entry.height}
                    </span>
                  </div>
                  <div className="text-[12px] text-label-2 mt-0.5">
                    {CASES.find((c) => c.id === entry.caseId)?.name ?? entry.caseId}{" "}
                    · Opening #{entry.openingId}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-label-2">
                    <span>{entry.tier ?? "Drawing"} · {entry.status}</span>
                    <time dateTime={openingTime(entry.timestamp).iso}>{openingTime(entry.timestamp).label}</time>
                    <a href={entry.transactionHash ? `https://testnet.nearblocks.io/txns/${entry.transactionHash}` : `https://testnet.nearblocks.io/blocks/${entry.height}`} target="_blank" rel="noopener noreferrer" className="text-purple-300 underline">{entry.transactionHash ? "Verified transaction ↗" : "Opening block ↗"}</a>
                  </div>
                  <div className="mt-2">
                    <BundleList assets={entry.assets} dense />
                  </div>
                </div>
              </div>
            ))}
            {onMore && (
              <button
                className="t-footnote py-3 w-full text-center font-semibold text-[#d7bd89] hover:text-[#f0dab2] transition-colors"
                onClick={onMore}
              >
                Load older transactions ↓
              </button>
            )}
          </div>
        </section>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="live-activity"
        onClick={() => {
          sound.tap();
          setOpen(!open);
        }}
        className="material-regular flex h-11 items-center gap-2.5 rounded-full pr-4 pl-4 border border-purple-500/25 shadow-[0_4px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform active:scale-[0.97] hover:border-purple-400/50"
      >
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d7bd89] opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#d7bd89]" />
        </span>
        <span className="font-display text-[13px] font-bold tracking-wide text-white">Live Activity</span>
        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-[#d7bd89]">
          {open ? "Hide" : "Show"}
          <Glyph
            name={open ? "chevron-down" : "chevron-up"}
            className="size-3.5"
          />
        </span>
      </button>
    </div>
  );
}
