# Iroh Case Shop

Standalone NEAR Testnet Case Shop backend, smart contracts, wallet signer and frontend integration code. This repository intentionally contains no Tea Shop interface. The new frontend can be developed independently against these APIs and client modules.

Read [the frontend integration guide](docs/frontend-integration.md) before wiring the user interface. [Architecture and extraction notes](docs/architecture.md) describe what was retained, what was removed, and the remaining activation work.

## What is here

- Next.js API routes for account authentication, player profiles, wallet operations and case-history references. `GET /api/catalog` lists configured cases and tokens; it does not report live balances or guarantee that a case is currently open.
- Headless NEAR case clients, receipt verification, history and HOT wallet connector modules in `src/case`, `src/wallet`, and `src/shared`.
- Separate managed signing worker in `src/game-wallet` and `scripts/player-wallet`. Its KMS keys are custodial; no browser key or arbitrary-signing API is provided.
- Rust source for the existing USDI, case-pool, mock-token and economics contracts under `contracts/`. The public Testnet deployment registry and reviewed code-hash manifest are included unchanged.
- Historical Prisma migration chain, preserved for compatibility. The repository does not contain an existing database or user records, and it exposes no old Tea Shop chat or Nansen APIs.

## Local setup

Requires Node.js 22.12 or later, npm, Python 3 and the Rust toolchain specified in `contracts/rust-toolchain.toml` when working on contracts.

```sh
npm ci
npm test
npm run typecheck
npm run db:migrate
npm run dev
```

The API starts at `http://127.0.0.1:3000`. `GET /` identifies the API and `GET /api/catalog` returns the five configured Testnet cases and supported tokens. The default database is local SQLite; the migration creates an empty local database. `DATABASE_URL` can select another SQLite file.

The frontend and API must share the same browser origin, including when using a reverse proxy. Set `IROH_PLAYER_APP_ORIGIN` to the exact frontend origin. Production requires HTTPS; loopback HTTP is allowed for development. Authentication and CSRF checks must not be bypassed to make a cross-origin frontend work.

## Player wallets and signing

No newly extracted player wallet is automatically active. The KMS signer and public Testnet write gate are disabled until the operator configures them and separately authorizes activation, funding and public transactions. The frontend must distinguish an unconfigured wallet, an allocated address and an active funded account. Do not display simulated balances or treat local Sandbox tests as public Testnet results.

The worker is started separately with `npm run player:worker`. It and the web server need the same durable database. Production credential material belongs only in the worker environment, never in this repository, frontend code, chat or command arguments. See [wallet architecture](docs/player-wallets.md) and the integration guide for the exact environment variables and custody limitations. Do not put a signing credential into a web service just to bypass database topology constraints.

Run `npm run player:verify-testnet` for a read-only public code-hash and token-metadata check. It never signs or broadcasts. `npm run test:player:sandbox -- /path/to/near-sandbox` runs controlled local-chain tests after the three contract WASMs have been built; set `IROH_PLAYER_SANDBOX_WASM_DIR` if they are elsewhere. Sandbox results are not public Testnet verification.

## Contracts and tests

```sh
npm test
npm run typecheck
npm run build -- --webpack
npm run contracts:test
npm run contracts:build
```

All contract deploys, funding and public player transactions require their own authorized scope. The existing contracts have not been modified by this extraction. A formal audit remains outstanding. There is no Mainnet support or real-money readiness claim.

## New repository

This directory has an independent local Git history. To publish later, create an empty remote repository and configure it using your normal Git workflow. No remote, push, merge, cloud credential or deployment is created by this extraction.
