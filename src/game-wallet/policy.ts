import { z } from 'zod';
import { baseEncode } from 'near-api-js';
import contracts from '../../config/contracts.testnet.json' with { type: 'json' };
import batch from '../../docs/multi-case/deployment-batch.json' with { type: 'json' };
import { caseCatalog, type CaseDefinition } from '../case/catalog';
import { supportedTokens } from '../player/tokens';
import {
  decimalAtomic,
  digest,
  integer,
  object,
  stableJson,
  testnetAddress,
  unknownAccount,
} from '../player/validation';
import type { OperationRequest, SupportedToken } from '../player/types';
import type { WalletFunctionCall } from '../shared/wallet';
import { PlayerWalletError } from '../player/errors';
import type { ChainPort } from './chain';

export type PolicyCatalog = {
  tokens: SupportedToken[];
  cases: CaseDefinition[];
  paymentToken: string;
  codeHashes: Map<string, string>;
};
export const defaultCatalog: PolicyCatalog = {
  tokens: supportedTokens,
  cases: caseCatalog,
  paymentToken: contracts.tokenContractId,
  codeHashes: new Map([
    ...Object.entries(batch.expectedExistingCode),
    ...supportedTokens
      .filter((t) => !Object.hasOwn(batch.expectedExistingCode, t.contractId))
      .map((t): [string, string] => [
        t.contractId,
        baseEncode(Buffer.from(batch.artifacts.mock.sha256, 'hex')),
      ]),
    ...caseCatalog.map((c): [string, string] => [
      c.contractId,
      baseEncode(Buffer.from(batch.artifacts.case.sha256, 'hex')),
    ]),
  ]),
};
export type PolicyPreview = {
  kind: string;
  accountId: string;
  tokenId: string | null;
  symbol: string | null;
  amountAtomic: string | null;
  amountDisplay: string | null;
  recipient: string | null;
  steps: WalletFunctionCall[];
  nativeCostCapYocto: string;
};
const G30 = '30000000000000',
  G50 = '50000000000000',
  G150 = '150000000000000',
  G250 = '250000000000000';
const MAX_NATIVE = 1000000000000000000000000n;
function deny(code: string, message: string, status = 400): never {
  throw new PlayerWalletError(status, code, message);
}
function address(value: string, chain: ChainPort): string {
  if (
    chain.network === 'sandbox' &&
    value.length >= 2 &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)
  )
    return value;
  return testnetAddress(value);
}
export async function finalBlock(chain: ChainPort) {
  const value = z
    .object({
      header: z.object({
        hash: z.string(),
        height: z.union([z.number().int().safe(), z.string()]),
      }),
    })
    .parse(await chain.call('block', { finality: 'final' }));
  return { hash: value.header.hash, height: integer(value.header.height) };
}
export async function accountState(
  chain: ChainPort,
  id: string,
  blockId?: string,
): Promise<Record<string, unknown> | null> {
  try {
    const value = object.parse(
      await chain.call('query', {
        request_type: 'view_account',
        account_id: id,
        ...(blockId ? { block_id: blockId } : { finality: 'final' }),
      }),
    );
    return value.absent === true ? null : value;
  } catch (error) {
    if (unknownAccount(error)) return null;
    throw error;
  }
}
async function pinned(chain: ChainPort, id: string, catalog: PolicyCatalog) {
  const account = await accountState(chain, id);
  const expected = catalog.codeHashes.get(id);
  if (!expected || !account || account.code_hash !== expected)
    deny(
      'contract_changed',
      'Contract code does not match the reviewed Testnet deployment.',
      409,
    );
}
function exact(observed: WalletFunctionCall, expected: WalletFunctionCall) {
  if (stableJson(observed) !== stableJson(expected))
    deny(
      'call_not_allowed',
      'This call does not match an allowed game action.',
    );
}
function call(
  receiverId: string,
  methodName: string,
  args: Record<string, unknown>,
  gas: string,
  deposit: string,
): WalletFunctionCall {
  return { receiverId, methodName, args, gas, deposit };
}
function display(amount: string, decimals: number) {
  const n = BigInt(amount),
    base = 10n ** BigInt(decimals);
  const part = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${n / base}${part ? '.' + part : ''}`;
}
async function tokenInfo(chain: ChainPort, id: string, catalog: PolicyCatalog) {
  const token = catalog.tokens.find((t) => t.contractId === id);
  if (!token)
    deny(
      'unsupported_token',
      'Only supported Iroh Testnet tokens are allowed.',
    );
  await pinned(chain, id, catalog);
  const metadata = z
    .object({ decimals: z.number().int(), symbol: z.string() })
    .parse(await chain.view(id, 'ft_metadata', {}));
  if (metadata.decimals !== token.decimals || metadata.symbol !== token.symbol)
    deny(
      'token_changed',
      'Token metadata changed; no transfer was prepared.',
      409,
    );
  return token;
}
async function storageStep(
  chain: ChainPort,
  tokenId: string,
  recipient: string,
) {
  const registered = await chain.view(tokenId, 'storage_balance_of', {
    account_id: recipient,
  });
  if (registered !== null) return null;
  const bounds = z
    .object({ min: z.string() })
    .parse(await chain.view(tokenId, 'storage_balance_bounds', {}));
  const min = integer(bounds.min);
  return call(
    tokenId,
    'storage_deposit',
    { account_id: recipient, registration_only: true },
    G30,
    min,
  );
}
export async function previewPolicy(
  chain: ChainPort,
  request: OperationRequest,
  gameAccount: string,
  catalog: PolicyCatalog = defaultCatalog,
): Promise<PolicyPreview> {
  await chain.assertNetwork();
  address(gameAccount, chain);
  if (!(await accountState(chain, gameAccount)))
    deny(
      'wallet_unfunded',
      'The game wallet needs native Testnet NEAR activation and gas.',
      409,
    );
  let kind: string = request.kind,
    accountId = gameAccount,
    tokenId: string | null = null,
    symbol: string | null = null,
    amountAtomic: string | null = null,
    amountDisplay: string | null = null,
    recipient: string | null = null;
  const steps: WalletFunctionCall[] = [];
  if (request.kind === 'deposit' || request.kind === 'withdraw') {
    const token = await tokenInfo(chain, request.tokenId, catalog);
    tokenId = token.contractId;
    symbol = token.symbol;
    amountAtomic = decimalAtomic(request.amount, token.decimals);
    amountDisplay = display(amountAtomic, token.decimals);
    const max =
      BigInt(token.symbol === 'USDI' ? 1000 : 10000) *
      10n ** BigInt(token.decimals);
    if (BigInt(amountAtomic) > max)
      deny(
        'transfer_limit',
        'This transfer exceeds the prototype per-operation limit.',
      );
    if (request.kind === 'deposit') {
      accountId = address(request.sourceAccountId, chain);
      recipient = gameAccount;
      if (accountId === gameAccount)
        deny('same_wallet', 'Choose a separate external deposit source.');
    } else recipient = address(request.recipient, chain);
    if (
      !(await accountState(chain, accountId)) ||
      !(await accountState(chain, recipient))
    )
      deny(
        'unknown_account',
        'Both transfer accounts must exist on Testnet.',
        409,
      );
    if (
      BigInt(
        integer(
          await chain.view(tokenId, 'ft_balance_of', { account_id: accountId }),
        ),
      ) < BigInt(amountAtomic)
    )
      deny('insufficient_tokens', 'Insufficient confirmed token balance.', 409);
    const storage = await storageStep(chain, tokenId, recipient);
    if (storage) steps.push(storage);
    steps.push(
      call(
        tokenId,
        'ft_transfer',
        { receiver_id: recipient, amount: amountAtomic },
        G50,
        '1',
      ),
    );
  } else {
    const c = request.call;
    const definition = catalog.cases.find((x) => x.contractId === c.receiverId);
    const token = catalog.tokens.find((x) => x.contractId === c.receiverId);
    if (
      c.receiverId === catalog.paymentToken &&
      c.methodName === 'claim_starter'
    ) {
      await tokenInfo(chain, catalog.paymentToken, catalog);
      if (
        (await chain.view(catalog.paymentToken, 'has_claimed', {
          account_id: gameAccount,
        })) !== false
      )
        deny('already_claimed', 'Starter USDI has already been claimed.', 409);
      const cost = integer(
        await chain.view(catalog.paymentToken, 'claim_storage_cost', {
          account_id: gameAccount,
        }),
      );
      exact(c, call(catalog.paymentToken, 'claim_starter', {}, G50, cost));
      kind = 'claim';
      tokenId = catalog.paymentToken;
      symbol = 'USDI';
      amountAtomic = '1000000000';
      amountDisplay = '1000';
      recipient = gameAccount;
    } else if (token && c.methodName === 'storage_deposit') {
      await tokenInfo(chain, token.contractId, catalog);
      const bounds = z
        .object({ min: z.string() })
        .parse(
          await chain.view(token.contractId, 'storage_balance_bounds', {}),
        );
      exact(
        c,
        call(
          token.contractId,
          'storage_deposit',
          { registration_only: true },
          G30,
          integer(bounds.min),
        ),
      );
      kind = 'token-storage';
      recipient = gameAccount;
    } else if (definition && c.methodName === 'storage_deposit') {
      await pinned(chain, definition.contractId, catalog);
      const pool = object.parse(
        await chain.view(definition.contractId, 'get_pool', {}),
      );
      const cost = (
        BigInt(integer(pool.storage_per_opening)) +
        BigInt(integer(pool.storage_account_cost))
      ).toString();
      exact(c, call(c.receiverId, 'storage_deposit', {}, G30, cost));
      kind = 'case-storage';
      recipient = definition.contractId;
    } else if (
      c.receiverId === catalog.paymentToken &&
      c.methodName === 'ft_transfer_call'
    ) {
      const args = z
        .object({
          receiver_id: z.string(),
          amount: z.string(),
          msg: z.string().max(4096),
        })
        .strict()
        .parse(c.args);
      const game = catalog.cases.find(
        (x) =>
          x.contractId === args.receiver_id &&
          x.deploymentStatus === 'verified-live',
      );
      if (!game) deny('game_unavailable', 'That game is not available.');
      await pinned(chain, game.contractId, catalog);
      await tokenInfo(chain, catalog.paymentToken, catalog);
      const msg = z
        .object({
          action: z.literal('open'),
          case_id: z.literal(game.id),
          nonce: z.string(),
          quote: z
            .object({ revision: z.string(), expires_at: z.string() })
            .strict(),
        })
        .strict()
        .parse(JSON.parse(args.msg));
      const quote = object.parse(
        await chain.view(game.contractId, 'get_quote', {
          account_id: gameAccount,
        }),
      );
      const block = await finalBlock(chain);
      if (
        quote.can_open !== true ||
        msg.nonce !== integer(quote.nonce) ||
        msg.quote.revision !== integer(quote.revision) ||
        BigInt(integer(msg.quote.expires_at)) < BigInt(block.height) ||
        BigInt(msg.quote.expires_at) > BigInt(integer(quote.expires_at))
      )
        deny('quote_changed', 'Refresh the case quote before confirming.', 409);
      exact(
        c,
        call(
          catalog.paymentToken,
          'ft_transfer_call',
          { receiver_id: game.contractId, amount: game.price, msg: args.msg },
          G250,
          '1',
        ),
      );
      if (
        BigInt(
          integer(
            await chain.view(catalog.paymentToken, 'ft_balance_of', {
              account_id: gameAccount,
            }),
          ),
        ) < BigInt(game.price)
      )
        deny(
          'insufficient_tokens',
          'Insufficient confirmed USDI balance.',
          409,
        );
      kind = 'case-open';
      tokenId = catalog.paymentToken;
      symbol = 'USDI';
      amountAtomic = game.price;
      amountDisplay = display(game.price, 6);
      recipient = game.contractId;
    } else if (
      definition &&
      ['advance_opening', 'retry_payout'].includes(c.methodName)
    ) {
      await pinned(chain, definition.contractId, catalog);
      const args = z.object({ opening_id: z.string() }).strict().parse(c.args);
      integer(args.opening_id);
      const opening = object.parse(
        await chain.view(definition.contractId, 'get_opening', args),
      );
      if (
        opening.account_id !== gameAccount ||
        opening.status !==
          (c.methodName === 'retry_payout' ? 'Claimable' : 'RandomnessPending')
      )
        deny(
          'opening_unavailable',
          'Only the owner can recover an eligible opening.',
          403,
        );
      exact(c, call(c.receiverId, c.methodName, args, G150, '1'));
      kind = 'case-recover';
      recipient = definition.contractId;
    } else
      deny(
        'call_not_allowed',
        'This contract method is not allowed for game wallets.',
      );
    steps.push(c);
  }
  const protocol = object.parse(
    await chain.call('EXPERIMENTAL_protocol_config', { finality: 'final' }),
  );
  const runtime = object.parse(protocol.runtime_config);
  const blockPrice = BigInt(
    integer(object.parse(await chain.call('gas_price', [null])).gas_price),
  );
  const floor = BigInt(integer(runtime.min_gas_purchase_price));
  const purchasePrice = blockPrice > floor ? blockPrice : floor;
  const fees = object.parse(runtime.transaction_costs);
  const actionFees = object.parse(fees.action_creation_config);
  function fee(value: unknown) {
    const item = object.parse(value);
    const send =
      BigInt(integer(item.send_sir)) > BigInt(integer(item.send_not_sir))
        ? BigInt(integer(item.send_sir))
        : BigInt(integer(item.send_not_sir));
    return send + BigInt(integer(item.execution));
  }
  const baseGas =
    fee(fees.action_receipt_creation_config) +
    fee(actionFees.function_call_cost);
  const byteGas = fee(actionFees.function_call_cost_per_byte);
  // Reserve upfront purchase, including static action costs, at twice the live price.
  // Unspent gas is refunded by NEAR. This is a conservative reserve, not a fee quote.
  const nativeCostCapYocto = steps
    .reduce((sum, c) => {
      const bytes =
        Buffer.byteLength(c.methodName) +
        Buffer.byteLength(JSON.stringify(c.args));
      return (
        sum +
        BigInt(c.deposit) +
        (BigInt(c.gas) + baseGas + byteGas * BigInt(bytes)) *
          purchasePrice *
          2n +
        1000000000000000000000n
      );
    }, 0n)
    .toString();
  if (BigInt(nativeCostCapYocto) > MAX_NATIVE)
    deny(
      'native_limit',
      'Native gas or storage reserve exceeds the prototype limit.',
      409,
    );
  const state = await accountState(chain, accountId);
  if (!state)
    deny('unknown_account', 'The signer account does not exist.', 409);
  const backing =
    BigInt(integer(state.storage_usage)) *
    BigInt(integer(runtime.storage_amount_per_byte));
  if (BigInt(integer(state.amount)) - backing < BigInt(nativeCostCapYocto))
    deny(
      'insufficient_near',
      'The signing wallet needs more native Testnet NEAR for gas and storage.',
      409,
    );
  return {
    kind,
    accountId,
    tokenId,
    symbol,
    amountAtomic,
    amountDisplay,
    recipient,
    steps,
    nativeCostCapYocto,
  };
}
export function intentHash(
  request: OperationRequest,
  preview: PolicyPreview,
  walletId: string,
) {
  return digest({ network: 'testnet', walletId, request, preview });
}
