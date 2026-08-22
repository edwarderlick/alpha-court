"use client";

import { useState } from "react";
import { useAppState } from "@/lib/store";
import { hasInjectedWallet } from "@/lib/genlayer/wallet";
import { WrongNetworkBanner } from "./WrongNetworkBanner";

/**
 * Wallet-connect modal shell, converted verbatim from
 * wallet_connect_pro_theme/code.html. Build Prompt 9 kept it visual-only
 * ("selecting a provider does nothing but close the modal"); Build Prompt
 * 11 wires the MetaMask option to a real connectWallet() call -- a
 * rejected MetaMask prompt is caught and shown as a real error here, never
 * silently treated as a successful connection. WalletConnect/Coinbase stay
 * disabled and labeled "not available" rather than faking a connection,
 * same honesty standard as Provider Court's own WalletChip.
 */
export function WalletConnectModal() {
  const { walletModalOpen, closeWalletModal, wallet, connectWallet, switchNetwork } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  if (!walletModalOpen) return null;

  const providers = [
    { name: "MetaMask", description: "Connect using browser extension", available: true },
    { name: "WalletConnect", description: "Not yet available", available: false },
    { name: "Coinbase Wallet", description: "Not yet available", available: false },
  ];

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      await connectWallet();
      closeWalletModal();
    } catch (err) {
      // A rejected MetaMask connect prompt (or no wallet installed) lands
      // here as a real error message, never as a silent success.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-[#131313] rounded-3xl shadow-2xl overflow-hidden transform transition-all border-2 border-primary-container glow-purple flex flex-col">
        <div className="absolute inset-0 noise-overlay pointer-events-none" />
        {wallet.status === "connected" && wallet.wrongNetwork && (
          <WrongNetworkBanner onSwitch={switchNetwork} />
        )}
        <div className="px-8 pt-8 pb-6 relative z-10 flex justify-between items-start">
          <div>
            <h2 className="font-display-md text-[32px] md:text-display-md text-white mb-2 uppercase tracking-tighter leading-none">
              Connect Wallet
            </h2>
            <p className="font-body-md text-on-surface-variant font-mono text-sm opacity-80">
              Select a provider to authenticate your session.
            </p>
          </div>
          <button
            aria-label="Close"
            onClick={closeWalletModal}
            className="text-on-surface-variant hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-3xl">close</span>
          </button>
        </div>
        <div className="px-8 pb-2 relative z-10 flex flex-col gap-4">
          {!hasInjectedWallet() && (
            <p className="font-label-mono-sm text-label-mono-sm text-dispute-red">
              No wallet extension detected. Install MetaMask to continue.
            </p>
          )}
          {error && (
            <p className="font-label-mono-sm text-label-mono-sm text-dispute-red break-all">{error}</p>
          )}
          {providers.map((provider) => (
            <button
              key={provider.name}
              onClick={provider.available ? handleConnect : undefined}
              disabled={!provider.available || !hasInjectedWallet() || connecting}
              className="w-full bg-[#1a1a1a] border border-white/10 hover:border-secondary-container rounded-2xl p-5 flex items-center justify-between group transition-all duration-300 relative overflow-hidden glow-lime-hover disabled:opacity-40 disabled:hover:border-white/10"
            >
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-black/50 rounded-full flex items-center justify-center border border-white/10 group-hover:border-secondary-container transition-colors" />
                <div className="text-left">
                  <span className="block font-label-mono-bold text-label-mono-bold text-white uppercase tracking-wider mb-1 group-hover:text-secondary-container transition-colors">
                    {provider.available && connecting ? "CONNECTING..." : provider.name}
                  </span>
                  <span className="block font-body-md text-[12px] text-on-surface-variant font-mono">
                    {provider.description}
                  </span>
                </div>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant group-hover:text-secondary-container transition-colors relative z-10">
                chevron_right
              </span>
            </button>
          ))}
        </div>
        <div className="bg-black/50 px-8 py-4 mt-6 border-t border-white/5 relative z-10 text-center">
          <p className="font-body-md text-[12px] text-on-surface-variant/70 font-mono">
            By connecting a wallet, you agree to Alpha Court&apos;s{" "}
            <a className="text-primary-container hover:text-white transition-colors hover:underline" href="#">
              Terms of Service
            </a>{" "}
            and{" "}
            <a className="text-primary-container hover:text-white transition-colors hover:underline" href="#">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
