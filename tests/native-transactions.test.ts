import { expect, it } from 'vitest';
import { verifyNativeOpeningTransaction } from '../src/case/nativeTransactions';
import { nativeCaseCatalog } from '../src/case/nativeCatalog';
const definition = nativeCaseCatalog[0];
const hash = 'C6zv1CUGtKcXMBq8heYwMrev5Jr6rTLF4G4G3LDGBcHB';
const opening = { id: 'bamboo-mist:1', caseId: 'bamboo-mist', accountId: 'needmore_1_near.testnet', nonce: '1', openingId: '1', height: '277820015' };
function receipt() {
  return { final_execution_status: 'FINAL', transaction: { hash, signer_id: opening.accountId, receiver_id: definition.contractId,
    actions: [{ FunctionCall: { method_name: 'open', args: btoa('{"nonce":"1","quote":{"revision":"9","expires_at":"277820128"}}'), deposit: '90960000000000000000000' } }] },
    status: { SuccessValue: btoa('"1"') } };
}
it('links only a finalized successful transaction proving the signer, contract, nonce and returned opening', () => {
  expect(verifyNativeOpeningTransaction(receipt(), hash, opening, definition)).toBe(hash);
  expect(() => verifyNativeOpeningTransaction(receipt(), hash, { ...opening, nonce: '2' }, definition)).toThrow('does not prove');
  expect(() => verifyNativeOpeningTransaction(receipt(), hash, { ...opening, accountId: 'other.testnet' }, definition)).toThrow('does not prove');
  expect(() => verifyNativeOpeningTransaction(receipt(), hash, { ...opening, openingId: '2' }, definition)).toThrow('does not prove');
});
it('refuses unfinalized and failed indexer references', () => {
  expect(() => verifyNativeOpeningTransaction({ ...receipt(), final_execution_status: 'EXECUTED' }, hash, opening, definition)).toThrow();
  expect(() => verifyNativeOpeningTransaction({ ...receipt(), status: { Failure: 'failed' } }, hash, opening, definition)).toThrow();
});

it('follows indexer pagination to prove an older opening instead of limiting links to ten transactions', async () => {
  const { vi } = await import('vitest');
  const { nativeOpeningTransactions } = await import('../src/case/nativeTransactions');
  const { NativeCaseClient } = await import('../src/case/nativeClient');
  const urls: string[] = [];
  const reference = (signer: string) => ({ transaction_hash: hash, signer_account_id: signer,
    receiver_account_id: definition.contractId, actions: [{ action: 'FUNCTION_CALL', method: 'open' }],
    block: { block_height: '100', block_timestamp: '1794693195272190981' }, outcomes: { status: true } });
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    return Response.json(String(url).includes('next=page2')
      ? { data: [reference(opening.accountId)] }
      : { data: [reference('other.testnet')], meta: { next_page: 'page2' } });
  });
  try {
    const client = new NativeCaseClient(definition, async () => Response.json({ result: receipt() }));
    expect(await nativeOpeningTransactions(client, [opening], new AbortController().signal)).toEqual({ 'bamboo-mist:1': hash });
    expect(urls).toEqual([
      `https://api-testnet.nearblocks.io/v3/accounts/${definition.contractId}/txns?limit=10`,
      `https://api-testnet.nearblocks.io/v3/accounts/${definition.contractId}/txns?limit=10&next=page2`,
    ]);
  } finally { vi.unstubAllGlobals(); }
});
