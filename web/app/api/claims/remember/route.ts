import { NextRequest, NextResponse } from "next/server";
import { rememberClaim } from "@/lib/genlayer/claims-cache";
import { isOnChainClaimId, type ClaimSummary } from "@/lib/genlayer/claim-display";

export async function POST(req: NextRequest) {
  // Split in two: a JSON-parse/shape failure really is "bad body" (400,
  // client's fault). A failure inside rememberClaim's storage write is a
  // completely different thing -- previously the one catch-all mapped
  // both to "bad body", so a dead Redis connection looked identical to a
  // malformed request and hid the real outage from anyone reading logs
  // or the network tab.
  let claim: ClaimSummary | undefined;
  try {
    const body = await req.json();
    claim = body?.claim as ClaimSummary | undefined;
    if (!claim?.claim_id || typeof claim.claim_id !== "string") {
      return NextResponse.json({ error: "claim_id required" }, { status: 400 });
    }
    if (!isOnChainClaimId(claim.claim_id)) {
      return NextResponse.json({ error: "[EXPECTED] unknown claim_id" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `bad body: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  try {
    await rememberClaim(claim);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[claims/remember] storage write failed for claim ${claim.claim_id}: ${detail}`);
    return NextResponse.json(
      { error: `claim not remembered: storage unavailable (${detail})` },
      { status: 503 }
    );
  }
}
