const BASE = "https://alpha-court.vercel.app";
const res = await fetch(BASE + "/cases/1", { cache: "no-store" });
const text = await res.text();
console.log("status", res.status, "date", res.headers.get("date"), "ms-id", res.headers.get("x-vercel-id"), "len", text.length);
const keys = ["999999", "ETH/USD", "BROKEN", "HELD", "Live court", "0x219e", "0xF9Df", "studio_unavailable", "read_failed", "does not exist", "threshold", "1946", "treasury", "374D46"];
for (const k of keys) {
  const i = text.toLowerCase().indexOf(k.toLowerCase());
  console.log(k, i >= 0 ? text.slice(Math.max(0, i - 40), i + k.length + 60).replace(/\s+/g, " ") : "ABSENT");
}

const tick = await fetch(BASE + "/api/keeper/tick", { cache: "no-store" });
console.log("keeper tick", tick.status, await tick.text(), tick.headers.get("date"));
