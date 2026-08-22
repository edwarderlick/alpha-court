import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const BASE = process.env.WALKTHROUGH_BASE || "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "my-stakes");
mkdirSync(OUT, { recursive: true });

const WIN = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const LOSS = "0x47F58b1A3726A177EC934a425BA98d391746823b";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/my-stakes?address=${WIN}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText(/Paid 2\.25 GEN/i).waitFor({ timeout: 120000 });
await page.screenshot({ path: join(OUT, "won-claim-21.png"), fullPage: true });

await page.goto(`${BASE}/my-stakes?address=${LOSS}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.getByText(/0 GEN, this stake lost/i).waitFor({ timeout: 120000 });
await page.screenshot({ path: join(OUT, "lost-claim-21.png"), fullPage: true });

await browser.close();
console.log("ok", join(OUT, "won-claim-21.png"), join(OUT, "lost-claim-21.png"));
