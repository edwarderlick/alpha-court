import { NextRequest, NextResponse } from "next/server";
import { readClaimRaw } from "@/lib/genlayer/client";
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
import { withDeadline } from "@/lib/genlayer/rpc-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Production was returning an empty HTTP 500 body for this route
 * (~5s). Two stacked problems:
 *   1. `readOneClaim` calls Next `connection()`, which is for Server
 *      Components opting out of static render. In a Route Handler it
 *      can abort the response before we write JSON.
 *   2. The Studio `get_claim` had no deadline, so a slow/blocked RPC
 *      from Vercel's IP ate the Hobby function and the platform killed
 *      it with an empty body — a silent failure for anyone opening a
 *      case page (the client poll hits this route).
 * Always return JSON. Prefer cache. Bound the chain read so we answer
 * before the function is killed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();
  try {
    const { id } = await params;
    const preferLegacy = req.nextUrl.searchParams.get("legacy") === "1";
    const origin = req.nextUrl.searchParams.get("origin");
    let booked: ClaimSummary | null = null;
    try {
      booked = await withDeadline(bookGet(id, { preferLegacy, origin }), 1500, "bookGet");
    } catch (err) {
      console.error("bookGet failed", err);
    }
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
      const claim = (await withDeadline(
        readClaimRaw("get_claim", [id], { bypass: true }),
        6500,
        "get_claim"
      )) as ClaimSummary;
      noteClaimChainRead(id);
      try {
        await withDeadline(bookUpsert(claim), 1000, "bookUpsert");
      } catch {
        /* cache write must not fail the read */
      }
      return NextResponse.json({ claim, studio: studioStatus() });
    } catch (err) {
      if (booked) return NextResponse.json({ claim: booked, cached: true, studio: studioStatus() });
      const detail = err instanceof Error ? err.message : String(err);
      const known = (
        await withDeadline(bookAll(), 1000, "bookAll").catch(() => [] as ClaimSummary[])
      )
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
      if (rpcBlocked() || isAnyRateLimit(err) || /timed out/i.test(detail)) {
        return NextResponse.json(
          {
            error: "Studio is unavailable, so this claim could not be checked.",
            code: "studio_unavailable",
            detail,
            ms: Date.now() - started,
            studio: studioStatus(),
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: detail, code: "read_failed", ms: Date.now() - started, studio: studioStatus() },
        { status: 502 }
      );
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: detail, code: "unhandled", ms: Date.now() - started },
      { status: 502 }
    );
  }
}
