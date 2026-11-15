# Charity activation requires owner approval

The dedicated Testnet account is `fujitora-paws.needmore_1_near.testnet`. Its initial 0.1 test NEAR funding and existing user-controlled full-access public key were verified on-chain. Creation transaction: [7gC8pNMvHLm5BLj2aB81tzQxiDoNTQBfkUQGZMr2hnZB](https://testnet.nearblocks.io/txns/7gC8pNMvHLm5BLj2aB81tzQxiDoNTQBfkUQGZMr2hnZB).

This is a separate account controlled by the same existing owner key. No new private key was generated or exported. Retain the existing keychain and recovery mechanism for `needmore_1_near.testnet`. Possession of the parent account name alone does not recover a lost subaccount key. Public ownership metadata and the recovery statement are recorded in `treasury.json`.

Fee routing is not active. No existing contract was upgraded, and no historical fees were redirected.

## Prepared code

The tested native WASM SHA256 is `f9ae627173ded178723f20dc3006a7869c6195fa66dabd7353972f8d752e91b1` at `contracts/target/wasm32-unknown-unknown/release/near_native_case_pool.wasm`. Rebuild and compare the hash immediately before any proposed deployment. The code preserves the existing root and opening Borsh layouts. Missing sidecar state means disabled charity routing.

All five cases passed actual local Sandbox tests of native payments, recovery, future-only 5% accrual, native charity transfer failure and retry, exact recipient balance, and reserve conservation. The Bamboo test first deployed the preserved old WASM and created a claimable opening, then upgraded locally and proved the opening and pool survived. No public upgrade was involved. Reproduce the compatibility check with `NEAR_SANDBOX_BIN_PATH=/absolute/path/to/near-sandbox node scripts/native/verify-upgrade.mjs`. It rebuilds the pre-change contract from Git revision `91484c2f90928c15fee49156bb91577b8eba6404`, then runs the upgraded native Sandbox suite.

## Transactions requiring explicit approval

For each of the five native case accounts in `config/cases.native.testnet.json`:

1. Deploy the reviewed native WASM to that existing contract account, without an initialization or migration call. This needs that contract account's existing upgrade authority.
2. After finalized code-hash verification and read-only regression checks, call `activate_charity` as `needmore_1_near.testnet` with `{"treasury_id":"fujitora-paws.needmore_1_near.testnet"}`. Read `charity_storage_cost` first. At the tested storage price, attach exactly `5120000000000000000000` yoctoNEAR, or 0.00512 NEAR, for the 512-byte reserve. Use 60 Tgas. Activation is one-time and fixes the recipient and first eligible opening ID.

Approval of these upgrades and activation is separate from the routine game-testing budget. Do not execute either step without explicit owner approval. A recipient change or any transfer of fees accumulated before activation is outside this design.

After approved activation, `get_charity` exposes available future fees and paid totals. The owner can call `withdraw_charity` with an amount no greater than its verified `available`, one yoctoNEAR attached, and 80 Tgas. The recipient is fixed by activation. No withdrawal transaction is proposed now because no eligible fees or active route exists.

These Testnet transfers are not real monetary donations. The public charity section must keep that distinction.
