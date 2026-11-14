import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { BundleList, combineBundles, TokenStack } from '@/components/Bundle'
import { CaseStage, type StagePhase } from '@/components/case3d/CaseStage'
import { History } from '@/components/History'
import { Inventory } from '@/components/Inventory'
import type { Account, Drop, HistoryEntry, OwnedCase } from '@/lib/api'
import { CASES, fmt, toCurrency, type Currency } from '@/lib/cases'
import { contract, wallet } from '@/lib/mock'
import { RARITY_INDEX, sound } from '@/lib/sound'
import { RARITY_COLOR, tierOf } from '@/lib/tiers'
import { Button, Glyph, Row, Section, SegmentedControl, Stepper } from '@/ui/kit'

const MAX_QTY = 10
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

type Pending = 'connect' | 'buy' | 'reveal' | 'sell' | 'disconnect' | null

const Dot = ({ color, size = 8 }: { color: string; size?: number }) => (
  <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} aria-hidden="true" />
)

export default function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [caseId, setCaseId] = useState(CASES[0].id)
  const [currency, setCurrency] = useState<Currency>('USDC')
  const [qty, setQty] = useState(1)
  const [unopened, setUnopened] = useState<OwnedCase[]>([])
  const [drops, setDrops] = useState<Drop[]>([])
  const [inventory, setInventory] = useState<Drop[]>([])
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const reducedMotion = useReducedMotion()
  const muted = useSyncExternalStore(sound.subscribe, () => sound.muted)

  const refreshHistory = () => contract.history().then(setHistory)
  useEffect(() => {
    refreshHistory()
    const t = setInterval(refreshHistory, 3000)
    return () => clearInterval(t)
  }, [])

  const def = CASES.find((c) => c.id === caseId)!
  const tier = tierOf(caseId)
  const tierIndex = CASES.findIndex((c) => c.id === caseId)
  const busy = pending !== null
  const phase = !account ? 'connect' : drops.length ? 'sell' : unopened.length ? 'reveal' : 'buy'
  const locked = phase === 'reveal' || phase === 'sell' // finish the current round before switching
  const dropsUsd = drops.reduce((s, d) => s + d.item.valueUsd, 0)
  const paidUsd = def.priceUsd * Math.max(1, drops.length)
  const best = drops.reduce<Drop | null>((b, d) => (!b || d.item.valueUsd > b.item.valueUsd ? d : b), null)
  const net = dropsUsd - paidUsd
  const combined = combineBundles(drops.map((d) => d.bundle))

  const stagePhase: StagePhase = opening ? 'opening' : phase === 'sell' ? 'open' : phase === 'reveal' ? 'sealed' : 'idle'

  const run = async (kind: Exclude<Pending, null>, fn: () => Promise<void>) => {
    setPending(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      sound.error()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }

  const setBalances = (balances: Account['balances']) => setAccount((a) => (a ? { ...a, balances } : a))

  const actions = {
    connect: () =>
      run('connect', async () => {
        setAccount(await wallet.connect())
        sound.connect()
      }),
    disconnect: () =>
      run('disconnect', async () => {
        await wallet.disconnect()
        setAccount(null)
      }),
    buy: () =>
      run('buy', async () => {
        const res = await contract.buy(caseId, qty, currency)
        setUnopened(res.cases)
        setBalances(res.balances)
        sound.buy()
      }),
    reveal: () =>
      run('reveal', async () => {
        setOpening(true)
        const duration = reducedMotion ? 300 : tier.openMs
        sound.open(duration, tierIndex)
        try {
          // the unlock sequence and the contract call run together; results land as the lid opens
          const [res] = await Promise.all([contract.reveal(unopened.map((c) => c.id)), sleep(duration)])
          setDrops(res)
          setUnopened([])
          sound.reveal(Math.max(...res.map((d) => RARITY_INDEX[d.item.rarity] ?? 0)))
        } finally {
          setOpening(false)
        }
        await refreshHistory()
      }),
    sell: () =>
      run('sell', async () => {
        const res = await contract.sell(drops.map((d) => d.id), currency)
        setBalances(res.balances)
        setDrops([])
        sound.sell()
      }),
    keep: () => {
      setInventory((inv) => [...inv, ...drops])
      setDrops([])
      sound.keep()
    },
    sellKept: (ids: string[]) =>
      run('sell', async () => {
        const res = await contract.sell(ids, currency)
        setBalances(res.balances)
        sound.sell()
        setInventory((inv) => inv.filter((d) => !ids.includes(d.id)))
      }),
  }

  const primary = {
    connect: { label: 'Connect NEAR Wallet', onClick: actions.connect },
    buy: { label: `Buy for ${fmt(def.priceUsd * qty, currency)}`, onClick: actions.buy },
    reveal: { label: unopened.length > 1 ? `Open ${unopened.length} Cases` : 'Open Case', onClick: actions.reveal },
    sell: { label: `Sell for ${fmt(dropsUsd, currency)}`, onClick: actions.sell },
  }[phase]
  const busyLabel = { connect: 'Connecting', buy: 'Confirming', reveal: 'Opening', sell: 'Selling', disconnect: 'Disconnecting' }

  const hint = {
    connect: 'Connect a NEAR wallet to pay with NEAR or USDC.',
    buy: 'Payment is confirmed in your wallet before the case is yours.',
    reveal: 'Your cases are sealed. Open them here, or tap the case.',
    sell: 'Sell to your balance now, or keep items in My Cases.',
  }[phase]

  const status = {
    connect: { text: 'Not Connected', color: 'var(--color-label-3)' },
    buy: { text: 'Ready', color: tier.ui },
    reveal: { text: `${unopened.length} Sealed`, color: 'var(--color-warning)' },
    sell: { text: 'Opened', color: 'var(--color-success)' },
  }[phase]

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg text-label" style={{ '--tier': tier.ui } as CSSProperties}>
      {/* ---------- 3D stage: fills the viewport, behind every other element ---------- */}
      <div className="stage-glow fixed inset-0 z-0" data-stage>
        <CaseStage
          tier={tier}
          phase={stagePhase}
          rewardColor={best && !opening ? RARITY_COLOR[best.item.rarity] : null}
          reducedMotion={reducedMotion}
          onActivate={phase === 'reveal' && !busy ? actions.reveal : undefined}
        />
      </div>

      {/* ---------- toolbar ---------- */}
      <header className="material-bar hairline-b fixed inset-x-0 top-0 z-40">
        <div className="mx-auto flex h-[52px] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <span className="t-headline mr-auto truncate">Near Case Shop</span>
          <button
            type="button"
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            aria-pressed={!muted}
            title={muted ? 'Sound off' : 'Sound on'}
            onClick={() => {
              sound.setMuted(!muted)
              if (muted) sound.tap()
            }}
            className="grid size-[30px] place-items-center rounded-full text-label-2 transition-colors hover:bg-fill-3 hover:text-label active:opacity-70"
          >
            <Glyph name={muted ? 'speaker-xmark' : 'speaker'} className="size-[18px]" />
          </button>
          {account ? (
            <>
              <span className="t-footnote tnum hidden items-center gap-3 text-label-2 md:flex">
                <span>
                  <span className="text-label">{account.balances.NEAR.toFixed(2)}</span> NEAR
                </span>
                <span>
                  <span className="text-label">{account.balances.USDC.toFixed(2)}</span> USDC
                </span>
              </span>
              <Button
                variant="gray"
                size="small"
                onClick={() => {
                  sound.sheet(true)
                  setInventoryOpen(true)
                }}
              >
                <Glyph name="shippingbox" className="size-3.5" />
                My Cases
                <span className="tnum text-label-2">{inventory.length}</span>
              </Button>
              <span className="t-footnote hidden text-label-2 lg:inline">{account.accountId}</span>
              <Button variant="plain" size="small" onClick={actions.disconnect} disabled={busy} className="t-subheadline">
                Disconnect
              </Button>
            </>
          ) : (
            <Button variant="filled" size="small" onClick={actions.connect} loading={pending === 'connect'}>
              Connect Wallet
            </Button>
          )}
        </div>
      </header>

      {/* ---------- overlay layer: lets pointer events through to the stage where empty ---------- */}
      <div className="pointer-events-none relative z-10 flex min-h-dvh flex-col px-3 pt-[68px] pb-3 sm:px-6 lg:px-8 lg:pt-[76px] lg:pb-8">
        {/* tier picker */}
        <div className="pointer-events-auto mx-auto w-full max-w-[640px]">
          <SegmentedControl
            size="large"
            label="Case tier"
            options={CASES.map((c) => c.id)}
            value={caseId}
            onChange={(id) => {
              sound.select(CASES.findIndex((c) => c.id === id))
              setCaseId(id)
            }}
            disabled={locked || busy}
            renderOption={(id) => {
              const t = tierOf(id)
              const c = CASES.find((x) => x.id === id)!
              return (
                <span className="flex flex-col items-center gap-0.5 py-1.5">
                  <span className="flex items-center gap-1.5 text-[12px] sm:text-[13px]">
                    <span className="hidden sm:inline-flex">
                      <Dot color={t.ui} size={6} />
                    </span>
                    {t.name}
                  </span>
                  <span className="t-caption-2 tnum font-normal text-label-2">${c.priceUsd}</span>
                </span>
              )
            }}
          />
        </div>

        {/* tier title and short description */}
        <div key={tier.id} className="appear mt-5 max-w-[340px] px-1 lg:mt-10">
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[0.012em] lg:text-[34px] lg:leading-[41px]">{tier.name}</h1>
          <p className="t-subheadline mt-1 line-clamp-2 text-label-2">{tier.description}</p>
        </div>

        <div className="flex-1" />

        {/* reveal cards (desktop: centred over the stage floor) */}
        {phase === 'sell' && !opening && (
          <div className="no-scrollbar pointer-events-auto absolute inset-x-0 bottom-8 mx-auto hidden w-fit max-w-[calc(100vw-880px)] gap-3 overflow-x-auto lg:flex">
            {drops.map((d, i) => {
              const r = ((d.item.valueUsd - def.priceUsd) / def.priceUsd) * 100
              const color = RARITY_COLOR[d.item.rarity]
              return (
                <div
                  key={d.id}
                  className="material-regular appear flex w-[224px] shrink-0 flex-col gap-2.5 rounded-[16px] px-4 py-3"
                  style={{ animationDelay: `${120 + i * 90}ms` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="t-caption flex items-center gap-1.5 font-semibold" style={{ color }}>
                        <Dot color={color} size={6} />
                        {d.item.rarity}
                      </span>
                      <span className="t-subheadline font-semibold">5-Asset Bundle</span>
                    </div>
                    <span className="t-footnote tnum flex flex-col items-end">
                      <span className="font-semibold">${d.item.valueUsd.toFixed(2)}</span>
                      <span className={r > 0 ? 'text-success' : 'text-label-3'}>
                        {r > 0 ? '+' : ''}
                        {r.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <BundleList assets={d.bundle} dense />
                </div>
              )
            })}
          </div>
        )}
        {phase === 'reveal' && !opening && (
          <div className="absolute inset-x-0 bottom-10 hidden justify-center lg:flex">
            <span className="material-regular t-footnote appear rounded-full px-3.5 py-1.5 text-label-2">
              {unopened.length} sealed · click the case to open
            </span>
          </div>
        )}

        {/* bottom bar: live activity (left) and case controls (right) */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <History entries={history} me={account?.accountId} className="pointer-events-auto self-start lg:self-end" />

          <aside
            aria-label="Case controls"
            className="material-regular pointer-events-auto flex w-full flex-col gap-4 rounded-[22px] p-4 shadow-[0_24px_60px_rgb(0_0_0/0.45),inset_0_0.5px_0_rgb(255_255_255/0.08)] lg:w-[360px]"
          >
            <div className={`items-start justify-between gap-4 px-1 ${phase === 'sell' ? 'hidden lg:flex' : 'flex'}`}>
              <div className="flex flex-col">
                <span className="t-footnote text-label-2">{tier.name} Case</span>
                <span className="t-title-1 tnum">${def.priceUsd}</span>
                <span className="t-caption tnum text-label-2">
                  {toCurrency(def.priceUsd, 'NEAR').toFixed(2)} NEAR · {def.priceUsd.toFixed(2)} USDC
                </span>
              </div>
              <span className="t-footnote flex items-center gap-1.5 rounded-full bg-fill-3 px-2.5 py-1 text-label-2">
                <Dot color={status.color} size={6} />
                {status.text}
              </span>
            </div>

            <Section glass>
              <Row
                title="Pay With"
                accessory={
                  <div className="w-[132px]">
                    <SegmentedControl
                      label="Currency"
                      options={['USDC', 'NEAR'] as const}
                      value={currency}
                      onChange={(c) => {
                        sound.tap()
                        setCurrency(c)
                      }}
                      disabled={busy || phase === 'reveal'}
                    />
                  </div>
                }
              />
              {/* quantity and balance don't apply once a case is open; hiding them keeps the panel short */}
              {phase !== 'sell' && (
                <Row
                  title="Quantity"
                  accessory={
                    <Stepper
                      label="quantity"
                      value={qty}
                      min={1}
                      max={MAX_QTY}
                      onChange={(q) => {
                        sound.tap()
                        setQty(q)
                      }}
                      disabled={locked || busy}
                    />
                  }
                />
              )}
              {account && phase !== 'sell' && <Row title="Balance" accessory={`${account.balances[currency].toFixed(2)} ${currency}`} />}
            </Section>

            {phase === 'sell' && (
              <Section glass>
                <Row
                  leading={best ? <Dot color={RARITY_COLOR[best.item.rarity]} /> : undefined}
                  title={drops.length === 1 ? drops[0].item.name : `${drops.length} Bundles`}
                  accessory={
                    <>
                      <TokenStack symbols={combined.slice(0, 5).map((a) => a.symbol)} size={16} />
                      <span className="text-label">${dropsUsd.toFixed(2)}</span>
                    </>
                  }
                />
                {/* itemised tokens; on desktop the reveal cards over the stage show this */}
                <div className="group/row relative px-4 py-2.5 lg:hidden">
                  <BundleList assets={combined} />
                  <span className="absolute right-0 bottom-0 left-4 h-px scale-y-50 bg-separator" aria-hidden="true" />
                </div>
                <Row
                  title="Versus Price Paid"
                  accessory={
                    <span className={net >= 0 ? 'text-success' : ''}>
                      {net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(2)}
                    </span>
                  }
                />
              </Section>
            )}

            {error && (
              <p role="alert" className="t-footnote rounded-[12px] bg-danger/15 px-4 py-3 text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button variant="filled" size="large" className="flex-1" onClick={primary.onClick} loading={busy && pending !== 'disconnect'}>
                  {busy && pending ? busyLabel[pending] : primary.label}
                </Button>
                {phase === 'sell' && (
                  <Button variant="gray" size="large" onClick={actions.keep} disabled={busy}>
                    Keep
                  </Button>
                )}
              </div>
              <p className="t-footnote hidden px-1 text-label-2 sm:block">{hint}</p>
            </div>
          </aside>
        </div>
      </div>

      <Inventory
        open={inventoryOpen}
        onOpenChange={(o) => {
          if (!o && inventoryOpen) sound.sheet(false)
          setInventoryOpen(o)
        }}
        items={inventory}
        currency={currency}
        busy={busy}
        onSell={actions.sellKept}
      />
    </div>
  )
}
