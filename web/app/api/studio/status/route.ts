import { NextResponse } from "next/server";
import { bookAll, bookMeta } from "@/lib/genlayer/book";
import { studioStatus } from "@/lib/genlayer/studio-gate";

export async function GET() {
  const claims = bookAll();
  return NextResponse.json({
    studio: studioStatus(),
    book: bookMeta(),
    ids: claims.map((c) => c.claim_id),
  });
}
