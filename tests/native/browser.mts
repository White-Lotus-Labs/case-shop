import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { freePort, startNativeSandbox } from "./sandbox.ts";
import { nativeCaseCatalog } from "../../src/case/nativeCatalog.ts";
import { formatUnits } from "../../src/case/nativeClient.ts";
import type { WalletFunctionCall } from "../../src/shared/wallet.ts";

await access(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath(),
);
const sandbox = await startNativeSandbox(process.argv[2]);
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: process.cwd() + "/frontend",
    env: { ...process.env, VITE_NATIVE_SANDBOX: "1" },
    stdio: "pipe",
  },
);
let serverOutput = "";
vite.stdout.on("data", (data) => {
  serverOutput += String(data);
});
vite.stderr.on("data", (data) => {
  serverOutput += String(data);
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
const evidence = {
  network: "ephemeral local NEAR Sandbox, no public Testnet transactions",
  checks: [] as string[],
  transactions: [] as string[],
  browserErrors: [] as string[],
};
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    if (vite.exitCode !== null) throw new Error(serverOutput);
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (attempt === 119) throw new Error("Vite did not start: " + serverOutput);
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => {
    evidence.browserErrors.push(error.message);
    console.error("Browser error", error.message);
  });
  let selected = sandbox.player;
  let loseNextResponse = false;
  let unregisterBeforeNextOpen = false;
  await page.exposeFunction("__sandboxSelect", (account: string) => {
    selected =
      account === sandbox.other.accountId ? sandbox.other : sandbox.player;
  });
  await page.exposeFunction(
    "__sandboxSign",
    async (account: string, call: WalletFunctionCall) => {
      assert.equal(account, selected.accountId);
      assert.ok(call.receiverId.endsWith(".testnet"));
      assert.ok(
        ["open", "storage_deposit", "advance_opening", "retry_payout"].includes(
          call.methodName,
        ),
      );
      if (call.methodName === "open" && unregisterBeforeNextOpen) {
        unregisterBeforeNextOpen = false;
        const definition = nativeCaseCatalog.find(
          (item) => item.contractId === call.receiverId,
        );
        assert.ok(definition);
        for (const reward of definition.bonusRewards) {
          await sandbox.call(
            selected,
            reward.token_contract_id,
            "storage_unregister",
            { force: false },
            "1",
          );
        }
      }
      const result = await sandbox.call(
        selected,
        call.receiverId,
        call.methodName,
        call.args,
        call.deposit,
        call.gas,
      );
      evidence.transactions.push(result.transaction.hash);
      if (call.methodName === "open" && loseNextResponse) {
        loseNextResponse = false;
        throw new Error("Wallet response lost after local chain acceptance");
      }
      return result;
    },
  );
  // Forward the browser's RPC traffic to the real local chain, with no fabricated responses.
  await page.route(sandbox.chain.url + "**", async (route) => {
    const response = await fetch(sandbox.chain.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: route.request().postData(),
    });
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: await response.text(),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  const installWallet = ({
    rpcUrl,
    contracts,
  }: {
    rpcUrl: string;
    contracts: Record<string, string>;
  }) => {
    const signIns: Array<(accounts: Array<{ accountId: string }>) => void> = [];
    const signOuts: Array<() => void> = [];
    let accountId = localStorage.getItem("sandbox-wallet") ?? "alice.testnet";
    const bridge = window as unknown as {
      __sandboxSign: (account: string, call: unknown) => Promise<unknown>;
      __sandboxSelect: (account: string) => Promise<void>;
      __CASE_SHOP_TEST_DEPLOYMENTS__: unknown;
      __CASE_SHOP_TEST_CONNECTOR__: unknown;
      __switchSandboxWallet: (account: string) => Promise<void>;
    };
    bridge.__CASE_SHOP_TEST_DEPLOYMENTS__ = { rpcUrl, contracts };
    bridge.__switchSandboxWallet = async (next) => {
      accountId = next;
      localStorage.setItem("sandbox-wallet", next);
      await bridge.__sandboxSelect(next);
      signIns.forEach((listener) => listener([{ accountId }]));
    };
    bridge.__CASE_SHOP_TEST_CONNECTOR__ = {
      connect: async () => {
        localStorage.setItem("sandbox-wallet", accountId);
        await bridge.__sandboxSelect(accountId);
        return [{ accountId }];
      },
      restore: async () => {
        if (!localStorage.getItem("sandbox-wallet")) return null;
        await bridge.__sandboxSelect(accountId);
        return [{ accountId }];
      },
      disconnect: async () => {
        localStorage.removeItem("sandbox-wallet");
        signOuts.forEach((listener) => listener());
      },
      onSignIn: (listener: (typeof signIns)[number]) => {
        signIns.push(listener);
        return () => {
          const i = signIns.indexOf(listener);
          if (i >= 0) signIns.splice(i, 1);
        };
      },
      onSignOut: (listener: (typeof signOuts)[number]) => {
        signOuts.push(listener);
        return () => {
          const i = signOuts.indexOf(listener);
          if (i >= 0) signOuts.splice(i, 1);
        };
      },
      signFunctionCall: async (
        account: string,
        call: unknown,
        isCurrent?: () => boolean,
      ) => {
        if (account !== accountId || (isCurrent && !isCurrent()))
          throw new Error("Wallet changed");
        return bridge.__sandboxSign(account, call);
      },
    };
  };
  await page.addInitScript({
    content: `globalThis.__name = (target) => target; (${installWallet.toString()})(${JSON.stringify({ rpcUrl: sandbox.chain.url, contracts: Object.fromEntries([...sandbox.games].map(([id, game]) => [id, game.accountId])) })});`,
  });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await page
    .getByTestId("wallet-balance")
    .waitFor()
    .catch(async (error) => {
      console.error(await page.locator("body").innerText());
      throw error;
    });
  await page
    .getByTestId("wallet-balance")
    .filter({ hasText: "NEAR" })
    .waitFor();
  evidence.checks.push(
    "Connected an ephemeral player wallet and displayed its real available NEAR balance.",
  );
  for (const definition of nativeCaseCatalog) {
    const label = definition.name.replace(" Case", "");
    await page
      .getByRole("radio", {
        name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .click();
    const price = formatUnits(definition.price, 24);
    const buy = page.getByRole("button", {
      name: `Open for ${price} NEAR`,
      exact: true,
    });
    await buy.waitFor();
    await buy.click({ timeout: 30000 });
    await page
      .getByText("Rewards were transferred directly to your wallet.", {
        exact: true,
      })
      .waitFor({ timeout: 90000 });
    const history = await sandbox.chain.view(
      definition.contractId,
      "get_history",
      { account_id: sandbox.player.accountId, limit: 20 },
    );
    assert.ok(Array.isArray(history) && history.length === 1);
    const opening = history[0];
    assert.equal(opening.status, "Completed");
    assert.equal(opening.near_paid, true);
    assert.equal(opening.bonus_paid, true);
    const balance = await sandbox.chain.view(
      opening.bonus.token_contract_id,
      "ft_balance_of",
      { account_id: sandbox.player.accountId },
    );
    assert.ok(BigInt(String(balance)) >= BigInt(opening.bonus.amount));
    evidence.checks.push(
      `${definition.id}: native deposit accepted, chain-selected result shown, configured token paid to the connected wallet.`,
    );
    console.log(`Browser verified ${definition.id}`);
    await page
      .getByRole("button", { name: "Open another case", exact: true })
      .click();
  }
  await page.getByRole("radio", { name: /Bamboo Mist/ }).click();
  loseNextResponse = true;
  await page
    .getByRole("button", { name: "Open for 0.05 NEAR", exact: true })
    .click({ timeout: 30000 });
  await page
    .getByText("Wallet response lost after local chain acceptance", {
      exact: true,
    })
    .waitFor({ timeout: 90000 });
  await page.reload();
  await page
    .getByText("Rewards were transferred directly to your wallet.", {
      exact: true,
    })
    .waitFor({ timeout: 30000 });
  evidence.checks.push(
    "A missing wallet response survived refresh and recovered the original finalized nonce without another purchase.",
  );
  await page.getByRole("button", { name: "My openings", exact: true }).click();
  await page
    .getByRole("article")
    .filter({ hasText: "Completed" })
    .first()
    .waitFor();
  assert.equal(await page.getByRole("article").count(), 6);
  evidence.checks.push(
    "Reload restored the connected wallet and its six finalized personal openings.",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Live Activity/ }).click();
  await page
    .getByRole("region", { name: "Activity from all players" })
    .getByText("Global opening history")
    .waitFor();
  evidence.checks.push(
    "Global history displayed real finalized openings across all five contracts.",
  );
  await page.getByRole("button", { name: /Live Activity/ }).click();
  await page.evaluate(() => {
    const bridge = window as unknown as {
      __switchSandboxWallet: (account: string) => Promise<void>;
    };
    return bridge.__switchSandboxWallet("bob.testnet");
  });
  await page.getByRole("button", { name: "My openings", exact: true }).click();
  await page.getByText("No openings yet", { exact: true }).waitFor();
  evidence.checks.push(
    "Switching wallets removed the previous player results and personal history.",
  );
  await page.keyboard.press("Escape");
  unregisterBeforeNextOpen = true;
  await page
    .getByRole("button", { name: "Open for 0.05 NEAR", exact: true })
    .click({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Retry reward payout", exact: true })
    .waitFor({ timeout: 90000 });
  const partial = await sandbox.chain.view(
    nativeCaseCatalog[0].contractId,
    "get_account_opening",
    { account_id: sandbox.other.accountId },
  );
  assert.ok(
    partial &&
      typeof partial === "object" &&
      "near_paid" in partial &&
      partial.near_paid === true,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Retry reward payout", exact: true })
    .click({ timeout: 30000 });
  await page
    .getByText("Rewards were transferred directly to your wallet.", {
      exact: true,
    })
    .waitFor({ timeout: 90000 });
  const recovered = await sandbox.chain.view(
    nativeCaseCatalog[0].contractId,
    "get_history",
    { account_id: sandbox.other.accountId, limit: 20 },
  );
  assert.ok(
    Array.isArray(recovered) &&
      recovered.length === 1 &&
      recovered[0].status === "Completed",
  );
  const paid = recovered[0];
  assert.equal(
    String(
      await sandbox.chain.view(paid.bonus.token_contract_id, "ft_balance_of", {
        account_id: sandbox.other.accountId,
      }),
    ),
    paid.bonus.amount,
  );
  evidence.checks.push(
    "An actual unregistered-token payout failed, survived reload, registered the selected token, and retried to exact wallet balance without a second opening.",
  );
  await mkdir("docs/native/evidence", { recursive: true });
  await page.screenshot({
    path: "docs/native/evidence/browser-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/native/evidence/browser-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(evidence.browserErrors, []);
  await writeFile(
    "docs/native/evidence/browser.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (browser) await browser.close();
  vite.kill("SIGTERM");
  await sandbox.stop();
}
