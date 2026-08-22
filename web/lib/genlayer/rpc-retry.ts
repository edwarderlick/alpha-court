/**
 * Pre-launch audit finding: no retry/backoff logic existed anywhere in
 * this app before this file, despite this project's own testing hitting
 * real transient Studio failures multiple times across Build Prompts 8-11
 * (a rate limit mid-receipt-poll in Build Prompt 9, a connect timeout and
 * an HTML-error-page-instead-of-JSON in Build Prompt 10's own testing,
 * a "fetch failed" hit again during this very audit). Every one of those
 * was previously worked around by a human manually waiting and retrying
 * a curl command -- nothing in the shipped app code did this for a real
 * visitor.
 *
 * Three confirmed-real transient failure shapes (patterns match Provider
 * Court's own rpc-retry.ts, independently confirmed against the same
 * Studio infrastructure in this project's own testing rather than copied
 * blind):
 *   1. Studio's node-capacity/rate-limit rejection ("Rate limit exceeded:
 *      30 requests per minute", "Server busy: ... execution slots
 *      occupied").
 *   2. Network-level failures (Node's "fetch failed" / the browser's
 *      "Failed to fetch", connection resets/timeouts).
 *   3. An HTML page returned where JSON was expected ("Unexpected token
 *      '<'", "is not valid JSON") -- hit for real in this project's own
 *      Build Prompt 10 testing, almost certainly an edge/gateway
 *      intervention in front of Studio's own app logic.
 *
 * Only ever wrap idempotent operations with this: reads, and receipt-
 * status polling (re-asking for a transaction's already-existing state).
 * NEVER wrap the write submission itself (writeContract) -- retrying a
 * genuine submission failure risks a real double-send.
 */
const BUSY_PATTERN = /server busy|execution slots occupied|rate limit exceeded/i;
const TRANSIENT_NETWORK_PATTERN =
  /fetch failed|failed to fetch|network(?:\s|-)?error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|UND_ERR|connect timeout/i;
const HTML_RESPONSE_PATTERN = /Unexpected token '<'|is not valid JSON|<!doctype/i;

export function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const causeMessage = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  const combined = `${message} ${causeMessage}`;
  // Hourly Studio cap is not a blip. Retrying it burns the next window
  // and keeps the landing spinner up for a minute per call.
  if (/500 requests per hour|requests per hour/i.test(combined)) return false;
  return (
    BUSY_PATTERN.test(combined) ||
    TRANSIENT_NETWORK_PATTERN.test(combined) ||
    HTML_RESPONSE_PATTERN.test(combined)
  );
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  attempts = 6,
  baseDelayMs = 2000
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * Real incident that motivated this: a real create_claim, signed and
 * broadcast successfully by a real wallet, failed to CONFIRM with
 * "GenLayer RPC error (eth_getTransactionByHash): Failed to fetch" --
 * the default budget above (6 attempts, ~62s of backoff) wasn't enough to
 * ride out that particular network blip. The claim had actually
 * succeeded on-chain the whole time (confirmed directly: the real claim
 * existed with the exact submitted values) -- the visitor just saw a
 * plain error with no way to tell "this may have already worked" from
 * "nothing happened." Post-submission confirmation gets a much larger
 * budget than a plain read: a false "it failed" here risks a real
 * duplicate submission if the visitor retries, which a slow-but-honest
 * wait does not.
 */
// 7 attempts, 2s base -> ~126s of backoff (2+4+8+16+32+64), long enough
// to ride out a real multi-minute-class blip without leaving a real
// visitor staring at a spinner indefinitely.
export const PATIENT_CONFIRMATION_ATTEMPTS = 7;
export const PATIENT_CONFIRMATION_BASE_DELAY_MS = 2000;
