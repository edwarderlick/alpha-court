"use client";

import { useAppState } from "@/lib/store";
import { AddressMark, shortenAddress } from "./AddressMark";
import { StandingChip } from "./StandingChip";

/** Replaces the static OPERATOR_01 / TRUST_SCORE: 98.4 sidebar chrome --
 *  that number was never real. Shows the connected wallet, or a connect
 *  prompt, so the shell matches the rest of the app. */
export function OperatorCard() {
  const { wallet, openWalletModal } = useAppState();

  if (wallet.status === "connected" && wallet.address) {
    return (
      <div className="flex items-center gap-4 mb-2">
        <AddressMark address={wallet.address} size={48} className="border border-secondary-fixed/40" />
        <div>
          <h2 className="font-label-mono-bold text-label-mono-bold text-on-surface">{shortenAddress(wallet.address)}</h2>
          <p className="font-label-mono-sm text-label-mono-sm text-secondary-fixed">
            {wallet.wrongNetwork ? "WRONG NETWORK" : "CONNECTED"}
          </p>
          <StandingChip />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 mb-2">
      <div className="w-12 h-12 rounded-full bg-surface-variant overflow-hidden border border-white/20" />
      <div>
        <h2 className="font-label-mono-bold text-label-mono-bold text-on-surface">NO WALLET</h2>
        <button
          type="button"
          suppressHydrationWarning
          onClick={openWalletModal}
          className="font-label-mono-sm text-label-mono-sm text-secondary-fixed hover:underline"
        >
          Connect to sign
        </button>
      </div>
    </div>
  );
}
