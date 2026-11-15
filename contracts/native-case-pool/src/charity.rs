use super::*;

const KEY: &[u8] = b"n:charity:v1";
const STORAGE_BYTES: u128 = 512;

#[near(serializers = [borsh])]
#[derive(Clone, Copy)]
enum Transfer {
    Idle,
    InFlight { attempt: u64, amount: u128 },
}

/// Kept outside the deployed root and Opening Borsh encodings.
#[near(serializers = [borsh])]
struct Ledger {
    recipient: AccountId,
    first_opening_id: u64,
    accrued: u128,
    paid: u128,
    last_attempt: u64,
    transfer: Transfer,
}
impl Ledger {
    fn flight(&self) -> u128 {
        match self.transfer {
            Transfer::Idle => 0,
            Transfer::InFlight { amount, .. } => amount,
        }
    }
    fn outstanding(&self) -> u128 { sub(self.accrued, self.paid) }
    fn available(&self) -> u128 { sub(self.outstanding(), self.flight()) }
    fn save(&self) {
        let bytes = near_sdk::borsh::to_vec(self).expect("Charity encoding");
        require!(bytes.len() + KEY.len() <= STORAGE_BYTES as usize, "Charity storage bound");
        env::storage_write(KEY, &bytes);
    }
}
fn load() -> Option<Ledger> {
    env::storage_read(KEY).map(|bytes| {
        near_sdk::borsh::from_slice(&bytes).expect("Invalid charity ledger")
    })
}
pub(super) fn in_flight() -> u128 { load().map_or(0, |ledger| ledger.flight()) }
pub(super) fn credit_completed(opening_id: u64, fee: u128) {
    if let Some(mut ledger) = load() {
        if opening_id >= ledger.first_opening_id {
            ledger.accrued = add(ledger.accrued, fee);
            ledger.save();
            event("charity_fee_vested", json!({"opening_id":opening_id.to_string(),"amount":fee.to_string(),"treasury_id":ledger.recipient}));
        }
    }
}

#[ext_contract(ext_charity)]
#[allow(dead_code)]
trait CharityCallback {
    fn on_charity_transfer(&mut self, attempt: U64) -> bool;
}

#[near]
impl NativeCasePool {
    pub fn charity_storage_cost(&self) -> U128 {
        U128(env::storage_byte_cost().as_yoctonear().checked_mul(STORAGE_BYTES).expect("Storage cost overflow"))
    }

    #[payable]
    pub fn activate_charity(&mut self, treasury_id: AccountId) {
        self.assert_owner();
        require!(load().is_none(), "Charity already activated");
        require!(env::current_account_id().as_str().ends_with(".testnet"), "Testnet only");
        require!(treasury_id.as_str().ends_with(".testnet") &&
            treasury_id != env::current_account_id() && treasury_id != self.owner &&
            treasury_id != self.treasury &&
            !self.config().bonus_rewards.iter().any(|reward| reward.token_contract_id == treasury_id),
            "Separate Testnet charity treasury required");
        require!(env::attached_deposit().as_yoctonear() == self.charity_storage_cost().0,
            "Attach exact charity storage cost");
        self.assert_solvent();
        let before = env::storage_usage();
        let ledger = Ledger {
            recipient: treasury_id.clone(), first_opening_id: self.next_id,
            accrued: 0, paid: 0, last_attempt: 0, transfer: Transfer::Idle,
        };
        ledger.save();
        require!(u128::from(env::storage_usage() - before) + 24 <= STORAGE_BYTES,
            "Charity storage bound");
        self.assert_solvent();
        event("charity_activated", json!({"treasury_id":treasury_id,"first_opening_id":self.next_id.to_string(),"storage_deposit":self.charity_storage_cost().0.to_string()}));
    }

    pub fn get_charity(&self) -> Option<Value> {
        load().map(|ledger| {
            require!(ledger.outstanding() <= self.fees, "Charity exceeds vested fees");
            json!({"network":"testnet","treasury_id":ledger.recipient,
                "first_opening_id":ledger.first_opening_id.to_string(),
                "available":ledger.available().to_string(),"in_flight":ledger.flight().to_string(),
                "total_accrued":ledger.accrued.to_string(),"total_paid":ledger.paid.to_string(),
                "retained_legacy_fees":sub(self.fees,ledger.outstanding()).to_string(),
                "last_attempt":ledger.last_attempt.to_string()})
        })
    }

    #[payable]
    pub fn withdraw_charity(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        assert_one_yocto();
        let mut ledger = load().expect("Charity not activated");
        require!(matches!(ledger.transfer, Transfer::Idle), "Charity transfer pending");
        require!(amount.0 > 0 && amount.0 <= ledger.available() && ledger.outstanding() <= self.fees,
            "Insufficient charity fees");
        // Check the pre-transfer balance before a new flight reduces the liquid book.
        self.assert_solvent();
        ledger.last_attempt = ledger.last_attempt.checked_add(1).expect("Attempt overflow");
        let attempt = ledger.last_attempt;
        ledger.transfer = Transfer::InFlight { attempt, amount: amount.0 };
        ledger.save();
        event("charity_transfer_submitted", json!({"treasury_id":ledger.recipient,"attempt":attempt.to_string(),"amount":amount.0.to_string()}));
        Promise::new(ledger.recipient).transfer(NearToken::from_yoctonear(amount.0))
            .then(ext_charity::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_charity_transfer(U64(attempt)))
    }

    #[private]
    pub fn on_charity_transfer(&mut self, attempt: U64) -> bool {
        self.assert_private();
        let Some(mut ledger) = load() else { return false; };
        let Transfer::InFlight { attempt: current, amount } = ledger.transfer else { return false; };
        if current != attempt.0 { return false; }
        require!(env::promise_results_count() == 1, "Unexpected charity result count");
        let success = match env::promise_result_checked(0, 0) {
            Ok(_) => true,
            Err(near_sdk::PromiseError::Failed) => false,
            Err(_) => env::panic_str("Unknown charity transfer result"),
        };
        if success {
            self.fees = sub(self.fees, amount);
            ledger.paid = add(ledger.paid, amount);
        }
        ledger.transfer = Transfer::Idle;
        ledger.save();
        event(if success { "charity_transfer_completed" } else { "charity_transfer_failed" },
            json!({"treasury_id":ledger.recipient,"attempt":attempt.0.to_string(),"amount":amount.to_string()}));
        success
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn largest_ledger_fits_owner_funded_storage_reserve() {
        let ledger = Ledger {
            recipient: format!("{}.testnet", "a".repeat(56)).parse().unwrap(),
            first_opening_id: u64::MAX, accrued: u128::MAX, paid: 0,
            last_attempt: u64::MAX,
            transfer: Transfer::InFlight { attempt: u64::MAX, amount: u128::MAX },
        };
        assert!(near_sdk::borsh::to_vec(&ledger).unwrap().len() + KEY.len() + 40 <= STORAGE_BYTES as usize);
    }
}
