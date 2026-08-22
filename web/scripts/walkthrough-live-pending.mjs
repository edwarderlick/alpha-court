import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "live-pending");
mkdirSync(OUT, { recursive: true });
const KEEPER = "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

async function shot(name) {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: false,
    timeout: 15000,
    animations: "disabled",
  });
  console.log("shot", name);
}

const pendingDraft = {
  claim_id: "pending-verify-ui",
  claim_type: "PRICE_THRESHOLD",
  asset: "ETH/USD",
  asset_b: null,
  metric: null,
  direction: "above",
  threshold: "999999",
  state: "OPEN",
  consensus_result: "",
  verdict_text: "",
  stake_for_total: "0",
  stake_against_total: "0",
  deadline: new Date(Date.now() + 3600_000).toISOString(),
  created_at: new Date().toISOString(),
  poster: KEEPER,
};

await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.evaluate((draft) => {
  localStorage.setItem("ac-local-dockets-v1", JSON.stringify([draft]));
  window.dispatchEvent(new Event("ac-local-dockets"));
}, pendingDraft);
await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
await shot("01-markets-pending-bottom");
const cardOrder = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("a.pressable, div.pressable")];
  return cards.map((el) => el.innerText.slice(0, 80).replace(/\s+/g, " "));
});
const pendingPos = cardOrder.findIndex((t) => /ID PENDING|pending-verify/i.test(t));
const livePos = cardOrder.findIndex((t) => /#\d+/.test(t) && !/ID PENDING/i.test(t));

await page.goto(`${BASE}/cases/3`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
await shot("02-claim-3-before-stake");
const beforeStakers = await page.locator("body").innerText();

const stakeRes = await page.evaluate(async () => {
  const res = await fetch("/api/claims/3/stake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side: "for", amountGen: 1 }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
});
console.log("stake", JSON.stringify(stakeRes));
await page.evaluate(() => window.dispatchEvent(new CustomEvent("ac-stakes-changed", { detail: { claimId: "3" } })));

let appeared = false;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText();
  if (/1(\.0)? GEN/i.test(text) && /STAKERS/i.test(text) && !/No stakers indexed/i.test(text)) {
    appeared = true;
    break;
  }
}
await shot("03-stakers-after-stake-no-nav");
const afterStakers = await page.locator("body").innerText();
const stillOn3 = page.url().includes("/cases/3");

await page.goto(`${BASE}/cases/1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("04-claim-1-status-start");
const startStatus = await page.locator(".claim-live-label").first().innerText().catch(() => "");
let endStatus = startStatus;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(4000);
  endStatus = await page.locator(".claim-live-label").first().innerText().catch(() => "");
  if (/HELD|BROKEN|RESOLVED/i.test(endStatus) && !/CONSENSUS/i.test(endStatus)) break;
  if (endStatus !== startStatus && !/CONSENSUS/i.test(endStatus)) break;
}
await shot("05-claim-1-status-later");
const stillOn1 = page.url().includes("/cases/1");

const result = {
  pendingPos,
  livePos,
  pendingAfterLive: pendingPos < 0 ? false : pendingPos > livePos,
  cardCount: cardOrder.length,
  lastCards: cardOrder.slice(-4),
  firstCards: cardOrder.slice(0, 3),
  stakeRes,
  appeared,
  stillOn3,
  beforeHadEmpty: /No stakers indexed/i.test(beforeStakers),
  afterHasAmount: /1(\.0)? GEN/i.test(afterStakers),
  startStatus,
  endStatus,
  stillOn1,
  statusChanged: startStatus !== endStatus,
};
writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await context.close();
await browser.close();
