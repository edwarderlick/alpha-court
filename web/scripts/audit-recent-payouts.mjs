/**
 * Real, from-chain audit of claims #16-#21 on the LIVE contract (not the
 * legacy docket). No dependency on Redis or any local .data/ snapshot --
 * pulls resolve_verdict/resolve_appeal receipts, their triggered_transactions,
 * and each staker's real current get_stake() straight from Studio, the same
 * evidence method as the original 13-claim payout audit (audit-payouts.mjs),
 * generalized to the live contract and driven entirely by real transaction
 * history rather than a possibly-stale local book.
 */
import { createClient, chains } from "genlayer-js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const CONTRACT = "0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902";
const RPC = "https://studio.genlayer.com/api";
const OUT = join(process.cwd(), "_verify", "recent-payout-audit");
mkdirSync(OUT, { recursive: true });
const CLAIM_IDS = ["16", "17", "18", "19", "20", "21"];

function attoToGen(v) {
  try {
    const n = BigInt(v);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
  } catch {
    return String(v);
  }
}

function decodeB64(s) {
  if (!s || typeof s !== "string") return "";
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return s;
  }
}

function parseCalldata(tx) {
  const raw = tx?.data?.calldata;
  const b64 = typeof raw === "string" ? raw : raw?.base64;
  const readable = typeof raw === "object" && raw?.readable ? raw.readable : "";
  const decoded = b64 ? decodeB64(b64) : "";
  const blob = `${readable}\n${decoded}`;
  const methodMatch = blob.match(/method\|([A-Za-z0-9_]+)/) || blob.match(/"method"\s*:\s*"([A-Za-z0-9_]+)"/);
  const method = methodMatch ? methodMatch[1] : null;
  const argMatch = decoded.match(/(\d+)/) || blob.match(/"args"\s*:\s*\[\s*"(\d+)"/);
  const arg = argMatch ? argMatch[1] : null;
  return { method, arg, decoded, readable };
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

const client = createClient({ chain: chains.studionet });

async function getClaim(id) {
  return client.readContract({ address: CONTRACT, functionName: "get_claim", args: [id] });
}
async function getStake(id, side, addr) {
  return client.readContract({ address: CONTRACT, functionName: "get_stake", args: [id, side, addr] });
}

console.log("Fetching real tx history for live contract", CONTRACT);
const txs = await rpc("sim_getTransactionsForAddress", [CONTRACT]);
if (!Array.isArray(txs)) throw new Error("unexpected txs " + typeof txs);
console.log("contract txs:", txs.length);

const childrenByParent = new Map();
const resolvesByClaim = new Map();
const stakeTxsByClaim = new Map(); // claimId -> Set(address)

for (const tx of txs) {
  const hash = tx.hash;
  const parsed = parseCalldata(tx);
  const isChild = Boolean(tx.triggered_by);
  const exec =
    tx.execution_result || tx.consensus_data?.leader_receipt?.[0]?.execution_result || "";
  const row = {
    hash,
    from: (tx.from_address || "").toLowerCase(),
    to: (tx.to_address || "").toLowerCase(),
    valueAtto: tx.value != null ? String(tx.value) : "0",
    valueGen: attoToGen(tx.value ?? 0),
    credited: tx.value_credited === true,
    execution_result: exec,
    method: parsed.method,
    claimId: parsed.arg,
    triggered_by: tx.triggered_by || null,
  };
  if (isChild) {
    const k = tx.triggered_by.toLowerCase();
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k).push(row);
  }
  if (
    (row.method === "resolve_verdict" || row.method === "resolve_appeal" || row.method === "expire_appeal") &&
    row.claimId
  ) {
    if (!resolvesByClaim.has(row.claimId)) resolvesByClaim.set(row.claimId, []);
    resolvesByClaim.get(row.claimId).push(row);
  }
  if ((row.method === "stake_for" || row.method === "stake_against") && row.claimId) {
    if (!stakeTxsByClaim.has(row.claimId)) stakeTxsByClaim.set(row.claimId, new Set());
    stakeTxsByClaim.get(row.claimId).add(row.from);
  }
}

const report = [];
for (const id of CLAIM_IDS) {
  console.log(`\n--- claim #${id} ---`);
  let claim;
  try {
    claim = await getClaim(id);
  } catch (e) {
    console.log("get_claim failed:", e.message);
    report.push({ claim_id: id, error: "get_claim failed: " + e.message });
    continue;
  }
  const state = claim.state;
  const consensus = claim.consensus_result;
  console.log("state:", state, "consensus:", consensus, "for:", claim.stake_for_total, "against:", claim.stake_against_total);

  const side = consensus === "HELD" ? "for" : consensus === "BROKEN" ? "against" : null;
  const stakerAddrs = [...(stakeTxsByClaim.get(id) || [])];
  console.log("real stake_for/stake_against senders found on-chain:", stakerAddrs);

  const winners = [];
  for (const addr of stakerAddrs) {
    if (!side) continue;
    let stakeRaw;
    try {
      stakeRaw = await getStake(id, side, addr);
    } catch (e) {
      console.log(`  get_stake(${id},${side},${addr}) failed:`, e.message);
      continue;
    }
    const atto = String(stakeRaw ?? "0");
    if (atto === "0") continue;
    winners.push({ addr, side, stakeGen: attoToGen(atto), stakeAtto: atto });
  }
  console.log("real winning-side stakers (from get_stake):", winners);

  const resolves = resolvesByClaim.get(id) || [];
  const report_entry = {
    claim_id: id,
    state,
    consensus,
    winningSide: side,
    stakeForTotal: claim.stake_for_total,
    stakeAgainstTotal: claim.stake_against_total,
    resolveTxs: [],
    winners,
  };

  for (const r of resolves) {
    const children = childrenByParent.get(r.hash.toLowerCase()) || [];
    console.log(`  ${r.method} tx ${r.hash} exec=${r.execution_result} children=${children.length}`);
    for (const c of children) {
      console.log(`    child ${c.hash} to=${c.to} value=${c.valueGen} credited=${c.credited}`);
    }
    report_entry.resolveTxs.push({
      method: r.method,
      hash: r.hash,
      execution_result: r.execution_result,
      children: children.map((c) => ({
        hash: c.hash,
        to: c.to,
        valueGen: c.valueGen,
        valueAtto: c.valueAtto,
        credited: c.credited,
      })),
    });
  }

  // Cross-check: does every real on-chain winner have a real credited child
  // transfer sending them a nonzero value from this claim's resolve tx(s)?
  for (const w of winners) {
    const allChildren = report_entry.resolveTxs.flatMap((r) => r.children);
    const match = allChildren.find((c) => c.to === w.addr && c.credited && Number(c.valueAtto) > 0);
    w.realPayoutFound = Boolean(match);
    w.realPayoutTx = match?.hash || null;
    w.realPayoutValueGen = match?.valueGen || null;
    console.log(`  winner ${w.addr} stake=${w.stakeGen}: realPayoutFound=${w.realPayoutFound}${match ? ` (${match.hash}, ${match.valueGen} GEN)` : ""}`);
  }

  report.push(report_entry);
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log("\n\nWritten to", join(OUT, "report.json"));
