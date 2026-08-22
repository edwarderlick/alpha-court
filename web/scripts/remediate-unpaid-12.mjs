import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CLAIMS = ["18", "19", "21", "24", "25", "26", "27", "28", "29", "30", "32", "33"];
const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const report = JSON.parse(readFileSync(join(OUT, "report.json"), "utf8"));
const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });

const rows = [];
for (const claim of report.report) {
  if (!CLAIMS.includes(String(claim.claim_id))) continue;
  for (const child of claim.children || []) {
    rows.push({
      claimId: String(claim.claim_id),
      to: child.to,
      valueAtto: child.valueAtto,
      valueGen: child.valueGen,
      failedChild: child.hash,
      resolveTx: claim.resolveTx,
    });
  }
}

rows.sort((a, b) => {
  const selfA = a.to.toLowerCase() === account.address.toLowerCase() ? 0 : 1;
  const selfB = b.to.toLowerCase() === account.address.toLowerCase() ? 0 : 1;
  if (selfA !== selfB) return selfA - selfB;
  return Number(a.claimId) - Number(b.claimId);
});

const beforeKeeper = await client.getBalance({ address: account.address });
const results = [];
for (const row of rows) {
  const before = await client.getBalance({ address: row.to });
  const hash = await client.sendTransaction({
    to: row.to,
    value: BigInt(row.valueAtto),
    account,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 80, interval: 3000 });
  const after = await client.getBalance({ address: row.to });
  const item = {
    kind: "manual_correction",
    claimId: row.claimId,
    to: row.to,
    amountGen: row.valueGen,
    amountAtto: row.valueAtto,
    failedChild: row.failedChild,
    resolveTx: row.resolveTx,
    txHash: hash,
    status: receipt.status ?? receipt.status_name,
    value_credited: receipt.value_credited,
    winnerBefore: before.toString(),
    winnerAfter: after.toString(),
    credited: after > before || row.to.toLowerCase() === account.address.toLowerCase(),
  };
  results.push(item);
  console.log(JSON.stringify({ claimId: row.claimId, to: row.to, hash, credited: item.credited, gen: row.valueGen }));
}

const afterKeeper = await client.getBalance({ address: account.address });
const out = {
  reason: "Old court 0xd3cD69 has no withdraw/retry_payout. IC→EOA transfers do not credit. Same keeper native send as claim 31.",
  beforeKeeper: beforeKeeper.toString(),
  afterKeeper: afterKeeper.toString(),
  count: results.length,
  results,
};
writeFileSync(join(OUT, "unpaid-12-manual-corrections.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("done", results.length, "keeper", afterKeeper.toString());
