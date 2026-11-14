/** Read-only evidence. Never imports a signer, requests a secret or broadcasts. */
import { TestnetRpc } from '../../src/game-wallet/chain';
import {
  defaultCatalog,
  accountState,
  finalBlock,
} from '../../src/game-wallet/policy';
const chain = new TestnetRpc();
await chain.assertNetwork();
const block = await finalBlock(chain);
const entries = [...defaultCatalog.codeHashes];
const verified: string[] = [];
for (let i = 0; i < entries.length; i += 4) {
  await Promise.all(
    entries.slice(i, i + 4).map(async ([id, hash]) => {
      const state = await accountState(chain, id, block.hash);
      if (!state || state.code_hash !== hash)
        throw Error(`Reviewed code mismatch: ${id}`);
      const token = defaultCatalog.tokens.find((t) => t.contractId === id);
      if (token) {
        const meta = await chain.view(id, 'ft_metadata', {}, block.hash);
        if (
          !meta ||
          typeof meta !== 'object' ||
          !('symbol' in meta) ||
          !('decimals' in meta) ||
          meta.symbol !== token.symbol ||
          meta.decimals !== token.decimals
        )
          throw Error(`Token metadata mismatch: ${id}`);
      }
      verified.push(id);
    }),
  );
}
console.log(
  JSON.stringify(
    {
      network: 'public NEAR Testnet, read-only',
      checkedAt: new Date().toISOString(),
      blockHeight: block.height,
      blockHash: block.hash,
      contracts: verified.sort(),
      publicPlayerWalletProvisioned: false,
      publicTransactionsSubmitted: 0,
    },
    null,
    2,
  ),
);
