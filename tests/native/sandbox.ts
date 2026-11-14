import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { Account, actions, KeyPair, KeyPairSigner } from "near-api-js";
import { SandboxChainPort } from "../helpers/player-sandbox";
import registry from "../../config/cases.native.testnet.json";
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed local Sandbox value");
  return Object.fromEntries(Object.entries(value));
}
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No local port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
export async function startNativeSandbox(
  binary = process.env.NEAR_SANDBOX_BIN ?? "near-sandbox",
) {
  const directory = await mkdtemp(join(tmpdir(), "iroh-player-local-"));
  const chainId = `iroh-player-local-${Date.now()}`;
  const init = spawnSync(
    binary,
    [
      "--home",
      directory,
      "init",
      "--fast",
      "--chain-id",
      chainId,
      "--account-id",
      "testnet",
    ],
    { stdio: "ignore" },
  );
  if (init.status !== 0)
    throw new Error(
      "Local Sandbox initialization failed. Supply a working local binary.",
    );
  const config = record(
    JSON.parse(await readFile(join(directory, "config.json"), "utf8")),
  );
  const rpc = record(config.rpc),
    network = record(config.network);
  const rpcPort = await freePort(),
    peerPort = await freePort();
  rpc.addr = `127.0.0.1:${rpcPort}`;
  rpc.cors_allowed_origins = [];
  network.addr = `127.0.0.1:${peerPort}`;
  network.boot_nodes = "";
  network.max_num_peers = 0;
  network.minimum_outbound_peers = 0;
  network.ideal_connections_lo = 0;
  network.ideal_connections_hi = 0;
  network.trusted_stun_servers = [];
  const experimental = record(network.experimental);
  experimental.inbound_disabled = true;
  experimental.connect_only_to_boot_nodes = true;
  network.experimental = experimental;
  config.rpc = rpc;
  config.network = network;
  config.telemetry = { endpoints: [] };
  await writeFile(join(directory, "config.json"), JSON.stringify(config));
  const log = await open(join(directory, "sandbox.log"), "w");
  const child = spawn(binary, ["--home", directory, "run"], {
    stdio: ["ignore", log.fd, log.fd],
    env: { NODE_ENV: "test", PATH: process.env.PATH, RUST_LOG: "error" },
  });
  const chain = new SandboxChainPort(`http://127.0.0.1:${rpcPort}`, chainId);
  async function stop() {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await log.close();
    await rm(directory, { recursive: true, force: true });
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null)
        throw new Error(
          `Local Sandbox exited. Inspect ${join(directory, "sandbox.log")}.`,
        );
      try {
        await chain.assertNetwork();
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!ready) throw new Error("Local Sandbox did not become ready.");
    // Only this newly initialized local genesis key is read. No saved user wallet is accessed.
    const genesisKey = record(
      JSON.parse(await readFile(join(directory, "validator_key.json"), "utf8")),
    );
    if (
      genesisKey.account_id !== "testnet" ||
      typeof genesisKey.secret_key !== "string" ||
      !genesisKey.secret_key.startsWith("ed25519:")
    )
      throw new Error("Unexpected local genesis identity.");
    const key = KeyPair.fromString(`ed25519:${genesisKey.secret_key.slice(8)}`);
    const root = new Account("testnet", chain.url, new KeyPairSigner(key));
    async function createAccount(
      name: string,
      amount = 1000n,
      parent: Account = root,
    ) {
      const key = KeyPair.fromRandom("ed25519");
      await parent.signAndSendTransaction({
        receiverId: name,
        actions: [
          actions.createAccount(),
          actions.transfer(amount * 10n ** 24n),
          actions.addFullAccessKey(key.getPublicKey()),
        ],
        waitUntil: "FINAL",
        retries: 0,
      });
      return new Account(name, chain.url, new KeyPairSigner(key));
    }
    const owner = await createAccount(registry.ownerId, 5000n);
    const player = await createAccount("alice.testnet", 100n);
    const other = await createAccount("bob.testnet", 100n);
    const gameWasm = await readFile(
      resolve(
        "contracts/target/wasm32-unknown-unknown/release/near_native_case_pool.wasm",
      ),
    );
    const tokenWasm = await readFile(
      resolve(
        "contracts/target/wasm32-unknown-unknown/release/iroh_mock_token.wasm",
      ),
    );
    async function call(
      account: Account,
      receiverId: string,
      methodName: string,
      args: Record<string, unknown>,
      deposit = "0",
      gas = "250000000000000",
    ) {
      return account.signAndSendTransaction({
        receiverId,
        actions: [
          actions.functionCall(methodName, args, BigInt(gas), BigInt(deposit)),
        ],
        waitUntil: "FINAL",
        retries: 0,
      });
    }
    const tokens = new Map<string, Account>();
    for (const entry of registry.cases)
      for (const reward of entry.config.bonus_rewards) {
        if (tokens.has(reward.token_contract_id)) continue;
        console.log(`Sandbox token ${reward.token_symbol}`);
        const token = await createAccount(
          reward.token_contract_id,
          10n,
          reward.token_contract_id.endsWith("." + owner.accountId)
            ? owner
            : root,
        );
        await token.deployContract(tokenWasm);
        await call(token, token.accountId, "new", {
          asset: reward.token_symbol.toUpperCase(),
          owner_id: owner.accountId,
        });
        tokens.set(token.accountId, token);
      }
    const games = new Map<string, Account>();
    for (const entry of registry.cases) {
      console.log(`Sandbox case ${entry.id}`);
      const game = await createAccount(entry.contractId, 10n, owner);
      await game.deployContract(gameWasm);
      await call(game, game.accountId, "new", {
        owner_id: owner.accountId,
        treasury_id: owner.accountId,
        config: entry.config,
      });
      await call(
        owner,
        game.accountId,
        "fund_pool",
        {},
        String(BigInt(entry.config.economy.rewards[2]) * 10n ** 18n * 2n),
      );
      for (const reward of entry.config.bonus_rewards) {
        const bounds = record(
          await chain.view(
            reward.token_contract_id,
            "storage_balance_bounds",
            {},
          ),
        );
        await call(
          owner,
          reward.token_contract_id,
          "storage_deposit",
          { account_id: game.accountId, registration_only: true },
          String(bounds.min),
        );
        await call(
          owner,
          reward.token_contract_id,
          "ft_transfer_call",
          {
            receiver_id: game.accountId,
            amount: String(BigInt(reward.amount) * 20n),
            msg: JSON.stringify({ action: "fund" }),
          },
          "1",
        );
      }
      await call(owner, game.accountId, "set_paused", { paused: false }, "1");
      games.set(entry.id, game);
    }
    return { chain, owner, player, other, games, tokens, call, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
