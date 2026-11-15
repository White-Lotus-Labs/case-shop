# Bamboo Mist purchase diagnosis

The two earlier failed transactions were inspected through finalized Testnet RPC, without submitting another transaction:

- `9nt3c4ExphvzRYQ4uugxvQPWTTBH1XH2RXS3S1rTmBSH` was included at height277725717.
- `6LWr2siBf4ncPV5SaPLck5cXdXuco2P49d1FYeGEhREB` was included at height277725836.

Both carried nonce1, revision9, and the same quote expiry277725620. Both were already expired before inclusion. The contract requires quote expiry to be at least the execution height, so that authorization could not succeed. The RPC status exposes a generic WASM trap rather than a useful stale-quote message. Raw public failure evidence is in `../native/evidence/bamboo-prior-failures.json`.

The previous retry helper copied the original call unchanged. Retrying that saved expired quote could never recover an unsubmitted opening. The revised helper preserves the account, contract, original nonce, deposit and gas, but replaces quote revision and expiry with a freshly verified quote. It refuses a changed nonce or deposit. A late original and its retry still share the same contract-enforced opening nonce, so they cannot both open.

The frontend also retained saved purchase records even after it observed their finalized opening. It now removes them when the matching on-chain nonce is found. Local account-verification failures are distinguished from ambiguous wallet-signing failures. Only a proven preflight failure releases its unsent intent; unknown outcomes remain recoverable until chain state proves them.

Public RPC429, transient network failures and per-provider timeouts now use a bounded alternate read provider. Signed transactions never pass through this read retry transport. A regression test prohibits broadcast methods there.

The earlier `Cannot read properties of undefined (reading 'name')` wallet wording was not reproduced in the current Meteor approval flow, so no unsupported claim is made about that SDK stack. The actual Meteor browser opening completed, paid both reward legs and returned to idle. The retained nonce recovery protects ambiguous wallet responses even when their error wording is unhelpful.
