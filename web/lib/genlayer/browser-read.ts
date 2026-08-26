"use client";

import { createClient, chains } from "genlayer-js";
import type { ClaimSummary } from "./claim-display";

/**
 * Direct Studio read from the visitor's browser. Production Vercel Hobby
 * functions can die mid-flight on a slow Studio `get_claim` (empty HTTP
 * 500 before this fallback existed). The same RPC from a visitor IP is
 * the path writes already use.
 */
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS as
  | `0x${string}`
  | undefined;

let readClient: ReturnType<typeof createClient> | null = null;

function getBrowserReadClient() {
  if (!readClient) {
    readClient = createClient({ chain: chains.studionet });
  }
  return readClient;
}

export async function readClaimInBrowser(id: string): Promise<ClaimSummary | null> {
  if (!CONTRACT_ADDRESS || !id) return null;
  try {
    const row = (await getBrowserReadClient().readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_claim",
      args: [id],
    })) as ClaimSummary;
    if (row && String(row.claim_id ?? "") === String(id)) return row;
    if (row && row.state) return row;
    return null;
  } catch {
    return null;
  }
}
