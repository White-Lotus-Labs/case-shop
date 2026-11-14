// Static case catalogue. In production this would come from the contract / an indexer.

export type Currency = 'NEAR' | 'USDC'

/** Mock oracle rate. Replace with a real price feed. */
export const NEAR_USD = 2.5

export const toCurrency = (usd: number, c: Currency) => (c === 'NEAR' ? usd / NEAR_USD : usd)
export const fmt = (usd: number, c: Currency) => `${toCurrency(usd, c).toFixed(2)} ${c}`

// ---------- bundle tokens ----------

export interface Token {
  symbol: string
  name: string
  /** Mock oracle price. Replace with a real price feed (e.g. Ref Finance / Pyth on NEAR). */
  priceUsd: number
  kind: 'major' | 'defi'
}

export const TOKENS: Token[] = [
  { symbol: 'BTC', name: 'Bitcoin', priceUsd: 98_000, kind: 'major' },
  { symbol: 'ETH', name: 'Ether', priceUsd: 3_400, kind: 'major' },
  { symbol: 'NEAR', name: 'NEAR', priceUsd: NEAR_USD, kind: 'major' },
  { symbol: 'USDC', name: 'USD Coin', priceUsd: 1, kind: 'major' },
  { symbol: 'REF', name: 'Ref Finance', priceUsd: 0.24, kind: 'defi' },
  { symbol: 'BRRR', name: 'Burrow', priceUsd: 0.012, kind: 'defi' },
  { symbol: 'LINEAR', name: 'LiNEAR', priceUsd: 2.78, kind: 'defi' },
  { symbol: 'stNEAR', name: 'Meta Pool stNEAR', priceUsd: 2.82, kind: 'defi' },
  { symbol: 'AURORA', name: 'Aurora', priceUsd: 0.15, kind: 'defi' },
]

export const tokenOf = (symbol: string) => TOKENS.find((t) => t.symbol === symbol) ?? TOKENS[0]

/** Every opened case pays out a bundle of this many assets: majors plus NEAR DeFi tokens */
export const BUNDLE_MAJORS = 3
export const BUNDLE_DEFI = 2

/** Readable token amount: small balances keep 3 significant digits, large ones get grouping */
export function formatAmount(amount: number) {
  if (amount >= 1000) return amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (amount >= 1) return amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return Number(amount.toPrecision(3)).toString()
}

export interface LootItem {
  id: string
  name: string
  rarity: string
  valueUsd: number
  /** Relative drop weight */
  weight: number
}

export interface CaseDef {
  id: string
  name: string
  priceUsd: number
  /** Styling hook — only a grey shade in this prototype */
  shade: string
  loot: LootItem[]
}

const TIERS = [
  { name: 'Common', mult: 0.2, weight: 45 },
  { name: 'Uncommon', mult: 0.5, weight: 30 },
  { name: 'Rare', mult: 0.9, weight: 15 },
  { name: 'Epic', mult: 2, weight: 8 },
  { name: 'Legendary', mult: 10, weight: 2 },
]

const makeCase = (id: string, name: string, priceUsd: number, shade: string): CaseDef => ({
  id,
  name,
  priceUsd,
  shade,
  loot: TIERS.map((t) => ({
    id: `${id}-${t.name.toLowerCase()}`,
    name: `${t.name} Bundle`,
    rarity: t.name,
    valueUsd: +(priceUsd * t.mult).toFixed(2),
    weight: t.weight,
  })),
})

export const CASES: CaseDef[] = [
  makeCase('bronze', 'Bronze', 5, '#e5e5e5'),
  makeCase('silver', 'Silver', 10, '#d4d4d4'),
  makeCase('gold', 'Gold', 25, '#a3a3a3'),
  makeCase('platinum', 'Platinum', 50, '#737373'),
  makeCase('diamond', 'Diamond', 100, '#525252'),
]
