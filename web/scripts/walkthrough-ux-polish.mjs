import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.WALKTHROUGH_BASE || "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "ux-polish");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const displayCalls = [];
page.on("request", (req) => {
  if (req.url().includes("/api/display")) displayCalls.push(req.url());
});

const log = [];

await page.goto(`${BASE}/cases/21`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText(/so FOR won/i).waitFor({ timeout: 30000 });
await page.screenshot({ path: join(OUT, "01-verdict-summary.png"), fullPage: true });
await page.getByRole("button", { name: /View full reasoning/i }).click();
await page.getByText(/The claim is HELD|posting-time price/i).waitFor({ timeout: 10000 });
await page.screenshot({ path: join(OUT, "02-verdict-expanded.png"), fullPage: true });
log.push("verdict ok");

await page.goto(`${BASE}/post-a-claim`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByRole("button", { name: /PRICE THRESHOLD/i }).click();
await page.getByRole("button", { name: /^5 min$/i }).waitFor({ timeout: 15000 });
await page.getByRole("button", { name: /^5 min$/i }).click();
await page.screenshot({ path: join(OUT, "03-deadline-5min.png"), fullPage: true });

const beforeCheck = displayCalls.length;
await page.getByRole("button", { name: /Check this mark/i }).click();
await page.locator(".mark-live").waitFor({ timeout: 30000 });
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "04-check-mark.png"), fullPage: true });
const afterCheck = displayCalls.length;
log.push(`display calls during check: ${afterCheck - beforeCheck} total=${afterCheck}`);

await page.getByRole("button", { name: /Submit claim/i }).click();
await page.getByText(/Claim created\. Tx:/i).waitFor({ timeout: 240000 });
await page.screenshot({ path: join(OUT, "05-created-5min.png"), fullPage: true });
const open = page.getByRole("link", { name: /Open claim #/i });
const href = (await open.getAttribute("href")) || "";
log.push(`created ${href}`);

writeFileSync(join(OUT, "log.json"), JSON.stringify({ log, displayCalls }, null, 2));
await browser.close();
console.log(JSON.stringify({ ok: true, log, displayCalls }, null, 2));
