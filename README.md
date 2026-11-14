# NEAR Testnet case shop

Open one of five configured cases using your own NEAR Testnet wallet. Pay native NEAR and receive the contract-selected native reward and configured Testnet token directly in the same wallet. The Vite interface retains its original 3D models and animation.

The native implementation uses fresh contract accounts. Public Testnet deployment and funding remain pending authorization. The app shows that state explicitly and never substitutes fake balances, winnings, or activity.

```sh
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev
```

Read the [native deployment and verification guide](docs/native-near-deployment.md) for test commands, recovery behavior, exact deployment commands, funding requirements, and WASM hashes.

`contracts/native-case-pool` contains the native contract. `config/cases.native.testnet.json` defines the five new deployments. `src/case/native*` implements strict chain views and transaction recovery, and `src/wallet` contains the reused wallet connector.

The legacy USDI contracts and recovery modules remain available for historical obligations. Their deployments are not modified. Password accounts and managed-wallet routes are removed from the active application.
