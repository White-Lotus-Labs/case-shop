import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import {
  Account,
  actions,
  baseEncode,
  KeyPair,
  KeyPairSigner,
  PublicKey,
} from 'near-api-js';
import type { ChainPort } from '../../src/game-wallet/chain';
import type { ManagedSigner } from '../../src/game-wallet/kms';
import type { PolicyCatalog } from '../../src/game-wallet/policy';
import { dragonCase } from '../../src/case/catalog';
import type { WalletFunctionCall } from '../../src/wallet/nearConnector';

export const CACHED_SANDBOX =
  process.env.IROH_PLAYER_SANDBOX_BINARY ?? 'near-sandbox';
const WASM_ROOT =
  process.env.IROH_PLAYER_SANDBOX_WASM_DIR ??
  resolve('contracts/target/wasm32-unknown-unknown/release');
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed local Sandbox response.');
  return Object.fromEntries(Object.entries(value));
}
export class SandboxChainPort implements ChainPort {
  readonly network = 'sandbox';
  readonly url: string;
  constructor(
    url: string,
    readonly chainId: string,
  ) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/'
    )
      throw new Error('Sandbox RPC must be loopback HTTP.');
    this.url = parsed.toString();
  }
  async call(method: string, params: unknown): Promise<unknown> {
    if (
      ![
        'query',
        'status',
        'block',
        'gas_price',
        'EXPERIMENTAL_protocol_config',
        'tx',
        'EXPERIMENTAL_tx_status',
      ].includes(method)
    )
      throw new Error('Unsupported local Sandbox read.');
    return this.request(method, params);
  }
  private async request(method: string, params: unknown): Promise<unknown> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'local-sandbox',
        method,
        params,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const value = record(await response.json());
    if (!response.ok || value.error !== undefined) {
      const error = new Error('Local Sandbox RPC rejected request.');
      Object.defineProperty(error, 'rpcError', { value: value.error });
      throw error;
    }
    return value.result;
  }
  async assertNetwork(): Promise<void> {
    const result = record(await this.call('status', []));
    if (
      result.chain_id !== this.chainId ||
      !this.chainId.startsWith('iroh-player-local-')
    )
      throw new Error('Unexpected Sandbox chain.');
  }
  async view(
    contract: string,
    method: string,
    args: Record<string, unknown>,
    blockId?: string,
  ): Promise<unknown> {
    const result = record(
      await this.call('query', {
        request_type: 'call_function',
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        ...(blockId ? { block_id: blockId } : { finality: 'final' }),
      }),
    );
    if (
      !Array.isArray(result.result) ||
      !result.result.every(
        (v: unknown) =>
          typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255,
      )
    )
      throw new Error('Invalid Sandbox view bytes.');
    return JSON.parse(Buffer.from(result.result).toString());
  }
  async broadcast(signedBase64: string): Promise<unknown> {
    await this.assertNetwork();
    return this.request('broadcast_tx_async', [signedBase64]);
  }
}
export class EphemeralSandboxSigner implements ManagedSigner {
  private readonly keys = new Map<
    string,
    ReturnType<typeof KeyPair.fromRandom>
  >();
  async allocate(walletId: string) {
    const keyVersion = `sandbox:${walletId}`;
    const key = this.keys.get(keyVersion) ?? KeyPair.fromRandom('ed25519');
    this.keys.set(keyVersion, key);
    const publicKey = key.getPublicKey().toString();
    return {
      keyVersion,
      publicKey,
      accountId: Buffer.from(key.getPublicKey().data).toString('hex'),
    };
  }
  async signHash(
    keyVersion: string,
    expectedPublicKey: string,
    hash: Uint8Array,
  ) {
    const key = this.keys.get(keyVersion);
    if (
      !key ||
      key.getPublicKey().toString() !== expectedPublicKey ||
      hash.length !== 32
    )
      throw new Error('Unknown local test signing key.');
    return key.sign(hash).signature;
  }
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No local port.'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
export async function startPlayerSandbox(binary = CACHED_SANDBOX) {
  const directory = await mkdtemp(join(tmpdir(), 'iroh-player-local-'));
  const chainId = `iroh-player-local-${Date.now()}`;
  const init = spawnSync(
    binary,
    [
      '--home',
      directory,
      'init',
      '--fast',
      '--chain-id',
      chainId,
      '--account-id',
      'testnet',
    ],
    { stdio: 'ignore' },
  );
  if (init.status !== 0)
    throw new Error(
      'Local Sandbox initialization failed. Supply a working local binary.',
    );
  const config = record(
    JSON.parse(await readFile(join(directory, 'config.json'), 'utf8')),
  );
  const rpc = record(config.rpc),
    network = record(config.network);
  const rpcPort = await freePort(),
    peerPort = await freePort();
  rpc.addr = `127.0.0.1:${rpcPort}`;
  rpc.cors_allowed_origins = [];
  network.addr = `127.0.0.1:${peerPort}`;
  network.boot_nodes = '';
  network.max_num_peers = 0;
  network.minimum_outbound_peers = 0;
  network.ideal_connections_lo = 0;
  network.ideal_connections_hi = 0;
  network.trusted_stun_servers = [];
  const experimental = record(network.experimental);
  experimental.inbound_disabled = true;
  experimental.connect_only_to_boot_nodes = true;
  network.experimental = experimental;
  config.rpc = rpc;
  config.network = network;
  config.telemetry = { endpoints: [] };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config));
  const log = await open(join(directory, 'sandbox.log'), 'w');
  const child = spawn(binary, ['--home', directory, 'run'], {
    stdio: ['ignore', log.fd, log.fd],
    env: { NODE_ENV: 'test', PATH: process.env.PATH, RUST_LOG: 'error' },
  });
  const chain = new SandboxChainPort(`http://127.0.0.1:${rpcPort}`, chainId);
  async function stop() {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await log.close();
    await rm(directory, { recursive: true, force: true });
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null)
        throw new Error(
          `Local Sandbox exited. Inspect ${join(directory, 'sandbox.log')}.`,
        );
      try {
        await chain.assertNetwork();
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!ready) throw new Error('Local Sandbox did not become ready.');
    // Only this newly initialized local genesis key is read. No saved user wallet is accessed.
    const genesisKey = record(
      JSON.parse(await readFile(join(directory, 'validator_key.json'), 'utf8')),
    );
    if (
      genesisKey.account_id !== 'testnet' ||
      typeof genesisKey.secret_key !== 'string' ||
      !genesisKey.secret_key.startsWith('ed25519:')
    )
      throw new Error('Unexpected local genesis identity.');
    const key = KeyPair.fromString(`ed25519:${genesisKey.secret_key.slice(8)}`);
    const root = new Account('testnet', chain.url, new KeyPairSigner(key));
    async function createAccount(name: string) {
      const key = KeyPair.fromRandom('ed25519');
      await root.signAndSendTransaction({
        receiverId: name,
        actions: [
          actions.createAccount(),
          actions.transfer(20n * 10n ** 24n),
          actions.addFullAccessKey(key.getPublicKey()),
        ],
        waitUntil: 'FINAL',
        retries: 0,
      });
      return new Account(name, chain.url, new KeyPairSigner(key));
    }
    const owner = await createAccount('owner.testnet');
    const external = await createAccount('external.testnet');
    const recipient = await createAccount('recipient.testnet');
    const token = await createAccount('usdi-needmore-1-near.testnet');
    const game = await createAccount('cases-needmore-1-near.testnet');
    const mock = await createAccount('mock-player.testnet');
    const usdiWasm = await readFile(join(WASM_ROOT, 'iroh_usdi.wasm'));
    const caseWasm = await readFile(join(WASM_ROOT, 'iroh_case_pool.wasm'));
    const mockWasm = await readFile(join(WASM_ROOT, 'iroh_mock_token.wasm'));
    async function call(
      account: Account,
      receiverId: string,
      methodName: string,
      args: Record<string, unknown>,
      deposit = '0',
      gas = '250000000000000',
    ) {
      return account.signAndSendTransaction({
        receiverId,
        actions: [
          actions.functionCall(methodName, args, BigInt(gas), BigInt(deposit)),
        ],
        waitUntil: 'FINAL',
        retries: 0,
      });
    }
    await token.deployContract(usdiWasm);
    await game.deployContract(caseWasm);
    await mock.deployContract(mockWasm);
    await call(token, token.accountId, 'new', { owner_id: owner.accountId });
    await call(game, game.accountId, 'new', {
      owner_id: owner.accountId,
      token_id: token.accountId,
      treasury_id: owner.accountId,
    });
    await call(mock, mock.accountId, 'new', {
      asset: 'SHITZU',
      owner_id: owner.accountId,
    });
    const bounds = record(
      await chain.view(token.accountId, 'storage_balance_bounds', {}),
    );
    await call(
      owner,
      token.accountId,
      'storage_deposit',
      { account_id: game.accountId, registration_only: true },
      String(bounds.min),
    );
    await call(
      owner,
      token.accountId,
      'ft_transfer_call',
      {
        receiver_id: game.accountId,
        amount: '1000000000',
        msg: JSON.stringify({ action: 'fund' }),
      },
      '1',
    );
    const catalog: PolicyCatalog = {
      paymentToken: token.accountId,
      tokens: [
        {
          contractId: token.accountId,
          name: 'USD Iroh',
          symbol: 'USDI',
          decimals: 6,
          unofficial: true,
        },
        {
          contractId: mock.accountId,
          name: 'Test Shitzu',
          symbol: 'SHITZU',
          decimals: 6,
          unofficial: true,
        },
      ],
      cases: [
        {
          ...dragonCase,
          contractId: game.accountId,
          deploymentStatus: 'verified-live',
        },
      ],
      codeHashes: new Map([
        [
          token.accountId,
          baseEncode(createHash('sha256').update(usdiWasm).digest()),
        ],
        [
          game.accountId,
          baseEncode(createHash('sha256').update(caseWasm).digest()),
        ],
        [
          mock.accountId,
          baseEncode(createHash('sha256').update(mockWasm).digest()),
        ],
      ]),
    };
    const managedSigner = new EphemeralSandboxSigner();
    async function activate(accountId: string) {
      return root.signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.transfer(5n * 10n ** 24n)],
        waitUntil: 'FINAL',
        retries: 0,
      });
    }
    async function sendGameCall(
      allocation: Awaited<ReturnType<ManagedSigner['allocate']>>,
      call: WalletFunctionCall,
    ) {
      const { prepareNearTransaction, finalizeNearTransaction } = await import(
        '../../src/game-wallet/chain'
      );
      const access = record(
        await chain.call('query', {
          request_type: 'view_access_key',
          account_id: allocation.accountId,
          public_key: allocation.publicKey,
          finality: 'final',
        }),
      );
      const block = record(await chain.call('block', { finality: 'final' }));
      const header = record(block.header);
      const tx = prepareNearTransaction({
        signerId: allocation.accountId,
        publicKey: allocation.publicKey,
        nonce: (BigInt(String(access.nonce)) + 1n).toString(),
        blockHash: String(header.hash),
        call,
      });
      const signature = await managedSigner.signHash(
        allocation.keyVersion,
        allocation.publicKey,
        tx.hash,
      );
      const signed = finalizeNearTransaction(
        tx.unsignedBase64,
        signature,
        allocation.publicKey,
      );
      await chain.broadcast(signed.signedBase64);
      for (let i = 0; i < 100; i++) {
        try {
          const result = record(
            await chain.call('tx', {
              tx_hash: signed.txHash,
              sender_account_id: allocation.accountId,
              wait_until: 'FINAL',
            }),
          );
          if (result.final_execution_status === 'FINAL') return result;
        } catch {
          /* Query only; never resend or regenerate the transaction. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Local transaction finality unresolved.');
    }
    return {
      directory,
      chain,
      managedSigner,
      catalog,
      root,
      owner,
      external,
      recipient,
      token,
      game,
      mock,
      call,
      activate,
      sendGameCall,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
