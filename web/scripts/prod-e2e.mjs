const BASE = "https://alpha-court.vercel.app";

const tick = await fetch(BASE + "/api/keeper/tick?t=" + Date.now(), { cache: "no-store" });
const tickJson = await tick.json();
console.log("TICK", tick.status, tick.headers.get("date"), JSON.stringify(tickJson));

const claim1 = await fetch(BASE + "/api/claims/1?fresh=1&t=" + Date.now(), { cache: "no-store" });
const claim1Text = await claim1.text();
console.log("CLAIM1", claim1.status, claim1.headers.get("date"), claim1Text.slice(0, 1500));

const post = await fetch(BASE + "/api/claims", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    claimType: "PRICE_THRESHOLD",
    asset: "ETH/USD",
    thresholdPrice: "999998",
    direction: "above",
    deadline: new Date(Date.now() + 120000).toISOString(),
    postingStakeGen: 0,
  }),
});
const postText = await post.text();
console.log("POST /api/claims", post.status, postText.slice(0, 800));
