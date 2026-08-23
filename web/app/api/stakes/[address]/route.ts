import { NextResponse } from "next/server";
import { stakeRecordFromCache, stakeRowsFromCache, stakesForAddress } from "@/lib/genlayer/stakes";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  if (!address || !address.startsWith("0x")) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }
  try {
    const cached = await stakeRowsFromCache(address);
    const record = await stakeRecordFromCache(address);
    if (cached.length > 0) {
      return NextResponse.json({ stakes: cached, record, source: "cache" });
    }
    const stakes = await stakesForAddress(address);
    return NextResponse.json({ stakes, record: await stakeRecordFromCache(address), source: "live" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
