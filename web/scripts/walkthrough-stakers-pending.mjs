import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "live-pending");
mkdirSync(OUT, { recursive: true });
const KEEPER = "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";

await fetch(`${BASE}/api/stakes/remember`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: KEEPER, claimId: "3", side: "for", amountGen: 1 }),
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 15000, animations: "disabled" });
  console.log("shot", name);
}

await page.goto(`${BASE}/cases/3`, { waitUntil: "domcontentloaded", timeout: 90000 });
const t0 = await page.locator(".claim-live-label, .claim-live-detail").allInnerTexts().catch(() => []);
await shot("06-claim-3-countdown-a");
await page.waitForTimeout(5000);
const t1 = await page.locator(".claim-live-label, .claim-live-detail").allInnerTexts().catch(() => []);
await shot("07-claim-3-countdown-b");

let stakers = "";
for (let i = 0; i < 8; i++) {
  stakers = await page.locator("body").innerText();
  if (/0x374d46|374D46/i.test(stakers) && /STAKERS/i.test(stakers) && /1(\.0)?/i.test(stakers) && !/No stakers indexed/i.test(stakers)) break;
  await page.waitForTimeout(2000);
}
await shot("08-stakers-live");
const stillOn3 = page.url().includes("/cases/3");

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
await page.waitForTimeout(1200);
await shot("09-markets-top-no-pending");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await shot("10-markets-pending-last");

const result = {
  stillOn3,
  countdownA: t0,
  countdownB: t1,
  countdownMoved: JSON.stringify(t0) !== JSON.stringify(t1),
  stakersHasWallet: /0x374d46/i.test(stakers),
  stakersEmpty: /No stakers indexed/i.test(stakers),
};
writeFileSync(join(OUT, "result2.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
