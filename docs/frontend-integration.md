# Frontend integration for the standalone Case Shop

This repository is the Case Shop backend and client integration core. The old Tea Shop room, chat, dashboard components and roulette UI are not included. Build your own interface around the APIs and NEAR Testnet client modules below. The spinning reel and token icons are presentation: only a verified recorded opening and payout determine the real result.

## Current state and boundaries

- Five existing case contracts and the USDI token were deployed on **NEAR Testnet**. Their recorded configuration is in `config/cases.testnet.json`, `config/contracts.testnet.json`, and `config/tokens.testnet.json`. Live balances, pause status, prices, and eligibility can change; query the chain before enabling a purchase.
- Do not send Mainnet transactions, call contract owner/admin methods, change code hashes, deploy contracts, or assume a mock test represents a Testnet transaction. Frontend agents do not need owner credentials.
- The player-account service and Google KMS worker have code and local tests, but the worker, player addresses, funding and public Testnet player transactions have not been activated or verified. `unconfigured`, `allocated`, and `active` are different states. Never invent an address or balance.
- The standalone package does **not** include the old `PlayerProvider`, `useCaseController`, or account UI. You must implement the orchestration and confirmation UI described here; server endpoints do not render it for you. Existing `CaseClient`, validators, pending/receipt helpers and the HOT connector remain reusable.

## Same-origin and sessions

Serve the frontend and `/api` under the **same browser origin**, for example by using Next routes in this app or a same-origin reverse proxy. The server checks the exact `IROH_PLAYER_APP_ORIGIN` for mutations. Production requires HTTPS; development permits localhost/127.0.0.1. A different origin will not work by simply enabling CORS, because the auth routes enforce origin, `Sec-Fetch-Site`, cookie and CSRF requirements.

Register with `POST /api/auth/register` or sign in with `POST /api/auth/login` and JSON `{ "nickname": "...", "password": "..." }`. Both return `{user:{id,nickname}}` and set an HttpOnly session cookie. Use `POST /api/auth/logout` to revoke the session and `GET /api/auth/me` for the basic session user. Do not store passwords or session tokens in localStorage.

After login, `GET /api/player` returns the `PlayerProfile` directly, including `csrfToken`, `gameWallet`, `externalWallets`, `authMethods`, `createdAt` and signer status. Send the returned token as `x-player-csrf` on all authenticated `/api/player` POST requests and on authenticated wallet linking/authorization requests. Use `Content-Type: application/json` and `credentials: 'same-origin'` for fetch. On HTTP 401, clear the displayed player and require login again. Never accept a browser-provided user ID as the account owner.

## HOT Connect and wallet login

`src/wallet/nearConnector.ts` and `src/wallet/walletController.ts` are headless HOT integration helpers, not UI components. `loadConnector()` connects/restores/disconnects a Testnet wallet; `signTestnetMessage()` checks the active Testnet account and signs an authentication message. A wallet merely reporting an account ID is **not** a login.

1. Connect the external Testnet wallet and obtain its account ID.
2. `POST /api/auth/wallet/challenge` with `{ "purpose": "login", "accountId": "..." }`. It sets a separate HttpOnly browser-binding cookie and returns `{challenge:{id,message,recipient,nonceBase64,expiresAt}}`.
3. Reject expired challenges. Decode `nonceBase64` to a 32-byte `Uint8Array` and ask the connected wallet to sign exactly `{message,recipient,nonce}` using `signMessage` on Testnet. Recheck that the wallet account has not changed.
4. `POST /api/auth/wallet/verify` with `{challengeId,accountId,publicKey,signature}` returned from the wallet. The server validates the signature, binding, expiry, replay and finalized FullAccess key. A successful login returns `{user}` and sets the session cookie. Reload `/api/player`.

A connected external wallet and the game wallet are separate accounts. Never merge profiles or move funds on login. Wallet support for NEP-413 varies; provide a clear unsupported/cancelled state. The real HOT flow still needs public-wallet verification.

To link another wallet, first obtain a one-use authorization for the exact target: `POST /api/auth/reauth` with `{scope:'link',targetAccountId,password}`, or request a wallet challenge with `{purpose:'authorize',accountId:<already linked wallet>,scope:'link',targetAccountId}` and verify its signature. Then request `{purpose:'link',accountId:<new wallet>,authorizationId}`, sign that challenge with the new wallet and verify it. Authenticated link/authorize challenge and verify calls require `x-player-csrf`. A wallet already linked to another profile is rejected, not merged.

## Case catalog, reads and opening

`GET /api/catalog` returns `{network, cases, tokens}` from the committed Testnet registries. This is configuration, not a live balance, pause-state or quote check. There is no `/api/cases` endpoint. Import `caseCatalog`, `caseById` and `deploymentForCase` from `src/case/catalog.ts`. Build `new CaseClient(deploymentForCase(definition), undefined, definition)` only when the deployment is non-null. `CaseClient` and pure builders are in `src/case/client.ts`; the registry and actual contract views, not visual names, determine the allowed action.

The last recorded Testnet accounts are:

| Case ID                 | Contract account                  |
| ----------------------- | --------------------------------- |
| `bamboo-mist`           | `bamboo.needmore_1_near.testnet`  |
| `dragon-tea`            | `cases-needmore-1-near.testnet`   |
| `moon-spirit`           | `moon.needmore_1_near.testnet`    |
| `phoenix-flame`         | `phoenix.needmore_1_near.testnet` |
| `uncles-secret-reserve` | `reserve.needmore_1_near.testnet` |

The payment/faucet token is `usdi-needmore-1-near.testnet`; the default configured RPC is `https://rpc.testnet.fastnear.com`. USDI has six decimals; other test tokens use the decimals in the supported registry and must not be assumed to match. Amounts and deposits are decimal strings in atomic units, never JS floating point. `formatUnits`, parsers and `BigInt` are available. All listed tokens are Testnet assets.

Read each case independently with `CaseClient` methods such as `caseInfo`, `pool`, `publicOdds`, `balance`, `claimed`, `claimCost`, `tokenRegistration`, `storage`, `quote`, `active`, `history` and `historyPage`. Treat RPC timeouts and partial failures as unavailable, not zero. Bind each read to the currently selected case and active account, abort obsolete requests, and do not enable opening if quote/pool/account/registration is missing, stale or disagrees.

For an active game wallet, the client uses the server's queued `game-call` flow below. Reuse the existing builders:

- `claimCall(deployment,cost)` claims the game account's own once-only starter faucet, with the on-chain `claim_storage_cost` as attached deposit.
- `tokenRegistrationCall` and `storageCall` prepare the required token/case storage calls using fresh chain values. Approve/finalize each prerequisite before the next action.
- `openCall(deployment,quote,definition)` builds the USDI `ft_transfer_call` for the exact case price and fresh quote/nonce. The KMS worker accepts only reviewed methods, contracts and code hashes. Arbitrary methods are not supported.
- `recoverCall` accepts only an owned `Claimable` or `RandomnessPending` opening and builds `retry_payout` or `advance_opening` accordingly. Never draw again to fix an in-flight payout.
- A claimable bonus payout may first require the player to register storage on the particular awarded reward-token contract. Use `CaseClient.rewardRegistration(tokenId, accountId)` and verify that token matches the current opening and its case reward list; when unregistered, build `{...tokenRegistrationCall(deployment, tokenStorageCost), receiverId: tokenId}` as a separate confirmed game call, then retry the existing payout. Do not charge for or register an unrelated token.

After a verified draw, show the contract-recorded token and amount; animate the reel to that result. Wait for appropriate final payout state and expose claimable/recovery or failure states rather than promising a payout from an animation.

## Game-wallet operation API

Types and payloads are defined in `src/player/types.ts`; `WalletFunctionCall` is in `src/shared/wallet.ts`. Every mutating request below requires the current session, same origin and CSRF token. The server owns authorization, policy, exact amounts and idempotency.

1. `POST /api/player/operations` with one of the following flat JSON bodies and a unique `idempotencyKey` (for example `crypto.randomUUID()`):
   - `{kind:'game-call',call,idempotencyKey}`
   - `{kind:'deposit',tokenId,sourceAccountId,amount,idempotencyKey}`
   - `{kind:'withdraw',tokenId,recipient,amount,idempotencyKey}`
     `amount` is a human decimal string such as `"1.25"`; the server resolves token decimals and returns `{operation}`. The prepared operation contains exact atomic amount, source, recipient, steps, expiry, intent hash and native cost reserve. Display these before confirmation. No automatic spending.
2. `POST /api/player/operations/{id}/confirm` with `{intentHash, authorizationId?}`. Use the exact hash from the preview, not one constructed by the frontend. For withdrawal, obtain a fresh exact-operation grant first: password `POST /api/auth/reauth` with `{scope:'withdraw',operationId,password}`, or linked-wallet challenge `{purpose:'authorize',accountId,scope:'withdraw',operationId}` followed by signed `/verify`. Pass the returned `authorizationId` to confirm.
3. `GET /api/player/operations/{id}` polls one operation; `GET /api/player/operations` returns recent `{operations}`. `POST .../{id}/cancel` with `{}` only cancels an unsigned prepared operation. Do not expose cancel/retry as if it undoes a submitted transaction.

Operation statuses are `prepared`, `authorized`, `signing`, `awaiting_external`, `submitted`, `unknown`, `confirmed`, `failed`, and `cancelled`. A `txHash` alone does not prove successful execution. Unknown, timeouts, reloads, wallet switching and incomplete receipt graphs must not trigger a fresh transfer or case purchase. The worker persists signed bytes/hash before one broadcast and reconciles that same hash. Show waiting/recovery states; do not optimistically update balances. Let the user inspect an existing transaction or retry a **read**, not resend a payment. Keep status/step updates monotonic so a stale activity response cannot move a confirmed operation back to pending.

Deposit is externally signed: the source must first be linked and be the currently connected HOT wallet. `operation.accountId` is the **actual external signer** for deposit; for withdraw/game actions it is the game account. After confirmation, for each step starting at `completedSteps`, the external wallet signs exactly the returned call. Attach the resulting hash with `POST /api/player/operations/{id}/receipt` body `{stepIndex,hash}`. Wait for that step to finalize and increment `completedSteps` before prompting the next; a recipient-storage step may precede transfer. If a wallet already sent a step but the browser lost its receipt response, let the user enter that **existing public hash** for the same step. Never automatically ask the wallet to send it again.

Withdrawal is signed by the managed game wallet after explicit preview and fresh scoped reauthentication. The server enforces supported tokens, precise decimal amounts, per-operation limits, NEP-145 storage and native gas reserve. Show the reserve as an upper upfront amount including gas and storage; unused gas can be refunded. Do not present the reserve as a final fee. Do not assume recipients are registered or that a selected wallet account is still the same after any popup.

## Wallet status, balances and activity

- `POST /api/player/wallet/provision` with `{}` requests allocation only when the operator has configured and enabled the worker. An allocated implicit address is not an active NEAR account until separately funded with native Testnet NEAR and checked against its expected FullAccess key.
- `POST /api/player/wallet/refresh` with `{}` checks finalized account/key state. Never substitute a linked external account for an authenticated but unavailable game wallet.
- `GET /api/player/balance?token=near` or `?token=<supported-contract-id>` returns `{tokenId,symbol,decimals,balance,blockHeight,source:'finalized-rpc'}`. Fetch cards independently; `balance` is an atomic integer string.
- `GET /api/player/claim` returns `{claimed,eligible,costYocto,reason}` from chain state. The existing faucet enforces one claim per game wallet. Distinguish `null` (unknown/unavailable) from `false`. Do not show the 1,000 USDI as received before finality and a refreshed balance.
- Case activity is keyed by actual NEAR account. Read the game wallet's case history and let users deliberately select their previous external wallet to view its historical on-chain activity; do not pretend history or tokens were migrated. `GET /api/case-history?account=<testnet-account>&cursor=<optional>` supplies indexer references; indexer results are not independently verified receipts. Reuse `CaseClient` transaction/receipt checks, `src/case/history.ts`, and `src/case/pending.ts` to distinguish confirmed RPC evidence from indexer references.

## Required UI states and verification

Include disconnected, loading, unsupported-wallet, unconfigured/offline, allocated-but-unfunded, active, blocked, pending, unknown, failed, and confirmed states. Offer keyboard-accessible confirmations that show token, source, recipient, atomic/display amount, operations, and native reserve. Keep game-wallet and connected external-wallet identities visible. Provide a password-recovery limitation: a password-only account without a previously linked wallet has no recovery flow in this prototype. Never load a KMS credential or private key into browser code.

The existing automated tests and local NEAR Sandbox prove local behavior with controlled accounts and actual local contracts. They do **not** prove the new public KMS worker, real HOT login or real player-wallet funding/transfers. Verify those separately only after operator configuration and an authorized bounded Testnet scope. Coordinate API changes with the backend maintainers; do not alter server signing policy to fit the visuals.
