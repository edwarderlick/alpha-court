/**
 * Production keeper entry for GitHub Actions (or any long-lived host).
 * Runs the same tick as /api/keeper/tick, but is not bound by Vercel
 * Hobby's 10s serverless timeout — Studio consensus writes can take minutes.
 */
import { runKeeperTick } from "../lib/genlayer/keeper";
import { redisReachable, storageKind } from "../lib/persist";

async function main() {
  // Real reachability check, not just "is a URL configured" --
  // storageKind() reports "redis" even when the configured host is dead
  // (see persist/index.ts's redisReachable docstring for why that gap
  // matters here specifically). This loop runs continuously in GitHub
  // Actions and Actions already has a visible pass/fail per run -- the
  // one operational surface this project watches without needing a new
  // alerting channel. Fail the step loudly here instead of letting an
  // expired Redis instance quietly degrade every tick until someone
  // notices the Markets page is empty.
  if (storageKind() === "redis") {
    const health = await redisReachable();
    if (!health.ok) {
      console.error(
        `[keeper] Redis is configured but unreachable: ${health.error}. ` +
          `If this is an Upstash "start-redis" instance, it expires 72h after creation unless claimed -- ` +
          `see README's "Local development" section. Reprovision and update ` +
          `UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN (both here and in Vercel's project env).`
      );
      // Distinct exit code: keeper.yml's relay loop tolerates an
      // isolated bad tick (exit 1) so one transient error can't kill a
      // 12-minute relay, but escalates a run to a real failed Action
      // after several consecutive exit-2s -- see that workflow's "Tick
      // loop" step. A single blip should not page anyone; an instance
      // that's actually dead should be impossible to miss.
      process.exit(2);
    }
  }

  const result = await runKeeperTick();
  console.log(JSON.stringify(result));
  if (result.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
