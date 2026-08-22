import "server-only";
import { UnconfirmedSubmissionError } from "./errors";
import { explainContractError } from "./claim-display";

/**
 * Shared shape for every write API route's catch block, so the
 * UnconfirmedSubmissionError distinction (see errors.ts) doesn't need
 * reimplementing per route. `unconfirmed: true` + `txHash` tells the
 * client-side demo-signing path (lib/genlayer/actions.ts's jsonOrThrow)
 * to reconstruct the same error type the real wallet-signing path throws
 * natively, so every UI component checks one error type regardless of
 * which path signed.
 */
export function apiErrorResponse(err: unknown): { body: Record<string, unknown>; status: number } {
  if (err instanceof UnconfirmedSubmissionError) {
    return { body: { error: err.message, txHash: err.txHash, unconfirmed: true }, status: 502 };
  }
  return {
    body: { error: explainContractError(err instanceof Error ? err.message : String(err)) },
    status: 502,
  };
}
