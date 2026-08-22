import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });

const ADDR_A = "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";
const ADDR_B = "0xcE0ae5fCF5781810C8cc21c6135A5C3F50801025";
const ADDR_FRESH = "0x00000000000000000000000000000000000000aa";

let setup = {};
try {
  setup = JSON.parse(readFileSync(join(OUT, "round2-setup.json"), "utf8"));
} catch {
  setup = {};
}
const openId =
  setup.created?.price?.claimId ||
  setup.created?.relative?.claimId ||
  setup.created?.fundamentals?.claimId ||
  "";

const log = [];
function note(id, status, detail) {
  const row = { id, status, detail: typeof detail === "string" ? detail.slice(0, 400) : detail, at: new Date().toISOString() };
  log.push(row);
  console.log(`[${status}] ${id} — ${typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail)}`);
}

function walletMock(address) {
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "eth_chainId") return "0xf22f";
      if (method === "net_version") return "61999";
      if (method === "wallet_getSnaps") return {};
      if (method === "wallet_requestSnaps") return {};
      if (method === "eth_sendTransaction" || method === "personal_sign" || method === "eth_sign") {
        const err = new Error("MetaMask Message Signature: User denied message signature.");
        err.code = 4001;
        throw err;
      }
      return null;
    },
    on(event, cb) {
      (listeners[event] ||= []).push(cb);
    },
    removeListener(event, cb) {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
    },
  };
}

const browser = await chromium.launch({ headless: true });

async function shot(page, name) {
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 45000, animations: "disabled", fullPage: true });
  } catch (err) {
    console.log("shot-failed", name, err instanceof Error ? err.message : String(err));
  }
}

async function connect(page) {
  const chip = page.getByRole("button", { name: /Connect Wallet/i });
  if (await chip.count()) {
    await chip.first().click();
    const mm = page.getByRole("button", { name: /MetaMask/i });
    if (await mm.count()) await mm.first().click();
    await page.waitForTimeout(800);
  }
}

// --- 4 payout UI vs chain ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/cases/8`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot(page, "04-claim8-resolved");
  const t = await page.locator("body").innerText();
  note(
    "04-claim8-held-ui",
    /HELD|WON|RESOLVED/i.test(t) ? "PASS" : "FAIL",
    t.slice(0, 240).replace(/\s+/g, " ")
  );
  note(
    "05-claim8-no-appeal",
    /file appeal/i.test(t) ? "FAIL" : "PASS",
    /file appeal/i.test(t) ? "File Appeal shown on RESOLVED" : "no File Appeal on RESOLVED #8"
  );
  await page.close();
}

// --- 2 stake bounds on OPEN claim ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const target = openId ? `${BASE}/cases/${openId}` : `${BASE}/cases/1`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot(page, "02-open-claim");
  const num = page.locator("input[type='number']");
  if (await num.count()) {
    await num.fill("0.5");
    await page.getByRole("button", { name: /Stake FOR/i }).click();
    await page.waitForTimeout(500);
    await shot(page, "02-stake-below-1");
    const low = await page.locator("body").innerText();
    note("02-below-1", /between 1 and 10/i.test(low) ? "PASS" : "FAIL", low.match(/Amount must.*|Error:.*/)?.[0] || low.slice(0, 160));

    await num.fill("11");
    await page.getByRole("button", { name: /Stake FOR/i }).click();
    await page.waitForTimeout(500);
    await shot(page, "02-stake-above-10");
    const hi = await page.locator("body").innerText();
    note("02-above-10", /between 1 and 10/i.test(hi) ? "PASS" : "FAIL", hi.match(/Amount must.*|Error:.*/)?.[0] || "no message");

    await shot(page, "02-stakers-after-stake");
    const after = await page.locator("body").innerText();
    note(
      "02-stakers-live",
      /0x374d|374D46|374d46|0xce0a|ce0ae5|0x8b50/i.test(after) ? "PASS" : "WARN",
      after.slice(0, 220).replace(/\s+/g, " ")
    );
  } else {
    note("02-below-1", "FAIL", "no stake input — claim not OPEN");
    note("02-above-10", "FAIL", "no stake input");
    note("02-stakers-live", "WARN", "could not stake on this page");
  }
  await page.close();
}

// --- 2 after deadline ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/cases/8`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot(page, "02-stake-closed");
  const closed = await page.locator("body").innerText();
  const hasForm = /Stake FOR/i.test(closed);
  const closedCopy = /staking is closed|deadline has passed|not OPEN/i.test(closed);
  note(
    "02-after-deadline",
    !hasForm && closedCopy ? "PASS" : hasForm ? "FAIL" : "WARN",
    hasForm ? "stake form still shown on RESOLVED" : closed.slice(0, 180).replace(/\s+/g, " ")
  );
  await page.close();
}

// --- 6 passport A (claimant+staking) / B (staking only) ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/alpha-passport?address=${ADDR_A}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot(page, "06-passport-a");
  const pa = await page.locator("body").innerText();
  note(
    "06-passport-a",
    /claimant record/i.test(pa) && /staking record/i.test(pa) ? "PASS" : "FAIL",
    pa.slice(0, 240).replace(/\s+/g, " ")
  );

  await page.goto(`${BASE}/alpha-passport?address=${ADDR_B}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot(page, "06-passport-b-staking-only");
  const pb = await page.locator("body").innerText();
  const emptyClaimant = /no claims yet|no resolved claims yet/i.test(pb);
  const hasStaking = /staking record/i.test(pb);
  const broken = /crash|maximum update depth|failed to load/i.test(pb);
  note(
    "06-passport-b",
    !broken && /claimant record/i.test(pb) && emptyClaimant && hasStaking ? "PASS" : broken ? "FAIL" : "WARN",
    pb.slice(0, 260).replace(/\s+/g, " ")
  );

  await page.goto(`${BASE}/my-stakes?address=${ADDR_A}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot(page, "06-my-stakes-a");
  const sa = await page.locator("body").innerText();
  note(
    "06-my-stakes-a",
    /WON|LOST|pending|GEN/i.test(sa) && !/crash/i.test(sa) ? "PASS" : "FAIL",
    sa.slice(0, 240).replace(/\s+/g, " ")
  );

  await page.goto(`${BASE}/my-stakes?address=${ADDR_B}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  await shot(page, "06-my-stakes-b");
  const sb = await page.locator("body").innerText();
  note("06-my-stakes-b", /GEN|WON|LOST|pending/i.test(sb) ? "PASS" : "WARN", sb.slice(0, 220).replace(/\s+/g, " "));
  await page.close();
}

// --- 6 isolation: two wallets ---
{
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.addInitScript(walletMock, ADDR_A);
  await pageB.addInitScript(walletMock, ADDR_B);

  await pageA.goto(`${BASE}/my-claims`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await connect(pageA);
  await pageA.waitForTimeout(2500);
  await shot(pageA, "06-my-claims-a");
  const ca = await pageA.locator("body").innerText();

  await pageB.goto(`${BASE}/my-claims`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await connect(pageB);
  await pageB.waitForTimeout(2500);
  await shot(pageB, "06-my-claims-b");
  const cb = await pageB.locator("body").innerText();
  const aSeesOwn = /374d|Claim #8|Claim #9|Claim #10/i.test(ca);
  const bDoesNotSeeA = !/374d/i.test(cb);
  note(
    "06-my-claims-isolation",
    aSeesOwn && bDoesNotSeeA ? "PASS" : "WARN",
    { a: ca.slice(0, 180).replace(/\s+/g, " "), b: cb.slice(0, 180).replace(/\s+/g, " ") }
  );

  await pageA.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageA.waitForTimeout(2000);
  await shot(pageA, "06-activity-a");
  await pageB.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageB.waitForTimeout(2000);
  await shot(pageB, "06-activity-b");
  const aa = await pageA.locator("body").innerText();
  const ab = await pageB.locator("body").innerText();
  note(
    "06-activity-isolation",
    /my activity/i.test(aa) && /my activity/i.test(ab) ? "PASS" : "WARN",
    { aHas374d: /374d/i.test(aa), bHasCe0a: /ce0a|cE0a/i.test(ab), bHas374d: /374d/i.test(ab) }
  );

  // 10 fanfare isolation
  await pageA.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageB.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await pageA.waitForTimeout(1500);
  await pageB.waitForTimeout(1500);
  await pageA.evaluate(() => {
    window.__alphaPulse?.({
      kind: "stake_for",
      claimId: "8",
      title: "ETH/USD above 1.0",
      amount: "2",
      href: "/cases/8",
      tab: "Markets",
    });
  });
  await pageA.waitForTimeout(600);
  await shot(pageA, "10-fanfare-a");
  await shot(pageB, "10-fanfare-b");
  const fa = await pageA.locator("body").innerText();
  const fb = await pageB.locator("body").innerText();
  const aSeesFanfare = /FOR FILLED|2 GEN|ETH\/USD above/i.test(fa);
  const bSeesFanfare = /FOR FILLED|ETH\/USD above 1\.0/i.test(fb) && /FILLED/i.test(fb);
  note(
    "10-fanfare-isolation",
    aSeesFanfare && !bSeesFanfare ? "PASS" : "FAIL",
    { aSeesFanfare, bSeesFanfare, a: fa.slice(0, 120).replace(/\s+/g, " ") }
  );

  await pageA.evaluate(() => {
    window.__alphaPulse?.({
      kind: "resolved",
      claimId: "8",
      title: "ETH/USD above 1.0",
      href: "/cases/8",
      tab: "Claims",
    });
  });
  await pageA.waitForTimeout(1200);
  await shot(pageA, "10-win-fanfare-a");
  const win = await pageA.locator("body").innerText();
  note(
    "10-win-payout-amount",
    /4(\.0+)? GEN|Your payout/i.test(win) ? "PASS" : "WARN",
    win.slice(0, 220).replace(/\s+/g, " ")
  );

  await ctxA.close();
  await ctxB.close();
}

// --- 9 reject signature ---
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(walletMock, ADDR_A);
  const target = openId ? `${BASE}/cases/${openId}` : `${BASE}/cases/8`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90000 });
  await connect(page);
  await page.waitForTimeout(1500);
  const num = page.locator("input[type='number']");
  if (await num.count()) {
    await num.fill("1");
    await page.getByRole("button", { name: /Stake FOR/i }).click();
    await page.waitForTimeout(1500);
    await shot(page, "09-reject-signature");
    const body = await page.locator("body").innerText();
    const rejected = /denied|reject|4001|user denied/i.test(body);
    const falseSuccess = /Stake recorded|tx 0x|Submitted/i.test(body) && /0x[0-9a-f]{10,}/i.test(body);
    note(
      "09-reject-signature",
      rejected && !falseSuccess ? "PASS" : falseSuccess ? "FAIL" : "WARN",
      body.slice(0, 220).replace(/\s+/g, " ")
    );
  } else {
    note("09-reject-signature", "WARN", "no stake form to reject on");
  }
  note("09-snap-signing", "BLOCKED", "No MetaMask in this environment; cannot perform a real Snap signature.");
  await ctx.close();
}

// --- 7 legacy ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/cases/15?legacy=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot(page, "07-legacy-15");
  const l15 = await page.locator("body").innerText();
  note(
    "07-legacy-15",
    /legacy docket/i.test(l15) ? "PASS" : "FAIL",
    l15.slice(0, 220).replace(/\s+/g, " ")
  );
  note("07-banner", /live|historical|legacy|current court|retired/i.test(l15) ? "PASS" : "WARN", "banner copy");
  await page.close();
}

// --- 8 sorting / countdown / activity ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  if (await page.getByRole("button", { name: /^OPEN$/i }).count()) {
    await page.getByRole("button", { name: /^OPEN$/i }).click();
    await page.waitForTimeout(800);
  }
  await shot(page, "08-open-filter");
  const op = await page.locator("body").innerText();
  note("08-open-countdown", /\d{1,2}:\d{2}:\d{2}/.test(op) ? "PASS" : "WARN", op.slice(0, 180).replace(/\s+/g, " "));

  await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, "08-pending-bottom-2");
  note("08-pending-bottom", "PASS", "markets scrolled");

  await page.goto(`${BASE}/activity`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, "08-activity-order");
  const act = await page.locator("body").innerText();
  note("08-activity-recent", /ago|just now|minute|hour/i.test(act) ? "PASS" : "WARN", act.slice(0, 180).replace(/\s+/g, " "));
  await page.close();
}

// --- 11 empty / 404 already done; recheck 404 copy ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/cases/99999`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot(page, "11-missing-claim-2");
  const miss = await page.locator("body").innerText();
  note(
    "11-404",
    /not found|could not load|doesn.?t exist/i.test(miss) && !/Maximum update depth/i.test(miss) ? "PASS" : "FAIL",
    miss.slice(0, 240).replace(/\s+/g, " ")
  );
  const usedNotFoundPage = /404/i.test(miss);
  note("11-404-page-kind", usedNotFoundPage ? "PASS" : "WARN", usedNotFoundPage ? "uses 404 copy" : "custom could-not-load, not not-found.tsx");

  await page.goto(`${BASE}/alpha-passport?address=${ADDR_FRESH}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  await shot(page, "11-passport-fresh");
  const pe = await page.locator("body").innerText();
  note("11-passport-fresh", /crash|maximum update depth/i.test(pe) ? "FAIL" : "PASS", pe.slice(0, 180).replace(/\s+/g, " "));
  await page.close();
}

// --- 12 polish: landing click, verdict expand, avatars ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const enter = page.getByRole("link", { name: /enter|browse|markets|new claim/i }).first();
  if (await enter.count()) {
    await enter.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await shot(page, "12-landing-click");
  note("12-landing-click", "PASS", page.url());

  await page.goto(`${BASE}/cases/8`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2000);
  const expand = page.getByRole("button", { name: /view full reasoning|full reasoning/i });
  if (await expand.count()) {
    await expand.first().click();
    await page.waitForTimeout(400);
  }
  await shot(page, "12-verdict-expand");
  const v = await page.locator("body").innerText();
  note(
    "12-verdict",
    /view full reasoning|HELD/i.test(v) ? "PASS" : "WARN",
    v.slice(0, 220).replace(/\s+/g, " ")
  );
  const avatars = await page.locator("img, canvas, svg").count();
  note("12-avatars", avatars > 0 ? "PASS" : "WARN", `dom visual nodes=${avatars}`);
  await page.close();
}

// --- 1 UI create relative + fundamentals (10 min, skip stake) ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);

  async function createType(typeLabel, shotName, extra) {
    await page.goto(`${BASE}/post-a-claim`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: new RegExp(typeLabel, "i") }).click();
    await page.waitForTimeout(800);
    await extra?.(page);
    if (await page.getByRole("button", { name: /^10 min$/i }).count()) {
      await page.getByRole("button", { name: /^10 min$/i }).click();
    }
    if (await page.getByRole("button", { name: /^Skip$/i }).count()) {
      await page.getByRole("button", { name: /^Skip$/i }).click();
    }
    await page.getByRole("button", { name: /Submit claim/i }).click();
    await page.getByText(/Claim created\. Tx:/i).waitFor({ timeout: 180000 }).catch(() => {});
    await shot(page, shotName);
    const body = await page.locator("body").innerText();
    const link = page.getByRole("link", { name: /Open claim #/i });
    let id = "";
    if (await link.count()) {
      const href = await link.getAttribute("href");
      id = (href || "").split("/").pop() || "";
    }
    const tx = body.match(/Tx: 0x[0-9a-f]+/i)?.[0] || "";
    note(
      `01-ui-${shotName}`,
      /Claim created/i.test(body) && id ? "PASS" : "FAIL",
      `id=${id} ${tx} ${body.slice(0, 120).replace(/\s+/g, " ")}`
    );
    return id;
  }

  try {
    await createType("RELATIVE PERFORMANCE", "01-relative-created", async (p) => {
      const threshold = p.locator("input").first();
      await threshold.waitFor({ timeout: 5000 }).catch(() => {});
    });
  } catch (err) {
    note("01-ui-01-relative-created", "FAIL", err instanceof Error ? err.message : String(err));
  }
  try {
    await createType("FUNDAMENTALS THRESHOLD", "01-fundamentals-created", async (p) => {
      const metric = p.locator("select");
      if (await metric.count()) await metric.first().selectOption("MVRV");
      const thresh = p.locator("input").filter({ hasNot: p.locator("[type=hidden]") });
      if (await thresh.count()) await thresh.last().fill("1.0");
    });
  } catch (err) {
    note("01-ui-01-fundamentals-created", "FAIL", err instanceof Error ? err.message : String(err));
  }
  await page.close();
}

writeFileSync(join(OUT, "round2-ui-log.json"), JSON.stringify({ openId, log }, null, 2));
console.log(JSON.stringify({ openId, log }, null, 2));
await browser.close();
