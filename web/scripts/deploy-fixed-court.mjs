import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
const SURF = (envText.match(/^SURF_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY || !SURF) throw new Error("missing env");

const code = readFileSync(join(process.cwd(), "..", "contract", "contracts", "alpha_court.py"), "utf8");
if (!code.includes("_EoaRecipient")) throw new Error("source missing EOA payout path");

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });
console.log("deploying from", account.address, "code bytes", code.length);

const hash = await client.deployContract({
  code,
  args: [SURF],
});
console.log("deploy tx", hash);

const receipt = await client.waitForTransactionReceipt({
  hash,
  retries: 100,
  interval: 4000,
});

const exec = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
const contractAddress =
  receipt.contract_address ||
  receipt.data?.contract_address ||
  receipt.to_address ||
  null;

const out = {
  hash,
  status: receipt.status ?? receipt.statusName,
  execution_result: exec,
  contractAddress,
  keys: Object.keys(receipt || {}),
};
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "deploy-receipt.json"), JSON.stringify({ out, receiptPreview: {
  hash: receipt.hash,
  status: receipt.status,
  to_address: receipt.to_address,
  data: receipt.data,
  execution_result: exec,
} }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(JSON.stringify(out, null, 2));
if (exec && String(exec).toUpperCase() !== "SUCCESS") {
  process.exit(2);
}
