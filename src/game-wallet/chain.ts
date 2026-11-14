import { createHash } from 'node:crypto';
import {
  actions,
  baseDecode,
  baseEncode,
  createTransaction,
  KeyType,
  PublicKey,
  Signature,
  SignedTransaction,
  Transaction,
} from 'near-api-js';
import type { WalletFunctionCall } from '../shared/wallet';
import { publicTestnetWritesEnabled, testnetRpcUrl } from './config';

export interface ChainPort {
  network: 'testnet' | 'sandbox';
  call(method: string, params: unknown): Promise<unknown>;
  view(
    contract: string,
    method: string,
    args: Record<string, unknown>,
    blockId?: string,
  ): Promise<unknown>;
  broadcast(signedBase64: string): Promise<unknown>;
  assertNetwork(): Promise<void>;
}

const READ_METHODS = new Set([
  'query',
  'status',
  'block',
  'tx',
  'EXPERIMENTAL_tx_status',
  'EXPERIMENTAL_protocol_config',
  'gas_price',
  'EXPERIMENTAL_receipt',
]);
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed NEAR RPC response.');
  return Object.fromEntries(Object.entries(value));
}
function account(value: string): string {
  if (
    value.length < 2 ||
    value.length > 64 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)
  )
    throw new Error('Invalid NEAR account ID.');
  return value;
}
function atomic(value: string, bits: number): bigint {
  if (
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 39 ||
    BigInt(value) >= 2n ** BigInt(bits)
  )
    throw new Error('Invalid NEAR integer.');
  return BigInt(value);
}
export function decodeBase64(value: string): Buffer {
  if (
    !value ||
    value.length > 200000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error('Invalid transaction encoding.');
  return Buffer.from(value, 'base64');
}
export class TestnetRpc implements ChainPort {
  readonly network = 'testnet';
  private readonly url: string;
  constructor(
    url = testnetRpcUrl(),
    private readonly request: typeof fetch = fetch,
  ) {
    this.url = testnetRpcUrl(url);
  }
  private async send(method: string, params: unknown): Promise<unknown> {
    const response = await this.request(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'iroh-player',
        method,
        params,
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error('NEAR RPC response exceeds limit.');
    const payload = object(JSON.parse(text));
    if (payload.error !== undefined) {
      const error = new Error('NEAR RPC rejected the request.');
      // Preserve structured public RPC evidence so workers can classify unknown accounts/nonces.
      Object.defineProperty(error, 'rpcError', {
        value: payload.error,
        enumerable: false,
      });
      throw error;
    }
    if (!('result' in payload)) throw new Error('NEAR RPC omitted its result.');
    return payload.result;
  }
  async call(method: string, params: unknown): Promise<unknown> {
    if (!READ_METHODS.has(method))
      throw new Error('Only read-only NEAR RPC methods are allowed.');
    try {
      return await this.send(method, params);
    } catch (error) {
      if (error instanceof Error && 'rpcError' in error) throw error;
      return this.send(method, params);
    }
  }
  async assertNetwork(): Promise<void> {
    const status = object(await this.call('status', []));
    if (status.chain_id !== 'testnet')
      throw new Error('RPC did not identify NEAR Testnet.');
  }
  async view(
    contract: string,
    method: string,
    args: Record<string, unknown>,
    blockId?: string,
  ): Promise<unknown> {
    const response = object(
      await this.call('query', {
        request_type: 'call_function',
        account_id: account(contract),
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        ...(blockId ? { block_id: blockId } : { finality: 'final' }),
      }),
    );
    const bytes = response.result;
    if (
      !Array.isArray(bytes) ||
      !bytes.every(
        (n: unknown) =>
          typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255,
      )
    )
      throw new Error('Malformed NEAR view result.');
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  }
  async broadcast(signedBase64: string): Promise<unknown> {
    if (!publicTestnetWritesEnabled())
      throw new Error('Public Testnet writes are disabled.');
    decodeBase64(signedBase64);
    await this.assertNetwork();
    return this.send('broadcast_tx_async', [signedBase64]);
  }
}

export function prepareNearTransaction(input: {
  signerId: string;
  publicKey: string;
  nonce: string;
  blockHash: string;
  call: WalletFunctionCall;
}): { unsignedBase64: string; hash: Uint8Array; txHash: string } {
  const key = PublicKey.fromString(input.publicKey);
  if (key.keyType !== KeyType.ED25519)
    throw new Error('Player keys must be Ed25519.');
  const blockHash = baseDecode(input.blockHash);
  if (blockHash.length !== 32) throw new Error('Invalid NEAR block hash.');
  if (!/^[a-z][a-z0-9_]*$/.test(input.call.methodName))
    throw new Error('Invalid contract method.');
  const transaction = createTransaction(
    account(input.signerId),
    key,
    account(input.call.receiverId),
    atomic(input.nonce, 64),
    [
      actions.functionCall(
        input.call.methodName,
        input.call.args,
        atomic(input.call.gas, 64),
        atomic(input.call.deposit, 128),
      ),
    ],
    blockHash,
  );
  const bytes = transaction.encode();
  const hash = createHash('sha256').update(bytes).digest();
  return {
    unsignedBase64: Buffer.from(bytes).toString('base64'),
    hash,
    txHash: baseEncode(hash),
  };
}

export function finalizeNearTransaction(
  unsignedBase64: string,
  signature: Uint8Array,
  expectedPublicKey: string,
): { signedBase64: string; txHash: string } {
  const bytes = decodeBase64(unsignedBase64);
  const transaction = Transaction.decode(bytes);
  if (!Buffer.from(transaction.encode()).equals(bytes))
    throw new Error('Noncanonical NEAR transaction.');
  const key = PublicKey.fromString(expectedPublicKey);
  if (
    key.keyType !== KeyType.ED25519 ||
    transaction.publicKey.toString() !== key.toString()
  )
    throw new Error('Transaction public key mismatch.');
  const hash = createHash('sha256').update(bytes).digest();
  if (signature.length !== 64 || !key.verify(hash, signature))
    throw new Error('Invalid NEAR transaction signature.');
  const signed = new SignedTransaction({
    transaction,
    signature: new Signature({ keyType: KeyType.ED25519, data: signature }),
  });
  return {
    signedBase64: Buffer.from(signed.encode()).toString('base64'),
    txHash: baseEncode(hash),
  };
}
