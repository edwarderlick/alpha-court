import { NextResponse } from "next/server";
import { writeClaim } from "@/lib/genlayer/client";
import { apiErrorResponse } from "@/lib/genlayer/api-error";
import { isOnChainClaimId } from "@/lib/genlayer/claim-display";

/** POST -> resolve_appeal. Permissionless on-chain (no sender check), same here. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isOnChainClaimId(id)) {
    return NextResponse.json({ error: "[EXPECTED] unknown claim_id" }, { status: 400 });
  }
  try {
    const { txHash, receipt } = await writeClaim("resolve_appeal", [id]);
    return NextResponse.json({
      txHash,
      status: (receipt as { status_name?: string }).status_name ?? null,
    });
  } catch (err) {
    const { body, status } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
