/**
 * Deploy the Studionet court (v8):
 * - from/to historical lock evidence sampling (payload time <= declared deadline)
 * - canonical ISO-8601 UTC deadline validation & normalization
 * - 0-winner refund & 0-staker NO_AGREEMENT bond return
 * - custody escape hatches: expire_unsettled, expire_unresolved_lock, expire_unresolved_appeal, retry_refund
 * - pays winners via emit_transfer from self treasury (treasury = SELF)
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
let KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
if (KEY?.startsWith('"') && KEY?.endsWith('"')) KEY = KEY.slice(1, -1);
let SURF = (envText.match(/^SURF_API_KEY=(.*)$/m) || [])[1]?.trim();
if (SURF?.startsWith('"') && SURF?.endsWith('"')) SURF = SURF.slice(1, -1);
if (!KEY || !SURF) throw new Error("missing env");

const code = readFileSync(join(process.cwd(), "..", "contract", "contracts", "alpha_court.py"), "utf8");
if (!code.includes("_ExternalRecipient")) throw new Error("source missing proven EOA emit_transfer interface");
if (!code.includes("recipient = Address(to.as_hex)")) throw new Error("source missing storage-Address reconstruction");
if (code.includes("Leaving this as a no-op")) throw new Error("_pay_native still documents the no-op");
if (!code.includes('t.upper() == "SELF"')) throw new Error("source missing SELF treasury rotation");
if (!code.includes("spent_tx_hashes")) throw new Error("source missing spent-hash set");
if (!code.includes("paid: bool")) throw new Error("source missing Claim.paid");
if (!code.includes("claim already paid")) throw new Error("source missing already-paid revert");
if (!code.includes("only the claim poster or keeper may retry payout")) {
  throw new Error("source missing retry_payout caller gate");
}
if (!code.includes("def __receive__")) throw new Error("source missing __receive__");
if (!code.includes("def expire_unresolved_lock")) throw new Error("source missing expire_unresolved_lock");
if (!code.includes("_select_series_point")) throw new Error("source missing _select_series_point");
if (!code.includes("_parse_and_validate_canonical_deadline")) throw new Error("source missing _parse_and_validate_canonical_deadline");
if (!code.includes("def expire_unsettled")) throw new Error("source missing expire_unsettled");
if (!code.includes("def expire_unresolved_appeal")) throw new Error("source missing expire_unresolved_appeal");
if (!code.includes("def retry_refund")) throw new Error("source missing retry_refund");

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
  keeper: account.address,
};
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "deploy-v8-receipt.json"),
  JSON.stringify({ out }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)
);
console.log(JSON.stringify(out, null, 2));
if (exec && String(exec).toUpperCase() !== "SUCCESS") process.exit(2);
if (!contractAddress) process.exit(3);
