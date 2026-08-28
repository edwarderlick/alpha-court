/**
 * Cache-busting check that production is talking to 0x0312c04c, not 0x1b8Fc1a2.
 */
const BASE = "https://alpha-court.vercel.app";
const NEW = "0x0312c04cA7a5D29025f01d9487e62Fb4fe182C04".toLowerCase();
const OLD = "0x1b8Fc1a2B16352228f2016DB1BBbeAaBA9192B37".toLowerCase();
const cb = Date.now().toString();

function headers() {
  return {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    "User-Agent": "alpha-court-cutover-verify/1",
  };
}

async function grab(path) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}cb=${cb}`;
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  const text = await res.text();
  return {
    url,
    status: res.status,
    date: res.headers.get("date"),
    age: res.headers.get("age"),
    cache: res.headers.get("x-vercel-cache"),
    vercelId: res.headers.get("x-vercel-id"),
    cacheControl: res.headers.get("cache-control"),
    text,
  };
}

function has(hay, needle) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

const out = { cb, new: NEW, old: OLD };

const tick = await grab("/api/keeper/tick");
let tickJson = null;
try {
  tickJson = JSON.parse(tick.text);
} catch {
  tickJson = { parseError: tick.text.slice(0, 300) };
}
out.tick = {
  status: tick.status,
  date: tick.date,
  cache: tick.cache,
  age: tick.age,
  vercelId: tick.vercelId,
  body: tickJson,
};

const claim = await grab("/api/claims/1?fresh=1");
let claimJson = null;
try {
  claimJson = JSON.parse(claim.text);
} catch {
  claimJson = { parseError: claim.text.slice(0, 400) };
}
const c = claimJson.claim || {};
out.claim1 = {
  status: claim.status,
  date: claim.date,
  cache: claim.cache,
  age: claim.age,
  vercelId: claim.vercelId,
  cached: claimJson.cached ?? false,
  treasury: c.treasury ?? null,
  paid: c.paid ?? null,
  created_at: c.created_at ?? null,
  deadline: c.deadline ?? null,
  state: c.state ?? null,
  consensus_result: c.consensus_result ?? null,
  threshold: c.threshold ?? null,
};

const page = await grab("/browse-cases");
out.browse = {
  status: page.status,
  date: page.date,
  cache: page.cache,
  age: page.age,
  vercelId: page.vercelId,
  liveBanner: (page.text.match(/Live court[^<]{0,80}/i) || [null])[0],
  htmlHasNew: has(page.text, "0312c04c"),
  htmlHasOld: has(page.text, "1b8fc1a2"),
};

const scripts = [...page.text.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)].map((m) => m[0]);
out.scripts = scripts;
const chunkHits = [];
for (const src of [...new Set(scripts)]) {
  const js = await grab(src);
  chunkHits.push({
    src,
    cache: js.cache,
    hasNew: has(js.text, "0312c04c"),
    hasOld: has(js.text, "1b8fc1a2"),
    hasFullNew: has(js.text, NEW),
    hasFullOld: has(js.text, OLD),
  });
}
out.chunks = chunkHits;

out.verdict = {
  tickIsNew: String(tickJson.contract || "").toLowerCase() === NEW,
  tickTreasuryIsNew: String(tickJson.treasury || "").toLowerCase() === NEW,
  tickIsOld: String(tickJson.contract || "").toLowerCase() === OLD,
  claimTreasuryIsNew: String(c.treasury || "").toLowerCase() === NEW,
  claimTreasuryIsOld: String(c.treasury || "").toLowerCase() === OLD,
  claimPaid: c.paid === true,
  claimCreatedAfterNoon: typeof c.created_at === "string" && c.created_at >= "2026-08-27T12:00:00",
  jsHasFullNew: chunkHits.some((x) => x.hasFullNew),
  jsHasFullOld: chunkHits.some((x) => x.hasFullOld),
  browseBanner: out.browse.liveBanner,
};

console.log(JSON.stringify(out, null, 2));

const ok =
  out.verdict.tickIsNew &&
  out.verdict.tickTreasuryIsNew &&
  out.verdict.claimTreasuryIsNew &&
  out.verdict.claimPaid === true &&
  out.verdict.claimCreatedAfterNoon &&
  out.verdict.jsHasFullNew &&
  !out.verdict.tickIsOld &&
  !out.verdict.claimTreasuryIsOld;

if (!ok) {
  console.error("CUTOVER_NOT_CONFIRMED");
  process.exit(2);
}
console.error("CUTOVER_CONFIRMED");
