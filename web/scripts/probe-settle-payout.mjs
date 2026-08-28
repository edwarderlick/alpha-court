import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("ALPHA_COURT_SIGNER_PRIVATE_KEY missing");

const RECIPIENT = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const FUND = 10n ** 16n;      // 0.01 GEN in
const PAY  = 6n * 10n ** 15n; // 0.006 GEN out, in a LATER tx
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const code = readFileSync(
  join(process.cwd(), "..", "contract", "contracts", "settle_probe.py"),
  "utf8"
);

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });
const wait = (h) => client.waitForTransactionReceipt({ hash: h, retries: 150, interval: 4000 });
const exec = (r) =>
  String(r?.consensus_data?.leader_receipt?.[0]?.execution_result ?? r?.execution_result ?? "?").toUpperCase();

console.log("deployer", account.address);
const before = await client.getBalance({ address: RECIPIENT });
console.log("recipient before", before.toString());

const deployHash = await client.deployContract({ code, args: [] });
const dr = await wait(deployHash);
const probe = dr.data?.contract_address || dr.contract_address || dr.to_address;
console.log("deploy", deployHash, exec(dr), probe);
if (exec(dr) !== "SUCCESS") { writeFileSync(join(OUT,"settle-probe.json"), JSON.stringify({stage:"deploy",deployHash,exec:exec(dr)},null,2)); process.exit(2); }

// Step 1: fund only. No transfer emitted in this tx.
const fundHash = await client.writeContract({ address: probe, functionName: "fund", args: [], value: FUND });
const fr = await wait(fundHash);
console.log("fund", fundHash, exec(fr));
if (exec(fr) !== "SUCCESS") { writeFileSync(join(OUT,"settle-probe.json"), JSON.stringify({stage:"fund",fundHash,exec:exec(fr)},null,2)); process.exit(3); }

// Step 2: separate, deterministic, zero-value payout tx.
const payHash = await client.writeContract({ address: probe, functionName: "pay_out", args: [RECIPIENT, PAY.toString()] });
const pr = await wait(payHash);
const payExec = exec(pr);
console.log("pay_out", payHash, payExec);

let triggered = pr.triggered_transactions || pr.data?.triggered_transactions || [];
for (let i = 0; i < 25 && (!Array.isArray(triggered) || triggered.length === 0); i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const again = await client.getTransaction({ hash: payHash });
  triggered = again.triggered_transactions || again.data?.triggered_transactions || [];
}
console.log("triggered", JSON.stringify(triggered));

let child = null;
if (Array.isArray(triggered) && triggered.length > 0) {
  for (let i = 0; i < 25; i++) {
    child = await client.getTransaction({ hash: triggered[0] });
    const e = child.execution_result || child.consensus_data?.leader_receipt?.[0]?.execution_result;
    if (e && String(e).toUpperCase() !== "PENDING") break;
    await new Promise((r) => setTimeout(r, 4000));
  }
}

// Balances can lag the child; poll for the credit.
let after = await client.getBalance({ address: RECIPIENT });
for (let i = 0; i < 30 && after <= before; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  after = await client.getBalance({ address: RECIPIENT });
}

const evidence = {
  kind: "settle_payout_probe",
  shape: "ProofWorks: payable fund() then separate deterministic pay_out()",
  probe, deployHash, fundHash, payHash, payExec,
  triggered,
  child: child ? {
    hash: child.hash,
    to: child.to_address || child.to,
    value: child.value?.toString?.() || child.value,
    execution_result: child.execution_result || child.consensus_data?.leader_receipt?.[0]?.execution_result,
    value_credited: child.value_credited,
  } : null,
  fundedAtto: FUND.toString(), paidAtto: PAY.toString(), recipient: RECIPIENT,
  balances: {
    recipientBefore: before.toString(),
    recipientAfter: after.toString(),
    delta: (after - before).toString(),
    credited: after > before,
  },
};
const j = JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
writeFileSync(join(OUT, "settle-probe.json"), j);
console.log(j);
if (!evidence.balances.credited) process.exit(4);
