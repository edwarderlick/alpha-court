"use client";

import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/store";
import { AddressMark, shortenAddress } from "./AddressMark";

/**
 * Build Prompt 11: real connected-wallet chip, replacing the static
 * "Connect Wallet" text button that always opened the (previously
 * visual-only) modal. Shown in the header once a wallet is actually
 * connected -- real address, a real disconnect action, and an honest
 * wrong-network indicator (see lib/store.tsx for how wrongNetwork is
 * tracked for real).
 */
export function WalletChip() {
  const { wallet, disconnectWallet, switchNetwork, openWalletModal } = useAppState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (wallet.status !== "connected" || !wallet.address) {
    return (
      <button
        type="button"
        suppressHydrationWarning
        onClick={openWalletModal}
        className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary transition-colors scale-95 active:scale-90"
      >
        {wallet.status === "connecting" ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        suppressHydrationWarning
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1.5 rounded-full font-label-caps text-label-caps border transition-colors inline-flex items-center gap-2 ${
          wallet.wrongNetwork
            ? "border-dispute-red text-dispute-red"
            : "border-white/10 bg-surface-container-high text-primary"
        }`}
      >
        <AddressMark address={wallet.address} size={22} />
        {wallet.wrongNetwork ? "Wrong network" : shortenAddress(wallet.address)}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-surface-container border border-white/10 rounded-xl z-50 overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <p className="font-label-mono-sm text-label-mono-sm text-on-surface-variant mb-1">CONNECTED WALLET</p>
            <p className="font-label-mono-sm text-label-mono-sm break-all">{wallet.address}</p>
            {wallet.snapInstalled === false && (
              <p className="font-label-mono-sm text-label-mono-sm text-tertiary-container mt-2">
                GenLayer Snap not detected -- optional, all actions still work without it.
              </p>
            )}
          </div>
          {wallet.wrongNetwork && (
            <button
              onClick={() => switchNetwork().finally(() => setOpen(false))}
              className="w-full text-left px-4 py-3 font-label-mono-sm text-label-mono-sm text-dispute-red hover:bg-dispute-red/10 transition-colors"
            >
              Switch network
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              disconnectWallet();
            }}
            className="w-full text-left px-4 py-3 font-label-mono-sm text-label-mono-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
