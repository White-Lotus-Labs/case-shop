import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { BundleList } from "@/components/Bundle";
import { CaseStage, type StagePhase } from "@/components/case3d/CaseStage";
import { History } from "@/components/History";
import { Inventory } from "@/components/Inventory";
import type { BundleAsset, HistoryEntry } from "@/lib/api";
import { fmt, formatAmount } from "@/lib/cases";
import { runtimeCases, runtimeConnector } from "@/lib/runtime";
import { RARITY_INDEX, sound } from "@/lib/sound";
import { RARITY_COLOR, tierOf } from "@/lib/tiers";
import { Button, Glyph, Row, Section, SegmentedControl } from "@/ui/kit";
import {
  NativeCaseClient,
  percent,
  walletTransactionHash,
  type NativeOpening,
  type NativeQuote,
  type NativePool,
} from "../../src/case/nativeClient";
import {
  WalletController,
  INITIAL_WALLET_STATE,
  type WalletSnapshot,
} from "../../src/wallet/walletController";
import {
  nativePendingKey,
  readNativePending,
  saveNativePending,
  clearNativePending,
  observeNativePending,
  validateNativePending,
  retryOriginalNativeCall,
  type NativePending,
} from "../../src/case/nativePending";

const CASES = runtimeCases();
const CLIENTS = CASES.map((definition) => new NativeCaseClient(definition));
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const Dot = ({ color, size = 8 }: { color: string; size?: number }) => (
  <span
    className="inline-block shrink-0 rounded-full"
    style={{ background: color, width: size, height: size }}
    aria-hidden="true"
  />
);
function assets(opening: NativeOpening): BundleAsset[] {
  return [
    ...(opening.reward === null
      ? []
      : [
          {
            symbol: "NEAR",
            contractId: null,
            amount: opening.reward,
            decimals: 24,
            paid: opening.nearPaid,
          },
        ]),
    ...(opening.bonus === null
      ? []
      : [
          {
            symbol: opening.bonus.token_symbol,
            contractId: opening.bonus.token_contract_id,
            amount: opening.bonus.amount,
            decimals: opening.bonus.token_decimals,
            paid: opening.bonusPaid,
          },
        ]),
  ];
}
function entry(opening: NativeOpening): HistoryEntry {
  return {
    id: `${opening.caseId}:${opening.opening_id}`,
    accountId: opening.account_id,
    caseId: opening.caseId,
    openingId: opening.opening_id,
    height: opening.accepted_height,
    status: opening.status,
    assets: assets(opening),
  };
}
function mergeRows(previous: HistoryEntry[], incoming: HistoryEntry[]) {
  const records = new Map(previous.map((row) => [row.id, row]));
  for (const row of incoming) records.set(row.id, row);
  return [...records.values()].sort((a, b) =>
    BigInt(a.height) > BigInt(b.height)
      ? -1
      : BigInt(a.height) < BigInt(b.height)
        ? 1
        : a.id.localeCompare(b.id),
  );
}

export default function App() {
  const [wallet, setWallet] = useState<WalletSnapshot>(INITIAL_WALLET_STATE);
  const controller = useRef<WalletController | null>(null);
  const connector = useRef<Awaited<ReturnType<typeof runtimeConnector>> | null>(
    null,
  );
  const accountRef = useRef<string | null>(null);
  const [caseId, setCaseId] = useState(CASES[0].id);
  const caseRef = useRef(caseId);
  caseRef.current = caseId;
  const [balance, setBalance] = useState<string | null>(null);
  const [quote, setQuote] = useState<NativeQuote | null>(null);
  const [pool, setPool] = useState<NativePool | null>(null);
  const [verified, setVerified] = useState(false);
  const [active, setActive] = useState<NativeOpening | null>(null);
  const [result, setResult] = useState<NativeOpening | null>(null);
  const [uncertain, setUncertain] = useState<NativePending | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [personal, setPersonal] = useState<HistoryEntry[]>([]);
  const [global, setGlobal] = useState<HistoryEntry[]>([]);
  const [personalCursors, setPersonalCursors] = useState<
    Record<string, string | null>
  >({});
  const [globalCursors, setGlobalCursors] = useState<
    Record<string, string | null>
  >({});
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const signing = useRef(false);
  const [animating, setAnimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const muted = useSyncExternalStore(sound.subscribe, () => sound.muted);
  const definition = CASES.find((item) => item.id === caseId) ?? CASES[0];
  const client =
    CLIENTS.find((item) => item.definition.id === caseId) ?? CLIENTS[0];
  const visual = tierOf(caseId);
  const tier = { ...visual, name: definition.name };
  const busy = pending !== null || wallet.busy !== null || animating;
  const account = wallet.accountId;
  const selectedActive =
    active?.account_id === account && active.caseId === caseId ? active : null;
  const selectedResult =
    result?.account_id === account && result.caseId === caseId ? result : null;
  const currentOpening = selectedResult ?? selectedActive;
  const displayedAssets = currentOpening ? assets(currentOpening) : [];
  const phase: StagePhase = animating
    ? "opening"
    : currentOpening?.reward !== null && currentOpening?.reward !== undefined
      ? "open"
      : selectedActive || uncertain
        ? "sealed"
        : "idle";

  useEffect(() => {
    let disposed = false;
    let detach = () => {};
    let instance: WalletController | null = null;
    void runtimeConnector()
      .then((runtime) => {
        if (disposed) return;
        connector.current = runtime;
        instance = new WalletController({ connector: runtime });
        controller.current = instance;
        const update = () => {
          if (!instance || disposed) return;
          const snapshot = instance.getSnapshot();
          if (accountRef.current !== snapshot.accountId) {
            setResult(null);
            setActive(null);
            setUncertain(null);
            setBalance(null);
            setPersonal([]);
          }
          accountRef.current = snapshot.accountId;
          setWallet(snapshot);
        };
        detach = instance.subscribe(update);
        void instance.start();
      })
      .catch((reason) => {
        if (!disposed) setError(message(reason));
      });
    return () => {
      disposed = true;
      detach();
      instance?.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    setBalance(null);
    setPersonal([]);
    setPersonalCursors({});
    setPersonalError(null);
  }, [account]);
  useEffect(() => {
    setResult(null);
    setActive(null);
    setUncertain(null);
    setError(null);
  }, [account, caseId]);

  useEffect(() => {
    const abort = new AbortController();
    let loading = false;
    setVerified(false);
    setQuote(null);
    setPool(null);
    setDeploymentError(null);
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const [info, nextPool, nextQuote] = await Promise.all([
          client.caseInfo(abort.signal),
          client.pool(abort.signal),
          client.quote(account ?? "viewer.testnet", abort.signal),
        ]);
        if (abort.signal.aborted) return;
        setVerified(info.caseId === caseId);
        setPool(nextPool);
        setQuote(nextQuote);
        setDeploymentError(null);
        if (account) {
          const [nextActive, history] = await Promise.all([
            client.active(account, abort.signal),
            client.history(account, abort.signal),
          ]);
          if (abort.signal.aborted || accountRef.current !== account) return;
          setActive(nextActive);
          setResult((previous) =>
            previous
              ? (history.find(
                  (row) => row.opening_id === previous.opening_id,
                ) ?? previous)
              : null,
          );
          const key = nativePendingKey(definition, account);
          const saved = readNativePending(localStorage, key);
          if (saved) {
            validateNativePending(saved, definition, account);
            const found =
              observeNativePending(saved, [
                ...(nextActive ? [nextActive] : []),
                ...history,
              ]) ??
              (saved.action === "open" && saved.nonce
                ? await client.findOpeningByNonce(
                    account,
                    saved.nonce,
                    abort.signal,
                  )
                : null);
            if (abort.signal.aborted || accountRef.current !== account) return;
            if (found) {
              setUncertain(null);
              setResult(found);
            } else setUncertain(saved);
          } else setUncertain(null);
        }
      } catch (reason) {
        if (!abort.signal.aborted) {
          setVerified(false);
          setDeploymentError(
            definition.deploymentStatus === "planned"
              ? "Native NEAR deployment is pending. Purchases will be available after the new contracts are deployed and funded."
              : message(reason),
          );
        }
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 6000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [client, account, caseId, definition, revision]);

  useEffect(() => {
    if (!account) return;
    const abort = new AbortController();
    const refresh = () =>
      void client
        .nearBalance(account, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted && accountRef.current === account)
            setBalance(value.available);
        })
        .catch((reason) => {
          if (!abort.signal.aborted)
            setError(`Could not read your NEAR balance. ${message(reason)}`);
        });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [account, client, revision]);

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      const results = await Promise.allSettled(
        CLIENTS.map(async (source) => ({
          source,
          page: await source.globalHistory(null, abort.signal),
        })),
      );
      if (abort.signal.aborted) return;
      const loaded = results.flatMap((row) =>
        row.status === "fulfilled" ? [row.value] : [],
      );
      setGlobal((previous) =>
        mergeRows(
          previous,
          loaded.flatMap((row) => row.page.openings.map(entry)),
        ),
      );
      setGlobalCursors((previous) => ({
        ...Object.fromEntries(
          loaded.map((row) => [row.source.definition.id, row.page.nextCursor]),
        ),
        ...previous,
      }));
      setHistoryError(
        loaded.length === CLIENTS.length
          ? null
          : "Some native case contracts are unavailable or awaiting deployment. Only finalized records from available contracts appear.",
      );
    }
    void load();
    const timer = setInterval(() => void load(), 12000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [revision]);

  useEffect(() => {
    if (!account) return;
    const abort = new AbortController();
    void Promise.allSettled(
      CLIENTS.map(async (source) => ({
        source,
        page: await source.historyPage(account, null, abort.signal),
      })),
    ).then((results) => {
      if (abort.signal.aborted || accountRef.current !== account) return;
      const loaded = results.flatMap((row) =>
        row.status === "fulfilled" ? [row.value] : [],
      );
      setPersonal((previous) =>
        mergeRows(
          previous,
          loaded.flatMap((row) => row.page.openings.map(entry)),
        ),
      );
      setPersonalCursors((previous) => ({
        ...Object.fromEntries(
          loaded.map((row) => [row.source.definition.id, row.page.nextCursor]),
        ),
        ...previous,
      }));
      setPersonalError(
        loaded.length === CLIENTS.length
          ? null
          : "Some case contracts are unavailable or awaiting deployment.",
      );
    });
    return () => abort.abort();
  }, [account, revision]);

  async function run(label: string, operation: () => Promise<void>) {
    if (signing.current) return;
    signing.current = true;
    const owner = accountRef.current;
    const selectedCase = caseRef.current;
    setPending(label);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      if (owner === accountRef.current && selectedCase === caseRef.current) {
        setError(message(reason));
        sound.error();
      }
    } finally {
      signing.current = false;
      setPending(null);
      setRevision((value) => value + 1);
    }
  }
  async function sign(
    call: Parameters<
      Awaited<ReturnType<typeof runtimeConnector>>["signFunctionCall"]
    >[1],
    owner: string,
  ) {
    const runtime = connector.current;
    if (!runtime || accountRef.current !== owner || caseRef.current !== caseId)
      throw new Error(
        "Your wallet changed. Connect the reward owner to continue.",
      );
    const receipt = await runtime.signFunctionCall(
      owner,
      call,
      () => accountRef.current === owner && caseRef.current === caseId,
    );
    if (accountRef.current !== owner || caseRef.current !== caseId)
      throw new Error(
        "Your wallet changed. The opening remains associated with its original owner.",
      );
    return receipt;
  }
  async function present(opened: NativeOpening) {
    if (
      accountRef.current !== opened.account_id ||
      opened.caseId !== caseRef.current
    )
      return;
    setResult(opened);
    if (opened.reward === null) return;
    setAnimating(true);
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 300
      : tier.openMs;
    sound.open(
      duration,
      CASES.findIndex((row) => row.id === caseId),
    );
    await wait(duration);
    if (
      accountRef.current === opened.account_id &&
      caseRef.current === opened.caseId
    )
      sound.reveal(RARITY_INDEX[opened.tier ?? "Common"] ?? 0);
    setAnimating(false);
  }
  async function pollOpening(owner: string, nonce: string) {
    for (
      let attempt = 0;
      attempt < 20 &&
      accountRef.current === owner &&
      caseRef.current === definition.id;
      attempt++
    ) {
      const rows = await client.history(owner);
      if (accountRef.current !== owner || caseRef.current !== definition.id)
        return;
      const found = rows.find((row) => row.nonce === nonce);
      if (found) {
        setUncertain(null);
        if (found.reward !== null || attempt === 19) {
          await present(found);
          return;
        }
        setActive(found);
      }
      await wait(1500);
    }
  }
  const buy = () =>
    run("Preparing wallet", async () => {
      if (!account || !verified)
        throw new Error(
          "Connect your wallet and wait for verified native NEAR contracts.",
        );
      const key = nativePendingKey(definition, account);
      if (readNativePending(localStorage, key))
        throw new Error(
          "Verify your previous wallet transaction before making another purchase.",
        );
      await client.caseInfo();
      const registrations = await client.registrationCalls(account);
      for (const registration of registrations) {
        setPending(`Register ${registration.receiverId}`);
        await sign(registration, account);
        const outstanding = await client.registrationCalls(account);
        if (
          outstanding.some(
            (call) => call.receiverId === registration.receiverId,
          )
        )
          throw new Error(
            "Token registration has not finalized. Refresh after confirming it in your wallet.",
          );
      }
      const fresh = await client.quote(account);
      if (accountRef.current !== account || caseRef.current !== definition.id)
        throw new Error(
          "The wallet or selected case changed. Refresh before signing.",
        );
      const call = client.openCall(fresh);
      const height = await client.finalBlockHeight();
      const intent: NativePending = {
        accountId: account,
        caseId: definition.id,
        caseContractId: definition.contractId,
        action: "open",
        hash: null,
        nonce: fresh.nonce,
        openingId: null,
        call: { ...call, methodName: "open" },
        afterBlockHeight: height,
      };
      if (accountRef.current !== account || caseRef.current !== definition.id)
        return;
      saveNativePending(localStorage, key, intent);
      setUncertain(intent);
      setPending("Confirm NEAR purchase");
      try {
        const response = await sign(call, account);
        const hash = walletTransactionHash(response);
        if (hash) {
          const saved = { ...intent, hash };
          saveNativePending(localStorage, key, saved);
          if (accountRef.current === account) setUncertain(saved);
          const receipt = await client.transaction(hash, account, undefined, {
            ...call,
            afterBlockHeight: height,
          });
          if (accountRef.current !== account) return;
          if (!receipt.success) {
            clearNativePending(localStorage, key);
            setUncertain(null);
            throw new Error(
              "The purchase did not succeed. Its native deposit was refunded by NEAR. Refresh the quote to try again.",
            );
          }
        }
        setPending("Verifying opening");
        await pollOpening(account, fresh.nonce);
        sound.buy();
      } catch (reason) {
        throw reason;
      }
    });
  const recover = (row: HistoryEntry | NativeOpening) =>
    run("Recovering opening", async () => {
      if (!account) throw new Error("Connect the reward owner wallet.");
      const recoveryCase = CASES.find((item) => item.id === row.caseId);
      if (!recoveryCase) throw new Error("Unknown case.");
      const recoveryClient = new NativeCaseClient(recoveryCase);
      const id = "openingId" in row ? row.openingId : row.opening_id;
      const current = await recoveryClient.opening(id);
      if (!current || current.account_id !== account)
        throw new Error("This reward belongs to another wallet.");
      await recoveryClient.caseInfo();
      if (current.status === "Claimable") {
        for (const registration of await recoveryClient.registrationCalls(
          account,
        )) {
          if (registration.receiverId === current.bonus?.token_contract_id)
            await sign(registration, account);
        }
      }
      const call = recoveryClient.recoverCall(current);
      const key = nativePendingKey(recoveryCase, account);
      const intent: NativePending = {
        accountId: account,
        caseId: recoveryCase.id,
        caseContractId: recoveryCase.contractId,
        action: "recover",
        hash: null,
        nonce: current.nonce,
        openingId: current.opening_id,
        call: {
          ...call,
          methodName:
            current.status === "Claimable" ? "retry_payout" : "advance_opening",
        },
        afterBlockHeight: await recoveryClient.finalBlockHeight(),
      };
      saveNativePending(localStorage, key, intent);
      try {
        const response = await sign(call, account);
        const hash = walletTransactionHash(response);
        if (hash) saveNativePending(localStorage, key, { ...intent, hash });
      } catch (reason) {
        throw reason;
      }
      if (accountRef.current !== account) return;
      setCaseId(recoveryCase.id);
      setInventoryOpen(false);
    });
  const verifyTransaction = () =>
    run("Verifying transaction", async () => {
      if (!uncertain || !account) return;
      const hash = recoveryHash || uncertain.hash;
      if (!hash)
        throw new Error(
          "Paste the transaction hash from your wallet to verify the previous purchase.",
        );
      const receipt = await client.transaction(hash, account, undefined, {
        ...uncertain.call,
        afterBlockHeight: uncertain.afterBlockHeight,
      });
      if (accountRef.current !== account) return;
      if (!receipt.success) {
        clearNativePending(localStorage, nativePendingKey(definition, account));
        setUncertain(null);
        return;
      }
      await pollOpening(account, uncertain.nonce ?? "");
    });
  const retryOriginal = () =>
    run("Checking original purchase", async () => {
      if (!uncertain || !account) return;
      await client.caseInfo();
      const fresh = await client.quote(account);
      if (accountRef.current !== account) return;
      const call = retryOriginalNativeCall(
        uncertain,
        definition,
        account,
        fresh,
      );
      const response = await sign(call, account);
      const hash = walletTransactionHash(response);
      if (hash) {
        const saved = { ...uncertain, hash };
        saveNativePending(
          localStorage,
          nativePendingKey(definition, account),
          saved,
        );
        if (accountRef.current !== account) return;
        setUncertain(saved);
        const receipt = await client.transaction(hash, account, undefined, {
          ...call,
          afterBlockHeight: uncertain.afterBlockHeight,
        });
        if (accountRef.current !== account) return;
        if (!receipt.success) {
          clearNativePending(
            localStorage,
            nativePendingKey(definition, account),
          );
          setUncertain(null);
          return;
        }
      }
      if (uncertain.nonce) await pollOpening(account, uncertain.nonce);
    });
  async function moreHistory(personalOnly: boolean) {
    const cursors = personalOnly ? personalCursors : globalCursors;
    const owner = accountRef.current;
    const pages = await Promise.allSettled(
      CLIENTS.filter((source) => cursors[source.definition.id] != null).map(
        async (source) => ({
          source,
          page:
            personalOnly && owner
              ? await source.historyPage(owner, cursors[source.definition.id])
              : await source.globalHistory(cursors[source.definition.id]),
        }),
      ),
    );
    if (personalOnly && owner !== accountRef.current) return;
    const loaded = pages.flatMap((row) =>
      row.status === "fulfilled" ? [row.value] : [],
    );
    const update = personalOnly ? setPersonal : setGlobal;
    const updateCursors = personalOnly ? setPersonalCursors : setGlobalCursors;
    update((previous) =>
      mergeRows(
        previous,
        loaded.flatMap((row) => row.page.openings.map(entry)),
      ),
    );
    updateCursors((previous) => ({
      ...previous,
      ...Object.fromEntries(
        loaded.map((row) => [row.source.definition.id, row.page.nextCursor]),
      ),
    }));
  }

  const primary = !account
    ? {
        label: "Connect NEAR Wallet",
        action: () => void controller.current?.connect(),
        disabled: wallet.status === "initializing",
      }
    : selectedActive?.status === "Claimable"
      ? {
          label: "Retry reward payout",
          action: () => selectedActive && recover(selectedActive),
          disabled: false,
        }
      : selectedActive?.status === "RandomnessPending"
        ? {
            label: "Continue opening",
            action: () => selectedActive && recover(selectedActive),
            disabled: false,
          }
        : selectedActive?.status === "Paying"
          ? {
              label: "Sending rewards to your wallet",
              action: () => {},
              disabled: true,
            }
          : uncertain
            ? {
                label: "Verify wallet transaction",
                action: verifyTransaction,
                disabled: false,
              }
            : selectedResult
              ? {
                  label: "Open another case",
                  action: () => {
                    if (account)
                      clearNativePending(
                        localStorage,
                        nativePendingKey(definition, account),
                      );
                    setResult(null);
                    setRevision((value) => value + 1);
                  },
                  disabled: false,
                }
              : {
                  label: `Open for ${fmt(definition.price)}`,
                  action: buy,
                  disabled: !verified || !quote?.can_open,
                };
  const status = !verified
    ? definition.deploymentStatus === "planned"
      ? "Deployment pending"
      : "Unavailable"
    : (selectedActive?.status ??
      (selectedResult ? selectedResult.status : "Ready"));

  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-bg text-label"
      style={{ "--tier": tier.ui } as CSSProperties}
    >
      <div className="stage-glow fixed inset-0 z-0" data-stage>
        <CaseStage
          tier={tier}
          phase={phase}
          rewardColor={
            currentOpening?.tier && !animating
              ? RARITY_COLOR[currentOpening.tier]
              : null
          }
          reducedMotion={
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
          }
        />
      </div>
      <header className="material-bar hairline-b fixed inset-x-0 top-0 z-40">
        <div className="mx-auto flex h-[52px] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
          <span className="t-headline mr-auto truncate">
            Near Case Shop{" "}
            <span className="t-caption text-label-2">Testnet</span>
          </span>
          <button
            type="button"
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            aria-pressed={!muted}
            onClick={() => {
              sound.setMuted(!muted);
              if (muted) sound.tap();
            }}
            className="grid size-[30px] place-items-center rounded-full text-label-2 hover:bg-fill-3"
          >
            <Glyph
              name={muted ? "speaker-xmark" : "speaker"}
              className="size-[18px]"
            />
          </button>
          {account ? (
            <>
              <span
                className="t-footnote tnum hidden text-label-2 md:inline"
                data-testid="wallet-balance"
              >
                {balance === null ? "Reading balance…" : fmt(balance)}
              </span>
              <Button
                variant="gray"
                size="small"
                onClick={() => {
                  sound.sheet(true);
                  setInventoryOpen(true);
                }}
              >
                <Glyph name="shippingbox" className="size-3.5" />
                My openings
              </Button>
              <span
                className="t-footnote hidden max-w-[220px] truncate text-label-2 lg:inline"
                title={account}
              >
                {account}
              </span>
              <Button
                variant="plain"
                size="small"
                onClick={() => void controller.current?.disconnect()}
                disabled={busy}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              variant="filled"
              size="small"
              onClick={() => void controller.current?.connect()}
              loading={wallet.busy === "connect"}
              disabled={wallet.status === "initializing"}
            >
              Connect Wallet
            </Button>
          )}
        </div>
      </header>
      <div className="pointer-events-none relative z-10 flex min-h-dvh flex-col px-3 pt-[68px] pb-3 sm:px-6 lg:px-8 lg:pt-[76px] lg:pb-8">
        <div className="pointer-events-auto mx-auto w-full max-w-[740px]">
          <SegmentedControl
            size="large"
            label="Case tier"
            options={CASES.map((item) => item.id)}
            value={caseId}
            onChange={(id) => {
              sound.select(CASES.findIndex((item) => item.id === id));
              setCaseId(id);
            }}
            disabled={busy}
            renderOption={(id) => {
              const item = CASES.find((row) => row.id === id) ?? CASES[0];
              return (
                <span className="flex flex-col items-center gap-0.5 py-1.5">
                  <span className="flex items-center gap-1.5 text-[10px] sm:text-[12px]">
                    <span className="hidden sm:inline-flex">
                      <Dot color={tierOf(id).ui} size={6} />
                    </span>
                    {item.name.replace(" Case", "")}
                  </span>
                  <span className="t-caption-2 tnum font-normal text-label-2">
                    {fmt(item.price)}
                  </span>
                </span>
              );
            }}
          />
        </div>
        <div key={caseId} className="appear mt-5 max-w-[340px] px-1 lg:mt-10">
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[0.012em] lg:text-[34px] lg:leading-[41px]">
            {definition.name}
          </h1>
          <p className="t-subheadline mt-1 line-clamp-2 text-label-2">
            {definition.description}
          </p>
        </div>
        <div className="min-h-[180px] flex-1" />
        {currentOpening?.reward && !animating && (
          <div className="material-regular appear pointer-events-auto absolute inset-x-0 bottom-8 mx-auto hidden w-[240px] flex-col gap-3 rounded-[16px] px-4 py-3 lg:flex">
            <span
              className="t-caption font-semibold"
              style={{ color: RARITY_COLOR[currentOpening.tier ?? "Common"] }}
            >
              {currentOpening.tier} reward
            </span>
            <BundleList assets={displayedAssets} dense />
            <span className="t-caption text-label-2">
              Verified opening #{currentOpening.opening_id}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <History
            entries={global}
            me={account ?? undefined}
            error={historyError}
            onMore={
              Object.values(globalCursors).some((cursor) => cursor !== null)
                ? () => void moreHistory(false)
                : undefined
            }
            className="pointer-events-auto self-start lg:self-end"
          />
          <aside
            aria-label="Case controls"
            className="material-regular pointer-events-auto flex w-full flex-col gap-4 rounded-[22px] p-4 shadow-[0_24px_60px_rgb(0_0_0/0.45),inset_0_0.5px_0_rgb(255_255_255/0.08)] lg:w-[360px]"
          >
            <div className="flex items-start justify-between gap-4 px-1">
              <div className="flex flex-col">
                <span className="t-footnote text-label-2">
                  {definition.name}
                </span>
                <span className="t-title-1 tnum">{fmt(definition.price)}</span>
                <span className="t-caption text-label-2">
                  Native Testnet NEAR
                </span>
              </div>
              <span className="t-footnote flex items-center gap-1.5 rounded-full bg-fill-3 px-2.5 py-1 text-label-2">
                <Dot
                  color={verified ? tier.ui : "var(--color-label-3)"}
                  size={6}
                />
                {status}
              </span>
            </div>
            <Section glass>
              <Row title="Pay with" accessory="NEAR · Testnet" />
              {account && (
                <Row
                  title="Available balance"
                  accessory={balance === null ? "Reading…" : fmt(balance)}
                />
              )}
              {quote && (
                <Row
                  title="Opening storage"
                  accessory={fmt(quote.storage_deposit)}
                />
              )}
              {pool && (
                <Row title="Prize pool" accessory={fmt(pool.pool_funds)} />
              )}
            </Section>
            {quote && (
              <Section glass>
                {definition.rewards.map((reward) => (
                  <Row
                    key={reward.tier}
                    title={reward.tier}
                    leading={<Dot color={RARITY_COLOR[reward.tier]} />}
                    accessory={
                      <span className="tnum">
                        {percent(quote[reward.probability])} ·{" "}
                        {fmt(reward.amount)}
                      </span>
                    }
                  />
                ))}
                <div className="t-caption px-4 py-2 text-label-2">
                  {definition.bonusRewards.map((reward) => (
                    <p key={reward.token_contract_id}>
                      {reward.tier} token:{" "}
                      {formatAmount(reward.amount, reward.token_decimals)}{" "}
                      {reward.token_symbol}
                    </p>
                  ))}
                  <p className="mt-2">
                    One configured token is selected from the winning tier.
                    Probabilities come from the current contract quote.
                  </p>
                </div>
              </Section>
            )}
            {displayedAssets.length > 0 && (
              <Section glass>
                <div className="px-4 py-3">
                  <div className="t-footnote mb-2 font-semibold">
                    {currentOpening?.tier} · Opening #
                    {currentOpening?.opening_id}
                  </div>
                  <BundleList assets={displayedAssets} />
                  <p className="t-caption mt-2 text-label-2">
                    {currentOpening?.status === "Completed"
                      ? "Rewards were transferred directly to your wallet."
                      : "The contract retains unpaid rewards for recovery."}
                  </p>
                </div>
              </Section>
            )}
            {uncertain && (
              <div className="flex flex-col gap-2">
                <p className="t-footnote text-label-2">
                  Your previous purchase is awaiting verification. Check your
                  wallet before signing again.
                </p>
                <input
                  aria-label="Wallet transaction hash"
                  placeholder="Transaction hash from your wallet"
                  value={recoveryHash}
                  onChange={(event) =>
                    setRecoveryHash(event.target.value.trim())
                  }
                  className="t-footnote w-full rounded-[10px] bg-fill-3 px-3 py-2 text-label"
                />
                {uncertain.action === "open" && (
                  <>
                    <Button
                      variant="gray"
                      size="small"
                      onClick={retryOriginal}
                      disabled={busy}
                    >
                      Retry original purchase
                    </Button>
                    <p className="t-caption text-label-2">
                      The original nonce prevents a second purchase. A rejected
                      or expired retry refunds the deposit and may cost network
                      gas.
                    </p>
                  </>
                )}
              </div>
            )}
            {(error || wallet.error) && (
              <p
                role="alert"
                className="t-footnote rounded-[12px] bg-danger/15 px-4 py-3 text-danger"
              >
                {error || wallet.error}
              </p>
            )}
            {deploymentError && (
              <p role="status" className="t-footnote px-1 text-label-2">
                {deploymentError}
              </p>
            )}
            {verified && quote && !quote.can_open && !active && (
              <p role="status" className="t-footnote px-1 text-label-2">
                {quote.reason}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                variant="filled"
                size="large"
                className="w-full"
                onClick={primary.action}
                loading={busy}
                disabled={primary.disabled}
              >
                {pending ??
                  (animating ? "Opening verified reward" : primary.label)}
              </Button>
              <p className="t-footnote px-1 text-label-2">
                {account
                  ? "Your wallet confirms the price, storage and network gas. Rewards arrive automatically."
                  : "Connect your own NEAR Testnet wallet to open a case."}
              </p>
            </div>
          </aside>
        </div>
      </div>
      <Inventory
        open={inventoryOpen}
        onOpenChange={setInventoryOpen}
        items={personal.filter((row) => row.accountId === account)}
        error={personalError}
        busy={busy}
        onRecover={recover}
        onMore={
          Object.values(personalCursors).some((cursor) => cursor !== null)
            ? () => void moreHistory(true)
            : undefined
        }
      />
    </div>
  );
}
