import { NextRequest, NextResponse } from "next/server";
import { writeAsKeeper, readClaimRaw } from "@/lib/genlayer/client";
import { isOnChainClaimId, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { apiErrorResponse } from "@/lib/genlayer/api-error";
import { bookGet, bookUpsert } from "@/lib/genlayer/book";

/**
 * Emergency/debug only. Not linked from any page.
 *
 * POST { claimId, action: "lock" | "resolve" | "expire" | "appeal" }
 * Authorization: Bearer $KEEPER_SECRET
 *
 * Disabled unless KEEPER_SECRET is set, so a visitor cannot trigger
 * settlement by POSTing here. The live keeper uses writeAsKeeper
 * in-process and does not go through this route.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.KEEPER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "debug settle disabled" }, { status: 403 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const claimId = typeof body.claimId === "string" ? body.claimId.trim() : "";
  const action = body.action;
  if (!isOnChainClaimId(claimId)) {
    return NextResponse.json({ error: "[EXPECTED] unknown claim_id" }, { status: 400 });
  }
  const fn =
    action === "lock"
      ? "lock_deadline_evidence"
      : action === "resolve"
        ? "resolve_verdict"
        : action === "expire"
          ? "expire_appeal"
          : action === "appeal"
            ? "resolve_appeal"
            : null;
  if (!fn) {
    return NextResponse.json({ error: "action must be lock, resolve, expire, or appeal" }, { status: 400 });
  }

  try {
    const { txHash } = await writeAsKeeper(fn, [claimId]);
    try {
      const live = (await readClaimRaw("get_claim", [claimId], { bypass: true })) as ClaimSummary;
      bookUpsert(live);
    } catch {
      const existing = bookGet(claimId);
      if (existing) {
        bookUpsert({
          ...existing,
          state:
            action === "lock"
              ? "EVIDENCE_LOCKED"
              : action === "expire"
                ? "REFUNDED"
                : "RESOLVED",
        });
      }
    }
    return NextResponse.json({ txHash, action, claimId });
  } catch (err) {
    const { body: errorBody, status } = apiErrorResponse(err);
    return NextResponse.json(errorBody, { status });
  }
}
