import { NextResponse } from "next/server";
import { getPassportCached } from "@/lib/genlayer/passport";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  try {
    const passport = await getPassportCached(address);
    return NextResponse.json({ passport });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
