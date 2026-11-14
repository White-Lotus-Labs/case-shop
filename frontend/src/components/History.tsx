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
          className="material-regular appear absolute bottom-full left-0 mb-2 flex max-h-[min(520px,60dvh)] w-[min(600px,calc(100vw-24px))] flex-col overflow-hidden rounded-[20px] shadow-[0_24px_60px_rgb(0_0_0/0.5)]"
        >
          <div className="hairline-b px-5 py-4">
            <div className="t-headline">Global opening history</div>
            <p className="t-caption mt-1 text-label-2">
              Finalized contract records. Latest {entries.length} openings
              across five cases.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 pb-3">
            {error && (
              <p role="status" className="t-footnote py-3 text-label-2">
                {error}
              </p>
            )}
            {!entries.length && !error && (
              <p className="t-footnote py-4 text-label-2">
                No on-chain openings yet.
              </p>
            )}
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="hairline-b flex items-start gap-3 py-3"
              >
                <span
                  className="mt-1 size-1.5 shrink-0 rounded-full"
                  style={{ background: tierOf(entry.caseId).ui }}
                />
                <div className="min-w-0 flex-1">
                  <div className="t-footnote truncate">
                    {entry.accountId === me ? "You" : entry.accountId}
                  </div>
                  <div className="t-caption text-label-2">
                    {CASES.find((c) => c.id === entry.caseId)?.name ??
                      entry.caseId}{" "}
                    · #{entry.openingId} · block {entry.height}
                  </div>
                  <div className="mt-2">
                    <BundleList assets={entry.assets} dense />
                  </div>
                </div>
                <span className="t-caption text-label-2">{entry.status}</span>
              </div>
            ))}
            {onMore && (
              <button
                className="t-footnote py-3 text-[#409cff]"
                onClick={onMore}
              >
                Load more openings
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
        className="material-regular flex h-11 items-center gap-2.5 rounded-full pr-4 pl-4 shadow-[inset_0_0.5px_0_rgb(255_255_255/0.08)] transition-transform active:scale-[0.97]"
      >
        <span className="relative inline-flex size-2 rounded-full bg-success" />
        <span className="t-subheadline font-semibold">Live Activity</span>
        <span className="t-subheadline flex items-center gap-0.5 text-[#409cff]">
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
