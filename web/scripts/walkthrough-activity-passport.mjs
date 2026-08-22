import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "activity-passport");
mkdirSync(OUT, { recursive: true });

const ADDR_BOTH = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const ADDR_STAKE = "0x47F58b1A3726A177EC934a425BA98d391746823b";
const ADDR_CLAIM = "0x31e14df3b4f47F2428F3B78E7279691A78f70a05";

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
}

const timings = [];

async function timeUrl(url, label) {
  const t0 = Date.now();
  const res = await fetch(url, { cache: "no-store" });
  await res.text();
  const ms = Date.now() - t0;
  timings.push({ label, url, status: res.status, ms });
  console.log(`TIME ${ms}ms ${res.status} ${label}`);
  return ms;
}

await timeUrl(`${BASE}/alpha-passport?address=${ADDR_BOTH}`, "passport-both-1");
await timeUrl(`${BASE}/alpha-passport?address=${ADDR_BOTH}`, "passport-both-2");
await timeUrl(`${BASE}/api/passport/${ADDR_BOTH}`, "api-passport-2");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(walletMock, ADDR_BOTH);
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));

await page.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.locator("h2:visible").filter({ hasText: "My Activity" }).first().waitFor({ timeout: 20000 });
await page.locator("h1:visible").filter({ hasText: "Live Verdicts" }).first().waitFor({ timeout: 20000 });
await page.locator("section").filter({ hasText: "My Activity" }).getByText(/Claim #/i).first().waitFor({ timeout: 90000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "01-my-activity.png"), fullPage: false });
await page.screenshot({ path: join(OUT, "01b-activity-page.png"), fullPage: true });

await page.goto(`${BASE}/alpha-passport?address=${ADDR_BOTH}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.locator("h2:visible").filter({ hasText: "Claimant record" }).first().waitFor({ timeout: 20000 });
await page.locator("h2:visible").filter({ hasText: "Staking record" }).first().waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "02-passport-both.png"), fullPage: true });

await page.goto(`${BASE}/alpha-passport?address=${ADDR_STAKE}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.locator("h2:visible").filter({ hasText: "Staking record" }).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "03-passport-staking-only.png"), fullPage: true });

await page.goto(`${BASE}/alpha-passport?address=${ADDR_CLAIM}`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.locator("h2:visible").filter({ hasText: "Staking record" }).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "04-passport-claimant-only.png"), fullPage: true });

await page.goto(`${BASE}/leaderboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "05-rankings-you.png"), fullPage: false });

writeFileSync(join(OUT, "timing.json"), JSON.stringify(timings, null, 2));
await browser.close();
console.log("ok", OUT, timings);
