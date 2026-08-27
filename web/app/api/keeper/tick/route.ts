import { NextRequest, NextResponse } from "next/server";
import { getLastKeeperTick, keeperEnabled, keeperMinClaimId, runKeeperTick } from "@/lib/genlayer/keeper";

export const maxDuration = 300;

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
    lastTick: await getLastKeeperTick(),
    contract:
      process.env.ALPHA_COURT_CONTRACT_ADDRESS ||
      process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS ||
      null,
    treasury: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || null,
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
