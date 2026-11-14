# Player wallets and signing

Each authenticated User has one persistent GameWallet row. It is separate from linked external NEAR accounts. A connected wallet proves ownership through a server-issued NEP-413 challenge; a reported account ID alone is not authentication. Linking requires fresh authorization and a proof from the new wallet. Password-only profiles without an already linked wallet have no recovery mechanism in this prototype.

The dedicated worker uses one managed Google Cloud KMS Ed25519 SOFTWARE key/version per game wallet. The implicit address is derived from the public key. Allocation creates an address/key association, not an on-chain account; a separately authorized native Testnet NEAR transfer and finalized key check are required before status becomes active. The public signer has not yet been activated or verified for player wallets. No keys, credentials, or player databases are included in this repository.

This is a custodial prototype. The operator controls the FullAccess signer. Compromise of its KMS authority or a writable authorization database can enable spending. The application does not claim HSM protection, user self-custody, Mainnet readiness, or a formal audit. Independent security review and production-grade custody controls remain future work.

## Required worker configuration

The worker and API must connect to the same durable database. `DATABASE_URL` must name that database; the current Prisma schema and migrations target SQLite. Running two services with different local SQLite files will not work. The repository includes no existing database and does not migrate production data.

Set `IROH_PLAYER_KMS_KEY_RING` to the operator's dedicated Google Cloud KMS key ring resource. The operator may supply standard Google Application Default Credentials, or privately configure the worker-only `IROH_PLAYER_GOOGLE_CREDENTIALS_JSON` and `IROH_PLAYER_SERVICE_ACCOUNT_EMAIL` variables. The service account should have only key creation, version read, public key read and signing permissions on that dedicated ring. The worker validates the credential project and email and never logs the raw JSON. Service-account keys are long-lived credentials; workload identity is preferable when available. Never put signer credentials in the frontend, source control, chat or ordinary web-service environment.

`IROH_PLAYER_TESTNET_WRITES_ENABLED` defaults off and must be exactly `1` to allow public Testnet signing. Enabling it alone is not authorization to send any transaction. Allocation, funding, claims and transfers require an explicitly authorized scope. `IROH_PLAYER_RPC_URL` optionally selects one of the Testnet allowlisted RPC endpoints. The code checks network and contract hashes; it does not implement Mainnet.

## Operations

The server validates every supported claim, case call, deposit and withdrawal semantically. It records an idempotent preview and requires an explicit confirmation. Withdrawals require a fresh password or already-linked-wallet proof tied to the exact operation. Amounts are decimal strings converted with integer arithmetic. The worker serializes spending per wallet, persists unsigned and signed bytes before one broadcast, verifies the complete final receipt and never sends a replacement transaction after an uncertain result. An unresolved result blocks additional spending until reconciled.

A deposit is signed by the linked external wallet and can require a finalized storage-registration step before the token transfer. Claims and withdrawals use the game wallet. The USDI contract determines once-per-wallet eligibility, and balances come from finalized chain views. Neither a pending operation nor a visual animation creates a balance. The Testnet faucet and all existing contracts remain unchanged.

For frontend request bodies, status handling, HOT messages, receipt recovery and user confirmations, see [frontend integration](frontend-integration.md).
