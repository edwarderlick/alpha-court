import { NextRequest, NextResponse } from "next/server";
import { readClaim } from "@/lib/genlayer/client";
import { bookUpsert } from "@/lib/genlayer/book";
import { studioCanRead } from "@/lib/genlayer/studio-gate";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";

/** After a wallet create, extractClaimId sometimes misses. One list + one
 *  get_claim for the newest id, pinned only if the poster matches. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const poster = typeof body.poster === "string" ? body.poster.toLowerCase() : "";
  if (!studioCanRead()) return NextResponse.json({ error: "studio read cooled down" }, { status: 503 });

  try {
    const ids = (await readClaim("list_claims")) as string[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "no claims" }, { status: 404 });
    }
    const newest = ids[ids.length - 1];
    const claim = (await readClaim("get_claim", [newest])) as ClaimSummary;
    if (poster && (claim.poster || "").toLowerCase() !== poster) {
      return NextResponse.json({ error: "newest claim is not yours", claimId: newest }, { status: 409 });
    }
    await bookUpsert(claim);
    return NextResponse.json({ claim });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
