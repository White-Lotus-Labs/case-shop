# Standalone architecture

Case Shop is an API-only Next.js service, a separate signer worker, reusable headless NEAR client modules and an unchanged Rust contract workspace. No Tea Shop visual frontend is included. The new frontend uses the same-origin /api routes and the client-side case and wallet modules. See frontend-integration.md for exact integration and readiness limits.

The existing SQLite Prisma schema and migration history are retained for data compatibility, including historical chat and snapshot tables. Removing those tables requires an explicit data migration; retaining them does not enable the Tea Shop APIs or frontend. The authenticated cookie name remains unchanged for compatibility. No existing database is included or transferred.

Two structures were considered: a full Tea Shop copy with the homepage hidden, and this API-only extraction. The second avoids unrelated 3D/Nansen code and dependencies while retaining contract-facing behavior and session protections. The original deployment manifest is retained byte-for-byte because the signer policy pins its reviewed contract code hashes. Project-specific cloud configuration and all private keys, secrets, .env files, old deployment executors, and dependency/build caches are excluded.

Player game wallets are not yet active on public Testnet. KMS, funding, hosting, formal audit and public end-to-end transactions remain separate work. No Mainnet or unapproved Testnet actions are enabled by this extraction.
