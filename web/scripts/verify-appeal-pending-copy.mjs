import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = join(process.cwd(), "_verify", "appeal-pending-copy");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

let last = "";
for (let i = 0; i < 6; i++) {
  const res = await page.goto(`${BASE}/cases/4?preview=APPEAL_PENDING`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  last = body.slice(0, 200).replace(/\s+/g, " ");
  if (res?.status() === 200 && /APPEAL_PENDING|Second consensus/i.test(body) && !/Unexpected token|Runtime SyntaxError/i.test(body)) {
    break;
  }
  console.log("retry", i, res?.status(), last);
  await page.waitForTimeout(2500);
}

await page.getByText(/keeper is running the second round/i).first().waitFor({ timeout: 20000 });
await page.getByText(/nobody has to click/i).first().waitFor({ timeout: 10000 });
await page.getByText(/fallback: run second round now/i).first().waitFor({ timeout: 10000 });
await page.getByText(/second consensus in progress/i).first().waitFor({ timeout: 10000 });

const status = page.locator("text=Current status").locator("xpath=ancestor::div[contains(@class,'border')][1]");
const panel = page.getByText(/APPEAL_PENDING/i).locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");

await page.getByText(/fallback: run second round now/i).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "01-case-appeal-pending.png"), fullPage: false });
if (await status.count()) {
  await status.screenshot({ path: join(OUT, "02-claim-status-live.png") });
}
if (await panel.count()) {
  await panel.screenshot({ path: join(OUT, "03-appeal-panel.png") });
}

const text = await page.locator("body").innerText();
const checks = {
  statusKeeper: /keeper runs the second consensus round/i.test(text),
  statusNoClick: /nobody has to click/i.test(text),
  panelKeeper: /keeper is running the second round/i.test(text),
  panelNobody: /nobody has to click/i.test(text),
  fallbackButton: /fallback: run second round now/i.test(text),
  notPrimaryResolve: !/\bresolve appeal\b(?!.*fallback)/i.test(text.split("APPEAL_PENDING")[1]?.slice(0, 400) ?? ""),
  notFileAppeal: !/file appeal/i.test(text),
};

writeFileSync(join(OUT, "result.json"), JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));

const failed = Object.entries(checks).filter(([, v]) => !v);
if (failed.length) {
  console.error("COPY FAIL", failed.map(([k]) => k));
  process.exit(1);
}

await browser.close();
console.log("PASS", OUT);
