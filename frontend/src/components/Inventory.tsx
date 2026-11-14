import { useState } from 'react'
import { BundleList, TokenStack } from '@/components/Bundle'
import type { Drop } from '@/lib/api'
import { fmt, type Currency } from '@/lib/cases'
import { sound } from '@/lib/sound'
import { RARITY_COLOR, tierOf } from '@/lib/tiers'
import { Button, Glyph, SegmentedControl, Sheet } from '@/ui/kit'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: Drop[]
  currency: Currency
  busy: boolean
  onSell: (dropIds: string[]) => void
}

/** Rounded tile tinted by the tier, standing in for the case in lists */
function TierTile({ caseId, compact }: { caseId: string; compact?: boolean }) {
  const t = tierOf(caseId)
  return (
    <div
      className={`grid shrink-0 place-items-center text-label-2 ${compact ? 'size-10 rounded-[10px]' : 'aspect-[4/3] w-full rounded-[14px]'}`}
      style={{ background: `radial-gradient(110% 90% at 30% 10%, color-mix(in oklab, ${t.ui} 34%, transparent), transparent 65%), var(--color-bg-3)` }}
    >
      <Glyph name="shippingbox" className={compact ? 'size-5' : 'size-9'} />
    </div>
  )
}

export function Inventory({ open, onOpenChange, items, currency, busy, onSell }: Props) {
  const [view, setView] = useState<'Grid' | 'List'>('Grid')
  const totalUsd = items.reduce((s, d) => s + d.item.valueUsd, 0)

  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      title="My Cases"
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-44">
            <SegmentedControl label="View" options={['Grid', 'List'] as const} value={view}
              onChange={(v) => {
                sound.tap()
                setView(v)
              }}
            />
          </div>
          <span className="t-footnote tnum mr-auto text-label-2">
            {items.length} {items.length === 1 ? 'item' : 'items'} · {fmt(totalUsd, currency)}
          </span>
          <Button variant="filled" size="medium" disabled={busy || !items.length} onClick={() => onSell(items.map((d) => d.id))}>
            Sell All
          </Button>
        </div>
      }
    >
      {!items.length && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <Glyph name="shippingbox" className="mb-2 size-10 text-label-3" />
          <div className="t-title-3">No Items</div>
          <div className="t-subheadline text-label-2">Open a case and choose Keep to store what's inside.</div>
        </div>
      )}

      {view === 'Grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((d) => (
            <div key={d.id} className="flex flex-col gap-3 rounded-[18px] bg-bg-3/60 p-3">
              <TierTile caseId={d.caseId} />
              <div className="flex flex-col px-1">
                <span className="t-caption font-semibold" style={{ color: RARITY_COLOR[d.item.rarity] }}>
                  {d.item.rarity}
                </span>
                <span className="t-subheadline font-semibold">{d.item.name}</span>
                <span className="t-footnote tnum text-label-2">${d.item.valueUsd.toFixed(2)}</span>
              </div>
              <div className="px-1">
                <BundleList assets={d.bundle} dense />
              </div>
              <Button variant="tinted" size="small" disabled={busy} onClick={() => onSell([d.id])}>
                Sell · {fmt(d.item.valueUsd, currency)}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        items.length > 0 && (
          <div className="overflow-hidden rounded-[12px] bg-bg-3/60">
            {items.map((d) => (
              <div key={d.id} className="group/row relative flex min-h-[60px] items-center gap-3 px-3 py-2">
                <TierTile caseId={d.caseId} compact />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="t-body truncate">{d.item.name}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="t-footnote" style={{ color: RARITY_COLOR[d.item.rarity] }}>
                      {d.item.rarity}
                    </span>
                    <TokenStack symbols={d.bundle.map((a) => a.symbol)} size={14} />
                  </span>
                </div>
                <span className="t-body tnum text-label-2">${d.item.valueUsd.toFixed(2)}</span>
                <Button variant="tinted" size="small" disabled={busy} onClick={() => onSell([d.id])}>
                  Sell
                </Button>
                <span className="absolute right-0 bottom-0 left-[64px] h-px scale-y-50 bg-separator group-last/row:hidden" aria-hidden="true" />
              </div>
            ))}
          </div>
        )
      )}
    </Sheet>
  )
}
