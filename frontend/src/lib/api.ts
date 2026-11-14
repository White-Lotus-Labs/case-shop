// Architecture seams. The UI only talks to these two interfaces.
//  - WalletAdapter  -> swap mock for @near-wallet-selector
//  - CaseContract   -> swap mock for real contract calls (buy / reveal / sell)

import type { Currency, LootItem } from './cases'

export type Balances = Record<Currency, number>

export interface Account {
  accountId: string
  balances: Balances
}

/** A purchased, not yet revealed case. */
export interface OwnedCase {
  id: string
  caseId: string
}

/** The content of a revealed case. */
/** One asset inside an opened case's bundle */
export interface BundleAsset {
  symbol: string
  amount: number
  valueUsd: number
}

/** The content of a revealed case: a rarity tier and a bundle of 5 tokens worth the tier's value. */
export interface Drop {
  id: string
  caseId: string
  item: LootItem
  bundle: BundleAsset[]
}

/** One opened case by any user. In production: read from an indexer / contract events. */
export interface HistoryEntry {
  id: string
  accountId: string
  caseId: string
  itemName: string
  /** symbols in the bundle that was won */
  assets: string[]
  paidUsd: number
  valueUsd: number
  timestamp: number
}

export interface WalletAdapter {
  connect(): Promise<Account>
  disconnect(): Promise<void>
}

export interface CaseContract {
  buy(caseId: string, qty: number, currency: Currency): Promise<{ cases: OwnedCase[]; balances: Balances }>
  reveal(ownedIds: string[]): Promise<Drop[]>
  sell(dropIds: string[], currency: Currency): Promise<{ balances: Balances }>
  /** Global feed of opened cases, newest first. */
  history(limit?: number): Promise<HistoryEntry[]>
}
