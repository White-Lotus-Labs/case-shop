# Extraction verification

The Case Shop was extracted from the player's feature branch at commit `809c9b8`. The original working trees and their databases were not modified. No `.env` file, private key, credential, deployment executor, dependency cache or old UI was copied.

On 2026-11-14 the standalone copy was verified with:

- A fresh `npm ci --ignore-scripts`, followed by the explicit project Prisma generation step. Dependencies were installed in the standalone directory, not linked to the original project.
- `npm test`: 200 tests passed across 23 files, including authentication, profile ownership, NEP-413, KMS policy, transfers, final receipts, catalog and history.
- `npm run typecheck` and `npm run build -- --webpack`: passed.
- `npm run db:migrate`: all four existing migrations applied to a disposable empty SQLite database. The migration-preservation regression also passed. No live database was read, moved or changed.
- Local production HTTP smoke check: root and catalog, test registration, player profile without a fabricated wallet, disabled public signing, and absence of the old chat route passed.
- `npm run contracts:test` with cached offline Rust dependencies: 79 tests passed. All 25 tracked contract workspace files match the source project byte-for-byte.
- Local NEAR Sandbox: 12 checks passed, including the USDI claim and duplicate rejection, external deposit, storage registration, withdrawal and case opening through the wallet queue. Local test wallets and contract state were freshly generated; this is not a public Testnet test. Existing built contract WASMs were read from the source workspace for this check.
- Read-only Testnet verification checked the configured code hashes and metadata of 18 deployed contracts at finalized block `277672459`. The reviewed deployment manifest remains byte-for-byte identical, SHA-256 `4cf07ab44a6dcf3f9aedf970c938808ec2bcb61e6e21fec959bf36d859db5cc9`.

Public player-wallet provisioning, Google KMS signing, native funding and player transfers were not performed. The new frontend still needs to implement account and operation orchestration described in the integration guide. A formal security audit remains outstanding. No remote repository, push, merge or deployment was performed by this extraction.
