import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const CONTRACT = "0xd3cD69C30A4e899bA2D346723bffac066543cF97";
const RPC = "https://studio.genlayer.com/api";
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

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

function winningSide(consensus) {
  if (consensus === "HELD") return "for";
  if (consensus === "BROKEN") return "against";
  return null;
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
  const argMatch = decoded.match(/\u0014(\d+)/) || blob.match(/"args"\s*:\s*\[\s*"(\d+)"/);
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

const book = JSON.parse(readFileSync(join(process.cwd(), ".data", "claims-book.json"), "utf8"));
const pos = JSON.parse(readFileSync(join(process.cwd(), ".data", "stake-positions.json"), "utf8"));
const resolved = book.claims
  .filter((c) => c.state === "RESOLVED" || c.state === "REFUNDED")
  .sort((a, b) => Number(a.claim_id) - Number(b.claim_id));

const txs = await rpc("sim_getTransactionsForAddress", [CONTRACT]);
if (!Array.isArray(txs)) throw new Error("unexpected txs " + typeof txs);
console.log("contract txs", txs.length);

const childrenByParent = new Map();
const resolves = [];

for (const tx of txs) {
  const hash = tx.hash;
  const parsed = parseCalldata(tx);
  const isChild = Boolean(tx.triggered_by);
  const exec =
    tx.execution_result ||
    tx.consensus_data?.leader_receipt?.[0]?.execution_result ||
    "";
  const err =
    typeof tx.result === "string" && /not found|error/i.test(tx.result)
      ? tx.result
      : decodeB64(tx.consensus_data?.leader_receipt?.[0]?.result);
  const row = {
    hash,
    from: (tx.from_address || "").toLowerCase(),
    to: (tx.to_address || "").toLowerCase(),
    valueAtto: tx.value != null ? String(tx.value) : "0",
    valueGen: attoToGen(tx.value ?? 0),
    credited: tx.value_credited === true,
    execution_result: exec,
    error: typeof err === "string" ? err : "",
    method: parsed.method,
    claimId: parsed.arg,
    triggered_by: tx.triggered_by || null,
  };
  if (isChild) {
    const k = tx.triggered_by.toLowerCase();
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k).push(row);
  }
  if (parsed.method === "resolve_verdict" || (parsed.decoded && parsed.decoded.includes("resolve_verdict"))) {
    resolves.push(row);
  }
}

console.log("resolve_verdict", resolves.length, "child groups", childrenByParent.size);

const resolveByClaim = new Map();
for (const r of resolves) {
  if (r.claimId) resolveByClaim.set(r.claimId, r);
}

const report = [];
for (const c of resolved) {
  const forAmt = parseFloat(c.stake_for_total) || 0;
  const againstAmt = parseFloat(c.stake_against_total) || 0;
  const side = winningSide(c.consensus_result);
  const winPool = side === "for" ? forAmt : side === "against" ? againstAmt : 0;
  const losePool = side === "for" ? againstAmt : side === "against" ? forAmt : 0;
  const winners = [];
  for (const [key, p] of Object.entries(pos.positions || {})) {
    if (!key.includes(`:${c.claim_id}:`) || p.amountAtto === "0") continue;
    const [addr, , s] = key.split(":");
    if (side && s === side) {
      const stakeGen = Number(attoToGen(p.amountAtto));
      const owed = winPool > 0 ? stakeGen + (stakeGen * losePool) / winPool : 0;
      winners.push({ addr, side: s, stakeGen, owed });
    }
  }
  const resolve = resolveByClaim.get(c.claim_id) || null;
  const children = resolve ? childrenByParent.get(resolve.hash.toLowerCase()) || [] : [];
  const creditedKids = children.filter((ch) => ch.credited === true);
  const failedKids = children.filter((ch) => ch.credited !== true && Number(ch.valueAtto) > 0);

  let category;
  if (c.consensus_result !== "HELD" && c.consensus_result !== "BROKEN") category = "no_decisive_verdict";
  else if (winPool === 0) category = "no_winner_pool";
  else if (!resolve) category = "no_resolve_tx_found";
  else if (creditedKids.length > 0 && failedKids.length === 0) category = "paid_correctly";
  else if (failedKids.length > 0 && creditedKids.length === 0) category = "not_paid";
  else if (children.length === 0) category = "not_paid";
  else category = "uncertain";

  report.push({
    claim_id: c.claim_id,
    asset: c.asset,
    consensus: c.consensus_result,
    forAmt,
    againstAmt,
    winningSide: side,
    winPool,
    losePool,
    winners,
    resolveTx: resolve?.hash || null,
    resolveExec: resolve?.execution_result || null,
    children,
    creditedKids: creditedKids.length,
    failedKids: failedKids.length,
    category,
  });
}

const summary = { resolvedCount: resolved.length, resolveTxsFound: resolves.length, categories: {} };
for (const r of report) summary.categories[r.category] = (summary.categories[r.category] || 0) + 1;

writeFileSync(join(OUT, "report.json"), JSON.stringify({ summary, report }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of report) {
  const w = r.winners.map((x) => `${x.addr.slice(0, 8)}… owed ${x.owed}`).join(", ");
  console.log(
    `#${r.claim_id.padStart(2)} ${String(r.consensus).padEnd(6)} ${r.category.padEnd(22)} winPool=${r.winPool} losePool=${r.losePool} kids=${r.children.length} credited=${r.creditedKids} failed=${r.failedKids} ${w}`
  );
}
