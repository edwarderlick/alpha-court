import { NextRequest, NextResponse } from "next/server";
import { getDisplayPrice, getFundamentalsDisplay } from "@/lib/surf/display";

/**
 * Category A only -- GET, read-only, display convenience. Deliberately the
 * only route file that imports lib/surf/display.ts; deliberately does not
 * import lib/genlayer/client.ts. See that file's header for the full
 * structural-separation argument.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const asset = searchParams.get("asset");
  const assets = searchParams.get("assets");
  const assetA = searchParams.get("assetA");
  const assetB = searchParams.get("assetB");
  const metric = searchParams.get("metric");

  try {
    const headers = { "Cache-Control": "no-store" };
    if (assets || (assetA && assetB)) {
      return NextResponse.json(
        { error: "only one mark per request -- batch quotes are disabled" },
        { status: 400 }
      );
    }
    if (asset && metric) {
      return NextResponse.json(await getFundamentalsDisplay(asset, metric), { headers });
    }
    if (asset) {
      return NextResponse.json(await getDisplayPrice(asset), { headers });
    }
    return NextResponse.json(
      { error: "provide asset, assets, assetA+assetB, or asset+metric" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
