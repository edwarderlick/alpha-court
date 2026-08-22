/** Shared view helpers for /my-stakes, My Activity, and Passport staking. */

export type StakeViewRow = {
  claim_id: string;
  title: string;
  asset: string;
  asset_b: string | null;
  side: "for" | "against";
  amount: string;
  state: string;
  consensus_result: string;
  outcome: "pending" | "won" | "lost" | "refunded";
  payout: string | null;
  payoutTx: string | null;
  origin_contract?: string;
  created_at?: string;
};

export function stakeOutcomeCopy(row: StakeViewRow): { label: string; detail: string; tone: string } {
  if (row.outcome === "pending") {
    return {
      label: row.state.replace(/_/g, " "),
      detail: "No outcome yet.",
      tone: "text-on-surface-variant",
    };
  }
  if (row.outcome === "lost") {
    return {
      label: "LOST",
      detail: "0 GEN, this stake lost",
      tone: "text-dispute-red",
    };
  }
  if (row.outcome === "refunded") {
    if (row.payout) {
      return {
        label: "REFUNDED",
        detail: `Returned ${row.payout} GEN${row.payoutTx ? ` · ${row.payoutTx.slice(0, 10)}…` : ""}`,
        tone: "text-on-surface-variant",
      };
    }
    if (row.payoutTx) {
      return {
        label: "REFUNDED",
        detail: `Refund not credited on-chain · ${row.payoutTx.slice(0, 10)}…`,
        tone: "text-arbitration-orange",
      };
    }
    return {
      label: "REFUNDED",
      detail: "Refund is a keeper native send after the contract marks REFUNDED, not an IC transfer. Not credited yet.",
      tone: "text-arbitration-orange",
    };
  }
  if (row.payout) {
    return {
      label: "WON",
      detail: `Paid ${row.payout} GEN${row.payoutTx ? ` · ${row.payoutTx.slice(0, 10)}…` : ""}`,
      tone: "text-secondary-fixed",
    };
  }
  if (row.payoutTx) {
    return {
      label: "WON",
      detail: `Payout not credited on-chain · ${row.payoutTx.slice(0, 10)}…`,
      tone: "text-arbitration-orange",
    };
  }
  return {
    label: "WON",
    detail: "Payout transfer not indexed yet",
    tone: "text-arbitration-orange",
  };
}
