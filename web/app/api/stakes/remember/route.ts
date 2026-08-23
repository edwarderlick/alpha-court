import { NextRequest, NextResponse } from "next/server";
import { rememberStakePosition } from "@/lib/genlayer/stakes";
import { isOnChainClaimId } from "@/lib/genlayer/claim-display";
import { genFloatToAtto } from "@/lib/genlayer/atto";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const address = typeof body.address === "string" ? body.address : "";
  const claimId = typeof body.claimId === "string" ? body.claimId : "";
  const side = body.side === "against" ? "against" : body.side === "for" ? "for" : "";
  const amountGen = typeof body.amountGen === "number" ? body.amountGen : Number(body.amountGen);
  if (!address.startsWith("0x") || !isOnChainClaimId(claimId) || !side || !Number.isFinite(amountGen)) {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const originContract = typeof body.originContract === "string" ? body.originContract : "";
  await rememberStakePosition({
    address,
    claimId,
    side,
    amountAtto: genFloatToAtto(amountGen).toString(),
    stakedAt: Date.now(),
    originContract: originContract || undefined,
  });
  return NextResponse.json({ ok: true });
}
