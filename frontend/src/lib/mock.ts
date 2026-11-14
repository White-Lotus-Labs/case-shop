// In-memory mock of wallet + contract. No chain calls. Randomness is client-side
// here; on-chain it must come from the contract (e.g. NEAR random seed / VRF).

import { BUNDLE_DEFI, BUNDLE_MAJORS, CASES, TOKENS, toCurrency, type CaseDef, type Currency, type LootItem } from './cases'
import type { Balances, BundleAsset, CaseContract, Drop, HistoryEntry, OwnedCase, WalletAdapter } from './api'

const ME = 'player.testnet'
const OTHERS = ['alice.near', 'bob.near', 'whale.near', 'degen.near', 'luckycat.near', 'satoshi.near']

const ledger: Balances = { NEAR: 200, USDC: 500 }
const owned = new Map<string, string>() // ownedId -> caseId
const drops = new Map<string, Drop>()
const log: HistoryEntry[] = [] // newest first
let seq = 0

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const snapshot = (): Balances => ({ ...ledger })
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

const roll = (def: CaseDef): LootItem => {
  const total = def.loot.reduce((s, l) => s + l.weight, 0)
  let r = Math.random() * total
  return def.loot.find((l) => (r -= l.weight) < 0) ?? def.loot[0]
}

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5)

/**
 * Splits a drop's value into a 5-asset bundle: majors (BTC, ETH, NEAR, USDC) plus NEAR DeFi
 * tokens, with uneven random weights. Values are rounded to cents and always sum to `valueUsd`.
 */
function makeBundle(valueUsd: number): BundleAsset[] {
  const picks = [
    ...shuffle(TOKENS.filter((t) => t.kind === 'major')).slice(0, BUNDLE_MAJORS),
    ...shuffle(TOKENS.filter((t) => t.kind === 'defi')).slice(0, BUNDLE_DEFI),
  ]
  const weights = picks.map(() => 0.4 + Math.random())
  const total = weights.reduce((s, w) => s + w, 0)
  let left = Math.round(valueUsd * 100)
  return picks
    .map((t, i) => {
      const cents = i === picks.length - 1 ? left : Math.round((valueUsd * 100 * weights[i]) / total)
      left -= cents
      return { symbol: t.symbol, valueUsd: cents / 100, amount: cents / 100 / t.priceUsd }
    })
    .sort((a, b) => b.valueUsd - a.valueUsd)
}

const record = (accountId: string, def: CaseDef, item: LootItem, bundle: BundleAsset[], timestamp = Date.now()) =>
  log.unshift({
    id: `tx-${++seq}`,
    accountId,
    caseId: def.id,
    itemName: item.name,
    assets: bundle.map((a) => a.symbol),
    paidUsd: def.priceUsd,
    valueUsd: item.valueUsd,
    timestamp,
  })

// Simulated activity from other users: seed some past opens, then one every few seconds.
const simulateOther = (timestamp?: number) => {
  const def = pick(CASES)
  const item = roll(def)
  record(pick(OTHERS), def, item, makeBundle(item.valueUsd), timestamp)
}
for (let i = 15; i > 0; i--) simulateOther(Date.now() - i * 45_000)
setInterval(simulateOther, 5000)

export const wallet: WalletAdapter = {
  async connect() {
    await wait()
    return { accountId: ME, balances: snapshot() }
  },
  async disconnect() {
    await wait(100)
  },
}

export const contract: CaseContract = {
  async buy(caseId, qty, currency: Currency) {
    await wait()
    const def = CASES.find((c) => c.id === caseId)
    if (!def) throw new Error('Unknown case')
    const cost = toCurrency(def.priceUsd * qty, currency)
    if (ledger[currency] < cost) throw new Error(`Insufficient ${currency} balance`)
    ledger[currency] -= cost
    const cases: OwnedCase[] = Array.from({ length: qty }, () => {
      const id = `own-${++seq}`
      owned.set(id, caseId)
      return { id, caseId }
    })
    return { cases, balances: snapshot() }
  },

  async reveal(ownedIds) {
    await wait(700)
    return ownedIds.map((ownedId) => {
      const caseId = owned.get(ownedId)
      const def = CASES.find((c) => c.id === caseId)
      if (!caseId || !def) throw new Error('Case not owned')
      owned.delete(ownedId)
      const item = roll(def)
      const drop: Drop = { id: `drop-${++seq}`, caseId, item, bundle: makeBundle(item.valueUsd) }
      drops.set(drop.id, drop)
      record(ME, def, item, drop.bundle)
      return drop
    })
  },

  async sell(dropIds, currency) {
    await wait()
    for (const id of dropIds) {
      const drop = drops.get(id)
      if (!drop) throw new Error('Item not owned')
      drops.delete(id)
      ledger[currency] += toCurrency(drop.item.valueUsd, currency)
    }
    return { balances: snapshot() }
  },

  async history(limit = 50) {
    return log.slice(0, limit)
  },
}
