import { NextRequest, NextResponse } from "next/server";
import { readOneClaim, depositThenWrite } from "@/lib/genlayer/client";
import { genFloatToAtto } from "@/lib/genlayer/atto";
import { bookAll, bookUpsert } from "@/lib/genlayer/book";
import { getLastRedisError } from "@/lib/persist";
import { apiErrorResponse } from "@/lib/genlayer/api-error";
import { extractClaimId } from "@/lib/genlayer/receipt";
import { isOnChainClaimId, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { withDeadline } from "@/lib/genlayer/rpc-retry";

/**
 * GET  -> list claims from the Redis book. A full list_claims + get_claim
 *         fan-out from Vercel Hobby still dies with an empty 502.
 * POST -> create a claim of any of the three types, keyed by body.claimType.
 *         Build Prompt 10 extends Build Prompt 9's Price Threshold-only
 *         create here rather than adding parallel routes/patterns -- all
 *         three branches still go through the one writeClaim() choke point.
 *         Every numeric field arrives from the client as a string and is
 *         forwarded to the contract as a string, unparsed -- see
 *         lib/genlayer/client.ts's header for why that's non-negotiable.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const started = Date.now();
  try {
    // Do not fan out list_claims + get_claim from Vercel Hobby. That
    // path still dies with an empty 502 (~8s) even inside withDeadline —
    // the hanging Studio sockets eat the isolate before JSON is written.
    // One-id reads and the keeper fill the book; serve that.
    const booked = await withDeadline(bookAll(), 1500, "bookAll");
    // bookAll() swallows a dead-Redis hashLoad failure and returns []
    // rather than throwing (many other pages read through the same
    // hashLoad and must not 500 over a cache outage). That means an
    // empty array here is ambiguous: genuinely no claims, or the book is
    // unreachable. getLastRedisError() disambiguates it -- set only when
    // the load itself failed, cleared on the next success. A real outage
    // now reports as a real outage instead of a silently empty market.
    const redisError = getLastRedisError();
    if (booked.length === 0 && redisError) {
      return NextResponse.json(
        {
          claims: [],
          cached: false,
          degraded: true,
          error: `claims book unavailable: ${redisError}`,
          ms: Date.now() - started,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({
      claims: booked,
      cached: true,
      ms: Date.now() - started,
    });
  } catch (err) {
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(
      { ...body, claims: [], ms: Date.now() - started },
      { status }
    );
  }
}

async function createdPayload(txHash: string, receipt: unknown) {
  const claimId = extractClaimId(receipt);
  if (isOnChainClaimId(claimId)) {
    try {
      const claim = (await readOneClaim(claimId)) as ClaimSummary;
      await bookUpsert(claim);
    } catch {
      /* listing still works from the receipt id */
    }
  }
  return {
    txHash,
    claimId: claimId ?? null,
    status: (receipt as { status_name?: string }).status_name ?? null,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { claimType, postingStakeGen } = body;
  const stake = typeof postingStakeGen === "number" ? postingStakeGen : 0;

  try {
    if (claimType === "RELATIVE_PERFORMANCE") {
      const { assetA, assetB, deadline } = body;
      if (
        typeof assetA !== "string" ||
        typeof assetB !== "string" ||
        typeof deadline !== "string"
      ) {
        return NextResponse.json(
          { error: "assetA, assetB, deadline must all be strings" },
          { status: 400 }
        );
      }
      const { txHash, receipt } = await depositThenWrite(
        "create_relative_performance_claim",
        [assetA, assetB, deadline],
        genFloatToAtto(stake)
      );
      return NextResponse.json(await createdPayload(txHash, receipt));
    }

    if (claimType === "FUNDAMENTALS_THRESHOLD") {
      const { asset, metric, thresholdValue, direction, deadline } = body;
      if (
        typeof asset !== "string" ||
        typeof metric !== "string" ||
        typeof thresholdValue !== "string" ||
        typeof direction !== "string" ||
        typeof deadline !== "string"
      ) {
        return NextResponse.json(
          { error: "asset, metric, thresholdValue, direction, deadline must all be strings" },
          { status: 400 }
        );
      }
      const { txHash, receipt } = await depositThenWrite(
        "create_fundamentals_claim",
        [asset, metric, thresholdValue, direction, deadline],
        genFloatToAtto(stake)
      );
      return NextResponse.json(await createdPayload(txHash, receipt));
    }

    // Default / explicit "PRICE_THRESHOLD": Build Prompt 9's original shape.
    const { asset, thresholdPrice, direction, deadline } = body;
    if (
      typeof asset !== "string" ||
      typeof thresholdPrice !== "string" ||
      typeof direction !== "string" ||
      typeof deadline !== "string"
    ) {
      return NextResponse.json(
        { error: "asset, thresholdPrice, direction, deadline must all be strings" },
        { status: 400 }
      );
    }
    const { txHash, receipt } = await depositThenWrite(
      "create_claim",
      [asset, thresholdPrice, direction, deadline],
      genFloatToAtto(stake)
    );
    return NextResponse.json(await createdPayload(txHash, receipt));
  } catch (err) {
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
