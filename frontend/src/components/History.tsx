import { useEffect, useRef, useState } from "react";
import { BundleList } from "@/components/Bundle";
import type { HistoryEntry } from "@/lib/api";
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
                <span className="size-2 rounded-full bg-[#00EC97] animate-ping" />
                Live On-Chain Openings
              </div>
              <p className="t-caption mt-0.5 text-label-2">
                Finalized on-chain records · Latest {entries.length} vault activations
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#00EC97]/15 text-[#00EC97] text-[11px] font-semibold border border-[#00EC97]/30">
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
                className="hairline-b flex items-start gap-3 py-3 hover:bg-white/[0.02] transition-colors rounded-lg px-2"
              >
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
                  style={{ color: tierOf(entry.caseId).ui, background: tierOf(entry.caseId).ui }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-footnote font-semibold truncate text-white">
                      {entry.accountId === me ? "You (Connected)" : entry.accountId}
                    </span>
                    <span className="text-[11px] font-mono text-[#00EC97] bg-[#00EC97]/10 px-2 py-0.5 rounded border border-[#00EC97]/20">
                      Block #{entry.height}
                    </span>
                  </div>
                  <div className="text-[12px] text-label-2 mt-0.5">
                    {CASES.find((c) => c.id === entry.caseId)?.name ?? entry.caseId}{" "}
                    · Opening #{entry.openingId}
                  </div>
                  <div className="mt-2">
                    <BundleList assets={entry.assets} dense />
                  </div>
                </div>
              </div>
            ))}
            {onMore && (
              <button
                className="t-footnote py-3 w-full text-center font-semibold text-[#00EC97] hover:text-[#55f6bb] transition-colors"
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
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00EC97] opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#00EC97]" />
        </span>
        <span className="font-display text-[13px] font-bold tracking-wide text-white">Live Activity</span>
        <span className="flex items-center gap-0.5 text-[12px] font-semibold text-[#00EC97]">
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
