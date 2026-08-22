/**
 * Shared GEN <-> atto conversion, safe for both server and browser code
 * (no "server-only" import, no env access) -- needed in both
 * lib/genlayer/client.ts (server demo-signing path) and
 * lib/genlayer/actions.ts (browser wallet-signing path) for file_appeal's
 * exact-match bond amount.
 *
 * Exact decimal-string -> atto BigInt conversion, no float multiplication.
 * file_appeal requires message.value to equal appeal_bond_atto EXACTLY,
 * but get_claim can only expose that value as a float-divided decimal
 * string (bond_atto / ATTO, per the Build Prompt 8 calldata-string
 * discipline). Round-tripping that string through `parseFloat(x) * 1e18`
 * risks a double-precision rounding error large enough to fail the
 * contract's exact-match check and revert -- string arithmetic sidesteps
 * that entirely.
 */
export function genToAtto(decimal: string): bigint {
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  const atto = BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0");
  return negative ? -atto : atto;
}

/** stake_for/stake_against/create_claim only range-check value, no exact-match -- plain float is fine here. */
export function genFloatToAtto(gen: number): bigint {
  return BigInt(Math.round(gen * 1e18));
}

/** Exact atto -> decimal string. No float. 2250000000000000000 -> "2.25". */
export function attoToGenString(atto: bigint | string | number): string {
  const n = typeof atto === "bigint" ? atto : BigInt(String(atto));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 10n ** 18n;
  const frac = abs % 10n ** 18n;
  const sign = neg ? "-" : "";
  if (frac === 0n) return `${sign}${whole}`;
  return `${sign}${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}
