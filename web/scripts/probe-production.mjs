const home = await fetch("https://alpha-court.vercel.app/", { cache: "no-store" });
const html = await home.text();
console.log("home status", home.status, "date", home.headers.get("date"), "x-vercel-id", home.headers.get("x-vercel-id"));
const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"' ]+/g)].map((m) => m[0]);
console.log("chunks", chunks.length);
console.log(chunks.slice(0, 40).join("\n"));

const api = await fetch("https://alpha-court.vercel.app/api/claims", { cache: "no-store" });
const apiText = await api.text();
console.log("api status", api.status, "date", api.headers.get("date"));
console.log("api body", apiText.slice(0, 2000));

const toFetch = chunks.filter((c) => c.endsWith(".js")).slice(0, 25);
for (const path of toFetch) {
  const res = await fetch("https://alpha-court.vercel.app" + path, { cache: "no-store" });
  const text = await res.text();
  const hasNew = /219e7531/i.test(text);
  const hasOld = /F9Df5e7b/i.test(text);
  const hasTreasury = /374D46E8/i.test(text);
  const hasRetired = /22Cf7A9e/i.test(text);
  if (hasNew || hasOld || hasTreasury || hasRetired) {
    console.log("HIT", path, { hasNew, hasOld, hasTreasury, hasRetired, len: text.length });
  }
}
