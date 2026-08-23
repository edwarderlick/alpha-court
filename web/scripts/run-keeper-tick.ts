/**
 * Production keeper entry for GitHub Actions (or any long-lived host).
 * Runs the same tick as /api/keeper/tick, but is not bound by Vercel
 * Hobby's 10s serverless timeout — Studio consensus writes can take minutes.
 */
import { runKeeperTick } from "../lib/genlayer/keeper";

async function main() {
  const result = await runKeeperTick();
  console.log(JSON.stringify(result));
  if (result.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
