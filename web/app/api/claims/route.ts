import { NextRequest, NextResponse } from "next/server";
import { writeClaim, readOneClaim } from "@/lib/genlayer/client";
import { getAllClaimsSafe } from "@/lib/genlayer/claims";
import { bookAll, bookUpsert } from "@/lib/genlayer/book";
import { apiErrorResponse } from "@/lib/genlayer/api-error";
import { extractClaimId } from "@/lib/genlayer/receipt";
import { isOnChainClaimId, type ClaimSummary } from "@/lib/genlayer/claim-display";

/**
 * GET  -> list every claim on the deployed contract (Category A-style cheap
 *         display read: list_claims() + get_claim() per id, real data only).
 * POST -> create a claim of any of the three types, keyed by body.claimType.
 *         Build Prompt 10 extends Build Prompt 9's Price Threshold-only
 *         create here rather than adding parallel routes/patterns -- all
 *         three branches still go through the one writeClaim() choke point.
 *         Every numeric field arrives from the client as a string and is
 *         forwarded to the contract as a string, unparsed -- see
 *         lib/genlayer/client.ts's header for why that's non-negotiable.
 */
export async function GET() {
  try {
    const claims = await getAllClaimsSafe();
    return NextResponse.json({ claims });
  } catch (err) {
    const stale = await bookAll();
    if (stale.length > 0) return NextResponse.json({ claims: stale, cached: true });
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
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
      const { txHash, receipt } = await writeClaim(
        "create_relative_performance_claim",
        [assetA, assetB, deadline],
        stake
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
      const { txHash, receipt } = await writeClaim(
        "create_fundamentals_claim",
        [asset, metric, thresholdValue, direction, deadline],
        stake
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
    const { txHash, receipt } = await writeClaim(
      "create_claim",
      [asset, thresholdPrice, direction, deadline],
      stake
    );
    return NextResponse.json(await createdPayload(txHash, receipt));
  } catch (err) {
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
