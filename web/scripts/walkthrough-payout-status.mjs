import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "payout-31");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/cases/31`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.getByText(/Stakers|win rate|WON/i).first().waitFor({ timeout: 90000 }).catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "01-claim-31-detail.png"), fullPage: false });

await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "02-markets-status-live.png"), fullPage: false });

await page.goto(`${BASE}/cases/2`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "03-detail-settling.png"), fullPage: false });

await browser.close();
console.log("ok", OUT);
