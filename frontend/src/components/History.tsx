import { useEffect, useRef, useState } from 'react'
import { TokenStack } from '@/components/Bundle'
import type { HistoryEntry } from '@/lib/api'
import { CASES } from '@/lib/cases'
import { sound } from '@/lib/sound'
import { tierOf } from '@/lib/tiers'
import { Glyph } from '@/ui/kit'

const roi = (paid: number, value: number) => (paid ? ((value - paid) / paid) * 100 : 0)
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(0)}%`
const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="t-caption text-label-2">{label}</span>
      <span className={`t-headline tnum ${positive ? 'text-success' : ''}`}>{value}</span>
    </div>
  )
}

/** "Live Activity · Show" button that expands into a panel with stats and the feed of all opens */
export function History({ entries, me, className = '' }: { entries: HistoryEntry[]; me?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const paid = entries.reduce((s, e) => s + e.paidUsd, 0)
  const value = entries.reduce((s, e) => s + e.valueUsd, 0)
  const total = roi(paid, value)

  const toggle = (next: boolean) => {
    sound.tap()
    setOpen(next)
  }

  // close on outside click or Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className={`relative ${className}`}>
      {open && (
        <section
          id="live-activity"
          aria-label="Activity from all players"
          className="material-regular appear absolute bottom-full left-0 mb-2 flex max-h-[min(520px,60dvh)] w-[min(600px,calc(100vw-24px))] flex-col overflow-hidden rounded-[20px] shadow-[0_24px_60px_rgb(0_0_0/0.5)]"
        >
          <div className="hairline-b flex flex-wrap gap-x-8 gap-y-2 px-5 py-4">
            <Stat label="Opens" value={String(entries.length)} />
            <Stat label="Spent" value={`$${paid.toFixed(0)}`} />
            <Stat label="Won" value={`$${value.toFixed(0)}`} />
            <Stat label="Player ROI" value={pct(total)} positive={total > 0} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 pb-3">
            <table className="t-footnote tnum w-full min-w-[520px]">
              <thead className="text-left text-label-2">
                <tr>
                  <th className="py-2.5 font-normal">Time</th>
                  <th className="font-normal">Player</th>
                  <th className="font-normal">Case</th>
                  <th className="font-normal">Bundle</th>
                  <th className="text-right font-normal">Paid</th>
                  <th className="text-right font-normal">Won</th>
                  <th className="text-right font-normal">ROI</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const r = roi(e.paidUsd, e.valueUsd)
                  const mine = e.accountId === me
                  return (
                    <tr key={e.id} className={`hairline-t ${mine ? 'text-label' : 'text-label-2'}`}>
                      <td className="py-2 text-label-3">{ago(e.timestamp)}</td>
                      <td className={mine ? 'font-semibold' : ''}>{mine ? 'You' : e.accountId}</td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <span className="size-1.5 rounded-full" style={{ background: tierOf(e.caseId).ui }} />
                          {CASES.find((c) => c.id === e.caseId)?.name ?? e.caseId}
                        </span>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <TokenStack symbols={e.assets} size={14} />
                          <span className="hidden xl:inline">{e.itemName}</span>
                        </span>
                      </td>
                      <td className="text-right">${e.paidUsd}</td>
                      <td className="text-right">${e.valueUsd}</td>
                      <td className={`text-right ${r > 0 ? 'text-success' : 'text-label-3'}`}>{pct(r)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-controls="live-activity"
        onClick={() => toggle(!open)}
        className="material-regular flex h-11 items-center gap-2.5 rounded-full pr-4 pl-4 shadow-[inset_0_0.5px_0_rgb(255_255_255/0.08)] transition-transform active:scale-[0.97]"
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        <span className="t-subheadline font-semibold">Live Activity</span>
        <span className="t-subheadline flex items-center gap-0.5 text-[#409cff]">
          {open ? 'Hide' : 'Show'}
          <Glyph name={open ? 'chevron-down' : 'chevron-up'} className="size-3.5" />
        </span>
      </button>
    </div>
  )
}
