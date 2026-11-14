# Run and deploy the native NEAR case shop

The Vite frontend uses the player's NEAR Testnet wallet. It reads balances, quote probabilities, results, and history from finalized contract views. Each opening pays its selected native NEAR reward and one configured Testnet token directly to that wallet.

The five native contracts are deployed and funded on fresh Testnet accounts. The finalized code hashes, pool balances, and token inventory checks are recorded in `docs/native/evidence/live-deployment.json`.

## Run locally

Install Node.js 22.12 or later and the Rust version in `contracts/rust-toolchain.toml`. Install both dependency sets:

```sh
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open the printed Vite URL. Wallet connection uses the existing HOT NEAR connector in Testnet mode. No database, password, KMS credential, or managed signing worker is required by the native application.

The optional read-only backend starts with `npm run dev`. Its catalog endpoint is `/api/catalog`. Historical third-party transaction references remain at `/api/case-history`. The native frontend uses contract pagination for global history and does not need that indexer.

## Verify the implementation

```sh
npm test
npm run typecheck
npm --prefix frontend run typecheck
npm run build -- --webpack
npm --prefix frontend run build
npm run contracts:test
npm run contracts:build
NEAR_SANDBOX_BIN_PATH=/absolute/path/to/near-sandbox bash scripts/contracts.sh native-integration
node --import tsx tests/native/browser.mts /absolute/path/to/near-sandbox
```

Install the browser once with `npx playwright install chromium`. You can select an existing Chromium with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The browser test creates its own local chain, ephemeral wallets, tokens, and five case contracts. It never reads saved wallet credentials or signs public Testnet transactions. The wallet bridge and deployment overrides are restricted to a Vite development build, an explicit `VITE_NATIVE_SANDBOX=1` setting, and the loopback host.

## Review deployment requirements

Read `config/cases.native.testnet.json`. Configuration economics use integer microNEAR. Public views, wallet deposits, and accounting use yoctoNEAR. Prices are 0.05, 0.1, 0.2, 0.5, and 1 NEAR. All configured tokens are Testnet collectibles with no monetary value.

The proposed accounts are `native-bamboo`, `native-dragon`, `native-moon`, `native-phoenix`, and `native-reserve` under `needmore_1_near.testnet`. The parent account needs authority to create these subaccounts. Each fresh contract needs its own full-access key for deployment and initialization. Keep those keys outside the repository.

For a separate future deployment, configure fresh planned accounts first. After building the WASM, generate the deployment package:

```sh
npm run native:prepare-deployment
npm run native:preflight
```

The generator refuses to prepare the current live accounts. These commands only read public chain data and write local review files. They cannot sign or broadcast. The preflight verifies account absence, configured token metadata, and the owner's funding availability. Inspect these files:

- `docs/native/deployment/manifest.json` contains the actual WASM SHA256 and NEAR code hash, exact account targets, and aggregate reward funding requirements.
- `docs/native/deployment/*.init.json` contains each immutable case configuration.
- `docs/native/deployment/commands.review.txt` contains exact near-cli-rs 0.31.1 commands for account creation, atomic deployment and initialization, token storage registration, reward funding, and unpausing.
- `docs/native/evidence/testnet-preflight.json` records the read-only checks made immediately before deployment.

The plan allocates 100 NEAR for the five prize pools, 25 NEAR for the five new accounts, 0.03125 NEAR for token registration at the last checked storage rates, and 10 NEAR for gas and other transaction costs. The estimate is 135.03125 NEAR, leaving at least 14.96875 NEAR of the 150 NEAR budget with the owner. Each pool and each configured token candidate has enough funding for at least four concurrent maximum rewards. Native funding is distributed in proportion to each case's maximum reward. The manifest lists exact yoctoNEAR amounts for each case and the required token inventory.

The 10 NEAR for gas is an allowance, not a prepaid fixed fee. Actual gas costs can change, so the reviewed commands cannot guarantee an exact total spent or enforce the 150 NEAR ceiling automatically. Before each authorized transaction, track actual spending and stop if the remaining budget cannot cover the remaining transfers and their fees while leaving at least 14 NEAR. Unused gas stays with the owner. Rerun preflight before deployment.

Dynamic probabilities depend on available native reserves. The configured targets total 1,825 NEAR across five pools. The prepared funding starts below those targets and therefore uses the contract's lower-pool odds. Read `get_quote` to inspect the exact current probabilities.

## Deploy a fresh set after authorization

The listed native accounts are already deployed. Never redeploy to them. For a separate future deployment, do not execute commands until the user explicitly authorizes account creation, deployment, and funding. Run a fresh read-only check that every new account is absent. If any account exists, inspect its state and choose another fresh account rather than overwriting it.

After authorization, execute the reviewed commands in order. Each contract starts paused. Verify its code hash, immutable case configuration, native reserve, configured token balances, and token registrations before executing its unpause command. Read `get_pool`, `get_case`, and `get_reward_inventory` at finality. Compare `view_code.code_base64` against the manifest hash before activation.

Set a registry entry to `verified-live` only after those checks. Rebuild the frontend and run the wallet acceptance flow with separately authorized player transactions.

## Recover an unfinished opening

Reconnect the same wallet and select its case, or open **My openings**. Pending draws expose **Continue opening**. Confirmed payout failures expose **Retry reward payout**. A completed payout needs no claim transaction.

The browser saves the exact purchase intent before wallet confirmation. A refresh searches the account's finalized history for that nonce. If the wallet response is missing, verify its transaction hash or retry the exact original transaction. The retry preserves its original nonce, arguments, deposit, and gas. A duplicate or stale purchase fails without accepting another opening.

The browser retains the verified result's record until you select **Open another case**. A reload therefore restores the result even if the background refresh already verified its payout.

Each payout callback records the successful native and token legs separately. A retry sends only unpaid legs. The contract blocks duplicate callbacks and claims. A wallet switch clears private results immediately and leaves recovery records under their original wallet and contract keys.

## Preserve the historical contracts

Do not deploy the native WASM onto any account in `config/cases.testnet.json` or `config/contracts.testnet.json`. Those accounts retain historical USDI state and obligations. Their source, clients, recovery modules, and tests remain in this repository. Password and managed-wallet HTTP routes are removed from the active application. The retained managed-wallet modules are legacy code and are not part of the native frontend.

The new contract does not expose a treasury withdrawal method. Vested fees remain in the contract and cannot consume reward reserves. Randomness uses the existing NEAR protocol randomness architecture for a Testnet demonstration. It is not a production VRF.

Protocol references: [private callbacks](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks), [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md), [NEP-145 storage management](https://github.com/near/NEPs/blob/master/neps/nep-0145.md), and the [near-cli-rs guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md).
