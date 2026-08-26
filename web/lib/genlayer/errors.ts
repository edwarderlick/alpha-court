/**
 * Real incident: a real create_claim was signed, broadcast, and actually
 * succeeded on-chain (confirmed directly against the deployed contract
 * afterward), but the confirmation poll that follows submission failed
 * with a transient network error ("Failed to fetch"). The UI had no way
 * to tell that failure apart from "nothing was ever submitted" -- both
 * looked like a plain error, and retrying in that state risks a real
 * duplicate. This error type is thrown specifically when a write's
 * SUBMISSION already succeeded (a real tx hash exists) but its
 * CONFIRMATION poll then failed even after the patient retry budget in
 * rpc-retry.ts was exhausted -- carrying the real hash so the UI can
 * tell the visitor to check before resubmitting, instead of just
 * "error, try again."
 *
 * Isomorphic (no "server-only"/"use client") -- thrown from both the
 * server demo-signing path (lib/genlayer/client.ts) and the real
 * wallet-signing path (lib/genlayer/wallet.ts), and reconstructed
 * client-side from the demo path's JSON error response
 * (lib/genlayer/actions.ts), so every UI component checks exactly one
 * error type regardless of which path signed.
 */
/**
 * Native send succeeded (or was broadcast) but Studio RPC has not yet
 * returned the tx as FINALIZED. Not a failure — registering too early
 * would revert with "tx not found". UI should keep the hash and retry
 * registration, not send a second transfer.
 */
export class PendingTransferError extends Error {
  readonly txHash: string;

  constructor(txHash: string, cause?: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    super(
      `Your GEN transfer was submitted (tx ${txHash}) but Studio has not finalized it yet` +
        (causeMessage ? `: ${causeMessage}` : ".") +
        ` Wait, then register this hash — do not send the GEN again.`
    );
    this.name = "PendingTransferError";
    this.txHash = txHash;
    if (cause instanceof Error) this.cause = cause;
  }
}

export class UnconfirmedSubmissionError extends Error {
  readonly txHash: string;

  constructor(txHash: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Your transaction was submitted (tx ${txHash}) but couldn't be confirmed: ${causeMessage}. ` +
        `It may have already succeeded -- check before submitting again to avoid a duplicate.`
    );
    this.name = "UnconfirmedSubmissionError";
    this.txHash = txHash;
    if (cause instanceof Error) this.cause = cause;
  }
}
