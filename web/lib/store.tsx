"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  forgetProvider,
  getAuthorizedAccounts,
  getCurrentChainIdHex,
  isOnTargetChain,
  listInjectedWallets,
  onAccountsChanged,
  onChainChanged,
  rememberProvider,
  requestAccounts,
  startWalletDiscovery,
  storedWalletRdns,
  subscribeDiscoveredWallets,
  trySnapAndChainSetup,
  type EthereumProvider,
} from "./genlayer/wallet";

/**
 * Real wallet connect. Injected wallets are discovered via EIP-6963 so
 * MetaMask, Rabby, Coinbase Wallet, Brave, OKX, etc. can each be chosen
 * explicitly. The selected EIP-1193 provider is stored and later passed
 * to genlayer-js createClient({ provider }).
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
  connectWallet: (provider: EthereumProvider, rdns: string) => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: () => Promise<void>;
  walletModalOpen: boolean;
  openWalletModal: () => void;
  closeWalletModal: () => void;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(DEFAULT_WALLET);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [providerEpoch, setProviderEpoch] = useState(0);
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const userDisconnected = useRef(false);

  const refreshChainStatus = useCallback(async () => {
    try {
      const chainIdHex = await getCurrentChainIdHex();
      setWallet((w) => (w.status === "connected" ? { ...w, wrongNetwork: !isOnTargetChain(chainIdHex) } : w));
    } catch {
      // wallet may have been removed/locked; leave state as-is
    }
  }, []);

  useEffect(() => {
    startWalletDiscovery();
    let cancelled = false;
    let inFlight = false;

    async function tryReconnect() {
      if (cancelled || inFlight || userDisconnected.current) return;
      if (walletRef.current.status === "connected" || walletRef.current.status === "connecting") return;
      inFlight = true;
      try {
        const injected = listInjectedWallets();
        if (injected.length === 0) return;
        const saved = storedWalletRdns();
        const ordered = saved
          ? [...injected.filter((w) => w.info.rdns === saved), ...injected.filter((w) => w.info.rdns !== saved)]
          : injected;
        for (const detail of ordered) {
          const accounts = await getAuthorizedAccounts(detail.provider);
          if (cancelled || userDisconnected.current || accounts.length === 0) continue;
          rememberProvider(detail.info.rdns, detail.provider);
          const chainIdHex = await getCurrentChainIdHex(detail.provider);
          if (cancelled || userDisconnected.current) return;
          setWallet({
            status: "connected",
            address: accounts[0],
            wrongNetwork: !isOnTargetChain(chainIdHex),
            snapInstalled: null,
          });
          setProviderEpoch((n) => n + 1);
          const snapInstalled = await trySnapAndChainSetup(accounts[0]);
          if (!cancelled && !userDisconnected.current) {
            setWallet((w) => (w.status === "connected" ? { ...w, snapInstalled } : w));
          }
          return;
        }
      } finally {
        inFlight = false;
      }
    }

    const unsub = subscribeDiscoveredWallets(() => {
      void tryReconnect();
    });
    void tryReconnect();
    const late = setTimeout(() => void tryReconnect(), 400);
    return () => {
      cancelled = true;
      unsub();
      clearTimeout(late);
    };
  }, []);

  useEffect(() => {
    if (wallet.status !== "connected") return;
    const offAccounts = onAccountsChanged((accounts) => {
      if (accounts.length === 0) {
        forgetProvider();
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
  }, [wallet.status, providerEpoch, refreshChainStatus]);

  const connectWallet = useCallback(async (provider: EthereumProvider, rdns: string) => {
    userDisconnected.current = false;
    rememberProvider(rdns, provider);
    setWallet({ status: "connecting", address: null, wrongNetwork: false, snapInstalled: null });
    try {
      const address = await requestAccounts(provider);
      const chainIdHex = await getCurrentChainIdHex(provider);
      const wrongNetwork = !isOnTargetChain(chainIdHex);
      setWallet({ status: "connected", address, wrongNetwork, snapInstalled: null });
      setProviderEpoch((n) => n + 1);
      const snapInstalled = await trySnapAndChainSetup(address);
      setWallet((w) => (w.status === "connected" ? { ...w, snapInstalled } : w));
    } catch (err) {
      forgetProvider();
      setWallet({ status: "disconnected", address: null, wrongNetwork: false, snapInstalled: null });
      throw err;
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    userDisconnected.current = true;
    forgetProvider();
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
