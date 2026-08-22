import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const OLD = "0xd3cD69C30A4e899bA2D346723bffac066543cF97";
const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });

const schema = await client.getContractSchema(OLD);
const methods = Object.keys(schema?.ctor?.kw || schema || {});
const schemaKeys = schema && typeof schema === "object" ? Object.keys(schema) : [];
const methodNames = [];
if (schema && typeof schema === "object") {
  for (const [k, v] of Object.entries(schema)) {
    methodNames.push(k);
    if (v && typeof v === "object" && v.methods) {
      methodNames.push(...Object.keys(v.methods));
    }
  }
}

const balance = await client.getBalance({ address: OLD });
const keeperBal = await client.getBalance({ address: account.address });

const writeNames = methodNames.concat(schemaKeys).map(String);
const recoveryHits = writeNames.filter((n) =>
  /withdraw|recover|drain|rescue|admin|owner|retry_payout|sweep/i.test(n)
);

let retryProbe = null;
const hasRetry = writeNames.some((n) => n === "retry_payout" || /retry_payout/.test(n));
if (hasRetry) {
  try {
    const hash = await client.writeContract({
      address: OLD,
      functionName: "retry_payout",
      args: ["31"],
      account,
    });
    const receipt = await client.waitForTransactionReceipt({ hash, retries: 40, interval: 3000 });
    retryProbe = {
      hash,
      exec: receipt.consensus_data?.leader_receipt?.[0]?.execution_result,
      result: receipt.result,
      triggered: receipt.triggered_transactions,
    };
  } catch (err) {
    retryProbe = { error: err instanceof Error ? err.message : String(err) };
  }
}

const evidence = {
  contract: OLD,
  balanceAtto: balance.toString(),
  balanceGen: Number(balance) / 1e18,
  keeperBalanceGen: Number(keeperBal) / 1e18,
  schemaKeys,
  methodNames: [...new Set(writeNames)].sort(),
  recoveryHits,
  hasRetryPayout: hasRetry,
  retryProbe,
  schemaPreview: JSON.stringify(schema).slice(0, 4000),
};
writeFileSync(join(OUT, "old-court-recovery.json"), JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
