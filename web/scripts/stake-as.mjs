import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync } from "fs";
import { join } from "path";

const CONTRACT = "0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4";
const who = process.argv[2]; // a | b | c
const claimId = process.argv[3];
const side = process.argv[4]; // for | against
const gen = Number(process.argv[5] || "1");
if (!["a", "b", "c"].includes(who) || !claimId || !["for", "against"].includes(side) || !Number.isFinite(gen)) {
  console.error("usage: node stake-as.mjs a|b|c <claimId> for|against <gen>");
  process.exit(1);
}

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;
const keyC = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-c.json"), "utf8")).privateKey;
const key = who === "a" ? keyA : who === "b" ? keyB : keyC;
const account = createAccount(key);
const client = createClient({ chain: chains.studionet, account });
const before = await client.getBalance({ address: account.address });
const hash = await client.writeContract({
  address: CONTRACT,
  functionName: side === "for" ? "stake_for" : "stake_against",
  args: [claimId],
  value: BigInt(Math.round(gen * 1e18)),
  account,
});
const receipt = await client.waitForTransactionReceipt({ hash, retries: 80, interval: 3000 });
const after = await client.getBalance({ address: account.address });
const exec = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
console.log(
  JSON.stringify({
    who,
    address: account.address,
    claimId,
    side,
    gen,
    hash,
    exec,
    status: receipt.status,
    before: before.toString(),
    after: after.toString(),
  })
);
if (String(exec).toUpperCase() === "ERROR" || receipt.consensus_data?.leader_receipt?.[0]?.result?.status === "rollback") {
  process.exit(2);
}
