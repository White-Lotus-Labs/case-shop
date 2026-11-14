# Standalone Case Shop extraction plan

> For agentic workers: implement one verifiable unit at a time. Preserve the original project and never push or deploy without an explicit instruction.

**Goal:** Give the team an independent Case Shop codebase without the Tea Shop frontend.

**Architecture:** Preserve the existing Next.js backend/API, auth, KMS worker, headless NEAR SDK, Rust workspace and historical SQLite migration chain. Move the shared wallet call type out of UI. Expose a read-only catalog and root service status. Document the same-origin frontend integration and the unfinished Testnet activation.

**Tech stack:** Next.js, TypeScript, Prisma/SQLite, NEAR contracts in Rust, Google Cloud KMS.

- [x] Trace backend, client, wallet, and contract dependencies; select the headless API extraction.
- [x] Copy only tracked allowlisted source; exclude secrets, env files, user data, caches, deployment executors, and old UI.
- [x] Replace UI type dependencies and expose a read-only catalog.
- [x] Write an agent handoff with exact APIs, on-chain calls, CSRF and custody limits.
- [x] Verify clean install, migrations, automated auth/wallet/case tests, TypeScript, build, and contract source parity.
- [x] Place the standalone directory in Documents as an independent local Git repository. No push, merge, or public transaction.
