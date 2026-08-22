import { NextRequest, NextResponse } from "next/server";
import { getLastKeeperTick, keeperEnabled, keeperMinClaimId, runKeeperTick } from "@/lib/genlayer/keeper";

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const keeper = process.env.KEEPER_SECRET;
  const cron = process.env.CRON_SECRET;
  if (cron && header === `Bearer ${cron}`) return true;
  if (keeper && header === `Bearer ${keeper}`) return true;
  if (!keeper && !cron) return keeperEnabled();
  return false;
}

export async function GET(req: NextRequest) {
  if (authorized(req) && keeperEnabled()) {
    const result = await runKeeperTick();
    return NextResponse.json(result);
  }
  return NextResponse.json({
    enabled: keeperEnabled(),
    minClaimId: keeperMinClaimId() || null,
    lastTick: getLastKeeperTick(),
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!keeperEnabled()) {
    return NextResponse.json({ error: "keeper disabled" }, { status: 403 });
  }
  const result = await runKeeperTick();
  return NextResponse.json(result);
}
