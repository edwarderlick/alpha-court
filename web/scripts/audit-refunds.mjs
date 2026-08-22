import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const RPC = "https://studio.genlayer.com/api";
const OLD = "0xd3cD69C30A4e899bA2D346723bffac066543cF97";
const NEW = "0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902";
const OUT = join(process.cwd(), "_verify", "refund-audit");
mkdirSync(OUT, { recursive: true });

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
  const methodMatch =
    blob.match(/method\|([A-Za-z0-9_]+)/) || blob.match(/"method"\s*:\s*"([A-Za-z0-9_]+)"/);
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

function bookClaims() {
  const file = join(process.cwd(), ".data", "claims-book.json");
  if (!existsSync(file)) return [];
  const book = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(book.claims) ? book.claims : [];
}

async function scan(address) {
  const txs = await rpc("sim_getTransactionsForAddress", [address]);
  if (!Array.isArray(txs)) throw new Error("unexpected txs " + typeof txs);
  const childrenByParent = new Map();
  const refundParents = [];
  for (const tx of txs) {
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
      hash: tx.hash,
      from: (tx.from_address || "").toLowerCase(),
      to: (tx.to_address || "").toLowerCase(),
      valueAtto: tx.value != null ? String(tx.value) : "0",
      credited: tx.value_credited === true,
      execution_result: exec,
      error: typeof err === "string" ? err.slice(0, 180) : "",
      method: parsed.method,
      claimId: parsed.arg,
      triggered_by: tx.triggered_by || null,
    };
    if (isChild) {
      const k = tx.triggered_by.toLowerCase();
      if (!childrenByParent.has(k)) childrenByParent.set(k, []);
      childrenByParent.get(k).push(row);
    }
    const blob = `${parsed.method || ""} ${parsed.decoded || ""} ${parsed.readable || ""}`;
    if (
      parsed.method === "expire_appeal" ||
      parsed.method === "resolve_appeal" ||
      /expire_appeal|resolve_appeal/.test(blob)
    ) {
      refundParents.push(row);
    }
  }
  return { txCount: txs.length, refundParents, childrenByParent };
}

const claims = bookClaims();
const refundedBook = claims.filter((c) => c.state === "REFUNDED");
const states = {};
for (const c of claims) states[c.state] = (states[c.state] || 0) + 1;

const oldScan = await scan(OLD);
const newScan = await scan(NEW);

function decorate(scan, label) {
  return scan.refundParents.map((p) => {
    const kids = scan.childrenByParent.get((p.hash || "").toLowerCase()) || [];
    const valueKids = kids.filter((k) => Number(k.valueAtto) > 0);
    return {
      court: label,
      method: p.method,
      claimId: p.claimId,
      parent: p.hash,
      parentExec: p.execution_result,
      children: valueKids.length,
      credited: valueKids.filter((k) => k.credited).length,
      failed: valueKids.filter((k) => !k.credited).length,
      childErrors: valueKids.map((k) => k.error).filter(Boolean).slice(0, 3),
    };
  });
}

const report = {
  book: { total: claims.length, states, refundedIds: refundedBook.map((c) => c.claim_id) },
  oldCourt: { address: OLD, txCount: oldScan.txCount, refundLike: decorate(oldScan, "old") },
  newCourt: { address: NEW, txCount: newScan.txCount, refundLike: decorate(newScan, "new") },
};

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
