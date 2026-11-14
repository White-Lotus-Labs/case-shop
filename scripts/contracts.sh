#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../contracts"
contract_cargo="${IROH_CARGO_BIN:-cargo}"
case "${1:-}" in
  build)
    RUSTFLAGS="${RUSTFLAGS:-} -C target-cpu=mvp" "$contract_cargo" build --locked --release --target wasm32-unknown-unknown -p iroh-usdi -p iroh-case-pool -p iroh-mock-token -p near-native-case-pool
    shasum -a 256 target/wasm32-unknown-unknown/release/iroh_usdi.wasm target/wasm32-unknown-unknown/release/iroh_case_pool.wasm target/wasm32-unknown-unknown/release/iroh_mock_token.wasm target/wasm32-unknown-unknown/release/near_native_case_pool.wasm
    ;;
  test)
    "$contract_cargo" test --locked -p iroh-usdi -p iroh-case-pool -p iroh-mock-token -p iroh-economics -p near-native-case-pool
    ;;
  simulate)
    "$contract_cargo" run --locked --release -p iroh-economics --bin simulate -- --output ..
    ;;
  collection-simulate)
    "$contract_cargo" run --locked --release -p iroh-economics --bin simulate-collection
    ;;
  collection-integration)
    "$contract_cargo" run --locked --manifest-path integration/Cargo.toml -- --collection
    ;;
  native-integration)
    "$contract_cargo" run --locked --manifest-path integration/Cargo.toml -- --native
    ;;
  integration)
    "$contract_cargo" run --locked --manifest-path integration/Cargo.toml
    ;;
  *) printf '%s\n' 'Usage: bash scripts/contracts.sh {build|test|simulate|collection-simulate|collection-integration|native-integration|integration}' >&2; exit 2 ;;
esac
