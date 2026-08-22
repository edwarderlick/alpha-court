export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  // Serverless hosts do not keep a long-lived process. Production ticks
  // come from GET/POST /api/keeper/tick (Vercel Cron).
  if (process.env.VERCEL) return;
  if (process.env.KEEPER_ENABLED !== "true") return;
  const { startKeeper } = await import("./lib/genlayer/keeper");
  startKeeper();
}
