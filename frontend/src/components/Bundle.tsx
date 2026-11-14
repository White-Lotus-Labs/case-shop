// Token bundle display: coin logo, overlapping logo stack, and an itemised list.
//
// Logos come from the `cryptocurrency-icons` package (CC0). It covers BTC, ETH and USDC only;
// NEAR and the NEAR DeFi tokens have no openly licensed icon there, so those rows show no image.
// To add one, drop an SVG into src/assets/tokens and register it in LOGOS.

import btcLogo from 'cryptocurrency-icons/svg/color/btc.svg?url'
import ethLogo from 'cryptocurrency-icons/svg/color/eth.svg?url'
import usdcLogo from 'cryptocurrency-icons/svg/color/usdc.svg?url'
import type { BundleAsset } from '@/lib/api'
import { formatAmount, tokenOf } from '@/lib/cases'

const LOGOS: Partial<Record<string, string>> = {
  BTC: btcLogo,
  ETH: ethLogo,
  USDC: usdcLogo,
}

export const hasLogo = (symbol: string) => Boolean(LOGOS[symbol])

/** Coin logo, or nothing when no licensed image is available */
export function TokenIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const src = LOGOS[symbol]
  if (!src) return null
  return <img src={src} width={size} height={size} alt="" title={tokenOf(symbol).name} className="shrink-0 rounded-full" draggable={false} />
}

/** Overlapping logos for a compact "what's in it" preview (tokens without a logo are left out) */
export function TokenStack({ symbols, size = 18 }: { symbols: string[]; size?: number }) {
  const shown = symbols.filter(hasLogo)
  if (!shown.length) return null
  return (
    <span className="inline-flex items-center" aria-label={symbols.join(', ')} title={symbols.join(' · ')}>
      {shown.map((s, i) => (
        <span key={`${s}-${i}`} className="flex rounded-full ring-2 ring-bg-2" style={{ marginLeft: i ? -size * 0.3 : 0, zIndex: shown.length - i }}>
          <TokenIcon symbol={s} size={size} />
        </span>
      ))}
    </span>
  )
}

/** Itemised token list: logo (when available), amount + ticker, USD value */
export function BundleList({ assets, dense = false }: { assets: BundleAsset[]; dense?: boolean }) {
  const size = dense ? 14 : 18
  return (
    <ul className={`flex flex-col ${dense ? 'gap-1' : 'gap-1.5'}`}>
      {assets.map((a) => (
        <li key={a.symbol} className={`tnum flex items-center gap-2 ${dense ? 't-caption' : 't-footnote'}`}>
          {/* fixed slot keeps amounts aligned whether or not the token has a logo */}
          <span className="flex shrink-0" style={{ width: size, height: size }}>
            <TokenIcon symbol={a.symbol} size={size} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {formatAmount(a.amount)} <span className="text-label-2">{a.symbol}</span>
          </span>
          <span className="text-label-2">${a.valueUsd.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Sums several bundles into one list of assets, largest value first */
export function combineBundles(bundles: BundleAsset[][]): BundleAsset[] {
  const by = new Map<string, BundleAsset>()
  for (const a of bundles.flat()) {
    const cur = by.get(a.symbol)
    by.set(a.symbol, cur ? { symbol: a.symbol, amount: cur.amount + a.amount, valueUsd: cur.valueUsd + a.valueUsd } : { ...a })
  }
  return [...by.values()].sort((a, b) => b.valueUsd - a.valueUsd)
}
