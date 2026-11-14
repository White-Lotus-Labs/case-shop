import registry from '../../config/tokens.testnet.json' with { type: 'json' };
import contracts from '../../config/contracts.testnet.json' with { type: 'json' };
import type { SupportedToken } from './types';
export const supportedTokens: SupportedToken[] = [
  {
    contractId: contracts.tokenContractId,
    name: 'USD Iroh',
    symbol: 'USDI',
    decimals: 6,
    unofficial: true,
  },
  ...registry.tokens
    .filter((token) => token.selection === 'included')
    .map((token) => {
      if (
        typeof token.contractId !== 'string' ||
        typeof token.name !== 'string' ||
        typeof token.symbol !== 'string' ||
        typeof token.decimals !== 'number'
      )
        throw new Error('Invalid supported token registry.');
      return {
        contractId: token.contractId,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        unofficial: true,
      };
    }),
];
export function tokenById(id: string): SupportedToken {
  const token = supportedTokens.find((row) => row.contractId === id);
  if (!token) throw new Error('Unsupported Testnet token.');
  return token;
}
