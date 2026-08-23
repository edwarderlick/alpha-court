import { NextResponse } from "next/server";
import { bookAll, bookMeta } from "@/lib/genlayer/book";
import { studioStatus } from "@/lib/genlayer/studio-gate";
import { storageKind } from "@/lib/persist";

export async function GET() {
  const claims = await bookAll();
  return NextResponse.json({
    studio: studioStatus(),
    storage: storageKind(),
    book: await bookMeta(),
    ids: claims.map((c) => c.claim_id),
  });
}
