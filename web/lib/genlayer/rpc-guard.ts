export {
  isAnyRateLimit,
  isHourlyRateLimit,
  noteRpcFailure,
  rpcBlocked,
  rpcBlockedForMs,
  clearRpcBlock,
} from "./studio-gate";

export function isUnknownClaimMessage(text: string): boolean {
  return /missing or invalid|unknown claim|does not exist|not found|invalid parameters|no such claim/i.test(
    text
  );
}
