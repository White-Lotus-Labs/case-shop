import { z } from 'zod';
import { NativeCaseClient, walletAccountId } from './nativeClient';
import { nativeAccountId, nativeInteger, nativeU64, type NativeCaseDefinition } from './nativeCatalog';
import { parseIndexedPage } from './indexer';

export type OpeningReference = {
  id: string; caseId: string; accountId: string; openingId: string; nonce: string; height: string;
};
const hashSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const outcomeSchema = z.object({
  final_execution_status: z.literal('FINAL'),
  transaction: z.object({ hash: hashSchema, signer_id: walletAccountId, receiver_id: nativeAccountId,
    actions: z.tuple([z.object({ FunctionCall: z.object({ method_name: z.literal('open'), args: z.string().max(8192), deposit: nativeInteger }) })]),
  }),
  status: z.object({ SuccessValue: z.string().max(128) }),
});

/** An indexer hash becomes a link only after final RPC proves this exact opening. */
export function verifyNativeOpeningTransaction(raw: unknown, expectedHash: string, opening: OpeningReference, definition: NativeCaseDefinition) {
  const receipt = outcomeSchema.parse(raw);
  const tx = receipt.transaction;
  const call = tx.actions[0].FunctionCall;
  const args = z.object({ nonce: nativeU64, quote: z.object({ revision: nativeU64, expires_at: nativeU64 }) }).parse(JSON.parse(atob(call.args)));
  const result = nativeU64.parse(JSON.parse(atob(receipt.status.SuccessValue)));
  if (tx.hash !== hashSchema.parse(expectedHash) || opening.caseId !== definition.id ||
    tx.receiver_id !== definition.contractId || tx.signer_id !== opening.accountId ||
    args.nonce !== opening.nonce || result !== opening.openingId || BigInt(call.deposit) < BigInt(definition.price))
    throw new Error('Transaction does not prove this opening.');
  return tx.hash;
}

type Page = ReturnType<typeof parseIndexedPage>;
let indexerQueue: Promise<unknown> = Promise.resolve();
const pages = new Map<string, { until: number; promise: Promise<Page> }>();
const verified = new Map<string, string>();
const receipts = new Map<string, Promise<unknown>>();

function indexerPage(contract: string, cursor: string | null): Promise<Page> {
  const key = `${contract}:${cursor ?? 'latest'}`;
  const cached = pages.get(key);
  if (cached && cached.until > Date.now()) return cached.promise;
  const url = new URL(`https://api-testnet.nearblocks.io/v3/accounts/${contract}/txns`);
  url.searchParams.set('limit', '10');
  if (cursor) url.searchParams.set('next', cursor);
  const promise = indexerQueue.then(() => fetch(url.href, { signal: AbortSignal.timeout(8000) }))
    .then(async response => {
      if (!response.ok) throw new Error('Transaction references unavailable.');
      return parseIndexedPage(await response.json(), contract);
    });
  const entry = { until: cursor ? Infinity : Date.now() + 60_000, promise };
  void promise.catch(() => { entry.until = Date.now() + 30_000; });
  pages.set(key, entry);
  indexerQueue = promise.catch(() => undefined);
  return promise;
}

export async function nativeOpeningTransactions(client: NativeCaseClient, openings: OpeningReference[], signal: AbortSignal): Promise<Record<string, string>> {
  if (new URL(client.definition.rpcUrl).protocol !== 'https:' || !openings.length) return {};
  const contract = client.definition.contractId;
  const result: Record<string, string> = {};
  const keyOf = (opening: OpeningReference) => `${contract}:${opening.accountId}:${opening.nonce}`;
  for (const opening of openings) {
    const known = verified.get(keyOf(opening));
    if (known) result[opening.id] = known;
  }
  let cursor: string | null = null;
  const visited = new Set<string>();
  try {
    do {
      if (signal.aborted || openings.every(opening => result[opening.id])) break;
      const cursorKey = cursor ?? 'latest';
      if (visited.has(cursorKey)) throw new Error('Repeating transaction cursor.');
      visited.add(cursorKey);
      const page = await indexerPage(contract, cursor);
      for (const opening of openings) {
        if (signal.aborted) break;
        if (result[opening.id]) continue;
        const candidates = page.transactions.filter(tx => tx.signerId === opening.accountId && tx.receiverId === contract &&
          tx.actions.length === 1 && tx.actions[0] === 'open' && tx.indexerStatus === 'success');
        for (const candidate of candidates) {
          if (signal.aborted) break;
          try {
            let receipt = receipts.get(candidate.hash);
            if (!receipt) {
              receipt = client.rawTransaction(candidate.hash, opening.accountId);
              receipts.set(candidate.hash, receipt);
            }
            const raw = await receipt.catch(error => { receipts.delete(candidate.hash); throw error; });
            const hash = verifyNativeOpeningTransaction(raw, candidate.hash, opening, client.definition);
            verified.set(keyOf(opening), hash); result[opening.id] = hash; break;
          } catch { /* Unverified references never become transaction links. */ }
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  } catch { /* Finalized history remains usable during indexer outages. */ }
  if (verified.size > 500) verified.clear();
  if (receipts.size > 500) receipts.clear();
  if (pages.size > 500) pages.delete(pages.keys().next().value ?? '');
  return result;
}
