"use client";

import { createClient, simplifyTransactionReceipt } from "genlayer-js";
import * as chains from "genlayer-js/chains";
import {
  withTransientRetry,
  PATIENT_CONFIRMATION_ATTEMPTS,
  PATIENT_CONFIRMATION_BASE_DELAY_MS,
} from "./rpc-retry";
import { UnconfirmedSubmissionError } from "./errors";
import { extractLeaderResult } from "./receipt";
import { getActiveProvider, type EthereumProvider } from "./eip6963";

export {
  hasInjectedWallet,
  rememberProvider,
  forgetProvider,
  getActiveProvider,
  startWalletDiscovery,
  subscribeDiscoveredWallets,
  listInjectedWallets,
  storedWalletRdns,
  findInjectedWallet,
  type EthereumProvider,
  type EIP6963ProviderDetail,
} from "./eip6963";

/**
 * Build Prompt 11: real MetaMask (or another injected EIP-1193 wallet)
 * integration, confirmed directly against the installed genlayer-js
 * source (node_modules/genlayer-js/dist/index.js), not assumed:
 *   - `createClient({ chain, account: address, provider: window.ethereum })`
 *     -- passing `account` as a plain address STRING (not an Account object
 *     from `createAccount()`) makes the client route every signing method
 *     (eth_sendTransaction, personal_sign, etc. -- see PROVIDER_METHODS in
 *     source) through `provider` instead of local key signing. This alone
 *     is enough for real writes; no Snap install is required for it
 *     (confirmed: `getCustomTransportConfig` in source only checks
 *     `typeof config.account !== "object"`, nothing Snap-related).
 *   - `client.connect(network)` additionally switches/adds the wallet's
 *     chain AND installs a GenLayer-specific MetaMask Snap
 *     ("npm:genlayer-wallet-plugin") via `wallet_getSnaps`/
 *     `wallet_requestSnaps` (source: src/wallet/connect.ts, bundled in
 *     dist/index.js) -- but `wallet_requestSnaps` is Flask/Snap-capable-
 *     MetaMask-only and throws on a normal MetaMask install. Treated as
 *     non-fatal here, same as Provider Court's own genlayer-wallet.ts,
 *     confirmed to be the real, working, already-shipped pattern there
 *     (not a demo/deferred state) before reusing its structure.
 *   - Studio specifically (`chain.isStudio === true`) skips the
 *     wallet-chain-id assertion entirely (`assertChainMatch` returns
 *     immediately for it, per source) -- so a wrong-network condition
 *     matters less for this app's actual target than it would for a real
 *     testnet, but the check is kept anyway since it's cheap and this
 *     code isn't Studio-only by construction.
 */

export type GenLayerNetwork = "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";

export const TARGET_NETWORK: GenLayerNetwork =
  (process.env.NEXT_PUBLIC_GENLAYER_NETWORK as GenLayerNetwork) || "studionet";

const CHAIN_BY_NETWORK: Record<GenLayerNetwork, (typeof chains)["studionet"]> = {
  localnet: chains.localnet,
  studionet: chains.studionet,
  testnetAsimov: chains.testnetAsimov,
  testnetBradbury: chains.testnetBradbury,
};

export const TARGET_CHAIN = CHAIN_BY_NETWORK[TARGET_NETWORK];

function getProvider(): EthereumProvider {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No wallet extension detected. Install MetaMask, Rabby, or Coinbase Wallet to continue.");
  }
  return provider;
}

export function explainWalletError(err: unknown): string {
  const code = (err as { code?: number })?.code;
  if (code === 4001) return "You rejected the connection request.";
  if (code === 4100) return "This wallet is not authorized for this site.";
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export async function requestAccounts(provider?: EthereumProvider): Promise<string> {
  const next = provider ?? getProvider();
  // Real rejection UX lives here: the wallet rejects this promise (code 4001)
  // if the user declines the connect prompt -- propagated as a real
  // Error, never silently treated as a successful connection.
  try {
    const accounts = (await next.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) throw new Error("No account returned by wallet.");
    return accounts[0];
  } catch (err) {
    throw new Error(explainWalletError(err));
  }
}

/** Silent check (no popup) for whether this site is already authorized. */
export async function getAuthorizedAccounts(provider?: EthereumProvider): Promise<string[]> {
  const next = provider ?? getActiveProvider();
  if (!next) return [];
  try {
    return (await next.request({ method: "eth_accounts" })) as string[];
  } catch {
    return [];
  }
}

export async function getCurrentChainIdHex(provider?: EthereumProvider): Promise<string> {
  return (await (provider ?? getProvider()).request({ method: "eth_chainId" })) as string;
}

export function isOnTargetChain(chainIdHex: string): boolean {
  return parseInt(chainIdHex, 16) === TARGET_CHAIN.id;
}

export function getWalletWriteClient(address: string) {
  const provider = getProvider();
  return createClient({
    chain: TARGET_CHAIN,
    account: address as `0x${string}`,
    provider: provider as never,
  });
}

const GENLAYER_SNAP_ID = "npm:genlayer-wallet-plugin";

/**
 * Checks/installs the GenLayer snap and switches chain, best-effort. Not
 * required for a write to succeed (see header note) -- called once after
 * connecting purely so a Snap-capable wallet gets the nicer experience;
 * failure here is swallowed and logged, never surfaced as a connect error.
 * Returns whether the snap ended up installed, so the UI can show an
 * honest (non-blocking) status instead of staying silent about it --
 * verified end-to-end via a scripted wallet_requestSnaps failure: connect
 * still succeeds and every write still works with no snap installed at
 * all, so this is purely informational, never a gate.
 */
export async function trySnapAndChainSetup(address: string): Promise<boolean> {
  const client = getWalletWriteClient(address);
  try {
    await client.connect(TARGET_NETWORK);
    const installedSnaps = (await getProvider().request({ method: "wallet_getSnaps" })) as Record<
      string,
      unknown
    >;
    return Object.keys(installedSnaps ?? {}).includes(GENLAYER_SNAP_ID);
  } catch (err) {
    console.warn(
      "client.connect() did not fully complete (Snap install unavailable on this wallet -- basic signing still works):",
      err
    );
    return false;
  }
}

export function onAccountsChanged(
  cb: (accounts: string[]) => void,
  provider?: EthereumProvider
): () => void {
  const next = provider ?? getActiveProvider();
  if (!next) return () => {};
  const handler = (...args: unknown[]) => cb(args[0] as string[]);
  next.on?.("accountsChanged", handler);
  return () => next.removeListener?.("accountsChanged", handler);
}

export function onChainChanged(
  cb: (chainIdHex: string) => void,
  provider?: EthereumProvider
): () => void {
  const next = provider ?? getActiveProvider();
  if (!next) return () => {};
  const handler = (...args: unknown[]) => cb(args[0] as string);
  next.on?.("chainChanged", handler);
  return () => next.removeListener?.("chainChanged", handler);
}

/**
 * Build Prompt 10's revert-detection fix, applied to the browser signing
 * path too: `status_name`/FINALIZED reflects consensus finalization, not
 * whether the call itself reverted -- a cleanly-rejected UserError
 * finalizes exactly like a real success. Every wallet-signed write in
 * lib/genlayer/actions.ts goes through this, same as the server path in
 * lib/genlayer/client.ts.
 */
export async function waitFinalizedInBrowser(
  client: ReturnType<typeof createClient>,
  hash: `0x${string}`
) {
  // Pre-launch audit: only the receipt POLL is retried, never the
  // signing/submission that already happened before this is called --
  // this only re-asks for a transaction already broadcast. See
  // rpc-retry.ts for the confirmed-real transient failures this covers.
  //
  // Real incident: exactly this poll failed with "Failed to fetch" after
  // a real, wallet-signed create_claim had already succeeded on-chain --
  // confirmed directly by finding the real claim, with the submitted
  // values, already live. A patient budget tries hard to avoid ever
  // reaching the catch below; if it's still exhausted, the caller gets
  // UnconfirmedSubmissionError (carries the real hash) instead of a
  // plain error indistinguishable from "nothing was submitted" -- see
  // errors.ts's header.
  let receipt;
  try {
    receipt = await withTransientRetry(
      () => client.waitForTransactionReceipt({ hash: hash as never }),
      PATIENT_CONFIRMATION_ATTEMPTS,
      PATIENT_CONFIRMATION_BASE_DELAY_MS
    );
  } catch (err) {
    throw new UnconfirmedSubmissionError(hash, err);
  }
  const simplified = simplifyTransactionReceipt(receipt as never);
  const leaderResult = extractLeaderResult(simplified) ?? extractLeaderResult(receipt);
  if (leaderResult?.status === "rollback") {
    const payload =
      typeof leaderResult.payload === "string" ? leaderResult.payload : "transaction reverted";
    throw new Error(payload);
  }
  return receipt;
}
