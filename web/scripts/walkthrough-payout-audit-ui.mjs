import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/cases/2`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);
const claim2Text = await page.locator("body").innerText();
await page.screenshot({ path: join(OUT, "02-claim-2-legacy.png"), fullPage: false });

await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);
const marketsText = await page.locator("body").innerText();
await page.screenshot({ path: join(OUT, "04-markets-open-countdown.png"), fullPage: false });
await page.screenshot({ path: join(OUT, "03-markets-grid.png"), fullPage: false });

const result = {
  claim2HasLegacy: /legacy docket/i.test(claim2Text),
  claim2HasConsensus: /consensus in progress/i.test(claim2Text),
  claim2HasSettling: /\bsettling\b/i.test(claim2Text),
  marketsHasLegacy: /legacy docket/i.test(marketsText),
  marketsHasCountdown: /\d{2}:\d{2}:\d{2}/.test(marketsText) && /open/i.test(marketsText),
};
writeFileSync(join(OUT, "ui-check.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

await browser.close();
