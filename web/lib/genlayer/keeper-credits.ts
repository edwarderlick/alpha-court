import "server-only";
import type { PayoutTransfer } from "./payouts";

/**
 * After resolve_verdict, winners are paid by the contract itself
 * (`_pay_native` / emit_transfer). A keeper native send on top of that
 * would double-pay. This function is observation-only: triggered
 * children are indexed from the resolve receipt.
 */
export async function creditResolvedWinners(
  _claimId: string,
  _parentTx: string
): Promise<PayoutTransfer[]> {
  return [];
}

/**
 * After expire_appeal or resolve_appeal NO_AGREEMENT, original stakers
 * are refunded by the contract itself (`_pay_native` / emit_transfer).
 * This function is observation-only.
 */
export async function creditRefundedStakers(
  _claimId: string,
  _parentTx: string
): Promise<PayoutTransfer[]> {
  return [];
}
