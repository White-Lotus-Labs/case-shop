import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const registry = JSON.parse(
  await readFile("config/cases.native.testnet.json", "utf8"),
);
const manifest = JSON.parse(
  await readFile("docs/native/deployment/manifest.json", "utf8"),
);
const wasm = await readFile(manifest.wasmPath);
if (createHash("sha256").update(wasm).digest("hex") !== manifest.sha256)
  throw new Error(
    "Rebuild and regenerate the deployment package before checking it.",
  );
const blockers = [];
const accounts = [];
for (const entry of registry.cases) {
  const result = await rpc({
    request_type: "view_account",
    account_id: entry.contractId,
    finality: "final",
  });
  const absent = Boolean(
    result.error && JSON.stringify(result.error).includes("UNKNOWN_ACCOUNT"),
  );
  if (!absent)
    blockers.push(
      `${entry.contractId}: ${result.error ? "account absence could not be verified" : "already exists; do not overwrite"}`,
    );
  accounts.push({
    contractId: entry.contractId,
    absent,
    ...(result.result && {
      codeHash: result.result.code_hash,
      balance: result.result.amount,
    }),
  });
}
const owner = await rpc({
  request_type: "view_account",
  account_id: registry.ownerId,
  finality: "final",
});
const nativeRequired =
  BigInt(manifest.nativeRewardFundingYocto) +
  BigInt(manifest.accountCreationNear) * 10n ** 24n;
if (!owner.result || BigInt(integer(owner.result.amount)) < nativeRequired)
  blockers.push(
    "Owner needs additional NEAR for the prepared account and prize funding, plus storage and gas.",
  );
const tokens = [];
for (const requirement of manifest.tokens) {
  const metadata = await view(requirement.tokenContractId, "ft_metadata", {});
  const balance = integer(
    await view(requirement.tokenContractId, "ft_balance_of", {
      account_id: registry.ownerId,
    }),
  );
  const expected = registry.cases
    .flatMap((entry) => entry.config.bonus_rewards)
    .find((reward) => reward.token_contract_id === requirement.tokenContractId);
  const matches =
    expected &&
    metadata.symbol === expected.token_symbol &&
    metadata.decimals === expected.token_decimals;
  if (!matches)
    blockers.push(
      `${requirement.tokenContractId}: token metadata does not match the immutable reward catalog.`,
    );
  if (BigInt(balance) < BigInt(requirement.amount))
    blockers.push(
      `${requirement.tokenContractId}: owner reward inventory is below the prepared funding requirement.`,
    );
  tokens.push({
    tokenContractId: requirement.tokenContractId,
    metadataMatches: Boolean(matches),
    balance,
    required: requirement.amount,
  });
}
const report = {
  checkedAt: new Date().toISOString(),
  network: "testnet",
  readOnly: true,
  signedTransactions: 0,
  sha256: manifest.sha256,
  accounts,
  owner: {
    accountId: registry.ownerId,
    balance: owner.result?.amount ?? null,
    minimumNativeFundingYocto: String(nativeRequired),
  },
  tokens,
  blockers,
  activation:
    "Requires explicit user authorization even if all read-only checks pass.",
};
await mkdir("docs/native/evidence", { recursive: true });
await writeFile(
  "docs/native/evidence/testnet-preflight.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      accountsVerifiedAbsent: accounts.filter((account) => account.absent)
        .length,
      tokensChecked: tokens.length,
      blockers,
      signedTransactions: 0,
    },
    null,
    2,
  ),
);

function integer(value) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw new Error("Invalid RPC amount.");
  return value;
}
async function rpc(params) {
  const response = await fetch(registry.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "native-preflight-readonly",
      method: "query",
      params,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Read-only RPC failed with HTTP ${response.status}.`);
  return response.json();
}
async function view(account, method, args) {
  const response = await rpc({
    request_type: "call_function",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  if (response.error || !Array.isArray(response.result?.result))
    throw new Error(`Cannot verify ${account}.${method}`);
  return JSON.parse(Buffer.from(response.result.result).toString());
}
