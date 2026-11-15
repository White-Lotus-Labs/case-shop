import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { nativeCaseCatalog, nativeInteger } from '../../src/case/nativeCatalog.ts';
import { NativeCaseClient, walletAccountId } from '../../src/case/nativeClient.ts';
import registry from '../../config/cases.native.testnet.json';
import type { WalletFunctionCall } from '../../src/shared/wallet.ts';

// This driver never reads key material. near-cli asks its existing OS keychain signer.
const execute = promisify(execFile);
const output = 'docs/native/evidence/final-polish-live.json';
const limit = 15n * 10n ** 24n;
const gasReservation = 5n * 10n ** 23n;
const transaction = z.object({
  caseId: z.string(), method: z.string(), receiver: z.string(), deposit: nativeInteger,
  gasReserved: nativeInteger, status: z.enum(['prepared', 'uncertain', 'verified']),
  hash: z.string().nullable(), gasSpent: nativeInteger.nullable(),
  beforeBlock: z.string(), args: z.record(z.string(), z.unknown()), gas: z.string(),
});
const ledgerSchema = z.object({
  network: z.literal('testnet'), accountId: walletAccountId,
  budgetYocto: z.literal(limit.toString()),
  transactions: z.array(transaction),
  openings: z.array(z.object({ caseId: z.string(), nonce: z.string(), openingId: z.string(), status: z.string(), reward: z.string().nullable(), tier: z.string().nullable() })),
});
let ledger: z.infer<typeof ledgerSchema>;
try {
  ledger = ledgerSchema.parse(JSON.parse(await readFile(output, 'utf8')));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  ledger = { network: 'testnet', accountId: walletAccountId.parse(registry.ownerId), budgetYocto: limit.toString(), transactions: [], openings: [] };
}
const persist = () => writeFile(output, JSON.stringify(ledger, null, 2) + '\n');
if (ledger.transactions.some(row => row.status !== 'verified'))
  throw new Error('An earlier signing attempt is unresolved. Reconcile its receipt before any new transaction.');
let charitySpent = 0n;
try {
  const treasury = z.object({ status: z.literal('verified'), fundingYocto: nativeInteger, gasSpentYocto: nativeInteger }).parse(JSON.parse(await readFile('docs/charity/treasury.json', 'utf8')));
  charitySpent = BigInt(treasury.fundingYocto) + BigInt(treasury.gasSpentYocto);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
try {
  const browser = z.object({ status: z.literal('verified'), call: z.object({ deposit: nativeInteger }), gasSpent: nativeInteger }).parse(JSON.parse(await readFile('docs/native/evidence/browser-live.json', 'utf8')));
  charitySpent += BigInt(browser.call.deposit) + BigInt(browser.gasSpent);
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
const spentOrReserved = () => charitySpent + ledger.transactions.reduce((sum, row) => sum + BigInt(row.deposit) + BigInt(row.gasSpent ?? row.gasReserved), 0n);
const account = ledger.accountId;

async function send(client: NativeCaseClient, call: WalletFunctionCall) {
  if (!['open', 'storage_deposit', 'advance_opening', 'retry_payout'].includes(call.methodName) ||
    ![client.definition.contractId, ...client.definition.bonusRewards.map(row => row.token_contract_id)].includes(call.receiverId))
    throw new Error('Live testing allows only configured Testnet gameplay calls.');
  if (spentOrReserved() + BigInt(call.deposit) + gasReservation > limit) throw new Error('15 test NEAR budget would be exceeded.');
  const beforeBlock = await client.finalBlockHeight();
  const intent: z.infer<typeof transaction> = { caseId: client.definition.id, method: call.methodName, receiver: call.receiverId,
    deposit: call.deposit, gasReserved: gasReservation.toString(), status: 'prepared', hash: null, gasSpent: null,
    beforeBlock, args: z.record(z.string(), z.unknown()).parse(call.args), gas: call.gas };
  ledger.transactions.push(intent);
  await persist();
  try {
    const result = await execute('near', ['contract', 'call-function', 'as-transaction', call.receiverId, call.methodName,
      'json-args', JSON.stringify(call.args), 'prepaid-gas', `${BigInt(call.gas) / 10n ** 12n} Tgas`,
      'attached-deposit', `${call.deposit} yoctoNEAR`, 'sign-as', account, 'network-config', 'testnet', 'sign-with-keychain', 'send'],
      { timeout: 180_000, maxBuffer: 2_000_000 });
    const publicOutput = result.stdout + result.stderr;
    const hash = publicOutput.match(/Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i)?.[1]
      ?? publicOutput.match(/(?:txns|transactions)\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];
    if (!hash) throw new Error('Signer returned no recognizable transaction hash.');
    intent.hash = hash;
    await persist();
    const receipt = await client.transaction(hash, account, undefined, { ...call, afterBlockHeight: beforeBlock });
    // Receipt verification is authoritative. Unknown submission outcomes never unlock another call.
    if (!receipt.success) throw new Error('Gameplay transaction failed; reconcile deposit refund before continuing.');
    const response = await fetch(client.definition.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'live-fees', method: 'tx', params: { tx_hash: hash, sender_account_id: account, wait_until: 'FINAL' } }) });
    const outcome = z.object({ result: z.object({ transaction_outcome: z.object({ outcome: z.object({ tokens_burnt: nativeInteger }) }),
      receipts_outcome: z.array(z.object({ outcome: z.object({ tokens_burnt: nativeInteger }) })) }) }).parse(await response.json()).result;
    intent.gasSpent = [outcome.transaction_outcome, ...outcome.receipts_outcome].reduce((sum, row) => sum + BigInt(row.outcome.tokens_burnt), 0n).toString();
    intent.status = 'verified';
    await persist();
    console.log(JSON.stringify({ case: client.definition.id, method: call.methodName, hash, deposit: intent.deposit, gas: intent.gasSpent, totalSpentYocto: spentOrReserved().toString() }));
  } catch {
    intent.status = 'uncertain';
    await persist();
    throw new Error('Keychain signing or receipt verification did not complete. The attempt is locked in the ledger. No automatic resubmission.');
  }
}

if (process.argv.includes('--preflight')) {
  const checks = [];
  for (const definition of nativeCaseCatalog) {
    const client = new NativeCaseClient(definition);
    await client.caseInfo();
    const quote = await client.quote(account);
    checks.push({ caseId: definition.id, contract: definition.contractId, canOpen: quote.can_open,
      requiredDeposit: quote.required_deposit, registrationCount: (await client.registrationCalls(account)).length });
  }
  console.log(JSON.stringify({ network: 'testnet', account, budgetYocto: limit.toString(), checks }, null, 2));
  process.exit(0);
}

for (const definition of nativeCaseCatalog) {
  if (ledger.openings.some(row => row.caseId === definition.id && row.status === 'Completed')) continue;
  const client = new NativeCaseClient(definition);
  await client.caseInfo();
  if (await client.active(account)) throw new Error(`Existing active ${definition.id} opening must be reconciled first.`);
  const previousOpen = ledger.transactions.find(row => row.caseId === definition.id && row.method === 'open');
  let nonce: string;
  if (previousOpen) {
    nonce = z.string().parse(previousOpen.args.nonce);
  } else {
    for (const registration of await client.registrationCalls(account)) await send(client, registration);
    const quote = await client.quote(account);
    if (!quote.can_open) throw new Error(`${definition.id}: ${quote.reason}`);
    const balance = await client.nearBalance(account);
    if (BigInt(balance.available) < BigInt(quote.required_deposit) + gasReservation) throw new Error('Insufficient liquid Testnet balance.');
    nonce = quote.nonce;
    await send(client, client.openCall(quote));
  }
  let opening = await client.findOpeningByNonce(account, nonce);
  for (let attempt = 0; attempt < 30 && opening?.status !== 'Completed'; attempt++) {
    if (opening && ['RandomnessPending', 'Claimable'].includes(opening.status)) await send(client, client.recoverCall(opening));
    await new Promise(resolve => setTimeout(resolve, 1500));
    opening = await client.findOpeningByNonce(account, nonce);
  }
  if (!opening || opening.status !== 'Completed' || !opening.nearPaid || !opening.bonusPaid) throw new Error('Opening has not completed both payouts.');
  ledger.openings.push({ caseId: definition.id, nonce: opening.nonce, openingId: opening.opening_id, status: opening.status, reward: opening.reward, tier: opening.tier });
  await persist();
}
console.log(JSON.stringify({ network: 'testnet', testedCases: ledger.openings.length, totalSpentYocto: spentOrReserved().toString(), budgetYocto: limit.toString() }));
