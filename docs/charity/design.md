# Candidate B: retain fee liabilities until transfer settlement

## Problem

The existing native contracts accept an included 5% platform fee and vest it only when both player reward legs succeed. They have no native fee-withdrawal method. Charity routing must preserve existing root and opening Borsh encodings, exclude fees from every opening accepted before activation, and remain solvent while player and charity transfers settle in any order. The existing `treasury` inventory-funder authorization must remain separate from charity configuration.

## Usage

After a separately approved code upgrade and verified user-controlled treasury provisioning, the existing owner calls `activate_charity({ treasury_id })` once with the quoted storage deposit. The owner then reads `get_charity()`. A disabled response means no routing configuration has been stored. An active response identifies the immutable recipient, first eligible opening ID, vested amount available, transfer in flight, and cumulative completed Testnet transfers.

After future openings complete, the owner calls `withdraw_charity({ amount })` with one yoctoNEAR. The contract sends only that amount to its stored recipient. The caller cannot choose a recipient or opening. If a confirmed transfer fails, the view makes the amount available again. A pending transfer cannot be retried based on elapsed time.

```rust
// Existing owner, only after explicit deployment/activation approval.
owner.call(case_id, "activate_charity", json!({"treasury_id": verified_treasury}));

// Read-only public transparency, no owner authorization required.
let status = case.view("get_charity", json!({}));

// Pay only currently available future vested fees, to the immutable recipient.
owner.call(case_id, "withdraw_charity", json!({"amount": available}));
```

## Shape

Keep the exact existing `NativeCasePool` and `Opening` layouts. Add a single private module `charity.rs` with a versioned sidecar under a new raw storage key such as `n:charity:v1`. Absence means disabled and ordinary gameplay performs no charity storage write before activation. Corrupt or unknown-version data must fail closed rather than silently treating the route as disabled.

The core difference from a debit-at-submission design is that `self.fees` continues to include a charity transfer in flight. It decreases only after successful settlement. This preserves the meaning of `book = pool + pending_fees + fees` as unpaid obligations, and makes failure a release of a reservation rather than a restoration of two ledgers.

```rust
#[near(serializers = [borsh])]
struct CharityLedger {
    recipient: AccountId,             // Immutable after activation.
    first_opening_id: u64,            // Snapshot of self.next_id at activation.
    accrued: u128,                   // Only eligible, fully completed openings.
    paid: u128,                      // Confirmed successful native transfers.
    next_attempt: u64,
    transfer: CharityTransfer,
}

#[near(serializers = [borsh])]
enum CharityTransfer {
    Idle,
    InFlight { attempt: u64, amount: u128 },
}

// Private pure functions own checked arithmetic and valid transitions.
impl CharityLedger {
    fn in_flight(&self) -> u128 { todo!() }
    fn available(&self) -> u128 { /* accrued - paid - in_flight */ todo!() }
    fn accrue(&mut self, opening_id: u64, fee: u128) {
        // Called only from existing one-time Completed transition.
        // Credit iff opening_id >= first_opening_id.
        todo!()
    }
    fn reserve(&mut self, amount: u128) -> u64 {
        // Only Idle, amount > 0 and <= available, checked next attempt.
        todo!()
    }
    fn settle(&mut self, attempt: u64, success: bool) -> Option<u128> {
        // Only matching InFlight; duplicates/stale attempts return None.
        // Success increments paid. Either result returns to Idle.
        // Return Some(successfully_paid_amount), zero for confirmed failure.
        todo!()
    }
}

#[near]
impl NativeCasePool {
    #[payable]
    pub fn activate_charity(&mut self, treasury_id: AccountId) { todo!() }
    pub fn get_charity(&self) -> Value { todo!() }
    #[payable]
    pub fn withdraw_charity(&mut self, amount: U128) -> Promise { todo!() }
    #[private]
    pub fn on_charity_transfer(&mut self, attempt: U64) -> bool { todo!() }
}
```

`activate_charity` validates owner authorization, Testnet deployment, a named Testnet recipient, no existing sidecar, and recipient distinct from the case account, owner, and configured reward-token contracts. It records `first_opening_id = self.next_id`. Account existence and user-owned recovery remain explicit pre-activation checks outside this contract. Activation should not attempt a test payment or implicit account creation.

The module keeps persistence private. Public callers coordinate one activation or withdrawal call, not load/reserve/send/save steps. The existing `on_payout` calls `accrue` only in its guarded transition to `Completed`, after the existing fee moves from pending to vested. Its existing status/attempt guard is the source of truth for exactly-once accrual. No per-opening charity map is needed.

### Accounting invariants

Let `C = accrued - paid`, `F = in_flight`, and `A = C - F`.

- `0 <= F <= C <= self.fees`.
- `A` is the only withdrawable charity amount.
- Existing/historical fees equal `self.fees - C`. They are never included in a charity withdrawal.
- Gross book remains `pool + pending_fees + fees`.
- Liquid book during transfers is `gross_book - player_native_in_flight - F`.
- A successful charity callback subtracts its amount from `self.fees` and increments `paid` in the same atomic receipt.
- A confirmed failed callback changes only the transfer reservation to Idle. Neither fees nor paid changes.
- New eligible openings may accrue while a charity transfer is pending. The immutable in-flight amount does not change, and later fees become available without a second outgoing transfer.

`withdraw_charity` requires owner and one yoctoNEAR, loads the ledger, checks `C <= fees`, reserves a positive amount, writes the sidecar, and checks liquid solvency before returning a native `Promise::transfer` followed by its callback. It never modifies pool, player reserves, inventory, randomness, existing treasury authorization, or pending fee accounting.

The callback requires the current contract as predecessor and exactly one promise result. It matches the current attempt before changing anything. Known success settles once. Known failure releases once. An unavailable/unknown result must panic or remain locked, never infer failure or trigger a retry. Use a dedicated native-transfer callback rather than copying FT-specific assumptions. If the callback itself fails, funds stay reserved and cannot be duplicated; recovery requires inspecting the actual receipt before a separately designed, owner-approved repair. Reserve adequate static callback gas and keep callback work bounded.

Update `assert_solvent`, `get_pool.expected_balance_min`, `get_pool.expected_balance_max`, `treasury_available`, and `treasury_in_flight` together. `treasury_available = fees - F`, while `treasury_in_flight = F`. Existing settled-balance checks remain unchanged at quiescence; new in-flight tests must include `F`. No ordinary legacy fee payout API is added.

### Storage funding

The enum grows from Idle to InFlight. Activation must charge for the raw key and maximum serialized record, including a 64-byte account ID and the largest transfer variant, at the actual `env::storage_byte_cost()`. Determine the cost using the serialized target record length plus key bytes and NEAR trie overhead measured by `env::storage_usage()` in the actual activation receipt. Charge the actual Idle storage delta plus the exact pending-variant expansion, with a bounded documented overhead reserve if runtime charging requires it. Refund only deposits above that maximum funded reserve. Keep the unused expansion funding on the account, outside fee or pool books, until a transfer allocates those bytes. This makes the first charity transfer independent of player-paid storage reserves. Alternatively pad Idle to the same encoded size as InFlight, but that adds a custom encoding burden without reducing the public API.

No state-migration entrypoint is needed because existing encodings do not change. The WASM upgrade still requires explicit approval and must first pass a live-state compatibility test in Sandbox.

### Audit events

Emit `charity_activated` with recipient and first eligible opening ID, `charity_fee_vested` with opening ID and exact fee, `charity_transfer_submitted` with attempt and amount, and `charity_transfer_completed` or `charity_transfer_failed` with attempt, recipient, and amount. Use the repository's existing event wrapper and string-encode yoctoNEAR amounts. Views expose Testnet status and do not claim a real-world donation.

## Synthesis decision

This is an independent candidate. Parent synthesis and cross-judge have not selected it.

## Tradeoffs accepted

- We accept a new liquid-solvency subtraction in exchange for failure callbacks that never reconstruct fee balances.
- We accept one unresolved charity transfer per case in exchange for bounded storage and simple duplicate protection.
- We accept an immutable recipient and one-time activation in exchange for preventing silent rerouting. Key recovery must be proven before activation.
- We accept leaving unknown outcomes locked in exchange for never paying the same transfer twice.

## Alternatives considered

1. Debit `fees` and available charity funds at submission, then restore both on failure. This leaves existing `book()` untouched and is viable, but failure restoration coordinates two balances; a missed restoration or duplicated callback can create lost or duplicate accounting. The retained-liability approach derives availability and changes actual fee balance only on proven success.
2. Append charity fields to `NativeCasePool` and add a root-state migration. This centralizes storage but requires a second root type, explicit migration authority, and proof every old child record remains readable. A sidecar avoids touching the deployed encodings and exposes a smaller upgrade operation.
3. Auto-transfer every fee directly from player payout settlement. This couples player payout completion to charity availability and produces a separate external transfer per opening. Batched owner withdrawals isolate failure and use less gas.
4. Route based on the vested-fee balance at activation. This is incorrect because pre-activation accepted openings can settle later. An opening-ID boundary is required.

## Verification

Unit tests must cover disabled upgrades with no sidecar write; one-time owner activation; insufficient storage deposit rollback; non-owner/malformed recipient rejection; pre-activation completed and pending openings excluded; post-activation partial player payouts not accrued until both legs succeed; duplicate player callbacks not accruing twice; mixed-order settlements; exact 5% inclusion with no extra fee; oversized/zero withdrawals; concurrent withdrawal rejection; successful callback; failed callback release; duplicate/stale/private callback rejection; new fees accruing during flight; arithmetic overflow; and serialized root/old-opening compatibility.

Sandbox tests must deploy the preserved old WASM, create vested fees and at least one unsettled opening, snapshot root-derived views and history, upgrade to the candidate WASM without migration, and prove all existing views/recovery still work before activation. Provision an ephemeral treasury, activate routing, complete the old opening and exclude its fee, then open a new case and settle it. Compare treasury actual balance before/after one withdrawal with the exact eligible fee. Confirm legacy fee balance, reward books, actual token inventory and player balances remain conserved. Test a genuine failed native transfer using a non-existent named receiver in an isolated contract fixture, then create that exact receiver in Sandbox and retry once. Verify receiver gets the amount once and failure/success events match. Repeat withdrawal/callback attempts and assert no additional transfer.

A failed-receiver fixture uses a separately initialized case with that recipient; do not add recipient-mutating test hooks to production. Do not bypass normal account authorization or callbacks. Test gas costs and storage allocation through actual receipts.

## Open questions and risks

- Which dedicated Testnet account has verified user-controlled recovery before the activation transaction is prepared?
- Can the current contract-account upgrade authority execute the reviewed WASM deployment securely, separately from routine game-testing authorization?
- If callback execution itself fails after a successful transfer, should a future explicit recovery protocol be designed, or should this release keep such transfers locked for owner investigation? This candidate chooses locked safety.

These questions block activation/deployment, not implementation or Sandbox testing.

## Next implementation step

Write unit tests for the old-pending-opening exclusion and retained-fee in-flight invariants, then implement the private ledger and sidecar methods without altering either deployed Borsh type.

## Final synthesis

Use candidate B's accrued/paid/flight ledger, keeping gross fees until successful settlement. Both independent candidates converged on a versioned raw-storage sidecar, an immutable recipient, a next-opening-ID activation boundary, and one attempt-bound transfer. The cross-judge also selected B. Deriving availability avoids a second mutable available balance.

Graft candidate A's exact 512-byte storage reserve and public `charity_storage_cost` quote. Prove the largest serialized record fits, and test actual storage use in Sandbox. Check current solvency before creating a new flight reservation, as the cross-judge identified. Keep unknown callback outcomes locked. Handle native transfer results directly, without FT return-size success heuristics.

The owner must separately approve code upgrades and charity activation. No existing fees move. Treasury provisioning and recovery must be verified before an activation transaction is proposed. The preserved pre-change native WASM is `/private/tmp/fujitora-native-before-charity.wasm`, SHA256 `173736c8b20a7a02713ff49195ec4001875a1209bd83709701f4418376b8854a`.

Verification is pending implementation, unit tests, storage-bound checks, old-WASM compatibility, and real Sandbox native-transfer failure/retry tests. Do not deploy this preparation based on design review alone.
