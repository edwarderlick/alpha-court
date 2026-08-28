const paths = [
  "/api/claims",
  "/api/claims/1",
  "/browse-cases",
  "/how-verdicts-work",
];
for (const path of paths) {
  const res = await fetch("https://alpha-court.vercel.app" + path, { cache: "no-store" });
  const text = await res.text();
  console.log(path, res.status, "date", res.headers.get("date"), "len", text.length, "old", /F9Df5e7b/i.test(text), "new", /219e7531/i.test(text));
  if (path.startsWith("/api") || res.status >= 400) console.log(text.slice(0, 800));
}

const chunk = await fetch("https://alpha-court.vercel.app/_next/static/chunks/0gpqa1e-uutgh.js");
const js = await chunk.text();
const addrs = [...js.matchAll(/0x[a-fA-F0-9]{40}/g)].map((m) => m[0]);
console.log("chunk addrs", [...new Set(addrs)]);
