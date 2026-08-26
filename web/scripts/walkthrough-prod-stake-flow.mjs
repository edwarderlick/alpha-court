/**
 * Real browser click-through of the custody-free stake UX against live
 * production (https://alpha-court.vercel.app).
 *
 * Not a scripted contract call pretending to be the UI: Playwright drives
 * the production page, the page's StakeForm, and an injected EIP-1193
 * MetaMask (+ GenLayer Snap methods) whose eth_sendTransaction actually
 * signs with wallet B and broadcasts to Studio.
 */
import { chromium } from "playwright";
import { createAccount, createClient, chains } from "genlayer-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, "..");
const PROD = process.env.BASE_URL || "https://alpha-court.vercel.app";
const OUT = join(WEB, "_verify", "prod-stake-flow");
mkdirSync(join(OUT, "video"), { recursive: true });

const TREASURY = "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";
const COURT = "0x219e753176D1157bC22376e10d06e4E21E401417";
const ADDR_B = "0xcE0ae5fCF5781810C8cc21c6135A5C3F50801025";
const SNAP_ID = "npm:genlayer-wallet-plugin";

const env = readFileSync(join(WEB, ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
if (!keyA) throw new Error("ALPHA_COURT_SIGNER_PRIVATE_KEY missing from web/.env.local");
const walletB = JSON.parse(readFileSync(join(WEB, "_verify", "predeploy", "wallet-b.json"), "utf8"));
const keyB = walletB.privateKey;

const accA = createAccount(keyA);
const accB = createAccount(keyB);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });

const result = {
  startedAt: new Date().toISOString(),
  prod: PROD,
  court: COURT,
  treasury: TREASURY,
  wallet: ADDR_B,
  steps: [],
  rpc: [],
};
function save() {
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
function note(id, status, detail) {
  const row = { id, status, detail, at: new Date().toISOString() };
  result.steps.push(row);
  save();
  console.log(`[${status}] ${id} — ${typeof detail === "string" ? detail.slice(0, 400) : JSON.stringify(detail)}`);
}

function toBigInt(v) {
  if (v == null || v === "" || v === "0x") return 0n;
  return BigInt(v);
}

async function waitReceipt(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 80, interval: 3000 });
  const exec = receipt?.consensus_data?.leader_receipt?.[0]?.execution_result || null;
  note(label, exec === "SUCCESS" || receipt.status === "FINALIZED" ? "PASS" : "WARN", {
    hash,
    status: receipt.status,
    exec,
  });
  return receipt;
}

function mmIconDataUri() {
  const svg = readFileSync(join(WEB, "public", "wallets", "metamask.svg"), "utf8");
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function handleWalletRpc(method, params) {
  if (method !== "eth_sendTransaction") {
    throw new Error("unsupported wallet method " + method);
  }
  const tx = (params && params[0]) || {};
  const value = toBigInt(tx.value);
  const hasData = Boolean(tx.data && tx.data !== "0x");
  let hash;
  if (!hasData) {
    // Native GEN send to the published treasury — same shape as deposit.ts.
    hash = await clientB.sendTransaction({ to: tx.to, value, account: accB });
  } else {
    // Browser genlayer-js already encoded a consensus addTransaction.
    // Sign that payload; do not re-wrap it through writeContract.
    const nonce =
      tx.nonce != null
        ? Number(toBigInt(tx.nonce))
        : Number(await clientB.getCurrentNonce({ address: ADDR_B }));
    const gas = tx.gas != null ? toBigInt(tx.gas) : 200000n;
    let gasPrice = tx.gasPrice != null ? toBigInt(tx.gasPrice) : 0n;
    if (gasPrice === 0n) {
      gasPrice = BigInt(await clientB.request({ method: "eth_gasPrice" }));
    }
    if (typeof accB.signTransaction !== "function") {
      throw new Error("wallet B account cannot signTransaction");
    }
    const serializedTransaction = await accB.signTransaction({
      to: tx.to,
      data: tx.data,
      value,
      type: "legacy",
      nonce,
      gas,
      gasPrice,
      chainId: 61999,
    });
    hash = await clientB.sendRawTransaction({ serializedTransaction });
  }
  result.rpc.push({
    method,
    to: tx.to,
    value: String(value),
    hasData,
    hash,
    at: new Date().toISOString(),
  });
  save();
  console.log("eth_sendTransaction", tx.to, "value", String(value), "data", hasData, "→", hash);
  return hash;
}

// --- setup: a fresh OPEN claim on the live court (not the UI under test) ---
const deadline = new Date(Date.now() + 25 * 60 * 1000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("creating OPEN claim on live court", COURT, "deadline", deadline);
const createHash = await clientA.writeContract({
  address: COURT,
  functionName: "create_claim",
  args: ["ETH/USD", "999998", "above", deadline, ""],
  value: 0n,
  account: accA,
});
await waitReceipt(clientA, createHash, "setup-create");
const ids = await clientA.readContract({ address: COURT, functionName: "list_claims", args: [] });
const claimId = String(ids.slice(-1)[0]);
result.claimId = claimId;
result.createHash = createHash;
save();
note("setup-claim", "PASS", `OPEN claim #${claimId}`);

const claim = await clientA.readContract({ address: COURT, functionName: "get_claim", args: [claimId] });
result.onChainBefore = { state: claim.state, deadline: claim.deadline, stake_against_total: claim.stake_against_total };
save();
if (claim.state !== "OPEN") {
  throw new Error("setup claim is not OPEN: " + claim.state);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(120000);
const consoleLines = [];
page.on("console", (msg) => {
  const line = `[${msg.type()}] ${msg.text()}`;
  consoleLines.push(line);
  if (/error|fail|snap|wallet|transfer|stake/i.test(msg.text())) console.log("PAGE", line.slice(0, 300));
});
page.on("pageerror", (err) => {
  consoleLines.push(`[pageerror] ${err.message}`);
  console.log("PAGEERROR", err.message);
});

await page.exposeFunction("__acWalletRequest", async (method, params) => {
  try {
    const value = await handleWalletRpc(method, params);
    return { ok: true, result: value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.rpc.push({ method, error: message, at: new Date().toISOString() });
    save();
    return { ok: false, message, code: err && err.code };
  }
});

await page.addInitScript(
  ({ address, icon, snapId, treasury }) => {
    let authorized = false;
    const snaps = {
      [snapId]: { id: snapId, origin: snapId, enabled: true, version: "1.0.0" },
    };
    const listeners = {};
    const provider = {
      isMetaMask: true,
      isFlask: true,
      _metamask: { isUnlocked: async () => true },
      request: async ({ method, params }) => {
        if (method === "eth_accounts") return authorized ? [address] : [];
        if (method === "eth_requestAccounts") {
          authorized = true;
          return [address];
        }
        if (method === "eth_chainId") return "0xf22f";
        if (method === "net_version") return "61999";
        if (method === "wallet_getSnaps") return snaps;
        if (method === "wallet_requestSnaps") return snaps;
        if (method === "web3_clientVersion") return "MetaMask/v12.12.0 flask";
        if (method === "wallet_addEthereumChain" || method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_watchAsset") return true;
        if (method === "eth_sendTransaction" || method === "personal_sign" || method === "eth_signTypedData_v4" || method === "eth_signTransaction") {
          const res = await window.__acWalletRequest(method, params || []);
          if (!res?.ok) {
            const e = new Error(res?.message || "wallet request failed");
            e.code = res?.code ?? -32603;
            throw e;
          }
          return res.result;
        }
        return null;
      },
      on(event, cb) {
        (listeners[event] ||= []).push(cb);
      },
      removeListener(event, cb) {
        listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
      },
    };
    window.ethereum = provider;
    function announce() {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: { uuid: "ac-metamask-flask", name: "MetaMask", icon, rdns: "io.metamask" },
            provider,
          },
        })
      );
    }
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    window.__acTreasury = treasury;
  },
  { address: ADDR_B, icon: mmIconDataUri(), snapId: SNAP_ID, treasury: TREASURY }
);

async function shot(name) {
  const path = join(OUT, `${name}.png`);
  try {
    await page.screenshot({ path, timeout: 45000, animations: "disabled", fullPage: true });
    console.log("shot", name);
  } catch (err) {
    console.log("shot-failed", name, err instanceof Error ? err.message : String(err));
  }
  return path;
}

async function bodyText() {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
}

// 1. landing + connect
await page.goto(PROD + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);
await shot("01-landing");
note("landing", "PASS", (await bodyText()).slice(0, 180));

const connectBtn = page.getByRole("button", { name: /connect wallet/i });
await connectBtn.first().click();
await page.getByRole("heading", { name: /connect wallet/i }).waitFor({ timeout: 15000 });
await shot("02-connect-modal");
note("connect-modal", "PASS", "wallet modal open");

const mm = page.getByRole("button", { name: /MetaMask/i });
if ((await mm.count()) === 0) throw new Error("MetaMask not listed in wallet modal");
await mm.first().click();
await page.waitForTimeout(1500);
await shot("03-connected");
const chipText = await page.locator("header, nav, body").innerText();
const connected = /0xcE0a|ce0ae5fc|cE0ae5fC/i.test(chipText) || (await page.getByText(/0xcE0a|ce0ae5/i).count()) > 0;
note("connected", connected ? "PASS" : "WARN", connected ? `connected ${ADDR_B}` : chipText.slice(0, 220));

const snapCheck = await page.evaluate(async (snapId) => {
  const snaps = await window.ethereum.request({ method: "wallet_getSnaps" });
  return { snaps, hasSnap: Boolean(snaps && snaps[snapId]) };
}, SNAP_ID);
result.snap = snapCheck;
note("snap", snapCheck.hasSnap ? "PASS" : "FAIL", snapCheck);

const chip = page.getByRole("button", { name: /0xcE0a|ce0ae5|Wrong network/i });
if ((await chip.count()) > 0) {
  await chip.first().click();
  await page.waitForTimeout(400);
  await shot("03b-chip-snap");
  const menu = await bodyText();
  note(
    "snap-ui",
    /Snap not detected/i.test(menu) ? "WARN" : "PASS",
    /Snap not detected/i.test(menu) ? "UI says snap missing" : "no snap-missing warning"
  );
}

// 2. case page: treasury + amount visible
await page.goto(`${PROD}/cases/${claimId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(4000);
await shot("04-case-loading");
try {
  await page.getByText(/Stake on this claim/i).waitFor({ timeout: 90000 });
} catch {
  await shot("04-case-no-stake-form");
  note("case-form", "FAIL", (await bodyText()).slice(0, 500));
  throw new Error("stake form never appeared on /cases/" + claimId);
}
const caseText = await bodyText();
const seesTreasury = new RegExp(TREASURY.slice(2), "i").test(caseText);
const seesAmount = /1-10|Amount \(GEN/i.test(caseText);
const seesCustodyCopy = /never holds your GEN|published treasury/i.test(caseText);
note("treasury-visible", seesTreasury && seesAmount ? "PASS" : "FAIL", {
  seesTreasury,
  seesAmount,
  seesCustodyCopy,
  excerpt: caseText.slice(0, 400),
});
await shot("05-treasury-and-amount");

if (!seesTreasury) throw new Error("production stake form did not show the treasury address");

// 3. submit against — real native send then register
await page.getByRole("button", { name: /^Against$/i }).click();
const amount = page.locator('input[type="number"]');
if ((await amount.count()) > 0) {
  await amount.first().fill("1");
}
await shot("06-ready-to-stake");
await page.getByRole("button", { name: /Stake AGAINST/i }).click();

let sawPending = false;
let sawWaiting = false;
let sawDone = false;
const deadlineMs = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadlineMs) {
  const text = await bodyText();
  if (/Confirm transfer, then register/i.test(text) && !sawPending) {
    sawPending = true;
    await shot("07-pending-confirmation");
    note("pending-confirmation", "PASS", "UI shows confirm-transfer / register pending");
  }
  if (/Studio has not finalized it yet|Do not send the GEN again|Register transfer/i.test(text) && !sawWaiting) {
    sawWaiting = true;
    await shot("08-waiting-transfer");
    note("waiting-transfer", "PASS", "honest pending-confirmation during Studio visibility lag");
    const register = page.getByRole("button", { name: /Register transfer/i });
    if ((await register.count()) > 0 && (await register.first().isEnabled())) {
      await register.first().click();
      note("register-click", "PASS", "clicked Register transfer");
    }
  }
  if (/Stake landed/i.test(text)) {
    sawDone = true;
    await shot("09-stake-landed");
    note("stake-landed", "PASS", text.match(/Tx: 0x[0-9a-fA-F]+/)?.[0] || "stake landed");
    break;
  }
  if (/Error:/i.test(text) && !/Stake landed/i.test(text)) {
    const err = text.match(/Error:.{0,400}/)?.[0] || text.slice(0, 400);
    await shot("09-stake-error");
    note("stake-error", "FAIL", err);
    if (!sawWaiting && !sawPending) break;
  }
  await page.waitForTimeout(2500);
}

if (!sawDone) {
  await shot("09-stake-timeout");
  note("stake-landed", "FAIL", { sawPending, sawWaiting, body: (await bodyText()).slice(0, 500) });
}

await page.waitForTimeout(3000);
await shot("10-after-stake");
const afterText = await bodyText();
result.afterStakeUi = afterText.slice(0, 800);

// On-chain confirmation (not a substitute for the UI — extra evidence the register landed)
let onChain = null;
for (let i = 0; i < 20; i++) {
  try {
    onChain = await clientA.readContract({ address: COURT, functionName: "get_claim", args: [claimId] });
    const against = parseFloat(onChain.stake_against_total) || 0;
    if (against >= 1) break;
  } catch (err) {
    console.log("on-chain lag", err instanceof Error ? err.message : err);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
result.onChainAfter = onChain
  ? {
      state: onChain.state,
      stake_for_total: onChain.stake_for_total,
      stake_against_total: onChain.stake_against_total,
    }
  : null;
const against = parseFloat(onChain?.stake_against_total) || 0;
note("on-chain-stake", against >= 1 ? "PASS" : "FAIL", result.onChainAfter);

try {
  const stakers = await clientA.readContract({
    address: COURT,
    functionName: "get_stakers_for_claim",
    args: [claimId],
  });
  result.stakers = stakers;
  const listed = JSON.stringify(stakers, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  note("stakers", listed.toLowerCase().includes(ADDR_B.slice(2).toLowerCase()) ? "PASS" : "WARN", listed.slice(0, 500));
} catch (err) {
  note("stakers", "WARN", err instanceof Error ? err.message : String(err));
}

// Appeal-bond UI: only if a real CONTESTED claim exists on this court
try {
  const allIds = await clientA.readContract({ address: COURT, functionName: "list_claims", args: [] });
  let contestedId = null;
  for (const id of allIds) {
    const row = await clientA.readContract({ address: COURT, functionName: "get_claim", args: [String(id)] });
    if (row.state === "CONTESTED") {
      contestedId = String(id);
      break;
    }
  }
  result.contestedId = contestedId;
  if (contestedId) {
    await page.goto(`${PROD}/cases/${contestedId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);
    await shot("11-appeal-contested");
    const t = await bodyText();
    const hasAppeal = /file appeal|required bond|appeal bond/i.test(t);
    const seesTreas = new RegExp(TREASURY.slice(2), "i").test(t);
    note("appeal-ui", hasAppeal ? "PASS" : "WARN", { contestedId, hasAppeal, seesTreas, excerpt: t.slice(0, 300) });
  } else {
    note(
      "appeal-ui",
      "SKIP",
      "No CONTESTED claim on the live court. Validator disagreement cannot be forced; appeal-bond UI was not click-through'd."
    );
  }
} catch (err) {
  note("appeal-ui", "SKIP", err instanceof Error ? err.message : String(err));
}

result.console = consoleLines.slice(-80);
result.finishedAt = new Date().toISOString();
result.video = context.pages()[0]?.video()?.path?.() || null;
save();

const videoPath = await page.video()?.path();
await browser.close();
if (videoPath && existsSync(videoPath)) {
  result.video = videoPath;
  save();
}

const failed = result.steps.filter((s) => s.status === "FAIL");
console.log("WALKTHROUGH_DONE claim", claimId, "fails", failed.length);
if (failed.length) {
  console.log(failed);
  process.exitCode = 1;
}
