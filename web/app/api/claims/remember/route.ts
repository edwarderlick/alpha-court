import { NextRequest, NextResponse } from "next/server";
import { rememberClaim } from "@/lib/genlayer/claims-cache";
import { isOnChainClaimId, type ClaimSummary } from "@/lib/genlayer/claim-display";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const claim = body?.claim as ClaimSummary | undefined;
    if (!claim?.claim_id || typeof claim.claim_id !== "string") {
      return NextResponse.json({ error: "claim_id required" }, { status: 400 });
    }
    if (!isOnChainClaimId(claim.claim_id)) {
      return NextResponse.json({ error: "[EXPECTED] unknown claim_id" }, { status: 400 });
    }
    rememberClaim(claim);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
}
