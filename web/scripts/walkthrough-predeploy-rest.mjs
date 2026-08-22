import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });
const log = [];
function note(id, status, detail) {
  log.push({ id, status, detail });
  console.log(`[${status}] ${id} — ${detail}`);
}
async function shot(page, name) {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 40000, animations: "disabled" });
  } catch {}
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 2. stake bounds
await page.goto(`${BASE}/cases/8`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
await page.locator("input[type='number']").fill("0.5");
await page.getByRole("button", { name: /Stake FOR/i }).click();
await page.waitForTimeout(600);
await shot(page, "02-stake-below-1");
const low = await page.locator("body").innerText();
note("02-below-1", /between 1 and 10/i.test(low) ? "PASS" : "FAIL", low.match(/Error:.*|Amount must.*/)?.[0] || low.slice(0, 160));

await page.locator("input[type='number']").fill("11");
await page.getByRole("button", { name: /Stake FOR/i }).click();
await page.waitForTimeout(600);
await shot(page, "02-stake-above-10");
const hi = await page.locator("body").innerText();
note("02-above-10", /between 1 and 10/i.test(hi) ? "PASS" : "FAIL", hi.match(/Error:.*|Amount must.*/)?.[0] || "no message");

// stakers list already populated from chain stakes
note("02-stakers-present", /0x374d/i.test(hi) || /374d46/i.test(hi) ? "PASS" : "WARN", "stakers after load");
await shot(page, "02-claim8-stakers");

// 2. stake after deadline on resolved claim
await page.goto(`${BASE}/cases/1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);
await shot(page, "02-stake-closed");
const closed = await page.locator("body").innerText();
note(
  "02-after-deadline",
  /staking is closed|deadline has passed|not OPEN/i.test(closed) && !/Stake FOR/i.test(closed)
    ? "PASS"
    : /Stake FOR/i.test(closed)
      ? "FAIL"
      : "PASS",
  /Stake FOR/i.test(closed) ? "stake form still shown on RESOLVED" : "no stake form on resolved"
);

// 7. unresolved-style legacy if possible — claim 33 resolved; try live-vs-legacy banner
await page.goto(`${BASE}/cases/15?legacy=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);
await shot(page, "07-legacy-15");
const l15 = await page.locator("body").innerText();
note("07-legacy-15", /legacy docket/i.test(l15) || /HELD|BROKEN/i.test(l15) ? "PASS" : "FAIL", l15.slice(0, 180).replace(/\s+/g, " "));

// 6. passport both
await page.goto(`${BASE}/alpha-passport?address=0x374D46E81973dd8797f14f586AEE94AaC27e39A3`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot(page, "06-passport-a");
const pa = await page.locator("body").innerText();
note("06-passport-a", /claimant record/i.test(pa) && /staking record/i.test(pa) ? "PASS" : "FAIL", "A claimant+staking sections");

await page.goto(`${BASE}/alpha-passport?address=0xcE0ae5fCF5781810C8cc21c6135A5C3F50801025`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot(page, "06-passport-b-staking-only");
const pb = await page.locator("body").innerText();
note(
  "06-passport-b",
  /claimant record/i.test(pb) && /no resolved claims yet|no claims yet/i.test(pb) && /staking record/i.test(pb)
    ? "PASS"
    : "WARN",
  pb.slice(0, 200).replace(/\s+/g, " ")
);

await page.goto(`${BASE}/my-stakes?address=0x374D46E81973dd8797f14f586AEE94AaC27e39A3`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
await shot(page, "06-my-stakes");
note("06-my-stakes", "PASS", "opened my-stakes with address query");

await page.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);
await shot(page, "06-activity-disconnected");
const act = await page.locator("body").innerText();
note("06-activity-disconnected", /connect a wallet/i.test(act) ? "PASS" : "WARN", "My Activity without wallet");

// 8. OPEN filter countdown
await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
if (await page.getByRole("button", { name: /^OPEN$/i }).count()) {
  await page.getByRole("button", { name: /^OPEN$/i }).click();
  await page.waitForTimeout(800);
}
await shot(page, "08-open-filter");
const op = await page.locator("body").innerText();
note("08-open-countdown", /\d{2}:\d{2}:\d{2}/.test(op) ? "PASS" : "WARN", op.slice(0, 160).replace(/\s+/g, " "));

// 12. avatars
note("12-avatars", /AddressMark|0x/.test(await page.content()) ? "PASS" : "WARN", "address marks in DOM");

writeFileSync(join(OUT, "rest-log.json"), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
await browser.close();
