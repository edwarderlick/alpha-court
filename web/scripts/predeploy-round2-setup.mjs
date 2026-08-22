import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CONTRACT = "0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902";
const BASE = "http://localhost:3001";
const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const b = JSON.parse(readFileSync(join(OUT, "wallet-b.json"), "utf8"));
const c = JSON.parse(readFileSync(join(OUT, "wallet-c.json"), "utf8"));
const accountA = createAccount(keyA);
const client = createClient({ chain: chains.studionet, account: accountA });

const ADDR = {
  a: accountA.address,
  b: b.address,
  c: c.address,
};
const KEY = { a: keyA, b: b.privateKey, c: c.privateKey };

function gen(n) {
  return Number(n) / 1e18;
}

async function bals() {
  const out = {};
  for (const [k, addr] of Object.entries(ADDR)) {
    const v = await client.getBalance({ address: addr });
    out[k] = { address: addr, atto: v.toString(), gen: gen(v) };
  }
  return out;
}

async function rpc(method, params) {
  const res = await fetch("https://studio.genlayer.com/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

async function inspectTx(hash) {
  try {
    const tx = await client.getTransaction({ hash });
    return JSON.parse(JSON.stringify(tx, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch (err) {
    try {
      return await rpc("eth_getTransactionByHash", [hash]);
    } catch {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

async function remember(address, claimId, side, amountGen) {
  const res = await fetch(`${BASE}/api/stakes/remember`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, claimId, side, amountGen }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function createClaim(body) {
  const res = await fetch(`${BASE}/api/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}

async function stakeAs(who, claimId, side, amountGen) {
  const account = createAccount(KEY[who]);
  const w = createClient({ chain: chains.studionet, account });
  const before = await w.getBalance({ address: account.address });
  const hash = await w.writeContract({
    address: CONTRACT,
    functionName: side === "for" ? "stake_for" : "stake_against",
    args: [claimId],
    value: BigInt(Math.round(amountGen * 1e18)),
    account,
  });
  const receipt = await w.waitForTransactionReceipt({ hash, retries: 80, interval: 3000 });
  const after = await w.getBalance({ address: account.address });
  const exec = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  await remember(account.address, claimId, side, amountGen);
  return {
    who,
    address: account.address,
    claimId,
    side,
    amountGen,
    hash,
    exec,
    status: receipt.status,
    before: before.toString(),
    after: after.toString(),
  };
}

const log = [];
function note(id, status, detail) {
  log.push({ id, status, detail, at: new Date().toISOString() });
  console.log(`[${status}] ${id} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

const balancesBefore = await bals();
writeFileSync(join(OUT, "balances-after-8-10-resolve.json"), JSON.stringify(balancesBefore, null, 2));
note("04-balances-after-resolve", "INFO", balancesBefore);

const payoutTx = "0xa045cffcce4cada49bcb7ad15e354c20b149c0346c32b75d432183a641b653c4";
const payoutInspect = await inspectTx(payoutTx);
writeFileSync(join(OUT, "payout-8-a-tx.json"), JSON.stringify(payoutInspect, null, 2));
const creditedFlag = payoutInspect?.value_credited ?? payoutInspect?.data?.value_credited ?? null;
const value = payoutInspect?.value ?? payoutInspect?.data?.value ?? null;
note(
  "04-payout-8-tx",
  creditedFlag === true && Number(balancesBefore.a.gen) >= 29.9 ? "PASS" : "FAIL",
  {
    hash: payoutTx,
    value_credited: creditedFlag,
    value,
    walletAGen: balancesBefore.a.gen,
    expectedIfCredited: "~29.99",
  }
);

for (const id of ["8", "9", "10"]) {
  const r = await fetch(`${BASE}/api/claims/${id}`);
  const data = await r.json();
  note(`03-claim-${id}`, data.claim?.state === "RESOLVED" ? "PASS" : "WARN", {
    state: data.claim?.state,
    consensus: data.claim?.consensus_result,
    type: data.claim?.claim_type,
  });
}

await remember(ADDR.a, "8", "for", 2);
await remember(ADDR.b, "8", "against", 3);
await remember(ADDR.c, "8", "for", 1);
await remember(ADDR.a, "9", "for", 1);
await remember(ADDR.b, "9", "against", 1);
await remember(ADDR.a, "10", "for", 1);
await remember(ADDR.b, "10", "against", 1);
note("04-remember-8-10", "INFO", "positions written for A/B/C on 8/9/10");

const deadline = new Date(Date.now() + 6.5 * 60 * 1000).toISOString();
const created = {};
try {
  created.price = await createClaim({
    claimType: "PRICE_THRESHOLD",
    asset: "ETH/USD",
    thresholdPrice: "1.0",
    direction: "above",
    deadline,
    postingStakeGen: 0,
  });
  note("01-api-price", created.price.claimId ? "PASS" : "FAIL", created.price);
} catch (err) {
  note("01-api-price", "FAIL", err instanceof Error ? err.message : String(err));
}
try {
  created.relative = await createClaim({
    claimType: "RELATIVE_PERFORMANCE",
    assetA: "SOL/USD",
    assetB: "ETH/USD",
    deadline,
    postingStakeGen: 0,
  });
  note("01-api-relative", created.relative.claimId ? "PASS" : "FAIL", created.relative);
} catch (err) {
  note("01-api-relative", "FAIL", err instanceof Error ? err.message : String(err));
}
try {
  created.fundamentals = await createClaim({
    claimType: "FUNDAMENTALS_THRESHOLD",
    asset: "BTC",
    metric: "MVRV",
    thresholdValue: "1.0",
    direction: "above",
    deadline,
    postingStakeGen: 0,
  });
  note("01-api-fundamentals", created.fundamentals.claimId ? "PASS" : "FAIL", created.fundamentals);
} catch (err) {
  note("01-api-fundamentals", "FAIL", err instanceof Error ? err.message : String(err));
}

const stakes = [];
const priceId = created.price?.claimId;
const relId = created.relative?.claimId;
const fundId = created.fundamentals?.claimId;

async function safeStake(who, id, side, amount) {
  if (!id) return;
  try {
    const row = await stakeAs(who, String(id), side, amount);
    stakes.push(row);
    note(`02-stake-${who}-${id}-${side}`, /SUCCESS/i.test(String(row.exec)) || row.status === "FINALIZED" ? "PASS" : "FAIL", row);
  } catch (err) {
    note(`02-stake-${who}-${id}-${side}`, "FAIL", err instanceof Error ? err.message : String(err));
  }
}

if (priceId) {
  await safeStake("a", priceId, "for", 2);
  await safeStake("b", priceId, "against", 3);
  await safeStake("c", priceId, "for", 1);
}
if (relId) {
  await safeStake("a", relId, "for", 1);
  await safeStake("b", relId, "against", 1);
}
if (fundId) {
  await safeStake("a", fundId, "for", 1);
  await safeStake("b", fundId, "against", 1);
}

const balancesAfterStake = await bals();
writeFileSync(
  join(OUT, "round2-setup.json"),
  JSON.stringify({ created, stakes, balancesBefore, balancesAfterStake, log }, null, 2)
);
console.log(JSON.stringify({ created, log }, null, 2));
