# Native NEAR implementation

The requested branch starts at `36ffbb3283656e6207e5d312653bc048ca7df53b` with no uncommitted changes. The fetched remote points to the same commit.

## Contract boundary

Deploy a new `native-case-pool` crate to five fresh accounts. Preserve the legacy contracts, deployment registry, state encodings, and recovery modules. In-place upgrades would mix historical USDI obligations with native NEAR accounting, so they are excluded.

The new registry declares `microNEAR` configuration units. Multiply these integers by `10^18` at the contract boundary. Public prices, reserves, deposits, and native rewards use yoctoNEAR. The five purchase prices are 0.5, 1, 2, 5, and 10 NEAR. Preserve the existing economy's native reward ratios and dynamic tier probabilities. Every opening also selects a configured Testnet reward token within its tier.

Reserve the maximum native reward and every possible token candidate before accepting payment. Release unselected reserves after the chain selects the result. Transfer payouts directly to the signer. Track each transfer leg separately so retries never pay a successful leg twice.

## Application boundary

Keep the Vite layout, CSS, 3D models, sound, and animation. Replace the mock wallet and gameplay adapters. Reuse the existing Testnet connector and validate native contract identity before signing. Read balances and personal/global history from finalized chain state. Register eligible token receivers using the token's actual storage bounds.

Persist a purchase intent before asking the wallet to sign. Resolve uncertain outcomes against account-specific nonces and finalized openings. Separate pending records by wallet and contract. Animate an already verified reward.

Remove active authentication and managed-wallet HTTP routes. Retain their modules and tests as historical compatibility code. No application flow provisions or signs for a managed account.

## Verification and handoff

Run legacy and native Rust tests, build WASMs, execute local Sandbox deposits and payouts, run TypeScript checks and tests, build both applications, and exercise the frontend against an ephemeral Sandbox from a browser.

Generate deployment commands, initialization files, funding requirements, and WASM hashes without broadcasting. Public account creation, deployment, token funding, and purchases require separate user authorization. Commit the tested local implementation without pushing.
