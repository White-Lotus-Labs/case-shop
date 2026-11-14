//! Fresh-account native NEAR case contract. Deliberately has no legacy migration.
use iroh_economics::{DENOMINATOR, configured::Economy};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, assert_one_yocto, env,
    ext_contract, near, require,
};

/// Config economics are microNEAR; every public monetary amount is yoctoNEAR.
const SCALE: u128 = 1_000_000_000_000_000_000;
const OPENING_BYTES: u128 = 4096;
const DRAW_GAS: Gas = Gas::from_tgas(100);
const TRANSFER_GAS: Gas = Gas::from_tgas(25);
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const TIERS: [&str; 3] = ["Common", "Rare", "Legendary"];

#[ext_contract(ext_token)]
#[allow(dead_code)]
trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
#[ext_contract(ext_self)]
#[allow(dead_code)]
trait Callbacks {
    fn resolve_opening(&mut self, opening_id: U64) -> bool;
    fn on_payout(&mut self, opening_id: U64, attempt: U64) -> bool;
}

#[near(serializers = [json])]
#[derive(Clone)]
#[serde(deny_unknown_fields)]
pub struct CaseConfig {
    pub case_id: String,
    pub name: String,
    pub economy: Economy,
    pub bonus_rewards: Vec<TokenReward>,
}
#[near(serializers = [json])]
#[derive(Clone)]
#[serde(deny_unknown_fields)]
pub struct TokenReward {
    pub token_contract_id: AccountId,
    pub token_symbol: String,
    pub display_name: String,
    pub token_decimals: u8,
    pub amount: U128,
    pub tier: u8,
}
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct Inventory {
    funds: u128,
    reserved: u128,
    in_flight: u128,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    RandomnessPending,
    Paying,
    Claimable,
    Completed,
}
#[near(serializers = [borsh])]
#[derive(Clone)]
struct Opening {
    id: u64,
    account: AccountId,
    nonce: u64,
    previous: Option<u64>,
    accepted_height: u64,
    accepted_timestamp: u64,
    revision: u64,
    odds: [u32; 3],
    status: Status,
    reward: Option<u128>,
    draw: Option<u32>,
    attempt: u64,
    bonus: Option<u8>,
    near_paid: bool,
    bonus_paid: bool,
}
#[near(serializers = [json])]
#[serde(deny_unknown_fields)]
pub struct Authorization {
    pub revision: U64,
    pub expires_at: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NativeCasePool {
    owner: AccountId,
    treasury: AccountId,
    config_json: Vec<u8>,
    inventory: Vec<Inventory>,
    pool: u128,
    reserved: u128,
    pending_fees: u128,
    fees: u128,
    in_flight: u128,
    total_paid: u128,
    completed: u64,
    pending: u32,
    paused: bool,
    revision: u64,
    next_id: u64,
    openings: LookupMap<u64, Opening>,
    active: LookupMap<AccountId, u64>,
    latest: LookupMap<AccountId, u64>,
}

#[near]
impl NativeCasePool {
    /// Deploy only to new accounts. Init must be signed by the contract account.
    #[init]
    #[private]
    pub fn new(owner_id: AccountId, treasury_id: AccountId, config: CaseConfig) -> Self {
        require!(
            env::current_account_id().as_str().ends_with(".testnet"),
            "Testnet only"
        );
        require!(
            owner_id.as_str().ends_with(".testnet") && treasury_id.as_str().ends_with(".testnet"),
            "Testnet administrators required"
        );
        require!(
            owner_id != env::current_account_id() && treasury_id != env::current_account_id(),
            "Separate administrators required"
        );
        require!(
            (3..=48).contains(&config.case_id.len())
                && config
                    .case_id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
            "Invalid case ID"
        );
        require!(
            !config.name.is_empty() && config.name.len() <= 96,
            "Invalid case name"
        );
        if let Err(message) = config.economy.validate() {
            env::panic_str(message);
        }
        // This bound makes yoctoNEAR scaling and all probability arithmetic total.
        require!(
            config.economy.target <= 1_000_000_000_000 && config.economy.price <= 1_000_000_000_000,
            "Native economy too large"
        );
        require!(
            (3..=24).contains(&config.bonus_rewards.len()),
            "Three to 24 token rewards required"
        );
        for (index, reward) in config.bonus_rewards.iter().enumerate() {
            require!(
                reward.tier < 3 && reward.amount.0 > 0 && reward.amount.0 <= 10u128.pow(36),
                "Invalid reward amount or tier"
            );
            require!(
                reward.token_decimals <= 24
                    && !reward.token_symbol.is_empty()
                    && reward.token_symbol.len() <= 16
                    && reward
                        .token_symbol
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric())
                    && !reward.display_name.is_empty()
                    && reward.display_name.len() <= 96,
                "Invalid reward metadata"
            );
            require!(
                reward.token_contract_id.as_str().ends_with(".testnet")
                    && reward.token_contract_id != env::current_account_id()
                    && !config.bonus_rewards[..index]
                        .iter()
                        .any(|r| r.token_contract_id == reward.token_contract_id),
                "Distinct Testnet reward contracts required"
            );
        }
        require!(
            (0..3).all(|tier| config.bonus_rewards.iter().any(|r| r.tier == tier)),
            "Every tier needs a token reward"
        );
        Self {
            owner: owner_id,
            treasury: treasury_id,
            inventory: vec![Inventory::default(); config.bonus_rewards.len()],
            config_json: near_sdk::serde_json::to_vec(&config).expect("Configuration serializes"),
            pool: 0,
            reserved: 0,
            pending_fees: 0,
            fees: 0,
            in_flight: 0,
            total_paid: 0,
            completed: 0,
            pending: 0,
            paused: true,
            revision: 0,
            next_id: 0,
            openings: LookupMap::new(b"n:o".to_vec()),
            active: LookupMap::new(b"n:a".to_vec()),
            latest: LookupMap::new(b"n:l".to_vec()),
        }
    }

    pub fn get_case(&self) -> Value {
        let c = self.config();
        let rewards: Vec<_> = c.economy.rewards.iter().enumerate().map(|(tier, amount)| json!({
            "reward_id":format!("near-{}",TIERS[tier].to_ascii_lowercase()), "token_contract_id":"NEAR",
            "token_symbol":"NEAR", "token_decimals":24,"amount":native(*amount).to_string(),
            "display_name":"Testnet NEAR","tier":TIERS[tier]})).collect();
        json!({"case_id":c.case_id,"name":c.name,"payment_asset":"NEAR","contract_version":"native-v1",
            "token_id":"NEAR","price":native(c.economy.price).to_string(),
            "pool_contribution":native(c.economy.contribution()).to_string(),"platform_fee":native(c.economy.fee()).to_string(),
            "target":native(c.economy.target).to_string(),"probability_denominator":DENOMINATOR,"rewards":rewards,
            "bonus_rewards":self.get_reward_inventory(),"token_reward_required":true,
            "randomness":"NEAR protocol randomness; Testnet demonstration, not production-grade VRF",
            "quote_policy":"Exact revision and deposit; failed calls refund their attached deposit", "history_pagination":true})
    }
    pub fn get_reward_inventory(&self) -> Vec<Value> {
        (0..self.inventory.len())
            .map(|i| self.entry_view(i))
            .collect()
    }
    pub fn get_pool(&self) -> Value {
        let c = self.config();
        json!({"payment_asset":"NEAR","pool_funds":self.pool.to_string(),"reserved_rewards":self.reserved.to_string(),
            "available":self.available().to_string(),"target":native(c.economy.target).to_string(),
            "health":c.economy.health(self.available()/SCALE),"pending_fees":self.pending_fees.to_string(),
            "treasury_available":self.fees.to_string(),"treasury_in_flight":"0","in_flight_payouts":self.in_flight.to_string(),
            "pending_openings":self.pending,"completed_payouts":self.completed.to_string(),"total_paid":self.total_paid.to_string(),
            "revision":self.revision.to_string(),"paused":self.paused,"can_open":self.admission_error().is_none(),
            "storage_per_opening":Self::opening_cost().to_string(),"storage_account_cost":"0",
            "expected_balance_min":sub(self.book(),self.in_flight).to_string(),"expected_balance_max":self.book().to_string()})
    }
    pub fn get_quote(&self, account_id: AccountId) -> Value {
        let c = self.config();
        let odds = c.economy.distribution(self.available() / SCALE);
        let error = self.admission_error().or_else(|| {
            if self.active.get(&account_id).is_some() {
                Some("Finish the pending opening first")
            } else {
                None
            }
        });
        json!({"case_id":c.case_id,"payment_asset":"NEAR","revision":self.revision.to_string(),
            "expires_at":env::block_height().checked_add(120).expect("Height overflow").to_string(),
            "nonce":self.next_nonce(&account_id).to_string(),"common":odds.common,"rare":odds.rare,"legendary":odds.legendary,
            "denominator":DENOMINATOR,"target_ev":native(odds.target_ev).to_string(),
            "expected_numerator":native(odds.expected_numerator_for(c.economy.rewards)).to_string(),
            "available":self.available().to_string(),"price":native(c.economy.price).to_string(),
            "storage_deposit":Self::opening_cost().to_string(),"required_deposit":add(native(c.economy.price),Self::opening_cost()).to_string(),
            "can_open":error.is_none(),"reason":error})
    }
    pub fn get_opening(&self, opening_id: U64) -> Option<Value> {
        self.openings
            .get(&opening_id.0)
            .map(|o| self.opening_view(&o))
    }
    pub fn get_account_opening(&self, account_id: AccountId) -> Option<Value> {
        self.active
            .get(&account_id)
            .and_then(|id| self.openings.get(&id))
            .map(|o| self.opening_view(&o))
    }
    pub fn get_history(&self, account_id: AccountId, limit: u32) -> Vec<Value> {
        let mut id = self.latest.get(&account_id);
        let mut rows = Vec::new();
        for _ in 0..limit.min(50) {
            let Some(o) = id.and_then(|id| self.openings.get(&id)) else {
                break;
            };
            id = o.previous;
            rows.push(self.opening_view(&o));
        }
        rows
    }
    /// Cursor is inclusive and always bound to the requested account.
    pub fn get_history_page(
        &self,
        account_id: AccountId,
        before_opening_id: Option<U64>,
        limit: u32,
    ) -> Value {
        require!((1..=50).contains(&limit), "Limit must be 1 to 50");
        let mut id = before_opening_id
            .map(|id| id.0)
            .or_else(|| self.latest.get(&account_id));
        let mut rows = Vec::new();
        for _ in 0..limit {
            let Some(o) = id.and_then(|id| self.openings.get(&id)) else {
                break;
            };
            require!(
                o.account == account_id,
                "History cursor belongs to another account"
            );
            id = o.previous;
            rows.push(self.opening_view(&o));
        }
        json!({"openings":rows,"next_cursor":id.map(|id|id.to_string())})
    }
    /// Global contract history needs no third-party indexer and includes pending rows.
    pub fn get_global_history_page(&self, before_opening_id: Option<U64>, limit: u32) -> Value {
        require!((1..=50).contains(&limit), "Limit must be 1 to 50");
        let mut id = before_opening_id
            .map(|id| id.0)
            .or_else(|| self.next_id.checked_sub(1));
        if let Some(cursor) = id {
            require!(cursor < self.next_id, "Unknown history cursor");
        }
        let mut rows = Vec::new();
        for _ in 0..limit {
            let Some(next) = id else { break };
            let o = self.openings.get(&next).expect("Contiguous history");
            rows.push(self.opening_view(&o));
            id = next.checked_sub(1);
        }
        json!({"openings":rows,"next_cursor":id.map(|id|id.to_string()),"source":"Finalized case contract"})
    }
    #[payable]
    pub fn fund_pool(&mut self) {
        self.assert_funder();
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Positive native funding required");
        self.pool = add(self.pool, amount);
        self.bump();
        self.assert_solvent();
        event("pool_funded", json!({"amount":amount.to_string()}));
    }
    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        assert_one_yocto();
        self.assert_owner();
        self.paused = paused;
        self.bump();
    }
    #[payable]
    pub fn open(&mut self, nonce: U64, quote: Authorization) -> U64 {
        require!(
            env::prepaid_gas() >= Gas::from_tgas(150),
            "Attach at least 150 Tgas"
        );
        let account = env::predecessor_account_id();
        let now = env::block_height();
        require!(
            self.admission_error().is_none(),
            self.admission_error().unwrap_or("Unavailable")
        );
        require!(
            self.active.get(&account).is_none(),
            "Finish pending opening first"
        );
        require!(
            nonce.0 == self.next_nonce(&account),
            "Duplicate or stale opening nonce"
        );
        require!(
            quote.revision.0 == self.revision
                && quote.expires_at.0 >= now
                && quote.expires_at.0 <= now.saturating_add(300),
            "Stale quote"
        );
        let c = self.config();
        require!(
            env::attached_deposit().as_yoctonear()
                == add(native(c.economy.price), Self::opening_cost()),
            "Attach exact price plus opening storage"
        );
        let storage_before = env::storage_usage();
        let odds = c.economy.distribution(self.available() / SCALE);
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).expect("ID overflow");
        let o = Opening {
            id,
            account: account.clone(),
            nonce: nonce.0,
            previous: self.latest.get(&account),
            accepted_height: now,
            accepted_timestamp: env::block_timestamp(),
            revision: self.revision,
            odds: [odds.common, odds.rare, odds.legendary],
            status: Status::RandomnessPending,
            reward: None,
            draw: None,
            attempt: 0,
            bonus: None,
            near_paid: false,
            bonus_paid: false,
        };
        self.pool = add(self.pool, native(c.economy.contribution()));
        self.pending_fees = add(self.pending_fees, native(c.economy.fee()));
        self.reserved = add(self.reserved, native(c.economy.rewards[2]));
        for (state, reward) in self.inventory.iter_mut().zip(c.bonus_rewards) {
            state.reserved = add(state.reserved, reward.amount.0);
        }
        require!(
            self.pool >= self.reserved,
            "Maximum reward reserve insufficient"
        );
        self.pending = self.pending.checked_add(1).expect("Pending overflow");
        self.openings.insert(&id, &o);
        self.active.insert(&account, &id);
        self.latest.insert(&account, &id);
        require!(
            u128::from(env::storage_usage().saturating_sub(storage_before)) <= OPENING_BYTES - 512,
            "Opening exceeded prepaid storage"
        );
        self.bump();
        self.assert_solvent();
        self.schedule_draw(id);
        event("opening_accepted", self.opening_view(&o));
        U64(id)
    }
    #[payable]
    pub fn advance_opening(&mut self, opening_id: U64) {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(150),
            "Attach at least 150 Tgas"
        );
        let o = self.openings.get(&opening_id.0).expect("Unknown opening");
        require!(
            o.account == env::predecessor_account_id(),
            "Only opening owner can advance"
        );
        require!(
            o.status == Status::RandomnessPending,
            "Draw already selected"
        );
        self.schedule_draw(o.id);
    }
    #[payable]
    pub fn retry_payout(&mut self, opening_id: U64) {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= Gas::from_tgas(100),
            "Attach at least 100 Tgas"
        );
        let mut o = self.openings.get(&opening_id.0).expect("Unknown opening");
        require!(
            o.account == env::predecessor_account_id(),
            "Only reward owner can retry"
        );
        require!(
            o.status == Status::Claimable,
            "Only confirmed failure can retry"
        );
        self.send_payout(&mut o);
    }
    #[private]
    pub fn resolve_opening(&mut self, opening_id: U64) -> bool {
        self.assert_private();
        let Some(mut o) = self.openings.get(&opening_id.0) else {
            return false;
        };
        if o.status != Status::RandomnessPending || env::block_height() <= o.accepted_height {
            return false;
        }
        let Some(draw) = randomness(
            o.id,
            o.accepted_height,
            u64::from(DENOMINATOR),
            b"native:draw:v1",
        ) else {
            return false;
        };
        let draw = draw as u32;
        let tier = if draw < o.odds[0] {
            0
        } else if draw < o.odds[0] + o.odds[1] {
            1
        } else {
            2
        };
        let c = self.config();
        let candidates: Vec<usize> = c
            .bonus_rewards
            .iter()
            .enumerate()
            .filter_map(|(i, r)| {
                if usize::from(r.tier) == tier {
                    Some(i)
                } else {
                    None
                }
            })
            .collect();
        let Some(candidate) = randomness(
            o.id,
            o.accepted_height,
            candidates.len() as u64,
            b"native:token:v1",
        ) else {
            return false;
        };
        let selected = candidates[candidate as usize];
        let reward = native(c.economy.rewards[tier]);
        for (index, state) in self.inventory.iter_mut().enumerate() {
            if index != selected {
                state.reserved = sub(state.reserved, c.bonus_rewards[index].amount.0);
            }
        }
        self.reserved = sub(self.reserved, sub(native(c.economy.rewards[2]), reward));
        o.reward = Some(reward);
        o.draw = Some(draw);
        o.bonus = Some(selected as u8);
        o.status = Status::Claimable;
        self.bump();
        event("reward_selected", self.opening_view(&o));
        self.send_payout(&mut o);
        true
    }
    #[private]
    pub fn on_payout(&mut self, opening_id: U64, attempt: U64) -> bool {
        self.assert_private();
        let Some(mut o) = self.openings.get(&opening_id.0) else {
            return false;
        };
        if o.status != Status::Paying || o.attempt != attempt.0 {
            return false;
        }
        let near_due = !o.near_paid;
        let token_due = !o.bonus_paid;
        require!(
            env::promise_results_count() == u64::from(near_due) + u64::from(token_due),
            "Unexpected result count"
        );
        if near_due {
            let amount = o.reward.expect("Selected reward");
            self.in_flight = sub(self.in_flight, amount);
            if transfer_succeeded(0) {
                self.pool = sub(self.pool, amount);
                self.reserved = sub(self.reserved, amount);
                self.total_paid = add(self.total_paid, amount);
                o.near_paid = true;
            }
        }
        if token_due {
            let index = usize::from(o.bonus.expect("Selected token"));
            let amount = self.config().bonus_rewards[index].amount.0;
            let state = &mut self.inventory[index];
            state.in_flight = sub(state.in_flight, amount);
            if transfer_succeeded(u64::from(near_due)) {
                state.funds = sub(state.funds, amount);
                state.reserved = sub(state.reserved, amount);
                o.bonus_paid = true;
            }
        }
        let complete = o.near_paid && o.bonus_paid;
        o.status = if complete {
            let fee = native(self.config().economy.fee());
            self.pending_fees = sub(self.pending_fees, fee);
            self.fees = add(self.fees, fee);
            self.completed = self.completed.checked_add(1).expect("Count overflow");
            self.pending = self.pending.checked_sub(1).expect("Pending underflow");
            self.active.remove(&o.account);
            Status::Completed
        } else {
            Status::Claimable
        };
        self.openings.insert(&o.id, &o);
        self.bump();
        event(
            if complete {
                "payout_completed"
            } else {
                "payout_failed"
            },
            self.opening_view(&o),
        );
        complete
    }
}

#[near]
impl FungibleTokenReceiver for NativeCasePool {
    /// FT transfers only fund reward inventory; they can never purchase an opening.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if (sender_id != self.owner && sender_id != self.treasury)
            || amount.0 == 0
            || msg.len() > 128
            || near_sdk::serde_json::from_str::<Value>(&msg).ok() != Some(json!({"action":"fund"}))
        {
            return PromiseOrValue::Value(amount);
        }
        let c = self.config();
        let predecessor = env::predecessor_account_id();
        let Some(index) = c
            .bonus_rewards
            .iter()
            .position(|r| r.token_contract_id == predecessor)
        else {
            return PromiseOrValue::Value(amount);
        };
        let Some(funds) = self.inventory[index].funds.checked_add(amount.0) else {
            return PromiseOrValue::Value(amount);
        };
        self.inventory[index].funds = funds;
        self.bump();
        event(
            "token_funded",
            json!({"token_contract_id":predecessor,"amount":amount.0.to_string()}),
        );
        PromiseOrValue::Value(U128(0))
    }
}
impl NativeCasePool {
    fn config(&self) -> CaseConfig {
        near_sdk::serde_json::from_slice(&self.config_json).expect("Stored config")
    }
    fn available(&self) -> u128 {
        sub(self.pool, self.reserved)
    }
    fn book(&self) -> u128 {
        add(add(self.pool, self.pending_fees), self.fees)
    }
    fn opening_cost() -> u128 {
        env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(OPENING_BYTES)
            .expect("Storage overflow")
    }
    fn next_nonce(&self, account: &AccountId) -> u64 {
        self.latest
            .get(account)
            .and_then(|id| self.openings.get(&id))
            .map_or(0, |o| o.nonce.checked_add(1).expect("Nonce overflow"))
    }
    fn admission_error(&self) -> Option<&'static str> {
        if self.paused {
            return Some("Case paused");
        };
        let c = self.config();
        if self.available() < native(c.economy.rewards[2]) {
            return Some("Fund native maximum reward reserve");
        };
        if self
            .inventory
            .iter()
            .zip(c.bonus_rewards.iter())
            .any(|(s, r)| sub(s.funds, s.reserved) < r.amount.0)
        {
            return Some("Fund configured token inventory");
        };
        let limit = match c.economy.health(self.available() / SCALE) {
            iroh_economics::Health::Healthy => 64,
            iroh_economics::Health::Caution => 16,
            iroh_economics::Health::Critical => 4,
        };
        if self.pending >= limit {
            return Some("Pool concurrency limit reached");
        };
        None
    }
    fn entry_view(&self, index: usize) -> Value {
        let c = self.config();
        let r = &c.bonus_rewards[index];
        let s = &self.inventory[index];
        let candidates = c
            .bonus_rewards
            .iter()
            .filter(|other| other.tier == r.tier)
            .count();
        json!({"reward_id":format!("token-{}-{}",r.token_symbol.to_ascii_lowercase(),index),"token_contract_id":r.token_contract_id,
            "token_symbol":r.token_symbol,"display_name":r.display_name,"token_decimals":r.token_decimals,"amount":r.amount.0.to_string(),"tier":TIERS[usize::from(r.tier)],
            "chance_in_tier_bps":10000,"candidates_in_tier":candidates,"selection_denominator":candidates,"available":sub(s.funds,s.reserved).to_string(),
            "reserved":s.reserved.to_string(),"in_flight":s.in_flight.to_string(),"funds":s.funds.to_string(),
            "expected_balance_min":sub(s.funds,s.in_flight).to_string(),"expected_balance_max":s.funds.to_string(),"testnet":true})
    }
    fn opening_view(&self, o: &Opening) -> Value {
        let c = self.config();
        json!({"case_id":c.case_id,"case_name":c.name,"payment_asset":"NEAR",
            "tier":o.draw.map(|draw|TIERS[if draw<o.odds[0]{0}else if draw<o.odds[0]+o.odds[1]{1}else{2}]),
            "opening_id":o.id.to_string(),"account_id":o.account,"nonce":o.nonce.to_string(),"accepted_height":o.accepted_height.to_string(),
            "accepted_timestamp":o.accepted_timestamp.to_string(),"accepted_revision":o.revision.to_string(),"common":o.odds[0],"rare":o.odds[1],"legendary":o.odds[2],"denominator":DENOMINATOR,
            "status":o.status,"reward":o.reward.map(|n|n.to_string()),"draw":o.draw,"attempt":o.attempt.to_string(),"near_paid":o.near_paid,"bonus_paid":o.bonus_paid,
            "bonus":o.bonus.map(|index|self.entry_view(usize::from(index))),"reserved":if o.near_paid{"0".into()}else{o.reward.unwrap_or(native(c.economy.rewards[2])).to_string()}})
    }
    fn schedule_draw(&self, id: u64) {
        ext_self::ext(env::current_account_id())
            .with_static_gas(DRAW_GAS)
            .resolve_opening(U64(id))
            .detach();
    }
    fn send_payout(&mut self, o: &mut Opening) {
        require!(o.status == Status::Claimable, "Reward not claimable");
        o.attempt = o.attempt.checked_add(1).expect("Attempt overflow");
        o.status = Status::Paying;
        let mut promise = None;
        if !o.near_paid {
            let amount = o.reward.expect("Selected reward");
            self.in_flight = add(self.in_flight, amount);
            promise =
                Some(Promise::new(o.account.clone()).transfer(NearToken::from_yoctonear(amount)));
        }
        if !o.bonus_paid {
            let index = usize::from(o.bonus.expect("Selected token"));
            let r = self.config().bonus_rewards[index].clone();
            self.inventory[index].in_flight = add(self.inventory[index].in_flight, r.amount.0);
            let token = ext_token::ext(r.token_contract_id)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(TRANSFER_GAS)
                .ft_transfer(
                    o.account.clone(),
                    r.amount,
                    Some(format!("Native case opening {}", o.id)),
                );
            promise = Some(match promise {
                Some(near) => near.and(token),
                None => token,
            });
        }
        self.openings.insert(&o.id, o);
        promise
            .expect("Unpaid reward")
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout(U64(o.id), U64(o.attempt)),
            )
            .detach();
    }
    fn assert_solvent(&self) {
        let storage = env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(u128::from(env::storage_usage()))
            .expect("Storage overflow");
        require!(
            env::account_balance().as_yoctonear() >= add(sub(self.book(), self.in_flight), storage),
            "Native liabilities exceed liquid account balance"
        );
    }
    fn assert_private(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Private callback"
        );
    }
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }
    fn assert_funder(&self) {
        let who = env::predecessor_account_id();
        require!(
            who == self.owner || who == self.treasury,
            "Authorized inventory funder only"
        );
    }
    fn bump(&mut self) {
        self.revision = self.revision.checked_add(1).expect("Revision overflow");
    }
}
fn transfer_succeeded(index: u64) -> bool {
    match env::promise_result_checked(index, 16) {
        Ok(_) => true,
        Err(near_sdk::PromiseError::Failed) => false,
        Err(near_sdk::PromiseError::TooLong(_)) => true,
        Err(_) => env::panic_str("Unknown promise result"),
    }
}
fn native(amount: u128) -> u128 {
    amount.checked_mul(SCALE).expect("Native amount overflow")
}
fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).expect("Accounting overflow")
}
fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).expect("Accounting underflow")
}
fn event(name: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"near_native_case","version":"1.0.0","event":name,"data":[data]})
    ));
}
/// Rejection sampling avoids modulo bias. No caller supplies entropy or the result.
fn randomness(id: u64, height: u64, count: u64, domain: &[u8]) -> Option<u64> {
    require!(count > 0, "Empty random selection");
    let mut input = domain.to_vec();
    input.extend_from_slice(&env::random_seed_array());
    input.extend_from_slice(env::current_account_id().as_bytes());
    input.extend_from_slice(&id.to_le_bytes());
    input.extend_from_slice(&height.to_le_bytes());
    let bound = u64::MAX - u64::MAX % count;
    for counter in 0u8..4 {
        input.push(counter);
        let hash = env::sha256_array(&input);
        let value = u64::from_le_bytes(hash[..8].try_into().expect("Eight bytes"));
        if value < bound {
            return Some(value % count);
        }
    }
    None
}
#[cfg(test)]
mod tests;
