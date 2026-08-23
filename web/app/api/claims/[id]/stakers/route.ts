import { NextResponse } from "next/server";
import { stakersForClaim } from "@/lib/genlayer/stakes";
import { isOnChainClaimId } from "@/lib/genlayer/claim-display";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const preferLegacy = url.searchParams.get("legacy") === "1";
  const origin = url.searchParams.get("origin");
  if (!isOnChainClaimId(id)) {
    return NextResponse.json({ stakers: [], winningSide: null });
  }
  try {
    const data = await stakersForClaim(id, { preferLegacy, origin });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
