# Native fee accounting grounding

## Overview

Each native case is an independent `NativeCasePool` contract. `Economy::fee()` returns `price / 20`, and `contribution()` returns `price / 20 * 19`, with validated prices divisible by 20. Configuration uses microNEAR, scaled into yoctoNEAR by `native()`. The existing 5% comes out of the advertised price; storage is a separate prepaid amount. The fee is neither an extra charge nor a token transfer.

## Runtime flow

`NativeCasePool::open` in `contracts/native-case-pool/src/lib.rs:343` verifies exact price plus opening storage, quote revision and expiry, account nonce, and no active opening. It assigns monotonically increasing `next_id`, stores acceptance height and timestamp, adds the 95% contribution to `pool`, adds the 5% fee to `pending_fees`, and reserves the maximum native reward and every token candidate. No fee vests at this stage.

`resolve_opening` chooses the on-chain reward, then `send_payout` sends only unpaid native/token legs. `on_payout` at line 519 is private, accepts only the matching `Paying` status and attempt, and records each successful leg independently. Only when both legs are paid does it subtract one fee from `pending_fees` and add it to `fees`. It then marks the opening `Completed`. A duplicate or stale callback returns false before touching books. A failed leg stays recoverable in `Claimable`; owner-of-reward-only retries preserve the draw and never resend an already paid leg.

`get_pool` at line 229 exposes `pending_fees` and `treasury_available = fees`, but hardcodes treasury flight to zero. No native treasury withdrawal or treasury-recipient setter exists. The initialization `treasury` is currently only an authorized inventory funder, alongside `owner`; it receives no native fee transfer. Current registry sets both owner and treasury to `needmore_1_near.testnet`.

## Solvency and storage

`available = pool - reserved`; fee money is never available prize liquidity. `book = pool + pending_fees + fees`. `assert_solvent` at line 733 requires liquid native account balance to cover `book - native_reward_in_flight + actual_storage_cost`. Storage is funded by an opening deposit of 4096 bytes, with an admission bound below 3584 newly used bytes. The existing assertion runs on funding and admission, not in `on_payout`; the conservation tests cover payout settlement.

Root Borsh state is the exact ordered fields of `NativeCasePool` at lines 95–113. Child maps use prefixes `n:o`, `n:a`, `n:l`. `Opening` also has a fixed existing Borsh layout and is stored separately. Adding root fields makes old root state unreadable without migration. Adding fields to `Opening` breaks historical child records. The source explicitly has no migration method. A sidecar under a fresh, versioned raw storage key can preserve both old encodings, but its storage must be explicitly funded and its absence must mean disabled, with no write during ordinary upgraded gameplay until activation.

## Future-only charity constraints

1. Activation must require `assert_owner` and an explicitly supplied, separate Testnet treasury. Do not change the existing inventory-funder `treasury` just to add charity.
2. Freeze the activation boundary at current `next_id`. Credit only fees for openings whose IDs are at or above that boundary when they become `Completed`. This excludes both already vested fees and pre-activation accepted-but-unsettled fees. A baseline snapshot of `fees` alone would accidentally include those old pending fees later.
3. Keep charity availability as a subset of `fees`, never of `pool` or `pending_fees`. A withdrawal must prove `0 < amount <= charity_available <= fees`.
4. Before issuing a native transfer, reserve/remove the chosen amount from spendable charity fees and assign an incrementing attempt ID. Allow no second charity transfer while one is unresolved. A private callback must match the attempt and require one result. Success finalizes paid accounting once; failure restores availability once. Unknown outcomes stay locked; never retry based solely on time.
5. Define book/flight conventions consistently. Either keep outgoing charity liability in `book` and subtract it alongside native reward flight in solvency, or remove it from `fees` at scheduling and restore it on failure. Do not count it twice or omit failed-transfer restoration. Expose the flight truthfully in views.
6. A fixed-width sidecar record reduces storage variation across transfers. Fund activation storage plus any maximum flight-record expansion using owner deposit, so a charitable withdrawal cannot consume player storage reserves. Isolate immutable activation and recipient from payout attempt state where it improves auditability.
7. Emit activation, accrual, submitted, success, and failed events with recipient, opening/attempt IDs and exact yoctoNEAR amounts. Persist cumulative paid amount and expose available/in-flight values. Native transfer completion is testnet activity, not evidence of a real donation.
8. Deploying new code and activating this route are separate explicit owner-approved transactions. Existing accrued fees remain in `fees` outside the charity subset. Account provisioning/recovery is an off-contract prerequisite and requires a secure user-retained signer.

## Existing evidence and tests to extend

`contracts/native-case-pool/src/tests.rs` covers exact fee admission, successful completion, repeated callbacks, each failed payout leg, stale quotes and nonces, and concurrent reverse-order settlement. It has no charity or native fee withdrawal tests.

`contracts/integration/src/native.rs::assert_books` checks settled actual native balance >= `pool_funds + treasury_available + pending_fees + storage`, and reconciles actual FT inventory. The native Sandbox run covers all configured cases, genuine unregistered-token failure/retry, protected callbacks, no repeated native payment, history, and reserve solvency. Add actual charity receiver balance deltas and a deliberately failing native transfer, then assert the same books after failure/retry.

The legacy USDI contract offers a useful local pattern: `contracts/case-pool/src/lib.rs::withdraw_treasury` and `on_treasury` use owner auth, one pending transfer, monotonic attempts, private callbacks, and restoration on failure. Adapt the invariants to native transfers, not the token-specific gas/deposit mechanics or the legacy state layout.
