"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/lib/store";
import {
  listInjectedWallets,
  startWalletDiscovery,
  subscribeDiscoveredWallets,
  type EIP6963ProviderDetail,
} from "@/lib/genlayer/wallet";
import { WalletGlyph } from "./WalletIcons";
import { WrongNetworkBanner } from "./WrongNetworkBanner";

type ModalRow = {
  id: string;
  name: string;
  description: string;
  available: boolean;
  rdns: string;
  icon: string;
  detail?: EIP6963ProviderDetail;
};

function extraRows(injected: EIP6963ProviderDetail[]): ModalRow[] {
  const rdns = injected.map((w) => w.info.rdns.toLowerCase());
  const names = injected.map((w) => w.info.name.toLowerCase());
  const extras: ModalRow[] = [];
  const hasCoinbase = rdns.some((r) => r.includes("coinbase")) || names.some((n) => n.includes("coinbase"));
  extras.push({
    id: "walletconnect",
    name: "WalletConnect",
    description: "QR and mobile — coming soon",
    available: false,
    rdns: "walletconnect",
    icon: "/wallets/walletconnect.svg",
  });
  if (!hasCoinbase) {
    extras.push({
      id: "coinbase-soon",
      name: "Coinbase Wallet",
      description: "Mobile / QR — coming soon",
      available: false,
      rdns: "com.coinbase.wallet",
      icon: "/wallets/coinbase.svg",
    });
  }
  return extras;
}

export function WalletConnectModal() {
  const { walletModalOpen, closeWalletModal, wallet, connectWallet, switchNetwork } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [injected, setInjected] = useState<EIP6963ProviderDetail[]>([]);

  useEffect(() => {
    if (!walletModalOpen) return;
    startWalletDiscovery();
    const sync = () => setInjected(listInjectedWallets());
    sync();
    return subscribeDiscoveredWallets(sync);
  }, [walletModalOpen]);

  const rows = useMemo<ModalRow[]>(() => {
    const discovered: ModalRow[] = injected.map((detail) => ({
      id: detail.info.uuid,
      name: detail.info.name,
      description: "Connect using browser extension",
      available: true,
      rdns: detail.info.rdns,
      icon: detail.info.icon,
      detail,
    }));
    const extras = extraRows(injected);
    if (discovered.length === 0) {
      return [
        {
          id: "metamask-install",
          name: "MetaMask",
          description: "Install the browser extension",
          available: false,
          rdns: "io.metamask",
          icon: "/wallets/metamask.svg",
        },
        ...extras,
      ];
    }
    return [...discovered, ...extras];
  }, [injected]);

  if (!walletModalOpen) return null;

  async function handleConnect(row: ModalRow) {
    if (!row.available || !row.detail) return;
    setError(null);
    setConnectingId(row.id);
    try {
      await connectWallet(row.detail.provider, row.detail.info.rdns);
      closeWalletModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingId(null);
    }
  }

  const noneInstalled = injected.length === 0;

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
          {noneInstalled && (
            <p className="font-label-mono-sm text-label-mono-sm text-dispute-red">
              No wallet extension detected. Install MetaMask, Rabby, Coinbase Wallet, or Brave to continue.
            </p>
          )}
          {error && (
            <p className="font-label-mono-sm text-label-mono-sm text-dispute-red break-all">{error}</p>
          )}
          {rows.map((row) => {
            const busy = connectingId === row.id;
            const disabled = !row.available || connectingId !== null;
            return (
              <button
                key={row.id}
                type="button"
                onClick={row.available ? () => handleConnect(row) : undefined}
                disabled={disabled}
                className="w-full bg-[#1a1a1a] border border-white/10 hover:border-secondary-container rounded-2xl p-5 flex items-center justify-between group transition-all duration-300 relative overflow-hidden glow-lime-hover disabled:opacity-40 disabled:hover:border-white/10"
              >
                <div className="flex items-center gap-4 relative z-10 min-w-0">
                  <WalletGlyph name={row.name} rdns={row.rdns} icon={row.icon} />
                  <div className="text-left min-w-0">
                    <span className="block font-label-mono-bold text-label-mono-bold text-white uppercase tracking-wider mb-1 group-hover:text-secondary-container transition-colors truncate">
                      {busy ? "CONNECTING..." : row.name}
                    </span>
                    <span className="block font-body-md text-[12px] text-on-surface-variant font-mono">
                      {row.description}
                    </span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-secondary-container transition-colors relative z-10 shrink-0">
                  chevron_right
                </span>
              </button>
            );
          })}
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
