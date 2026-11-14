import { z } from 'zod';
import { integer, object, stableJson } from '../player/validation';
import type { WalletFunctionCall } from '../shared/wallet';
import { decodeBase64 } from './chain';
export function finalReceipt(
  value: unknown,
  expected: {
    hash: string;
    signer: string;
    publicKey?: string;
    nonce?: string;
    call: WalletFunctionCall;
    allowHandledFailure?: boolean;
  },
) {
  const result = object.parse(value);
  if (result.final_execution_status !== 'FINAL')
    throw new Error('Transaction is not FINAL.');
  const tx = object.parse(result.transaction);
  if (
    tx.hash !== expected.hash ||
    tx.signer_id !== expected.signer ||
    tx.receiver_id !== expected.call.receiverId ||
    (expected.publicKey && tx.public_key !== expected.publicKey) ||
    (expected.nonce && integer(tx.nonce) !== expected.nonce)
  )
    throw new Error('Transaction identity mismatch.');
  const acts = z.array(object).length(1).parse(tx.actions);
  const call = object.parse(acts[0].FunctionCall);
  if (
    call.method_name !== expected.call.methodName ||
    integer(call.gas) !== expected.call.gas ||
    integer(call.deposit) !== expected.call.deposit ||
    typeof call.args !== 'string' ||
    stableJson(JSON.parse(decodeBase64(call.args).toString('utf8'))) !==
      stableJson(expected.call.args)
  )
    throw new Error('Transaction actions do not match the authorized intent.');
  const root = object.parse(result.transaction_outcome);
  if (root.id !== expected.hash) throw new Error('Root receipt mismatch.');
  const outcomes = z.array(object).parse(result.receipts_outcome);
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of outcomes) {
    if (typeof row.id !== 'string' || byId.has(row.id))
      throw new Error('Duplicate receipt.');
    byId.set(row.id, object.parse(row.outcome));
  }
  const rootOutcome = object.parse(root.outcome);
  const pending = z.array(z.string()).parse(rootOutcome.receipt_ids);
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    const row = byId.get(id);
    if (!row || seen.has(id)) throw new Error('Incomplete receipt graph.');
    seen.add(id);
    pending.push(...z.array(z.string()).parse(row.receipt_ids));
  }
  if (seen.size !== byId.size) throw new Error('Unrelated receipt graph.');
  let failed = false,
    fees = 0n;
  for (const row of [rootOutcome, ...byId.values()]) {
    fees += BigInt(integer(row.tokens_burnt));
    const status = object.parse(row.status);
    if ('Failure' in status) failed = true;
    else if ('SuccessReceiptId' in status) {
      if (
        typeof status.SuccessReceiptId !== 'string' ||
        !z
          .array(z.string())
          .parse(row.receipt_ids)
          .includes(status.SuccessReceiptId)
      )
        throw new Error('Invalid forwarded receipt.');
    } else if (!('SuccessValue' in status))
      throw new Error('Unresolved receipt.');
  }
  const status = object.parse(result.status);
  if (!('SuccessValue' in status) && !('Failure' in status))
    throw new Error('Unresolved final transaction.');
  let accepted = true;
  if (
    expected.call.methodName === 'ft_transfer_call' &&
    'SuccessValue' in status
  ) {
    const returned = z.string().parse(status.SuccessValue);
    const used = integer(JSON.parse(decodeBase64(returned).toString('utf8')));
    accepted = used === integer(expected.call.args.amount);
  }
  const success =
    'SuccessValue' in status &&
    accepted &&
    (!failed || expected.allowHandledFailure === true);
  return { success, feeYocto: fees.toString(), receipt: result };
}
