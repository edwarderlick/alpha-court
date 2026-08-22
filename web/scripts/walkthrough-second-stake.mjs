import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "second-stake");
mkdirSync(OUT, { recursive: true });
const claimId = process.argv[2] || "5";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console ${m.text()}`);
});

async function shot(name) {
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready.catch(() => {}));
  } catch {
    /* ignore */
  }
  try {
    await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 60000, animations: "disabled" });
  } catch (err) {
    console.log("shot-failed", name, err instanceof Error ? err.message : String(err));
  }
  console.log("shot", name);
}

await page.goto(`${BASE}/browse-cases`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("01-markets");
const marketsErrors = [...errors];

await page.goto(`${BASE}/cases/${claimId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
await shot("02-before-stakes");

async function place(side) {
  const sideBtn = page.getByRole("button", { name: new RegExp(`^${side}$`, "i") });
  if (await sideBtn.count()) await sideBtn.click();
  const one = page.getByRole("button", { name: /^1 GEN$/i });
  if (await one.count()) await one.click();
  const submit = page.getByRole("button", { name: /Stake/i }).last();
  await submit.click();
  await page.getByText(/Stake landed|Tx:/i).first().waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

await place("FOR");
await shot("03-after-for");
const afterForErrors = [...errors];
const urlAfterFor = page.url();

await place("AGAINST");
await shot("04-after-against");
const urlAfterAgainst = page.url();
const body = await page.locator("body").innerText();

const depth = errors.filter((e) => /maximum update depth/i.test(e));
const dupKey = errors.filter((e) => /same key/i.test(e));
const result = {
  claimId,
  urlAfterFor,
  urlAfterAgainst,
  stayedOnCase: urlAfterAgainst.includes(`/cases/${claimId}`),
  depthErrors: depth,
  dupKeyErrors: dupKey,
  allErrors: errors,
  marketsErrorCount: marketsErrors.length,
  afterForErrorCount: afterForErrors.length,
  hasFor: /FOR/i.test(body) && /1(\.0)? GEN/i.test(body),
  hasAgainst: /AGAINST/i.test(body),
  twoStakers: /2 on this claim/i.test(body),
};
writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
