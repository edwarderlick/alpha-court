/**
 * Deploy the Studionet court that pays winners itself (un-stubbed
 * _pay_native) and uses treasury SELF so spent hashes cannot replay
 * from a retired court.
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
const SURF = (envText.match(/^SURF_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY || !SURF) throw new Error("missing env");

const code = readFileSync(join(process.cwd(), "..", "contract", "contracts", "alpha_court.py"), "utf8");
if (!code.includes("_ExternalRecipient")) throw new Error("source missing proven EOA emit_transfer interface");
if (!code.includes("recipient = Address(to.as_hex)")) throw new Error("source missing storage-Address reconstruction");
if (code.includes("Leaving this as a no-op")) throw new Error("_pay_native still documents the no-op");
if (!code.includes('t.upper() == "SELF"')) throw new Error("source missing SELF treasury rotation");
if (!code.includes("spent_tx_hashes")) throw new Error("source missing spent-hash set");

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account, endpoint: "https://studio.genlayer.com/api" });
console.log("deploying from", account.address, "treasury SELF", "code bytes", code.length);

const hash = await client.deployContract({
  code,
  args: [SURF, "SELF"],
});
console.log("deploy tx", hash);

const receipt = await client.waitForTransactionReceipt({
  hash,
  retries: 120,
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
  treasuryArg: "SELF",
};
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "deploy-v6-receipt.json"),
  JSON.stringify({ out }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)
);
console.log(JSON.stringify(out, null, 2));
if (exec && String(exec).toUpperCase() !== "SUCCESS") process.exit(2);
if (!contractAddress) process.exit(3);
