import { NextResponse } from "next/server";
import { readClaim, depositThenWrite, genToAtto } from "@/lib/genlayer/client";
import { apiErrorResponse } from "@/lib/genlayer/api-error";
import { isOnChainClaimId } from "@/lib/genlayer/claim-display";

/**
 * POST -> file_appeal. Reads the real, already-computed appeal_bond off
 * the claim first (the contract computed it once, at the moment it went
 * CONTESTED -- see _compute_appeal_bond's docstring; this route never
 * recomputes it) and sends EXACTLY that amount, via genToAtto's exact
 * string arithmetic -- see client.ts's header for why float math here
 * would risk an on-chain exact-match revert.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isOnChainClaimId(id)) {
    return NextResponse.json({ error: "[EXPECTED] unknown claim_id" }, { status: 400 });
  }

  try {
    const claim = (await readClaim("get_claim", [id])) as {
      state: string;
      appeal_bond: string | null;
    };
    if (claim.state !== "CONTESTED") {
      return NextResponse.json(
        { error: `claim is ${claim.state}, not CONTESTED` },
        { status: 400 }
      );
    }
    if (!claim.appeal_bond) {
      return NextResponse.json({ error: "no appeal_bond on this claim" }, { status: 400 });
    }

    const { txHash, receipt } = await depositThenWrite(
      "file_appeal",
      [id],
      genToAtto(claim.appeal_bond)
    );
    return NextResponse.json({
      txHash,
      bondPaid: claim.appeal_bond,
      status: (receipt as { status_name?: string }).status_name ?? null,
    });
  } catch (err) {
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
