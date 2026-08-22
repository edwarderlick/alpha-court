import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "ux-polish");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(300000);

await page.goto(`${BASE}/post-a-claim`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByRole("button", { name: /PRICE THRESHOLD/i }).click();
await page.locator('input').filter({ hasNot: page.locator('[type="datetime-local"]') }).first();
const inputs = page.locator("input:not([type='datetime-local'])");
const count = await inputs.count();
for (let i = 0; i < count; i++) {
  const val = await inputs.nth(i).inputValue();
  if (val === "3000" || /^\d+(\.\d+)?$/.test(val)) {
    await inputs.nth(i).fill("1");
    break;
  }
}
await page.getByRole("button", { name: /^5 min$/i }).click();
await page.screenshot({ path: join(OUT, "03b-5min-ready.png"), fullPage: true });
await page.getByRole("button", { name: /Submit claim/i }).click();

const created = page.getByText(/Claim created\. Tx:/i);
const err = page.locator(".bg-dispute-red\\/10");
await Promise.race([created.waitFor({ timeout: 240000 }), err.waitFor({ timeout: 240000 })]);
await page.screenshot({ path: join(OUT, "05-created-5min.png"), fullPage: true });
if (!(await created.isVisible().catch(() => false))) {
  const t = await page.locator("body").innerText();
  throw new Error(t.slice(0, 1200));
}
const href = await page.getByRole("link", { name: /Open claim #/i }).getAttribute("href");
console.log("created", href);
await browser.close();
