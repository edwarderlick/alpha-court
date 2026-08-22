import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });
const log = [];
function note(id, status, detail) {
  log.push({ id, status, detail, at: new Date().toISOString() });
  console.log(`[${status}] ${id} — ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const displayHits = [];
page.on("request", (req) => {
  if (req.url().includes("/api/display")) displayHits.push({ url: req.url(), t: Date.now() });
});

async function shot(name) {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 45000, animations: "disabled" });
  } catch (err) {
    console.log("shot-failed", name, err instanceof Error ? err.message : String(err));
  }
}

function localDeadline(minutes) {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- 11. 404 ---
await page.goto(`${BASE}/cases/99999`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("11-missing-claim");
const miss = await page.locator("body").innerText();
note(
  "11-404",
  /not found|could not load|doesn.?t exist/i.test(miss) && !/Maximum update depth/i.test(miss) ? "PASS" : "FAIL",
  miss.slice(0, 240).replace(/\s+/g, " ")
);

// --- 11. empty states ---
const fresh = "0x00000000000000000000000000000000000000aa";
await page.goto(`${BASE}/alpha-passport?address=${fresh}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);
await shot("11-passport-empty");
const pEmpty = await page.locator("body").innerText();
note(
  "11-passport-empty",
  /crash|Maximum update depth/i.test(pEmpty) ? "FAIL" : "PASS",
  pEmpty.slice(0, 200).replace(/\s+/g, " ")
);
await page.goto(`${BASE}/my-stakes`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
await shot("11-stakes-empty");
const sEmpty = await page.locator("body").innerText();
note("11-stakes-empty", /connect|no indexed|haven't|hasn.?t|no wallet/i.test(sEmpty) ? "PASS" : "WARN", sEmpty.slice(0, 180).replace(/\s+/g, " "));
await page.goto(`${BASE}/my-claims`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(800);
await shot("11-claims-empty");

// --- 12. landing ---
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2000);
await shot("12-landing");
note("12-landing", "PASS", "landing rendered");

// --- 7. legacy ---
await page.goto(`${BASE}/cases/33?legacy=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("07-legacy-33");
const leg = await page.locator("body").innerText();
note(
  "07-legacy-label",
  /legacy docket/i.test(leg) ? "PASS" : "FAIL",
  /legacy docket/i.test(leg) ? "Legacy docket shown" : leg.slice(0, 220).replace(/\s+/g, " ")
);
note("07-banner", /live court/i.test(leg) && /historical|legacy/i.test(leg) ? "PASS" : "FAIL", "banner on case page");

// --- 5. appeal UI on RESOLVED vs CONTESTED ---
await page.goto(`${BASE}/cases/1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("05-resolved-no-appeal");
const r1 = await page.locator("body").innerText();
note(
  "05-resolved-no-appeal",
  /file appeal/i.test(r1) ? "FAIL" : "PASS",
  /file appeal/i.test(r1) ? "Appeal UI shown on RESOLVED" : "No File Appeal on claim 1"
);
await page.goto(`${BASE}/cases/4`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("05-contested-appeal");
const c4 = await page.locator("body").innerText();
note(
  "05-contested-ui",
  /file appeal/i.test(c4) && /required bond/i.test(c4) ? "PASS" : /contested/i.test(c4) ? "WARN" : "FAIL",
  c4.includes("File Appeal") ? "Appeal UI + bond on CONTESTED" : c4.slice(0, 220).replace(/\s+/g, " ")
);

// --- 12. verdict summary ---
await page.goto(`${BASE}/cases/1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(1500);
const v1 = await page.locator("body").innerText();
if (await page.getByText(/view full reasoning/i).count()) {
  await page.getByText(/view full reasoning/i).first().click();
  await page.waitForTimeout(400);
}
await shot("12-verdict-summary");
note(
  "12-verdict",
  /HELD|BROKEN/i.test(v1) && /view full reasoning/i.test(v1) ? "PASS" : "WARN",
  "summary + expand control"
);

// --- 8. countdown + pending ---
const pendingDraft = {
  claim_id: "pending-predeploy",
  claim_type: "PRICE_THRESHOLD",
  asset: "ETH/USD",
  asset_b: null,
  metric: null,
  direction: "above",
  threshold: "1",
  state: "OPEN",
  consensus_result: "",
  verdict_text: "",
  stake_for_total: "0",
  stake_against_total: "0",
  deadline: new Date(Date.now() + 3600_000).toISOString(),
  created_at: new Date().toISOString(),
  poster: "0x374D46E81973dd8797f14f586AEE94AaC27e39A3",
};
await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.evaluate((d) => {
  localStorage.setItem("ac-local-dockets-v1", JSON.stringify([d]));
  window.dispatchEvent(new Event("ac-local-dockets"));
}, pendingDraft);
await page.waitForTimeout(1200);
await shot("08-markets-top");
const topText = await page.locator("body").innerText();
note(
  "08-countdown",
  /\d{2}:\d{2}:\d{2}/.test(topText) && /open/i.test(topText) ? "PASS" : "WARN",
  "OPEN countdown on grid"
);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await shot("08-pending-bottom");
const bottom = await page.locator("body").innerText();
note(
  "08-pending-bottom",
  /id pending/i.test(bottom) ? "PASS" : "FAIL",
  /id pending/i.test(bottom) ? "pending card present at bottom" : "pending card missing"
);

await page.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1200);
await shot("08-activity");
note("08-activity", "PASS", "activity page rendered");

// --- 1. min deadline rejected ---
await page.goto(`${BASE}/post-a-claim`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByRole("button", { name: /PRICE THRESHOLD/i }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^custom$/i }).click();
await page.locator("#claim-deadline").fill(localDeadline(1));
await page.getByRole("button", { name: /Submit claim/i }).click();
await page.waitForTimeout(800);
await shot("01-deadline-rejected");
const rej = await page.locator("body").innerText();
note(
  "01-min-deadline",
  /at least 5 minutes/i.test(rej) ? "PASS" : "FAIL",
  /at least 5 minutes/i.test(rej) ? "rejected short deadline" : rej.slice(0, 240).replace(/\s+/g, " ")
);

// --- 1. Check this mark ---
displayHits.length = 0;
await page.getByRole("button", { name: /check this mark/i }).click();
await page.waitForTimeout(8000);
await shot("01-check-mark");
const afterFirst = displayHits.length;
const markBody = await page.locator("body").innerText();
const viz = /mark-live|spark|check again/i.test(await page.content()) || /check again/i.test(markBody);
await page.waitForTimeout(1500);
const afterIdle = displayHits.length;
note(
  "01-check-mark",
  viz && afterFirst >= 1 && afterIdle === afterFirst ? "PASS" : "FAIL",
  `display calls=${afterFirst} after idle=${afterIdle} viz=${viz}`
);

// --- 1. create price 5 min ---
await page.getByRole("button", { name: /^5 min$/i }).click();
await page.getByRole("button", { name: /^Skip$/i }).click();
await page.getByRole("button", { name: /Submit claim/i }).click();
const created = page.getByText(/Claim created\. Tx:/i);
await created.waitFor({ timeout: 180000 }).catch(() => {});
await shot("01-price-created");
const priceBody = await page.locator("body").innerText();
const priceLink = page.getByRole("link", { name: /Open claim #/i });
let priceId = "";
if (await priceLink.count()) {
  const href = await priceLink.getAttribute("href");
  priceId = (href || "").split("/").pop() || "";
}
note(
  "01-price-create",
  /Claim created/i.test(priceBody) && priceId ? "PASS" : "FAIL",
  `id=${priceId} ${priceBody.match(/Tx: 0x[0-9a-f]+/i)?.[0] || ""}`
);

writeFileSync(join(OUT, "ui-log.json"), JSON.stringify({ log, priceId, displayHits }, null, 2));
console.log(JSON.stringify({ log, priceId }, null, 2));
await browser.close();
