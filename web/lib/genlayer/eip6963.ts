"use client";

export type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isPhantom?: boolean;
  providers?: EthereumProvider[];
};

export type EIP6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
};

const STORAGE_KEY = "alpha-court.selected-wallet-rdns";

const announced = new Map<string, EIP6963ProviderDetail>();
const listeners = new Set<() => void>();
let discoveryStarted = false;
let selected: { rdns: string; provider: EthereumProvider } | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function onAnnounce(event: Event) {
  const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
  if (!detail?.info?.uuid || !detail.provider) return;
  announced.set(detail.info.uuid, detail);
  if (selected && detail.info.rdns === selected.rdns) {
    selected = { rdns: detail.info.rdns, provider: detail.provider };
  }
  emit();
}

export function startWalletDiscovery() {
  if (typeof window === "undefined" || discoveryStarted) return;
  discoveryStarted = true;
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function subscribeDiscoveredWallets(listener: () => void): () => void {
  startWalletDiscovery();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDiscoveredWallets(): EIP6963ProviderDetail[] {
  startWalletDiscovery();
  return Array.from(announced.values());
}

export function windowEthereum(): EthereumProvider | undefined {
  return typeof window !== "undefined"
    ? (window as unknown as { ethereum?: EthereumProvider }).ethereum
    : undefined;
}

function brandFromLegacy(provider: EthereumProvider): { name: string; rdns: string } {
  if (provider.isRabby) return { name: "Rabby", rdns: "io.rabby" };
  if (provider.isCoinbaseWallet) return { name: "Coinbase Wallet", rdns: "com.coinbase.wallet" };
  if (provider.isBraveWallet) return { name: "Brave Wallet", rdns: "com.brave.wallet" };
  if (provider.isOkxWallet) return { name: "OKX Wallet", rdns: "com.okex.wallet" };
  if (provider.isPhantom) return { name: "Phantom", rdns: "app.phantom" };
  if (provider.isMetaMask) return { name: "MetaMask", rdns: "io.metamask" };
  return { name: "Browser wallet", rdns: "legacy.injected" };
}

/** Used only when no EIP-6963 wallet announced (older injectors). */
export function getLegacyInjectedWallet(): EIP6963ProviderDetail | null {
  const eth = windowEthereum();
  if (!eth) return null;
  if (getDiscoveredWallets().length > 0) return null;
  const brand = brandFromLegacy(eth);
  return {
    info: {
      uuid: "legacy-injected",
      name: brand.name,
      icon: "",
      rdns: brand.rdns,
    },
    provider: eth,
  };
}

export function listInjectedWallets(): EIP6963ProviderDetail[] {
  const discovered = getDiscoveredWallets();
  if (discovered.length > 0) return discovered;
  const legacy = getLegacyInjectedWallet();
  return legacy ? [legacy] : [];
}

export function hasInjectedWallet(): boolean {
  return listInjectedWallets().length > 0 || Boolean(windowEthereum());
}

export function rememberProvider(rdns: string, provider: EthereumProvider) {
  selected = { rdns, provider };
  try {
    localStorage.setItem(STORAGE_KEY, rdns);
  } catch {
    /* private mode */
  }
}

export function forgetProvider() {
  selected = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export function storedWalletRdns(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getActiveProvider(): EthereumProvider | undefined {
  if (selected?.provider) return selected.provider;
  const rdns = storedWalletRdns();
  if (rdns) {
    const match = listInjectedWallets().find((w) => w.info.rdns === rdns);
    if (match) {
      selected = { rdns: match.info.rdns, provider: match.provider };
      return match.provider;
    }
  }
  return undefined;
}

export function findInjectedWallet(rdns: string): EIP6963ProviderDetail | undefined {
  return listInjectedWallets().find((w) => w.info.rdns === rdns);
}
