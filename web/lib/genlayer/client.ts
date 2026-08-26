import "server-only";

import { connection } from "next/server";
import { createAccount, createClient, chains } from "genlayer-js";
import type { Address } from "viem";
import { genToAtto } from "./atto";
import {
  withTransientRetry,
  PATIENT_CONFIRMATION_ATTEMPTS,
  PATIENT_CONFIRMATION_BASE_DELAY_MS,
} from "./rpc-retry";
import { UnconfirmedSubmissionError } from "./errors";
import { extractLeaderResult } from "./receipt";
import { noteClaimChainRead, studioCanRead, studioCanWrite, studioNoteError } from "./studio-gate";
import { TREASURY_ADDRESS } from "./treasury";

export { genToAtto };

/**
 * Build Prompt 9: single choke point every SERVER-SIDE contract call goes
 * through, so the Build Prompt 8 string-only-across-the-boundary
 * discipline can't be accidentally skipped by a future call site. GenVM's
 * calldata encoder rejects non-integer JS numbers outright (confirmed in
 * genlayer-js's own source: `if (!Number.isInteger(data)) reportError(
 * "floats are not supported", data)`), so every arg passed through
 * readClaim/writeClaim below must already be a string/int/bool -- never a
 * raw float.
 *
 * Build Prompt 11: `writeClaim` here is now the DEMO-signing fallback
 * only, gated by `requireDemoSigningEnabled()` below -- real per-user
 * signing happens entirely in the browser (lib/genlayer/wallet.ts +
 * lib/genlayer/actions.ts), never through this server module, since the
 * server has no access to a user's MetaMask. Structure mirrors Provider
 * Court's lib/genlayer-server.ts (confirmed to be its real, already-
 * shipped pattern -- see that file's own `requireDemoSigningEnabled`).
 */

const RAW_CONTRACT_ADDRESS =
  process.env.ALPHA_COURT_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS;
const SIGNER_PRIVATE_KEY = process.env.ALPHA_COURT_SIGNER_PRIVATE_KEY as
  | `0x${string}`
  | undefined;

if (!RAW_CONTRACT_ADDRESS) {
  throw new Error("ALPHA_COURT_CONTRACT_ADDRESS is not set");
}
const CONTRACT_ADDRESS = RAW_CONTRACT_ADDRESS as Address;

let readClientPromise: ReturnType<typeof createClient> | null = null;
let demoClientPromise: ReturnType<typeof createClient> | null = null;

function getReadClient() {
  if (!readClientPromise) {
    readClientPromise = createClient({ chain: chains.studionet });
  }
  return readClientPromise;
}

/**
 * Real security boundary for the demo-signing fallback -- deliberately a
 * server-only var (no NEXT_PUBLIC_ prefix, never reaches the client
 * bundle), independent of whatever the frontend's own public flag
 * (NEXT_PUBLIC_ALLOW_DEMO_SIGNING, see lib/genlayer/actions.ts) sent.
 * Defaults to disabled (fails closed) when unset, so a fresh deployment
 * that never sets this doesn't accidentally expose demo signing to every
 * write route below.
 */
function requireDemoSigningEnabled(): void {
  if (process.env.ALLOW_DEMO_SIGNING !== "true") {
    throw new Error(
      "[EXPECTED] demo signing is disabled on this deployment -- connect a real wallet to continue"
    );
  }
}

function getSignerClient() {
  if (!SIGNER_PRIVATE_KEY) {
    throw new Error("ALPHA_COURT_SIGNER_PRIVATE_KEY is not set -- server writes need a funded account");
  }
  if (!demoClientPromise) {
    const account = createAccount(SIGNER_PRIVATE_KEY);
    demoClientPromise = createClient({ chain: chains.studionet, account });
  }
  return demoClientPromise;
}

function getDemoClient() {
  requireDemoSigningEnabled();
  return getSignerClient();
}

export const CONTRACT = CONTRACT_ADDRESS;

/** Every element must already be calldata-safe: string | number(int) | boolean | null. */
type CalldataArg = string | number | boolean | null;

export async function readClaimRaw(
  functionName: string,
  args: CalldataArg[] = [],
  opts?: { bypass?: boolean }
) {
  if (!studioCanRead() && !opts?.bypass) {
    throw new Error("Studio rate limit is cooling down. Serving cached data only.");
  }
  const client = getReadClient();
  const nativeError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/rate limit exceeded/i.test(text)) return;
    nativeError.apply(console, args as []);
  };
  try {
    return await withTransientRetry(() =>
      client.readContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
      })
    );
  } catch (err) {
    studioNoteError(err, "read");
    throw err;
  } finally {
    console.error = nativeError;
  }
}

export async function readClaim(functionName: string, args: CalldataArg[] = []) {
  // Next.js App Router will otherwise statically cache this render. A
  // successful create_claim / stake then looks like it never landed
  // because browse-cases / case-detail keep serving the pre-write
  // snapshot. connection() marks every contract read as request-time.
  await connection();
  return readClaimRaw(functionName, args);
}

/** One-id reads used by case detail. Bypasses the list-wide cooldown. */
export async function readOneClaim(id: string) {
  await connection();
  const row = await readClaimRaw("get_claim", [id], { bypass: true });
  noteClaimChainRead(id);
  return row;
}

type Client = Awaited<ReturnType<typeof createClient>>;
type TxHash = NonNullable<Parameters<Client["waitForTransactionReceipt"]>[0]["hash"]>;

function asTxHash(hash: string): TxHash {
  return hash as TxHash;
}

export async function readTransaction(hash: string) {
  const client = getReadClient();
  return client.getTransaction({ hash: asTxHash(hash) });
}

async function submitWrite(
  client: ReturnType<typeof createClient>,
  functionName: string,
  args: CalldataArg[],
  value: number | bigint
) {
  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Check MetaMask Activity before sending again.");
  }
  const valueAtto = typeof value === "bigint" ? value : BigInt(Math.round(value * 1e18));
  let txHash: string;
  try {
    txHash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName,
      args,
      value: valueAtto,
    });
  } catch (err) {
    studioNoteError(err, "write");
    throw err;
  }
  let receipt;
  try {
    receipt = await withTransientRetry(
      () => client.waitForTransactionReceipt({ hash: asTxHash(txHash) }),
      PATIENT_CONFIRMATION_ATTEMPTS,
      PATIENT_CONFIRMATION_BASE_DELAY_MS
    );
  } catch (err) {
    studioNoteError(err, "read");
    throw new UnconfirmedSubmissionError(txHash, err);
  }

  const leaderResult = extractLeaderResult(receipt);
  if (leaderResult?.status === "rollback") {
    const payload =
      typeof leaderResult.payload === "string" ? leaderResult.payload : `${functionName} reverted`;
    throw new Error(payload);
  }

  return { txHash, receipt, returnValue: leaderResult?.payload };
}

/** Demo-signing fallback only -- see requireDemoSigningEnabled() above. */
export async function writeClaim(
  functionName: string,
  args: CalldataArg[] = [],
  value: number | bigint = 0
) {
  return submitWrite(getDemoClient(), functionName, args, value);
}

/**
 * Demo path for the non-custodial deposit: send GEN to the treasury from
 * the demo signer, then register the resulting tx hash with value 0.
 */
export async function depositThenWrite(
  functionName: string,
  args: CalldataArg[],
  valueAtto: bigint
) {
  let transferHash = "";
  if (valueAtto > 0n) {
    const sent = await sendAsKeeper(TREASURY_ADDRESS, valueAtto);
    transferHash = sent.txHash;
  }
  return submitWrite(getDemoClient(), functionName, [...args, transferHash], 0n);
}

/** Native GEN send from the keeper EOA. Studionet IC→EOA transfers do not credit. */
export async function sendAsKeeper(to: Address, valueAtto: bigint) {
  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Native payout deferred.");
  }
  if (valueAtto <= 0n) {
    throw new Error("sendAsKeeper requires a positive value");
  }
  const client = getSignerClient();
  let txHash: string;
  try {
    txHash = await client.sendTransaction({
      to,
      value: valueAtto,
      account: createAccount(SIGNER_PRIVATE_KEY!),
    });
  } catch (err) {
    studioNoteError(err, "write");
    throw err;
  }
  let receipt;
  try {
    receipt = await withTransientRetry(
      () => client.waitForTransactionReceipt({ hash: asTxHash(txHash) }),
      PATIENT_CONFIRMATION_ATTEMPTS,
      PATIENT_CONFIRMATION_BASE_DELAY_MS
    );
  } catch (err) {
    studioNoteError(err, "read");
    throw new UnconfirmedSubmissionError(txHash, err);
  }
  return { txHash, receipt };
}

/** Keeper / automation path -- same funded signer, not gated by ALLOW_DEMO_SIGNING. */
export async function writeAsKeeper(
  functionName: string,
  args: CalldataArg[] = [],
  value: number | bigint = 0
) {
  return submitWrite(getSignerClient(), functionName, args, value);
}

export function keeperAddress(): Address | null {
  if (!SIGNER_PRIVATE_KEY) return null;
  return createAccount(SIGNER_PRIVATE_KEY).address as Address;
}

export async function readNativeBalance(address: string): Promise<bigint> {
  const client = getReadClient();
  const value = await client.getBalance({ address: address as Address });
  if (typeof value === "bigint") return value;
  return BigInt(value as number | string);
}
