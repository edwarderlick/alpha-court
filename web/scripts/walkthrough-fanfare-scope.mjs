import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "fanfare-scope");
mkdirSync(OUT, { recursive: true });

const ADDR_A = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const ADDR_B = "0x47F58b1A3726A177EC934a425BA98d391746823b";

function walletMock(address) {
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "eth_chainId") return "0xf22f";
      if (method === "net_version") return "61999";
      if (method === "wallet_getSnaps") return {};
      if (method === "wallet_requestSnaps") return {};
      return null;
    },
    on(event, cb) {
      (listeners[event] ||= []).push(cb);
    },
    removeListener(event, cb) {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
    },
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

const pageA = await context.newPage();
await pageA.addInitScript(walletMock, ADDR_A);
const pageB = await context.newPage();
await pageB.addInitScript(walletMock, ADDR_B);

pageA.on("pageerror", (err) => console.log("A PAGEERROR", err.message));
pageB.on("pageerror", (err) => console.log("B PAGEERROR", err.message));

await pageA.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
await pageB.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
await pageA.getByText("0x7E4E…9253").first().waitFor({ timeout: 20000 });
await pageB.getByText("0x47F5…823b").first().waitFor({ timeout: 20000 });

await pageA.evaluate(() => {
  window.__alphaPulse({
    kind: "stake_for",
    claimId: "21",
    title: "SOL/USD above 76.1",
    amount: "3",
    href: "/cases/21",
    tab: "Markets",
  });
});

await pageA.getByText("FOR FILLED").first().waitFor({ timeout: 8000 });
await pageA.waitForTimeout(400);
await pageA.screenshot({ path: join(OUT, "01-wallet-a-sees-own-stake.png") });

const bHasTicket = await pageB.locator(".market-pulse-root").count();
await pageB.waitForTimeout(400);
await pageB.screenshot({ path: join(OUT, "02-wallet-b-does-not-see-a.png") });

await pageB.evaluate(() => {
  const ch = new BroadcastChannel("alpha-court-pulse");
  ch.postMessage({
    id: `stake:leak:${Date.now()}`,
    kind: "stake_against",
    claimId: "21",
    title: "LEAKED AGAINST",
    amount: "5",
    href: "/cases/21",
    tab: "Markets",
    ts: Date.now(),
  });
  ch.close();
});
await pageA.waitForTimeout(800);
const aHasLeak = await pageA.getByText("LEAKED AGAINST").count();
await pageA.screenshot({ path: join(OUT, "03-channel-leak-rejected.png") });

const result = {
  aSawOwnStake: (await pageA.getByText("FOR FILLED").count()) > 0,
  bSawAStake: bHasTicket > 0,
  aSawBroadcastLeak: aHasLeak > 0,
};
writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
console.log(result);
if (!result.aSawOwnStake || result.bSawAStake || result.aSawBroadcastLeak) {
  throw new Error("fanfare scoping failed " + JSON.stringify(result));
}

await browser.close();
console.log("ok", OUT);
