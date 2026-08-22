import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const CLAIM = process.argv[2] || "11";
const SECONDS = Number(process.argv[3] || "25");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const hits = [];
page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/api/claims/") || url.includes("/api/studio/status") || url.includes("/api/claims?")) {
    hits.push({ t: Date.now(), url: url.replace(BASE, ""), type: req.resourceType() });
  }
});
await page.goto(`${BASE}/cases/${CLAIM}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(SECONDS * 1000);
const byPath = {};
for (const h of hits) {
  const path = h.url.split("?")[0];
  byPath[path] = (byPath[path] || 0) + 1;
}
const claimHits = hits.filter((h) => h.url.includes(`/api/claims/${CLAIM}`));
const statusHits = hits.filter((h) => h.url.includes("/api/studio/status"));
const freshHits = hits.filter((h) => h.url.includes("fresh=1"));
console.log(
  JSON.stringify(
    {
      seconds: SECONDS,
      claimId: CLAIM,
      claimPolls: claimHits.length,
      studioStatusPolls: statusHits.length,
      freshPolls: freshHits.length,
      perMinute: Number(((claimHits.length / SECONDS) * 60).toFixed(2)),
      byPath,
    },
    null,
    2
  )
);
await browser.close();
