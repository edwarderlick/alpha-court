import { NextResponse } from "next/server";
import { stakeRecordFromCache } from "@/lib/genlayer/stakes";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  if (!address || !address.startsWith("0x")) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }
  return NextResponse.json(stakeRecordFromCache(address));
}
