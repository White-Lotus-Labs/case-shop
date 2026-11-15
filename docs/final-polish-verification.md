# Final polish verification

The implementation branch is `feature/final-fujitora-polish`. No Mainnet operations were performed.

## Application checks

- `npm test`: 28 files, 232 tests passed.
- Root and frontend TypeScript checks passed.
- Vite production build and Next.js webpack production build passed.
- `git diff --check` passed.
- Visible branding search found no remaining hackathon text in frontend source or HTML.
- Independent review found no purchase nonce, account-switching, or transaction-recovery safety regression. Follow-up changes added pagination for older transaction references.

## Contract and Sandbox checks

- Rust tests passed for all retained crates and the native crate. The native crate has 17 passing tests.
- Native Sandbox integration passed for all five configured cases, native deposits, real FT payout failure and recovery, exact balances, and reserve conservation.
- Charity Sandbox integration passed for all five cases. It excludes pre-activation openings, uses the existing included 5%, handles genuine failed native transfers and retry, pays the treasury exactly once, and preserves earlier fees and player reserves.
- A preserved old native WASM was deployed locally before the new WASM. An existing claimable opening and pool accounting survived the local code upgrade without migration.
- Retained legacy USDI Sandbox integration passed refund, forged-token, concurrency, payout failure, same-draw recovery, and balance-conservation checks.
- The full browser-to-Sandbox flow passed all five cases, automatic return to idle, confirmed-intent cleanup, homepage scene isolation, lost-response refresh recovery, personal/global history, wallet switching, genuine unregistered-token recovery, and 390px sticky navigation/purchase dock checks. Browser error list was empty. The final run after adding rarity particles and homepage recent cards also passed, with no browser runtime errors.

Two prior failed Bamboo Mist receipts were also inspected. Both reused a quote already expired before finalized inclusion. The retry now refreshes authorization while preserving the original nonce; see `docs/native/bamboo-recovery.md`. The earlier SDK name-error wording was not independently reproduced.

## Public Testnet operations

Five case openings through the existing OS keychain signer completed. Both native and token legs were verified from finalized contract records. See `docs/native/evidence/final-polish-live.json` for deposits, gas, nonces, and hashes.

An additional Bamboo Mist purchase used the real Meteor browser approval flow. The displayed call was Testnet `open` on `native-bamboo.needmore_1_near.testnet`, nonce 2, with 0.09096 NEAR attached and 250 Tgas. It paid 0.02 NEAR and 25 SHITZU, showed the verified reward, closed, and returned to idle. Transaction: `CZS6ubJhjnJ7PJRikZ2ebZfHRBf4ciUEp6kjvQhreeR`. Evidence is in `docs/native/evidence/browser-live.json`.

The dedicated charity account `fujitora-paws.needmore_1_near.testnet` was provisioned with 0.1 test NEAR, controlled by the same existing user-retained full-access public key. No new private key was generated or exported. Account creation/funding hash: `7gC8pNMvHLm5BLj2aB81tzQxiDoNTQBfkUQGZMr2hnZB`.

Total game deposits, initial charity account funding, and actual gas: **2.2615062998332318 test NEAR**. This is gross spending; rewards were not deducted from that figure. The shared user-approved ceiling is 15 test NEAR.

The native contract WASM was not deployed publicly. Charity routing was not activated. No accumulated fees were transferred. Exact proposed upgrade and activation operations are in `docs/charity/transactions.review.json` and require explicit owner approval.

## Remaining delivery gates

Feature commit/push, GitHub Actions, verified merge to main, and Railway/public-site checks remain pending until their actual results are recorded. Do not infer deployment from a successful local build.
