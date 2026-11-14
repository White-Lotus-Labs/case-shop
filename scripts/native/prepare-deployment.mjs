import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { baseEncode } from "near-api-js";

const registry = JSON.parse(
  await readFile("config/cases.native.testnet.json", "utf8"),
);
const output = resolve("docs/native/deployment");
const wasmPath =
  "contracts/target/wasm32-unknown-unknown/release/near_native_case_pool.wasm";
const wasm = await readFile(wasmPath);
const digest = createHash("sha256").update(wasm).digest();
const rounds = 2n;
const scale = 10n ** 18n;
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const command = (args) => args.map(quote).join(" ");
const tx = (contract, method, args, deposit, gas = "100 Tgas") =>
  command([
    "near",
    "contract",
    "call-function",
    "as-transaction",
    contract,
    method,
    "json-args",
    JSON.stringify(args),
    "prepaid-gas",
    gas,
    "attached-deposit",
    deposit,
    "sign-as",
    registry.ownerId,
    "network-config",
    "testnet",
    "sign-with-keychain",
    "send",
  ]);
await mkdir(output, { recursive: true });
const lines = [
  "# REVIEW ONLY. These commands create accounts and broadcast Testnet transactions.",
  "# Do not execute until the user authorizes deployment and the listed funding.",
  "# Run from the repository root with near-cli-rs 0.31.1 or a compatible version.",
  `# SHA256 ${digest.toString("hex")}`,
  `# NEAR code_hash ${baseEncode(digest)}`,
  "",
];
const tokenRequirements = new Map();
let nearFunding = 0n;
for (const entry of registry.cases) {
  if (
    !entry.contractId.startsWith("native-") ||
    entry.contractId === entry.legacyContractId
  )
    throw new Error("Refusing a legacy deployment target.");
  const initPath = `docs/native/deployment/${entry.id}.init.json`;
  await writeFile(
    initPath,
    JSON.stringify(
      {
        owner_id: registry.ownerId,
        treasury_id: registry.treasuryId,
        config: entry.config,
      },
      null,
      2,
    ) + "\n",
  );
  lines.push(
    `# ${entry.name}: fresh account only; starts paused.`,
    command([
      "near",
      "account",
      "create-account",
      "fund-myself",
      entry.contractId,
      "5 NEAR",
      "autogenerate-new-keypair",
      "save-to-keychain",
      "sign-as",
      registry.ownerId,
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ]),
    command([
      "near",
      "contract",
      "deploy",
      entry.contractId,
      "use-file",
      wasmPath,
      "with-init-call",
      "new",
      "file-args",
      initPath,
      "prepaid-gas",
      "100 Tgas",
      "attached-deposit",
      "0 NEAR",
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ]),
  );
  const poolFunding = BigInt(entry.config.economy.rewards[2]) * scale * rounds;
  nearFunding += poolFunding;
  lines.push(tx(entry.contractId, "fund_pool", {}, `${poolFunding} yoctoNEAR`));
  for (const reward of entry.config.bonus_rewards) {
    const amount = BigInt(reward.amount) * rounds;
    const min = await storageMinimum(reward.token_contract_id);
    lines.push(
      tx(
        reward.token_contract_id,
        "storage_deposit",
        { account_id: entry.contractId, registration_only: true },
        `${min} yoctoNEAR`,
        "30 Tgas",
      ),
    );
    lines.push(
      tx(
        reward.token_contract_id,
        "ft_transfer_call",
        {
          receiver_id: entry.contractId,
          amount: String(amount),
          msg: JSON.stringify({ action: "fund" }),
        },
        "1 yoctoNEAR",
        "100 Tgas",
      ),
    );
    const previous = tokenRequirements.get(reward.token_contract_id);
    tokenRequirements.set(reward.token_contract_id, {
      tokenContractId: reward.token_contract_id,
      symbol: reward.token_symbol,
      decimals: reward.token_decimals,
      amount: String(BigInt(previous?.amount ?? "0") + amount),
      storageMinimum: min,
    });
  }
  lines.push(
    "# Inspect get_pool and get_reward_inventory before unpausing.",
    tx(
      entry.contractId,
      "set_paused",
      { paused: false },
      "1 yoctoNEAR",
      "30 Tgas",
    ),
    "",
  );
}
await writeFile(`${output}/commands.review.txt`, lines.join("\n") + "\n");
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      network: "testnet",
      status: "prepared-only-not-broadcast",
      contractVersion: "native-v1",
      wasmPath,
      wasmBytes: wasm.length,
      sha256: digest.toString("hex"),
      codeHash: baseEncode(digest),
      ownerId: registry.ownerId,
      treasuryId: registry.treasuryId,
      reservedConcurrentOpenings: String(rounds),
      accountCreationNear: "25",
      nativeRewardFundingYocto: String(nearFunding),
      fundingPolicy:
        "Two maximum native rewards per case and two of every configured FT candidate. Gas and FT storage are additional. Dynamic odds depend on remaining pool funds.",
      tokens: [...tokenRequirements.values()],
      cases: registry.cases.map((entry) => ({
        id: entry.id,
        contractId: entry.contractId,
        legacyContractId: entry.legacyContractId,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared five deployments without signing or broadcasting. SHA256 ${digest.toString("hex")}`,
);

async function storageMinimum(token) {
  const response = await fetch(registry.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "native-readonly-storage",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: token,
        method_name: "storage_balance_bounds",
        args_base64: Buffer.from("{}").toString("base64"),
        finality: "final",
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok || body.error || !Array.isArray(body.result?.result))
    throw new Error(
      `Cannot read storage bounds for ${token}; no commands executed.`,
    );
  const bounds = JSON.parse(Buffer.from(body.result.result).toString());
  if (!/^[1-9][0-9]*$/.test(bounds.min))
    throw new Error(`Invalid storage minimum for ${token}`);
  return bounds.min;
}
