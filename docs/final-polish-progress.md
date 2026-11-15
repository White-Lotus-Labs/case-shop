# Final Fujitora polish

User brief: attachment `6f41f360-83b9-4913-b917-0a02485906de/pasted-text-1.txt`.
Branch: `feature/final-fujitora-polish`, based on fetched `origin/main` at `91484c2`.
Preserve pre-existing changes to `src/game-wallet/config.ts` and `tests/reward-history.test.ts`.

## Authorization

Routine NEAR Testnet game testing is authorized. The user increased the total limit to **15 test NEAR**, including gas, storage, and all submitted transactions. No Mainnet. Never read, export, print, or log private keys or seed phrases. Use a configured wallet approval flow. Contract deployments/upgrades, ownership/fee-recipient changes, and accrued-fee transfers require explicit approval. Charity provisioning requires an existing authorized secure signer and user-controlled recovery.

Live transaction ledger: none submitted. Total spent: 0 NEAR.

## Work sequence and acceptance

1. Reproduce wallet/RPC/pending-state failures. Verify nonce-safe recovery and receipts.
2. Redesign existing Vite/React/Three frontend with black/violet/gold direction, accessible sticky selector and purchase controls, separate watermark homepage, and five distinct case geometries.
3. Add bounded opening/reveal/closing/idle transitions using confirmed chain rewards, with account/case/navigation cancellation.
4. Verify personal/global finalized history, timestamps and receipt links, caching/polling, and repository-backed or configurable X URL.
5. Inspect 5% accounting, implement and Sandbox-test future charity fee routing without touching deployed contracts or historical funds. Provision treasury only with secure user-owned recovery.
6. Rewrite README with actual addresses, probabilities, limitations and screenshots. Remove visible hackathon branding.
7. Run Rust, Sandbox, backend/frontend tests, TypeScript, builds and browser checks. Perform all-five live openings within budget and record hashes/costs.
8. Commit, push, CI, merge only after verification, then verify Railway/public deployment.

## Evidence so far

- Fetched main and created requested branch, retaining both existing modifications.
- Baseline `npm test`: 26 files, 222 tests passed.
- Confirmed RPC transport lacked HTTP 429 fallback. New failing tests reproduced that and absence of a read-only method boundary. Added bounded fallback between the two configured public Testnet providers, preserving custom/Sandbox URLs and never broadcasting.
- `npx vitest run tests/testnet-rpc.test.ts tests/native-client.test.ts`: 16 tests passed after fix.
- Found saved purchase intents were never removed when finalized matching nonce was observed. Added removal in refresh and opening polling. Needs browser verification.
- Native contract has existing 5% fee accounting in `pending_fees` / `fees`, and treasury configuration. Fee payout mechanics still to audit.

## Remaining

All acceptance steps above remain open except initial branch setup and narrow transport tests. Do not claim full completion or merge yet.

## Verified progress update

- User raised the shared live budget to 15 test NEAR and supplied `https://x.com/PandaCoderexe`.
- Five real Testnet openings completed, with finalized native and token payout flags verified. `docs/native/evidence/final-polish-live.json` records all hashes and actual gas.
- Dedicated treasury `fujitora-paws.needmore_1_near.testnet` created with 0.1 test NEAR. Same user-owned full-access public key as the existing owner, retained through the user's existing keychain/recovery mechanism; no new private key generated or exported. Creation hash `7gC8pNMvHLm5BLj2aB81tzQxiDoNTQBfkUQGZMr2hnZB`. Account and full-access key verified at finality in `docs/charity/treasury.json`.
- Combined routine game testing, treasury funding, and gas: `2169134224730242000000000` yoctoNEAR, or 2.169134224730242 NEAR. Fee routing remains inactive. No deployed contract code changed, and no old fees transferred.
- Charity preparation uses a versioned raw-storage sidecar, preserving existing root/opening Borsh layouts. Future-only eligibility starts at activation `next_id`. Single attempt-bound native transfer; failed transfers release only their reservation; success debits gross fees once. New unit tests and actual Sandbox tests passed across all five cases, including upgrade from preserved old WASM, a pre-activation claimable opening, failed transfer to absent account, provision/retry, exact receiver balance, storage funding and preserved player reserves.
- Prepared new native WASM SHA256 `f9ae627173ded178723f20dc3006a7869c6195fa66dabd7353972f8d752e91b1`. Requires explicit owner approval before deployment and activation.
- Latest `npm test`: 28 files, 231 tests passed. Both TypeScript checks and both production builds passed. Rust tests passed, including 17 native tests. Native and retained legacy Sandbox integration passed.
- Reviewer identified ineffective sticky navigation due to overflow-hidden. Changed to overflow-clip; observed mobile selector bounding top=64 after scrolling at 390px width. Added mobile purchase dock and corrected header sizing, awaiting final browser screenshots.
- New verified transaction-link resolver uses public Nearblocks references and proves signer, contract, nonce, returned opening ID and final success via RPC. All five live hashes verified individually. Found/fixed current Nearblocks terminal responses omitting `meta`; regression test passes. Indexer outages leave block links without inventing a transaction.
- Opening presentation now returns opening -> reveal -> closing -> idle, cancels on account/case/page changes, displays actual native amount over the 3D case, and uses silhouette-specific lid mechanics. Homepage unmounts scene. Four new primitive-based case models plus retained mechanical Dragon chest give distinct silhouettes.
- Final browser run session 83930 is still running. Earlier run passed all five purchases but had a recovery test expecting a result to survive refresh even after confirmed intent had already been cleared. Updated it to verify the original finalized history/count, rather than require transient presentation state after refresh.

## Current next steps

1. Finish browser run and inspect desktop/mobile screenshots. Do not modify frontend source while that run is active.
2. Remove remaining visible hackathon branding found by search in `frontend/src/ui/kit.tsx:355` and engraved label in `CaseModel.tsx:411`; remove trailing whitespace in App.tsx.
3. Browser real-wallet check is waiting on Meteor unlock. CUA preview tab 1634583172 (`http://127.0.0.1:5173`) and Meteor popup tab1634583174 are open. Meteor URL explicitly `/connect/testnet/login`. User asked asynchronously to unlock and reply Unlocked, never send password. Keychain live signing already verified all five cases. No additional UI purchase has been submitted. CUA markHandoff failed with an extension-update notice; do not bypass wallet login. Local Vite session25333 is serving port5173.
4. Review follow-up for recent metadata/history/mobile fixes; verify actual wallet approval flow if unlocked. Any UI purchase must be separately recorded before clicking and included in the shared15 NEAR total.
5. Update README/screenshots/status, finish exact upgrade/activation review commands, CI workflow, and test evidence. Remaining actual wallet/contract permission gates must not block independent work.
6. Commit/push feature branch, inspect CI, merge only after required checks pass, push main, and verify Railway commit/public runtime. No push/merge yet. GitHub keychain authentication verified with repo/workflow scopes.

## Final local verification before delivery

- Real Meteor wallet connected after user unlock. Bamboo Mist nonce2 purchase was approved through the actual Testnet wallet UI, paid0.02NEAR plus25SHITZU, showed floating reward/particles, closed and returned to idle. Hash `CZS6ubJhjnJ7PJRikZ2ebZfHRBf4ciUEp6kjvQhreeR`; audit `docs/native/evidence/browser-live.json`.
- Shared live spending including all six purchases, charity account funding and all gas: **2.2615062998332318 test NEAR**. No unresolved submitted transactions remain. No further live tests currently needed.
- X header link is the exact user-supplied `https://x.com/PandaCoderexe`.
- History references now paginate instead of stopping at ten transactions, with terminal-page and pagination regression tests. Homepage has six real recent-drop cards. Low-draw-count rarity particles and individual lid mechanics are present.
- Latest full application suite:28 files/232tests passed. Both TypeScript checks and both builds passed. Native Rust17 tests and all retained Rust tests pass. Native/charity Sandbox plus legacy Sandbox pass. Final complete browser run passed all checks with browserErrors=[] and updated desktop/mobile screenshots.
- Final branding search and git diff whitespace check passed. Fetched main again; origin/main and branch base remain91484c2f90928c15fee49156bb91577b8eba6404.
- Exact proposed contract operations are in docs/charity/transactions.review.json and activation-review.md. Upgrades/activation remain unexecuted pending explicit owner approval.
- Next: commit/push, CI, merge, Railway/public verification. CUA wallet flow ended successfully and completion summary was submitted. Preview tab1634583172 remains connected atlocalhost5173; no wallet popup is needed. Vite session25333 remains running.
