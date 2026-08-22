"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getAuthorizedAccounts,
  getCurrentChainIdHex,
  hasInjectedWallet,
  isOnTargetChain,
  onAccountsChanged,
  onChainChanged,
  requestAccounts,
  trySnapAndChainSetup,
} from "./genlayer/wallet";

/**
 * Build Prompt 11: real wallet connect, replacing the Build Prompt 9
 * placeholder (this file's previous docstring read "No real wallet/
 * contract logic -- visual only"). Structure mirrors Provider Court's own
 * lib/store.tsx, confirmed to be its real, working implementation (not a
 * deferred/demo state) before reusing it here.
 */
export type WalletStatus = "disconnected" | "connecting" | "connected";

export type WalletState = {
  status: WalletStatus;
  address: string | null;
  wrongNetwork: boolean;
  // null = not checked yet (or no wallet connected). Informational only --
  // see trySnapAndChainSetup's docstring for why this never gates anything.
  snapInstalled: boolean | null;
};

const DEFAULT_WALLET: WalletState = {
  status: "disconnected",
  address: null,
  wrongNetwork: false,
  snapInstalled: null,
};

type AppState = {
  wallet: WalletState;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: () => Promise<void>;
  // Kept for the existing wallet-connect modal shell (provider picker UI).
  walletModalOpen: boolean;
  openWalletModal: () => void;
  closeWalletModal: () => void;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(DEFAULT_WALLET);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const refreshChainStatus = useCallback(async () => {
    try {
      const chainIdHex = await getCurrentChainIdHex();
      setWallet((w) => (w.status === "connected" ? { ...w, wrongNetwork: !isOnTargetChain(chainIdHex) } : w));
    } catch {
      // wallet may have been removed/locked; leave state as-is
    }
  }, []);

  useEffect(() => {
    if (!hasInjectedWallet()) return;
    getAuthorizedAccounts().then(async (accounts) => {
      if (accounts.length === 0) return;
      const chainIdHex = await getCurrentChainIdHex();
      setWallet({
        status: "connected",
        address: accounts[0],
        wrongNetwork: !isOnTargetChain(chainIdHex),
        snapInstalled: null,
      });
      const snapInstalled = await trySnapAndChainSetup(accounts[0]);
      setWallet((w) => (w.status === "connected" ? { ...w, snapInstalled } : w));
    });
  }, []);

  useEffect(() => {
    if (!hasInjectedWallet()) return;
    const offAccounts = onAccountsChanged((accounts) => {
      if (accounts.length === 0) {
        setWallet({ status: "disconnected", address: null, wrongNetwork: false, snapInstalled: null });
      } else {
        setWallet((w) => (w.status === "connected" ? { ...w, address: accounts[0] } : w));
      }
    });
    const offChain = onChainChanged(() => {
      refreshChainStatus();
    });
    return () => {
      offAccounts();
      offChain();
    };
  }, [refreshChainStatus]);

  const connectWallet = useCallback(async () => {
    setWallet({ status: "connecting", address: null, wrongNetwork: false, snapInstalled: null });
    try {
      const address = await requestAccounts();
      const chainIdHex = await getCurrentChainIdHex();
      const wrongNetwork = !isOnTargetChain(chainIdHex);
      setWallet({ status: "connected", address, wrongNetwork, snapInstalled: null });
      const snapInstalled = await trySnapAndChainSetup(address);
      setWallet((w) => (w.status === "connected" ? { ...w, snapInstalled } : w));
    } catch (err) {
      setWallet({ status: "disconnected", address: null, wrongNetwork: false, snapInstalled: null });
      throw err;
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setWallet({ status: "disconnected", address: null, wrongNetwork: false, snapInstalled: null });
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!wallet.address) return;
    await trySnapAndChainSetup(wallet.address);
    await refreshChainStatus();
  }, [wallet.address, refreshChainStatus]);

  const value = useMemo<AppState>(
    () => ({
      wallet,
      connectWallet,
      disconnectWallet,
      switchNetwork,
      walletModalOpen,
      openWalletModal: () => setWalletModalOpen(true),
      closeWalletModal: () => setWalletModalOpen(false),
    }),
    [wallet, connectWallet, disconnectWallet, switchNetwork, walletModalOpen]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
