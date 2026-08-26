import { NextRequest, NextResponse } from "next/server";
import { depositThenWrite } from "@/lib/genlayer/client";
import { bustClaimsCache } from "@/lib/genlayer/claims-cache";
import { apiErrorResponse } from "@/lib/genlayer/api-error";
import { requireStakeOpen } from "@/lib/genlayer/write-guards";
import { isOnChainClaimId } from "@/lib/genlayer/claim-display";
import { rememberStakePosition } from "@/lib/genlayer/stakes";
import { genFloatToAtto } from "@/lib/genlayer/atto";

/** POST { side: "for" | "against", amountGen: number } -> stake_for/stake_against. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isOnChainClaimId(id)) {
    return NextResponse.json({ error: "[EXPECTED] unknown claim_id" }, { status: 400 });
  }
  const body = await req.json();
  const { side, amountGen } = body;

  if (side !== "for" && side !== "against") {
    return NextResponse.json(
      { error: 'side must be "for" or "against"' },
      { status: 400 }
    );
  }
  if (typeof amountGen !== "number" || amountGen <= 0) {
    return NextResponse.json(
      { error: "amountGen must be a positive number" },
      { status: 400 }
    );
  }

  const functionName = side === "for" ? "stake_for" : "stake_against";

  try {
    await requireStakeOpen(id);
    const { txHash, receipt } = await depositThenWrite(
      functionName,
      [id],
      genFloatToAtto(amountGen)
    );
    bustClaimsCache();
    const signer =
      (receipt as { from_address?: string }).from_address ||
      process.env.ALPHA_COURT_SIGNER_ADDRESS ||
      "";
    if (signer.startsWith("0x")) {
      await rememberStakePosition({
        address: signer,
        claimId: id,
        side,
        amountAtto: genFloatToAtto(amountGen).toString(),
        stakedAt: Date.now(),
      });
    }
    return NextResponse.json({
      txHash,
      status: (receipt as { status_name?: string }).status_name ?? null,
    });
  } catch (err) {
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
