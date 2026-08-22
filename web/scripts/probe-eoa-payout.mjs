import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("ALPHA_COURT_SIGNER_PRIVATE_KEY missing");

const RECIPIENT = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const AMOUNT = 10n ** 16n; // 0.01 GEN
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const code = readFileSync(
  join(process.cwd(), "..", "contract", "contracts", "payout_probe.py"),
  "utf8"
);
if (!code.includes("_EoaRecipient")) throw new Error("probe missing EOA path");

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });
console.log("deployer", account.address);

const beforeRecipient = await client.getBalance({ address: RECIPIENT });
const beforeDeployer = await client.getBalance({ address: account.address });
console.log("before recipient", beforeRecipient.toString());
console.log("before deployer", beforeDeployer.toString());

const deployHash = await client.deployContract({ code, args: [] });
console.log("deploy", deployHash);
const deployReceipt = await client.waitForTransactionReceipt({
  hash: deployHash,
  retries: 100,
  interval: 4000,
});
const deployExec =
  deployReceipt.consensus_data?.leader_receipt?.[0]?.execution_result ??
  deployReceipt.execution_result;
const probeAddress =
  deployReceipt.data?.contract_address ||
  deployReceipt.contract_address ||
  deployReceipt.to_address;
console.log("probe", probeAddress, "exec", deployExec);
if (String(deployExec).toUpperCase() !== "SUCCESS") {
  writeFileSync(
    join(OUT, "eoa-probe.json"),
    JSON.stringify({ deployHash, deployExec, deployReceiptKeys: Object.keys(deployReceipt || {}) }, (_, v) =>
      typeof v === "bigint" ? v.toString() : v, 2)
  );
  process.exit(2);
}

const pingHash = await client.writeContract({
  address: probeAddress,
  functionName: "ping",
  args: [RECIPIENT],
  value: AMOUNT,
});
console.log("ping", pingHash);
const pingReceipt = await client.waitForTransactionReceipt({
  hash: pingHash,
  retries: 100,
  interval: 4000,
});
const pingExec =
  pingReceipt.consensus_data?.leader_receipt?.[0]?.execution_result ??
  pingReceipt.execution_result;
const pending = pingReceipt.pending_transactions || pingReceipt.data?.pending_transactions || [];
const triggered = pingReceipt.triggered_transactions || pingReceipt.data?.triggered_transactions || [];
console.log("ping exec", pingExec, "pending", JSON.stringify(pending), "triggered", triggered);

let child = null;
let childHash = Array.isArray(triggered) && triggered.length > 0 ? triggered[0] : null;
if (!childHash) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const again = await client.getTransaction({ hash: pingHash });
    const t = again.triggered_transactions || again.data?.triggered_transactions || [];
    if (Array.isArray(t) && t.length > 0) {
      childHash = t[0];
      break;
    }
  }
}
if (childHash) {
  for (let i = 0; i < 20; i++) {
    child = await client.getTransaction({ hash: childHash });
    const exec =
      child.execution_result || child.consensus_data?.leader_receipt?.[0]?.execution_result;
    if (exec && String(exec).toUpperCase() !== "PENDING") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const afterRecipient = await client.getBalance({ address: RECIPIENT });
const afterDeployer = await client.getBalance({ address: account.address });

const evidence = {
  kind: "eoa_payout_probe",
  path: "_EoaRecipient.emit_transfer",
  probeAddress,
  deployHash,
  deployExec,
  pingHash,
  pingExec,
  pending,
  triggered,
  child: child
    ? {
        hash: child.hash,
        to: child.to_address || child.to,
        value: child.value?.toString?.() || child.value,
        execution_result:
          child.execution_result ||
          child.consensus_data?.leader_receipt?.[0]?.execution_result,
        value_credited: child.value_credited,
        error:
          child.consensus_data?.leader_receipt?.[0]?.result?.payload ||
          child.result ||
          null,
      }
    : null,
  amountAtto: AMOUNT.toString(),
  recipient: RECIPIENT,
  balances: {
    recipientBefore: beforeRecipient.toString(),
    recipientAfter: afterRecipient.toString(),
    deployerBefore: beforeDeployer.toString(),
    deployerAfter: afterDeployer.toString(),
    credited: afterRecipient > beforeRecipient,
  },
};
writeFileSync(
  join(OUT, "eoa-probe.json"),
  JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)
);
console.log(JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
if (!evidence.balances.credited) process.exit(3);
