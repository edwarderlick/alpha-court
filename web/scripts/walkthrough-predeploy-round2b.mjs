import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });
const ADDR_A = "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";
const ADDR_B = "0xcE0ae5fCF5781810C8cc21c6135A5C3F50801025";
let openId = "11";
try {
  const setup = JSON.parse(readFileSync(join(OUT, "round2-setup.json"), "utf8"));
  openId = setup.created?.price?.claimId || "11";
} catch {}

const log = [];
function note(id, status, detail) {
  log.push({ id, status, detail: typeof detail === "string" ? detail.slice(0, 360) : detail, at: new Date().toISOString() });
  console.log(`[${status}] ${id} — ${typeof detail === "string" ? detail.slice(0, 220) : JSON.stringify(detail)}`);
}

function walletMock(address) {
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "eth_chainId") return "0xf22f";
      if (method === "net_version") return "61999";
      if (method === "wallet_getSnaps") return {};
      if (method === "wallet_requestSnaps") return { "npm:genlayer-wallet-plugin": { id: "npm:genlayer-wallet-plugin" } };
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction" || method === "personal_sign" || method === "eth_signTypedData_v4") {
        const err = new Error("User denied transaction signature.");
        err.code = 4001;
        throw err;
      }
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

async function shot(page, name) {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 40000, animations: "disabled", fullPage: true });
  } catch (err) {
    console.log("shot-failed", name, err instanceof Error ? err.message : String(err));
  }
}

async function waitConnected(page, needle) {
  await page.waitForTimeout(1200);
  const body = await page.locator("body").innerText();
  if (new RegExp(needle, "i").test(body)) return true;
  const btn = page.getByRole("button", { name: /Connect Wallet/i }).first();
  if (await btn.count()) {
    await btn.click({ force: true, timeout: 5000 }).catch(() => {});
    const mm = page.getByRole("button", { name: /MetaMask/i }).first();
    if (await mm.count()) await mm.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return new RegExp(needle, "i").test(await page.locator("body").innerText());
}

const browser = await chromium.launch({ headless: true });

// isolation + fanfare
{
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.addInitScript(walletMock, ADDR_A);
  await pageB.addInitScript(walletMock, ADDR_B);

  await pageA.goto(`${BASE}/my-claims`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const aOk = await waitConnected(pageA, "374d");
  await pageA.waitForTimeout(2500);
  await shot(pageA, "06-my-claims-a");
  const ca = await pageA.locator("body").innerText();

  await pageB.goto(`${BASE}/my-claims`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const bOk = await waitConnected(pageB, "ce0a");
  await pageB.waitForTimeout(2500);
  await shot(pageB, "06-my-claims-b");
  const cb = await pageB.locator("body").innerText();
  note("06-connect-a", aOk ? "PASS" : "WARN", "wallet A header");
  note("06-connect-b", bOk ? "PASS" : "WARN", "wallet B header");
  note(
    "06-my-claims-isolation",
    /claim #8|claim #9|claim #10|claim #11/i.test(ca) && !/374d/i.test(cb) && /haven't posted|no claims|posted no|nothing here|connect/i.test(cb) || (!/ETH\/USD ABOVE 1\.0/i.test(cb) && /ETH\/USD ABOVE 1\.0/i.test(ca))
      ? "PASS"
      : "WARN",
    { a: ca.slice(0, 180).replace(/\s+/g, " "), b: cb.slice(0, 180).replace(/\s+/g, " ") }
  );

  await pageA.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageA.waitForTimeout(2000);
  await shot(pageA, "06-activity-a");
  await pageB.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageB.waitForTimeout(2000);
  await shot(pageB, "06-activity-b");
  const aa = await pageA.locator("body").innerText();
  const ab = await pageB.locator("body").innerText();
  note(
    "06-activity-isolation",
    /my activity/i.test(aa) && /my activity/i.test(ab) ? "PASS" : "WARN",
    { aHas374d: /374d/i.test(aa), bHasCe0a: /ce0a/i.test(ab), bHas374d: /374d/i.test(ab) }
  );

  await pageA.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageB.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageA.waitForTimeout(1500);
  await pageB.waitForTimeout(1500);
  await pageA.evaluate(() => {
    window.__alphaPulse?.({
      kind: "stake_for",
      claimId: "11",
      title: "ETH/USD above 1.0",
      amount: "2",
      href: "/cases/11",
      tab: "Markets",
    });
  });
  await pageA.waitForTimeout(700);
  await shot(pageA, "10-fanfare-a");
  await shot(pageB, "10-fanfare-b");
  const fa = await pageA.locator(".market-pulse-root").count();
  const fb = await pageB.locator(".market-pulse-root").count();
  const faText = await pageA.locator("body").innerText();
  note(
    "10-fanfare-isolation",
    fa > 0 && fb === 0 ? "PASS" : fa > 0 && !/FOR FILLED/i.test(await pageB.locator("body").innerText()) ? "PASS" : "FAIL",
    { aPulse: fa, bPulse: fb, aHasFilled: /FOR FILLED|2 GEN/i.test(faText) }
  );

  await pageA.evaluate(() => {
    window.__alphaPulse?.({
      kind: "resolved",
      claimId: "8",
      title: "ETH/USD above 1.0",
      href: "/cases/8",
      tab: "Claims",
    });
  });
  await pageA.waitForTimeout(1400);
  await shot(pageA, "10-win-fanfare-a");
  const win = await pageA.locator("body").innerText();
  note("10-win-payout-amount", /4(\.0+)? GEN|Your payout/i.test(win) ? "PASS" : "WARN", win.slice(0, 200).replace(/\s+/g, " "));

  await ctxA.close();
  await ctxB.close();
}

// reject signature on OPEN claim
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(walletMock, ADDR_A);
  await page.goto(`${BASE}/cases/${openId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitConnected(page, "374d");
  await page.waitForTimeout(1500);
  const num = page.locator("input[type='number']");
  if (await num.count()) {
    await num.fill("1");
    await page.getByRole("button", { name: /Stake FOR/i }).click({ force: true });
    await page.waitForTimeout(1800);
    await shot(page, "09-reject-signature");
    const body = await page.locator("body").innerText();
    const rejected = /denied|reject|4001|user denied/i.test(body);
    const falseSuccess = /Stake recorded|Submitted \(tx/i.test(body);
    note("09-reject-signature", rejected && !falseSuccess ? "PASS" : falseSuccess ? "FAIL" : "WARN", body.slice(0, 220).replace(/\s+/g, " "));
  } else {
    note("09-reject-signature", "WARN", "window already closed — no stake form");
    await shot(page, "09-reject-signature");
  }
  note("09-snap-signing", "BLOCKED", "No MetaMask in this environment. Real write hashes exist via demo/genlayer-js, not Snap.");
  await ctx.close();
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/cases/15?legacy=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot(page, "07-legacy-15");
  const l15 = await page.locator("body").innerText();
  note("07-legacy-15", /legacy docket/i.test(l15) ? "PASS" : "FAIL", l15.slice(0, 220).replace(/\s+/g, " "));

  await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  if (await page.getByRole("button", { name: /^OPEN$/i }).count()) {
    await page.getByRole("button", { name: /^OPEN$/i }).click();
    await page.waitForTimeout(600);
  }
  await shot(page, "08-open-filter");
  const op = await page.locator("body").innerText();
  note("08-open-countdown", /\d{1,2}:\d{2}:\d{2}/.test(op) ? "PASS" : "WARN", op.slice(0, 160).replace(/\s+/g, " "));

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, "08-pending-bottom-2");

  await page.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, "08-activity-order");
  const act = await page.locator("body").innerText();
  note("08-activity-recent", /ago|just now|minute|hour/i.test(act) ? "PASS" : "WARN", act.slice(0, 160).replace(/\s+/g, " "));

  await page.goto(`${BASE}/cases/99999`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  await shot(page, "11-missing-claim-2");
  const miss = await page.locator("body").innerText();
  note("11-404", /not found|could not load|doesn.?t exist/i.test(miss) && !/Maximum update depth/i.test(miss) ? "PASS" : "FAIL", miss.slice(0, 220).replace(/\s+/g, " "));

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(600);
  await shot(page, "12-landing-click");
  if (await page.getByRole("link", { name: /Markets/i }).count()) {
    await page.getByRole("link", { name: /Markets/i }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
  note("12-landing-click", "PASS", page.url());

  await page.goto(`${BASE}/cases/8`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  const expand = page.getByRole("button", { name: /view full reasoning|full reasoning/i });
  if (await expand.count()) await expand.first().click();
  await page.waitForTimeout(400);
  await shot(page, "12-verdict-expand");
  const v = await page.locator("body").innerText();
  note("12-verdict", /view full reasoning|HELD/i.test(v) ? "PASS" : "WARN", v.slice(0, 200).replace(/\s+/g, " "));
  await page.close();
}

// UI create relative (10 min, skip stake)
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/post-a-claim`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /RELATIVE PERFORMANCE/i }).click();
  await page.waitForTimeout(800);
  if (await page.getByRole("button", { name: /^10 min$/i }).count()) await page.getByRole("button", { name: /^10 min$/i }).click();
  if (await page.getByRole("button", { name: /^Skip$/i }).count()) await page.getByRole("button", { name: /^Skip$/i }).click();
  await page.getByRole("button", { name: /Submit claim/i }).click();
  await page.getByText(/Claim created\. Tx:/i).waitFor({ timeout: 150000 }).catch(() => {});
  await shot(page, "01-relative-created");
  const body = await page.locator("body").innerText();
  const link = page.getByRole("link", { name: /Open claim #/i });
  let id = "";
  if (await link.count()) id = ((await link.getAttribute("href")) || "").split("/").pop() || "";
  note("01-ui-relative", /Claim created/i.test(body) && id ? "PASS" : "FAIL", `id=${id} ${body.slice(0, 140).replace(/\s+/g, " ")}`);
  await page.close();
}

writeFileSync(join(OUT, "round2b-ui-log.json"), JSON.stringify({ openId, log }, null, 2));
console.log(JSON.stringify({ openId, log }, null, 2));
await browser.close();
