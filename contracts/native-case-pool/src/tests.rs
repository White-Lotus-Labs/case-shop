use super::*;
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_utils::VMContextBuilder, testing_env};
use std::collections::HashMap;
fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn context(who: &str, deposit: u128, height: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(account("case.testnet"))
        .predecessor_account_id(account(who))
        .signer_account_id(account(who))
        .account_balance(NearToken::from_near(10000))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .block_height(height)
        .random_seed([7; 32])
        .build()
}
fn set(who: &str, deposit: u128, height: u64) {
    testing_env!(context(who, deposit, height));
}
fn config() -> CaseConfig {
    CaseConfig {
        case_id: "bamboo-mist".into(),
        name: "Bamboo Mist Case".into(),
        economy: iroh_economics::configured::collection().remove(0).1,
        bonus_rewards: (0..3)
            .map(|tier| TokenReward {
                token_contract_id: account(&format!("token{tier}.testnet")),
                token_symbol: format!("T{tier}"),
                display_name: format!("Token {tier}"),
                token_decimals: 6,
                amount: U128(1_000_000),
                tier,
            })
            .collect(),
    }
}
fn funded() -> NativeCasePool {
    set("case.testnet", 0, 10);
    let mut p = NativeCasePool::new(account("owner.testnet"), account("owner.testnet"), config());
    set("owner.testnet", native(250_000_000), 10);
    p.fund_pool();
    for tier in 0..3 {
        set(&format!("token{tier}.testnet"), 0, 10);
        assert!(matches!(
            p.ft_on_transfer(
                account("owner.testnet"),
                U128(100_000_000),
                "{\"action\":\"fund\"}".into()
            ),
            PromiseOrValue::Value(U128(0))
        ));
    }
    set("owner.testnet", 1, 10);
    p.set_paused(false);
    p
}
fn auth(p: &NativeCasePool, who: &str) -> Authorization {
    let q = p.get_quote(account(who));
    Authorization {
        revision: U64(q["revision"].as_str().unwrap().parse().unwrap()),
        expires_at: U64(q["expires_at"].as_str().unwrap().parse().unwrap()),
    }
}
fn open(p: &mut NativeCasePool, who: &str) -> u64 {
    let quote = auth(p, who);
    let nonce = p.next_nonce(&account(who));
    set(who, native(500_000) + NativeCasePool::opening_cost(), 10);
    p.open(U64(nonce), quote).0
}
fn callback(near: bool, token: Option<bool>) {
    let mut results = vec![if near {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    }];
    if let Some(success) = token {
        results.push(if success {
            PromiseResult::Successful(vec![])
        } else {
            PromiseResult::Failed
        });
    }
    testing_env!(
        context("case.testnet", 0, 12),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        results
    );
}
#[test]
fn native_deposit_creates_once_and_reserves_every_possible_reward() {
    let mut p = funded();
    assert_eq!(p.get_case()["price"], native(500_000).to_string());
    let id = open(&mut p, "alice.testnet");
    assert_eq!(id, 0);
    assert_eq!(p.reserved, native(4_000_000));
    assert_eq!(p.pending_fees, native(25_000));
    assert!(p.inventory.iter().all(|i| i.reserved == 1_000_000));
    assert_eq!(p.get_quote(account("alice.testnet"))["can_open"], false);
    assert_eq!(p.get_history(account("alice.testnet"), 10).len(), 1);
    assert_eq!(
        p.get_global_history_page(None, 10)["openings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn native_and_token_payout_complete_then_duplicate_callback_is_noop() {
    let mut p = funded();
    let id = open(&mut p, "alice.testnet");
    set("case.testnet", 0, 11);
    assert!(p.resolve_opening(U64(id)));
    let o = p.openings.get(&id).unwrap();
    assert!(o.bonus.is_some());
    assert_eq!(o.status, Status::Paying);
    let reward = o.reward.unwrap();
    callback(true, Some(true));
    assert!(p.on_payout(U64(id), U64(1)));
    assert!(!p.on_payout(U64(id), U64(1)));
    assert_eq!(p.completed, 1);
    assert_eq!(p.total_paid, reward);
    assert_eq!(p.reserved, 0);
    assert!(
        p.inventory
            .iter()
            .all(|i| i.reserved == 0 && i.in_flight == 0)
    );
    assert!(p.get_account_opening(account("alice.testnet")).is_none());
    assert_eq!(p.openings.get(&id).unwrap().status, Status::Completed);
}
#[test]
fn failed_token_payout_preserves_only_token_reserve_and_retry_does_not_repeat_native() {
    let mut p = funded();
    let id = open(&mut p, "alice.testnet");
    set("case.testnet", 0, 11);
    p.resolve_opening(U64(id));
    callback(true, Some(false));
    assert!(!p.on_payout(U64(id), U64(1)));
    let o = p.openings.get(&id).unwrap();
    assert_eq!(o.status, Status::Claimable);
    assert!(o.near_paid);
    assert!(!o.bonus_paid);
    let paid = p.total_paid;
    set("alice.testnet", 1, 12);
    p.retry_payout(U64(id));
    assert_eq!(p.in_flight, 0);
    callback(true, None);
    assert!(!p.on_payout(U64(id), U64(1)));
    assert!(p.on_payout(U64(id), U64(2)));
    assert_eq!(p.total_paid, paid);
    assert_eq!(p.completed, 1);
}
#[test]
fn failed_native_only_retries_native() {
    let mut p = funded();
    let id = open(&mut p, "alice.testnet");
    set("case.testnet", 0, 11);
    p.resolve_opening(U64(id));
    callback(false, Some(true));
    assert!(!p.on_payout(U64(id), U64(1)));
    let o = p.openings.get(&id).unwrap();
    assert!(o.bonus_paid && !o.near_paid);
    let funds = p.inventory.iter().map(|i| i.funds).collect::<Vec<_>>();
    set("alice.testnet", 1, 12);
    p.retry_payout(U64(id));
    callback(true, None);
    assert!(p.on_payout(U64(id), U64(2)));
    assert_eq!(
        funds,
        p.inventory.iter().map(|i| i.funds).collect::<Vec<_>>()
    );
}
#[test]
#[should_panic(expected = "Stale quote")]
fn stale_quote_rejected() {
    let mut p = funded();
    let q = auth(&p, "alice.testnet");
    set("owner.testnet", 1, 10);
    p.set_paused(false);
    set(
        "alice.testnet",
        native(500_000) + NativeCasePool::opening_cost(),
        10,
    );
    p.open(U64(0), q);
}
#[test]
#[should_panic(expected = "Attach exact price")]
fn wrong_attached_amount_rejected() {
    let mut p = funded();
    let q = auth(&p, "alice.testnet");
    set("alice.testnet", native(500_000), 10);
    p.open(U64(0), q);
}
#[test]
#[should_panic(expected = "Duplicate or stale opening nonce")]
fn duplicate_nonce_rejected_after_completion() {
    let mut p = funded();
    let id = open(&mut p, "alice.testnet");
    set("case.testnet", 0, 11);
    p.resolve_opening(U64(id));
    callback(true, Some(true));
    p.on_payout(U64(id), U64(1));
    let q = auth(&p, "alice.testnet");
    set(
        "alice.testnet",
        native(500_000) + NativeCasePool::opening_cost(),
        12,
    );
    p.open(U64(0), q);
}
#[test]
#[should_panic(expected = "Only reward owner")]
fn another_account_cannot_retry() {
    let mut p = funded();
    let id = open(&mut p, "alice.testnet");
    set("case.testnet", 0, 11);
    p.resolve_opening(U64(id));
    callback(true, Some(false));
    p.on_payout(U64(id), U64(1));
    set("bob.testnet", 1, 12);
    p.retry_payout(U64(id));
}
#[test]
#[should_panic(expected = "another account")]
fn history_cursor_cannot_cross_accounts() {
    let mut p = funded();
    open(&mut p, "alice.testnet");
    p.get_history_page(account("bob.testnet"), Some(U64(0)), 10);
}
#[test]
fn ft_transfers_never_purchase_and_unknown_funding_is_refunded() {
    let mut p = funded();
    let count = p.next_id;
    set("token0.testnet", 0, 10);
    let value = p.ft_on_transfer(
        account("alice.testnet"),
        U128(1_000_000),
        "{\"action\":\"open\"}".into(),
    );
    assert!(matches!(value, PromiseOrValue::Value(U128(1_000_000))));
    assert_eq!(p.next_id, count);
}
#[test]
fn global_and_personal_pagination_survive_refresh_and_switch() {
    let mut p = funded();
    for who in ["alice.testnet", "bob.testnet", "alice.testnet"] {
        let id = open(&mut p, who);
        set("case.testnet", 0, 11);
        p.resolve_opening(U64(id));
        callback(true, Some(true));
        p.on_payout(U64(id), U64(1));
    }
    let global = p.get_global_history_page(None, 2);
    assert_eq!(global["openings"][0]["opening_id"], "2");
    assert_eq!(global["next_cursor"], "0");
    assert_eq!(
        p.get_global_history_page(Some(U64(0)), 2)["openings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let personal = p.get_history_page(account("alice.testnet"), None, 1);
    assert_eq!(personal["next_cursor"], "0");
    assert_eq!(
        p.get_history_page(account("bob.testnet"), None, 10)["openings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn two_accounts_reserve_all_candidates_then_settle_in_reverse_order() {
    let mut p = funded();
    let alice = open(&mut p, "alice.testnet");
    let bob = open(&mut p, "bob.testnet");
    assert_eq!(p.reserved, native(8_000_000));
    assert!(p.inventory.iter().all(|s| s.reserved == 2_000_000));
    assert_eq!(p.pending, 2);
    set("case.testnet", 0, 11);
    assert!(p.resolve_opening(U64(alice)));
    set("case.testnet", 0, 11);
    assert!(p.resolve_opening(U64(bob)));
    let alice_reward = p.openings.get(&alice).unwrap().reward.unwrap();
    let bob_reward = p.openings.get(&bob).unwrap().reward.unwrap();
    assert_eq!(p.reserved, alice_reward + bob_reward);
    assert_eq!(p.in_flight, alice_reward + bob_reward);
    callback(true, Some(true));
    assert!(p.on_payout(U64(bob), U64(1)));
    assert_eq!(p.reserved, alice_reward);
    assert_eq!(p.in_flight, alice_reward);
    assert_eq!(p.pending, 1);
    callback(true, Some(true));
    assert!(p.on_payout(U64(alice), U64(1)));
    assert_eq!(p.reserved, 0);
    assert_eq!(p.in_flight, 0);
    assert_eq!(p.pending, 0);
    assert_eq!(p.completed, 2);
    assert!(
        p.inventory
            .iter()
            .all(|s| s.reserved == 0 && s.in_flight == 0)
    );
}
