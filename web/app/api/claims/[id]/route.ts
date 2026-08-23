import { NextRequest, NextResponse } from "next/server";
import { readOneClaim } from "@/lib/genlayer/client";
import { bookAll, bookGet, bookUpsert } from "@/lib/genlayer/book";
import { isOnChainClaimId } from "@/lib/genlayer/claim-display";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";
import { isLegacyClaim } from "@/lib/legacy-claim-ids";
import { isAnyRateLimit, isUnknownClaimMessage, rpcBlocked } from "@/lib/genlayer/rpc-guard";
import {
  claimChainReadAllowed,
  noteClaimChainRead,
  studioCanRead,
  studioStatus,
} from "@/lib/genlayer/studio-gate";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const preferLegacy = req.nextUrl.searchParams.get("legacy") === "1";
  const origin = req.nextUrl.searchParams.get("origin");
  const booked = await bookGet(id, { preferLegacy, origin });
  if (!isOnChainClaimId(id)) {
    if (booked) return NextResponse.json({ claim: booked, pending: true });
    return NextResponse.json({ error: "not an on-chain claim id" }, { status: 400 });
  }
  if (preferLegacy && booked) {
    return NextResponse.json({ claim: booked, cached: true, legacy: true });
  }
  if (booked && isLegacyClaim(booked)) {
    return NextResponse.json({ claim: booked, cached: true, legacy: true, studio: studioStatus() });
  }
  const force = req.nextUrl.searchParams.get("fresh") === "1";
  if (!claimChainReadAllowed(id, force) && booked) {
    return NextResponse.json({ claim: booked, cached: true, studio: studioStatus() });
  }
  if (!studioCanRead() && booked) {
    return NextResponse.json({ claim: booked, cached: true, studio: studioStatus() });
  }
  try {
    const claim = (await readOneClaim(id)) as ClaimSummary;
    noteClaimChainRead(id);
    await bookUpsert(claim);
    return NextResponse.json({ claim, studio: studioStatus() });
  } catch (err) {
    if (booked) return NextResponse.json({ claim: booked, cached: true, studio: studioStatus() });
    const detail = err instanceof Error ? err.message : String(err);
    const known = (await bookAll())
      .map((c) => Number(c.claim_id))
      .filter((n) => Number.isFinite(n));
    const maxKnown = known.length ? Math.max(...known) : 0;
    const n = Number(id);
    const implausible = Number.isInteger(n) && n > maxKnown + 100;
    if (isUnknownClaimMessage(detail) || implausible) {
      return NextResponse.json(
        { error: "This claim does not exist on the deployed contract.", code: "not_found" },
        { status: 404 }
      );
    }
    if (rpcBlocked() || isAnyRateLimit(err)) {
      return NextResponse.json(
        {
          error: "Studio is unavailable, so this claim could not be checked.",
          code: "studio_unavailable",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: detail, code: "read_failed" }, { status: 502 });
  }
}
