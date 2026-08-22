import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = join(process.cwd(), "_verify", "hero-cast");
mkdirSync(OUT, { recursive: true });

function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

const browser = await chromium.launch({ headless: true });

async function capture(name, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("h1", { timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });

  const report = await page.evaluate(() => {
    const words = [...document.querySelectorAll("header h1")].map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { text: el.textContent.replace(/\s+/g, " ").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const figs = [...document.querySelectorAll(".landing-cast .cast-fig")].map((el) => {
      const r = el.getBoundingClientRect();
      const cls = [...el.classList].find((c) => c.startsWith("cast-") && c !== "cast-fig") || "unknown";
      const style = getComputedStyle(el);
      return {
        cls,
        hidden: style.display === "none" || r.width < 2 || r.height < 2,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    });
    return { words, figs };
  });

  const hits = [];
  for (const word of report.words) {
    if (!/COURT|2026|CHOICE/.test(word.text)) continue;
    for (const fig of report.figs) {
      if (fig.hidden) continue;
      const area = overlap(word, fig);
      if (area > 40) hits.push({ word: word.text, fig: fig.cls, area: Math.round(area) });
    }
  }

  await page.close();
  return { name, viewport, hits, figs: report.figs, words: report.words };
}

const desktop = await capture("01-desktop", { width: 1440, height: 900 });
const desktopWide = await capture("02-desktop-wide", { width: 1680, height: 980 });
const mobile = await capture("03-mobile", { width: 390, height: 844 });

writeFileSync(join(OUT, "result.json"), JSON.stringify({ desktop, desktopWide, mobile }, null, 2));

console.log(JSON.stringify({
  desktopHits: desktop.hits,
  wideHits: desktopWide.hits,
  mobileHits: mobile.hits,
  desktopFigs: desktop.figs.filter((f) => !f.hidden).map((f) => `${f.cls}@${Math.round(f.x)},${Math.round(f.y)}`),
}, null, 2));

if (desktop.hits.length || desktopWide.hits.length) {
  console.error("OVERLAP");
  process.exit(1);
}

await browser.close();
console.log("PASS", OUT);
