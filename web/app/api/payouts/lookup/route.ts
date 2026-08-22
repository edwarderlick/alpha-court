import { NextRequest, NextResponse } from "next/server";
import { payoutsFor } from "@/lib/genlayer/payouts";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const claimId = req.nextUrl.searchParams.get("claimId") ?? "";
  if (!address.startsWith("0x") || !claimId) {
    return NextResponse.json({ won: false });
  }
  const origin = req.nextUrl.searchParams.get("origin") ?? "";
  const hits = payoutsFor(address, claimId, origin || undefined).filter(
    (t) => t.kind === "payout" && t.credited === true
  );
  return NextResponse.json({
    won: hits.length > 0,
    amount: hits[0]?.value ?? null,
    txHash: hits[0]?.txHash ?? null,
  });
}
