import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { createAccount, createClient, chains } from "genlayer-js";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });
const claimId = process.argv[2] || "8";

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const b = JSON.parse(readFileSync(join(OUT, "wallet-b.json"), "utf8"));
const c = JSON.parse(readFileSync(join(OUT, "wallet-c.json"), "utf8"));
const client = createClient({ chain: chains.studionet, account: createAccount(keyA) });
const addrs = {
  a: createAccount(keyA).address,
  b: b.address,
  c: c.address,
};

async function bals() {
  const out = {};
  for (const [k, addr] of Object.entries(addrs)) {
    out[k] = (await client.getBalance({ address: addr })).toString();
  }
  return out;
}

const before = await bals();
writeFileSync(join(OUT, `balances-before-${claimId}.json`), JSON.stringify(before, null, 2));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/cases/${claimId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
const trail = [];
async function snap(tag) {
  const label = await page.locator(".claim-live-label").first().innerText().catch(() => "");
  const body = (await page.locator("body").innerText()).slice(0, 400);
  trail.push({ t: new Date().toISOString(), label, url: page.url() });
  try {
    await page.screenshot({ path: join(OUT, `settle-${claimId}-${tag}.png`), timeout: 30000, animations: "disabled" });
  } catch {}
  console.log(tag, label);
  return label;
}

let last = await snap("start");
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(20000);
  const label = await page.locator(".claim-live-label").first().innerText().catch(() => "");
  if (label && label !== last) {
    last = label;
    await snap(`step-${i}-${label.replace(/\s+/g, "-").slice(0, 24)}`);
  }
  if (/HELD|BROKEN|RESOLVED/i.test(label) && !/CONSENSUS|OPEN|SETTLING/i.test(label)) {
    await snap("final");
    break;
  }
}
const after = await bals();
writeFileSync(
  join(OUT, `settle-${claimId}.json`),
  JSON.stringify({ claimId, before, after, trail, stayed: page.url().includes(`/cases/${claimId}`) }, null, 2)
);
console.log(JSON.stringify({ last, trail, before, after, stayed: page.url().includes(`/cases/${claimId}`) }, null, 2));
await browser.close();
