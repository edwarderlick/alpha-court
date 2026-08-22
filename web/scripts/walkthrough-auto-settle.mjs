import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.WALKTHROUGH_BASE || "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "auto-settle");
mkdirSync(OUT, { recursive: true });

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDeadline(minutesAhead) {
  const d = new Date(Date.now() + minutesAhead * 60 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: join(OUT, "video"), size: { width: 1400, height: 900 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const log = [];
  const shot = async (name) => {
    const file = join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    log.push(`screenshot ${name}`);
    console.log("shot", name);
  };

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await shot("01-landing");

    await page.goto(`${BASE}/post-a-claim`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await shot("02-post-step1");
    await page.getByRole("button", { name: /PRICE THRESHOLD/i }).click();
    await page.getByText("When it settles", { exact: false }).waitFor({ timeout: 15000 });
    await shot("03-post-form");

    const threshold = page.locator('input').filter({ hasNot: page.locator('[type="datetime-local"]') }).last();
    // Threshold price field is the visible number input in "The target"
    await page.locator('input[type="datetime-local"]').waitFor();
    const textInputs = page.locator("input:not([type='datetime-local'])");
    const count = await textInputs.count();
    for (let i = 0; i < count; i++) {
      const val = await textInputs.nth(i).inputValue();
      if (val === "3000" || /^\d+(\.\d+)?$/.test(val)) {
        await textInputs.nth(i).fill("1");
        break;
      }
    }
    await page.getByRole("button", { name: /^10 min$/i }).click();
    await page.getByRole("button", { name: /^1 GEN$/i }).click();
    await shot("04-form-filled");

    await page.getByRole("button", { name: /Submit claim/i }).click();
    const created = page.getByText(/Claim created\. Tx:/i);
    const errorBox = page.locator(".bg-dispute-red\\/10");
    await Promise.race([
      created.waitFor({ timeout: 240000 }),
      errorBox.waitFor({ timeout: 240000 }),
    ]);
    await shot("05-after-submit");
    if (!(await created.isVisible().catch(() => false))) {
      const err = await page.locator("body").innerText();
      throw new Error(`create did not confirm. page text snippet: ${err.slice(0, 800)}`);
    }

    const openLink = page.getByRole("link", { name: /Open claim #/i });
    let claimId = "";
    if (await openLink.count()) {
      const href = await openLink.getAttribute("href");
      claimId = (href || "").split("/").pop() || "";
      await openLink.click();
    } else {
      throw new Error("create succeeded but no numeric claim link — placeholder id was not resolved");
    }
    log.push(`created claim ${claimId}`);
    await page.waitForURL(/\/cases\/\d+/, { timeout: 30000 });
    await page.locator(".market-ticket").waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
    await shot("06-case-after-create");

    const lockBtn = await page.getByRole("button", { name: /Lock deadline price/i }).count();
    const resolveBtn = await page.getByRole("button", { name: /Resolve verdict/i }).count();
    log.push(`lock buttons=${lockBtn} resolve buttons=${resolveBtn}`);
    if (lockBtn > 0 || resolveBtn > 0) {
      throw new Error("manual settlement button still visible on case page");
    }

    const against = page.getByRole("button", { name: /^Against$/i });
    await against.waitFor({ timeout: 20000 });
    await against.click();
    const amount = page.locator('input[type="number"]');
    if (await amount.count()) await amount.fill("1");
    await page.getByRole("button", { name: /Stake AGAINST/i }).click();
    await Promise.race([
      page.getByText(/Confirmed\. Tx:/i).waitFor({ timeout: 180000 }),
      page.getByText(/^Error:/i).waitFor({ timeout: 180000 }),
    ]);
    await page.locator(".market-ticket").waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
    await shot("07-after-stake");
    log.push("stake attempted");
    if (await page.getByText(/^Error:/i).count()) {
      throw new Error(`stake failed: ${(await page.getByText(/^Error:/i).innerText())}`);
    }

    const deadline = await page.locator("text=DEADLINE").locator("xpath=..").innerText().catch(() => "");
    log.push(`deadline panel: ${deadline.replace(/\s+/g, " ").slice(0, 200)}`);

    const settleDeadline = Date.now() + 12 * 60 * 1000;
    let settled = false;
    while (Date.now() < settleDeadline) {
      await page.reload({ waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();
      const hasLock = await page.getByRole("button", { name: /Lock deadline price/i }).count();
      if (hasLock) throw new Error("lock button appeared while waiting for keeper");
      if (/RESOLVED|HELD|BROKEN|Price frozen|keeper settling|WINDOW CLOSED/i.test(body)) {
        await shot("08-settlement-state");
        log.push(`ui state snippet: ${body.match(/RESOLVED|HELD|BROKEN|Price frozen|keeper settling|WINDOW CLOSED/gi)?.join(",")}`);
        if (/RESOLVED|HELD|BROKEN/i.test(body) && /CONSENSUS/i.test(body)) {
          settled = true;
          break;
        }
      }
      await page.waitForTimeout(15000);
    }
    await shot("09-final");
    log.push(settled ? "keeper settlement visible in UI" : "waited; automatic lock/resolve may still be in progress");

    console.log(JSON.stringify({ ok: true, claimId, settled, log }, null, 2));
  } catch (err) {
    await shot("error");
    console.error("WALKTHROUGH_FAILED", err.message);
    process.exitCode = 1;
  } finally {
    await context.tracing.stop({ path: join(OUT, "trace.zip") });
    await context.close();
    await browser.close();
  }
}

main();
