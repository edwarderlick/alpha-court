import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "avatars-activity");
const ADDR = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

await context.addInitScript((address) => {
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "eth_chainId") return "0xf22f";
      if (method === "net_version") return "61999";
      if (method === "wallet_getSnaps") return {};
      if (method === "wallet_requestSnaps") return {};
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      return null;
    },
    on(event, cb) {
      (listeners[event] ||= []).push(cb);
    },
    removeListener(event, cb) {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
    },
  };
}, ADDR);

const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE", msg.text());
});

await page.goto(`${BASE}/cases/21`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByText(/win rate/i).first().waitFor({ timeout: 90000 });
await page.getByText("0x7E4E…9253").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "01-stakers-claim-21.png"), fullPage: false });
const header = page.locator("header").first();
if (await header.count()) {
  await header.screenshot({ path: join(OUT, "01b-wallet-chip.png") });
}

await page.goto(`${BASE}/leaderboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "02-leaderboard-avatars.png"), fullPage: false });

await page.goto(`${BASE}/alpha-passport?address=${ADDR}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "03-passport-avatar.png"), fullPage: false });

await page.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText(/Live Verdicts/i).waitFor({ timeout: 30000 });
await page.getByText(/left|resolved |settling/i).first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "04-activity-sorted.png"), fullPage: true });

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1400);
await page.screenshot({ path: join(OUT, "05-landing-cast.png"), fullPage: false });

await page.evaluate(() => {
  const emit = window.__alphaPulse;
  if (typeof emit === "function") {
    emit({
      kind: "created",
      claimId: "21",
      title: "ETH will be above 1",
      href: "/cases/21",
      tab: "Markets",
    });
  }
});
await page.getByText(/Docket live/i).waitFor({ timeout: 8000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "06-create-fanfare.png"), fullPage: false });
await page.waitForTimeout(4000);

await page.evaluate(() => {
  const emit = window.__alphaPulse;
  if (typeof emit === "function") {
    emit({
      kind: "resolved",
      claimId: "21",
      title: "SOL/USD above 76.1",
      verdict: "HELD",
      href: "/cases/21",
      tab: "Claims",
    });
  }
});
await page.getByText(/Your payout/i).waitFor({ timeout: 12000 });
await page.getByText(/2\.25/i).waitFor({ timeout: 8000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "07-win-fanfare.png"), fullPage: false });

await browser.close();
console.log("ok", OUT);
