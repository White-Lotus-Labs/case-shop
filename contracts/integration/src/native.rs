//! Actual attached native deposits and FT transfers on a new local chain.
use super::*;
use std::collections::BTreeMap;

async fn register(payer: &Account, token: &Contract, account: &Account) -> Result<()> {
    let min = number(
        &view(token, "storage_balance_bounds", json!({})).await?,
        "min",
    )?;
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({"account_id":account.id(),"registration_only":true}))
        .deposit(NearToken::from_yoctonear(min))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
async fn pause(owner: &Account, game: &Contract, paused: bool) -> Result<()> {
    owner
        .call(game.id(), "set_paused")
        .args_json(json!({"paused":paused}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
async fn latest(game: &Contract, player: &Account) -> Result<Value> {
    let rows = view(
        game,
        "get_history",
        json!({"account_id":player.id(),"limit":1}),
    )
    .await?;
    rows.as_array()
        .and_then(|r| r.first())
        .cloned()
        .context("No persisted opening")
}
async fn settle(game: &Contract, player: &Account) -> Result<Value> {
    for _ in 0..12 {
        let o = latest(game, player).await?;
        match o["status"].as_str().context("Status")? {
            "Completed" | "Claimable" => return Ok(o),
            "RandomnessPending" => {
                player
                    .call(game.id(), "advance_opening")
                    .args_json(json!({"opening_id":o["opening_id"]}))
                    .deposit(NearToken::from_yoctonear(1))
                    .gas(Gas::from_tgas(180))
                    .transact()
                    .await?
                    .into_result()?;
            }
            "Paying" => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            _ => bail!("Unknown opening state {o}"),
        }
    }
    bail!("Opening did not settle")
}
async fn assert_books(game: &Contract, tokens: &BTreeMap<String, Contract>) -> Result<Value> {
    let pool = view(game, "get_pool", json!({})).await?;
    ensure!(
        number(&pool, "reserved_rewards")? == 0
            && number(&pool, "in_flight_payouts")? == 0
            && pool["pending_openings"] == 0,
        "Outstanding native liabilities {pool}"
    );
    let book = number(&pool, "pool_funds")?
        + number(&pool, "treasury_available")?
        + number(&pool, "pending_fees")?;
    let actual = game.as_account().view_account().await?;
    let storage = u128::from(actual.storage_usage) * 10_000_000_000_000_000_000;
    ensure!(
        actual.balance.as_yoctonear() >= book + storage,
        "Actual native balance cannot cover book and storage"
    );
    for row in view(game, "get_reward_inventory", json!({}))
        .await?
        .as_array()
        .context("Inventory")?
    {
        let token = tokens
            .values()
            .find(|token| Some(token.id().as_str()) == row["token_contract_id"].as_str())
            .context("Selected token")?;
        ensure!(
            number(row, "reserved")? == 0 && number(row, "in_flight")? == 0,
            "Token obligation not cleared"
        );
        ensure!(
            balance(token, game.as_account()).await? == number(row, "funds")?,
            "Actual FT balance does not match inventory"
        );
    }
    Ok(pool)
}
pub(super) async fn verify() -> Result<()> {
    let registry: Value =
        serde_json::from_str(include_str!("../../../config/cases.native.testnet.json"))?;
    let worker = near_workspaces::sandbox()
        .await
        .context("Start local native NEAR Sandbox")?;
    let namespace = worker
        .create_tla("testnet".parse()?, SecretKey::from_random(KeyType::ED25519))
        .await?
        .into_result()?;
    worker
        .root_account()?
        .transfer_near(namespace.id(), NearToken::from_near(50_000))
        .await?
        .into_result()?;
    let owner = namespace
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(40_000))
        .transact()
        .await?
        .into_result()?;
    let attacker = namespace
        .create_subaccount("attacker")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let target =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32-unknown-unknown/release");
    let wasm_hash_output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(target.join("near_native_case_pool.wasm"))
        .output()?;
    ensure!(wasm_hash_output.status.success(), "Hash native WASM");
    let hash_line = String::from_utf8(wasm_hash_output.stdout)?;
    let wasm_hash = hash_line
        .split_whitespace()
        .next()
        .context("Missing WASM hash")?
        .to_string();
    let native_wasm = std::fs::read(target.join("near_native_case_pool.wasm"))
        .context("Build native case WASM first")?;
    let token_wasm = std::fs::read(target.join("iroh_mock_token.wasm"))?;
    let previous_wasm = std::env::var("NATIVE_PRE_UPGRADE_WASM").ok()
        .map(std::fs::read).transpose().context("Read preserved pre-upgrade WASM")?;
    let rows = registry["cases"].as_array().context("Cases array")?;
    let mut specs = BTreeMap::<String, String>::new();
    for case in rows {
        for r in case["config"]["bonus_rewards"]
            .as_array()
            .context("Rewards")?
        {
            specs.insert(
                r["token_contract_id"].as_str().context("Token id")?.into(),
                r["token_symbol"]
                    .as_str()
                    .context("Symbol")?
                    .to_ascii_uppercase(),
            );
        }
    }
    let mut tokens = BTreeMap::<String, Contract>::new();
    for (i, (canonical, asset)) in specs.into_iter().enumerate() {
        let token = namespace
            .create_subaccount(&format!("token-{i}"))
            .initial_balance(NearToken::from_near(6))
            .transact()
            .await?
            .into_result()?
            .deploy(&token_wasm)
            .await?
            .into_result()?;
        token
            .as_account()
            .call(token.id(), "new")
            .args_json(json!({"asset":asset,"owner_id":owner.id()}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        tokens.insert(canonical, token);
    }
    let mut evidence = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        println!(
            "Verifying native case {}/{} {}",
            index + 1,
            rows.len(),
            row["id"]
        );
        let player = namespace
            .create_subaccount(&format!("player-{index}"))
            .initial_balance(NearToken::from_near(30))
            .transact()
            .await?
            .into_result()?;
        let game = namespace
            .create_subaccount(&format!("native-{index}"))
            .initial_balance(NearToken::from_near(8))
            .transact()
            .await?
            .into_result()?
            .deploy(if index == 0 { previous_wasm.as_deref().unwrap_or(&native_wasm) } else { &native_wasm })
            .await?
            .into_result()?;
        let mut config = row["config"].clone();
        for r in config["bonus_rewards"].as_array_mut().context("Rewards")? {
            let token = tokens
                .get(r["token_contract_id"].as_str().context("Token")?)
                .context("Mapped token")?;
            r["token_contract_id"] = json!(token.id());
        }
        game.as_account()
            .call(game.id(), "new")
            .args_json(json!({"owner_id":owner.id(),"treasury_id":owner.id(),"config":config}))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        ensure!(
            view(&game, "get_case", json!({})).await?["payment_asset"] == "NEAR",
            "Wrong payment asset"
        );
        let scale = 1_000_000_000_000_000_000u128;
        let funding = number(&config["economy"], "target")? * scale;
        owner
            .call(game.id(), "fund_pool")
            .args_json(json!({}))
            .deposit(NearToken::from_yoctonear(funding))
            .gas(Gas::from_tgas(40))
            .transact()
            .await?
            .into_result()?;
        for r in config["bonus_rewards"].as_array().context("Rewards")? {
            let token = tokens
                .values()
                .find(|t| Some(t.id().as_str()) == r["token_contract_id"].as_str())
                .context("Mapped reward")?;
            register(&owner, token, game.as_account()).await?;
            let amount = number(r, "amount")? * 10;
            let outcome=owner.call(token.id(),"ft_transfer_call").args_json(json!({"receiver_id":game.id(),"amount":amount.to_string(),"memo":null,"msg":"{\"action\":\"fund\"}"})).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(150)).transact().await?.into_result()?;
            let used: String = outcome.json()?;
            ensure!(used == amount.to_string(), "Funding returned unused tokens");
        }
        pause(&owner, &game, false).await?;
        let stale = view(&game, "get_quote", json!({"account_id":player.id()})).await?;
        pause(&owner, &game, false).await?;
        let price = number(&view(&game, "get_case", json!({})).await?, "price")?;
        let storage = number(
            &view(&game, "get_pool", json!({})).await?,
            "storage_per_opening",
        )?;
        let stale_result=player.call(game.id(),"open").args_json(json!({"nonce":stale["nonce"],"quote":{"revision":stale["revision"],"expires_at":stale["expires_at"]}})).deposit(NearToken::from_yoctonear(price+storage)).gas(Gas::from_tgas(150)).transact().await?;
        ensure!(stale_result.is_failure(), "Stale quote accepted");
        ensure!(
            view(
                &game,
                "get_history",
                json!({"account_id":player.id(),"limit":1})
            )
            .await?
                == json!([]),
            "Failed payment persisted opening"
        );
        let quote = view(&game, "get_quote", json!({"account_id":player.id()})).await?;
        let args = json!({"nonce":quote["nonce"],"quote":{"revision":quote["revision"],"expires_at":quote["expires_at"]}});
        let wrong = player
            .call(game.id(), "open")
            .args_json(args.clone())
            .deposit(NearToken::from_yoctonear(price))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?;
        ensure!(wrong.is_failure(), "Missing storage payment accepted");
        player
            .call(game.id(), "open")
            .args_json(args)
            .deposit(NearToken::from_yoctonear(price + storage))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?
            .into_result()?;
        let failed = settle(&game, &player).await?;
        ensure!(
            failed["status"] == "Claimable"
                && failed["near_paid"] == true
                && failed["bonus_paid"] == false,
            "Missing token registration must preserve recoverable token payout: {failed}"
        );
        if index == 0 && previous_wasm.is_some() {
            let before_upgrade = view(&game, "get_pool", json!({})).await?;
            game.as_account().deploy(&native_wasm).await?.into_result()?;
            ensure!(view(&game, "get_pool", json!({})).await? == before_upgrade,
                "Code upgrade changed existing native books");
            ensure!(latest(&game, &player).await? == failed,
                "Code upgrade changed existing claimable opening");
            ensure!(view(&game, "get_charity", json!({})).await?.is_null(),
                "Upgrade activated charity without authorization");
        }
        let charity_name = format!("paws-{index}");
        let charity_id = format!("{charity_name}.{}", namespace.id());
        let charity_storage = view(&game, "charity_storage_cost", json!({})).await?
            .as_str().context("Charity storage quote")?.parse::<u128>()?;
        let storage_before = game.as_account().view_account().await?.storage_usage;
        owner.call(game.id(), "activate_charity")
            .args_json(json!({"treasury_id":charity_id}))
            .deposit(NearToken::from_yoctonear(charity_storage)).gas(Gas::from_tgas(60))
            .transact().await?.into_result()?;
        let storage_growth = game.as_account().view_account().await?.storage_usage - storage_before;
        ensure!(u128::from(storage_growth) * 10_000_000_000_000_000_000 <= charity_storage,
            "Charity activation storage was not owner-funded");
        let selected = tokens
            .values()
            .find(|t| Some(t.id().as_str()) == failed["bonus"]["token_contract_id"].as_str())
            .context("Selected token")?;
        let before = balance(selected, &player).await?;
        let amount = number(&failed["bonus"], "amount")?;
        let unauthorized = attacker
            .call(game.id(), "retry_payout")
            .args_json(json!({"opening_id":failed["opening_id"]}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?;
        ensure!(
            unauthorized.is_failure(),
            "Attacker retried another owner's opening"
        );
        let forged = attacker
            .call(game.id(), "on_payout")
            .args_json(json!({"opening_id":failed["opening_id"],"attempt":"1"}))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?;
        ensure!(forged.is_failure(), "Public payout callback accepted");
        register(&player, selected, &player).await?;
        let total_before = number(&view(&game, "get_pool", json!({})).await?, "total_paid")?;
        player
            .call(game.id(), "retry_payout")
            .args_json(json!({"opening_id":failed["opening_id"]}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?
            .into_result()?;
        let complete = settle(&game, &player).await?;
        ensure!(
            complete["status"] == "Completed",
            "Retry did not complete: {complete}"
        );
        ensure!(
            balance(selected, &player).await? == before + amount,
            "Genuine wallet token reward missing"
        );
        ensure!(
            view(
                &game,
                "get_account_opening",
                json!({"account_id":player.id()})
            )
            .await?
            .is_null(),
            "Active opening not cleared"
        );
        let duplicate = player
            .call(game.id(), "retry_payout")
            .args_json(json!({"opening_id":complete["opening_id"]}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?;
        ensure!(duplicate.is_failure(), "Duplicate reward claim accepted");
        ensure!(
            balance(selected, &player).await? == before + amount,
            "Duplicate token payout"
        );
        let pool = assert_books(&game, &tokens).await?;
        ensure!(
            number(&pool, "total_paid")? == total_before,
            "Token retry repeated native transfer"
        );
        let global = view(
            &game,
            "get_global_history_page",
            json!({"before_opening_id":null,"limit":20}),
        )
        .await?;
        ensure!(
            global["openings"][0]["account_id"] == player.id().as_str()
                && global["openings"][0]["status"] == "Completed",
            "Global finalized history missing"
        );
        let personal = view(
            &game,
            "get_history_page",
            json!({"account_id":player.id(),"before_opening_id":null,"limit":20}),
        )
        .await?;
        ensure!(
            personal["openings"][0] == global["openings"][0],
            "Personal and global records differ"
        );
        ensure!(number(&view(&game, "get_charity", json!({})).await?, "available")? == 0,
            "Pre-activation pending opening accrued charity fees");
        for reward in config["bonus_rewards"].as_array().context("Reward candidates")? {
            let token = tokens.values().find(|token| Some(token.id().as_str()) == reward["token_contract_id"].as_str()).context("Reward token")?;
            register(&player, token, &player).await?;
        }
        let future_quote = view(&game, "get_quote", json!({"account_id":player.id()})).await?;
        player.call(game.id(), "open")
            .args_json(json!({"nonce":future_quote["nonce"],"quote":{"revision":future_quote["revision"],"expires_at":future_quote["expires_at"]}}))
            .deposit(NearToken::from_yoctonear(price + storage)).gas(Gas::from_tgas(250))
            .transact().await?.into_result()?;
        ensure!(settle(&game, &player).await?["status"] == "Completed", "Future opening not paid");
        let fee = price / 20;
        ensure!(number(&view(&game, "get_charity", json!({})).await?, "available")? == fee,
            "Future charity fee is not the included 5%");
        let player_pool = view(&game, "get_pool", json!({})).await?["pool_funds"].clone();
        let failed_transfer = owner.call(game.id(), "withdraw_charity")
            .args_json(json!({"amount":fee.to_string()})).deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(80)).transact().await?.into_result()?.json::<bool>()?;
        ensure!(!failed_transfer, "Transfer to absent named treasury unexpectedly succeeded");
        ensure!(number(&view(&game, "get_charity", json!({})).await?, "available")? == fee,
            "Failed charity transfer did not release exactly once");
        let treasury = namespace.create_subaccount(&charity_name)
            .initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
        let treasury_before = treasury.view_account().await?.balance.as_yoctonear();
        let paid = owner.call(game.id(), "withdraw_charity")
            .args_json(json!({"amount":fee.to_string()})).deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(80)).transact().await?.into_result()?.json::<bool>()?;
        ensure!(paid && treasury.view_account().await?.balance.as_yoctonear() == treasury_before + fee,
            "Charity receiver did not receive the exact fee once");
        let charity = view(&game, "get_charity", json!({})).await?;
        ensure!(number(&charity, "available")? == 0 && number(&charity, "total_paid")? == fee &&
            number(&charity, "retained_legacy_fees")? == fee, "Charity moved historical fees");
        let after_charity = assert_books(&game, &tokens).await?;
        ensure!(after_charity["pool_funds"] == player_pool, "Charity consumed player reserves");
        let excess = owner.call(game.id(), "withdraw_charity")
            .args_json(json!({"amount":"1"})).deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(80)).transact().await?;
        ensure!(excess.is_failure(), "Duplicate charity withdrawal accepted");
        println!("PASS future-only charity fee, genuine native failure/retry, exact treasury balance and preserved player reserves");
        evidence.push(json!({"case_id":config["case_id"],"price":price.to_string(),"storage":storage.to_string(),"opening":complete,"charity":charity,"charity_storage_growth":storage_growth,"upgrade_compatibility_verified":index == 0 && previous_wasm.is_some(),"pool":after_charity,"case":view(&game,"get_case",json!({})).await?,"quote":quote,"checks":["native deposit","stale quote rejected","missing storage rejected","unregistered token fails safely","owner-only retry","private callbacks","actual FT wallet balance","no repeat native payment","duplicate claim rejected","native solvency","FT reserves reconciled","personal history","global history"]}));
    }
    let report = json!({"network":"local NEAR Sandbox","payment_asset":"NEAR","cases":evidence,"live_testnet_transactions":false,"wasm_sha256":wasm_hash,"open_gas_tgas":150,"retry_gas_tgas":100});
    let output =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/evidence/native-sandbox.json");
    std::fs::write(output, serde_json::to_string_pretty(&report)?)?;
    println!(
        "Native NEAR Sandbox verified all {} configured cases, real deposits, mandatory FT payouts and recovery",
        rows.len()
    );
    Ok(())
}
