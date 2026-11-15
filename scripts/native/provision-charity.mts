import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { nativeInteger } from '../../src/case/nativeCatalog.ts';
import registry from '../../config/cases.native.testnet.json';

const destination = 'docs/charity/treasury.json';
const accountId = `fujitora-paws.${registry.ownerId}`;
const initialBalance = 10n ** 23n;
const limit = 15n * 10n ** 24n;
const gasReserve = 5n * 10n ** 23n;
const live = z.object({ accountId: z.string(), transactions: z.array(z.object({
  status: z.literal('verified'), hash: z.string(), deposit: nativeInteger, gasSpent: nativeInteger,
})) }).parse(JSON.parse(await readFile('docs/native/evidence/final-polish-live.json', 'utf8')));
const gameSpent = live.transactions.reduce((sum, row) => sum + BigInt(row.deposit) + BigInt(row.gasSpent), 0n);
if (live.accountId !== registry.ownerId || gameSpent + initialBalance + gasReserve > limit) throw new Error('Charity funding exceeds the shared Testnet authorization.');
try {
  await readFile(destination);
  throw new Error('Provisioning already has a record. Verify that account and receipt before any repeat attempt.');
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
async function rpc(method: string, params: object) {
  const response = await fetch(registry.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'charity-provision', method, params }), signal: AbortSignal.timeout(15000) });
  return z.record(z.string(), z.unknown()).parse(await response.json());
}
const prior = await rpc('tx', { tx_hash: live.transactions[0].hash, sender_account_id: live.accountId, wait_until: 'FINAL' });
const publicKey = z.object({ transaction: z.object({ public_key: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/) }) }).parse(prior.result).transaction.public_key;
const access = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: live.accountId, public_key: publicKey });
z.object({ permission: z.literal('FullAccess') }).parse(access.result);
const absent = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
z.object({ cause: z.object({ name: z.literal('UNKNOWN_ACCOUNT') }) }).parse(absent.error);
const record = { network: 'testnet', accountId, controllingPublicKey: publicKey, authorization: 'Existing user-controlled owner key, already retained in the OS keychain. No new private key generated or exported.',
  fundingYocto: initialBalance.toString(), gasSpentYocto: null as string | null, transactionHash: null as string | null,
  status: 'prepared', accountVerified: false, recovery: `Retain the existing full-access signing and recovery mechanism for ${live.accountId}. The same public key controls this separate account. The parent account alone cannot recover a subaccount if that key is lost.`,
  charityRoutingActive: false };
const persist = () => writeFile(destination, JSON.stringify(record, null, 2) + '\n');
await persist();
try {
  const signed = await promisify(execFile)('near', ['account', 'create-account', 'fund-myself', accountId, '0.1 NEAR',
    'use-manually-provided-public-key', publicKey, 'sign-as', live.accountId, 'network-config', 'testnet', 'sign-with-keychain', 'send'], { timeout: 180000, maxBuffer: 2000000 });
  const output = signed.stdout + signed.stderr;
  const hash = output.match(/Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i)?.[1]
    ?? output.match(/(?:txns|transactions)\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];
  if (!hash) throw new Error('Missing creation receipt');
  record.transactionHash = hash;
  await persist();
  const chainAccount = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
  const account = z.object({ amount: nativeInteger }).parse(chainAccount.result);
  if (BigInt(account.amount) < initialBalance) throw new Error('Treasury funding not verified');
  const chainAccess = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey });
  z.object({ permission: z.literal('FullAccess') }).parse(chainAccess.result);
  const transaction = await rpc('tx', { tx_hash: hash, sender_account_id: live.accountId, wait_until: 'FINAL' });
  const receipt = z.object({ final_execution_status: z.literal('FINAL'), status: z.object({ SuccessValue: z.string() }),
    transaction_outcome: z.object({ outcome: z.object({ tokens_burnt: nativeInteger }) }),
    receipts_outcome: z.array(z.object({ outcome: z.object({ tokens_burnt: nativeInteger }) })) }).parse(transaction.result);
  record.gasSpentYocto = [receipt.transaction_outcome, ...receipt.receipts_outcome].reduce((sum, row) => sum + BigInt(row.outcome.tokens_burnt), 0n).toString();
  record.status = 'verified'; record.accountVerified = true;
  await persist();
  console.log(JSON.stringify({ accountId, hash, fundingYocto: record.fundingYocto, gasSpentYocto: record.gasSpentYocto,
    combinedSpendYocto: (gameSpent + initialBalance + BigInt(record.gasSpentYocto)).toString(), routingActive: false }, null, 2));
} catch {
  record.status = 'uncertain'; await persist();
  throw new Error('Charity account provisioning could not be fully verified. Do not repeat or fund again before reconciling its receipt.');
}
