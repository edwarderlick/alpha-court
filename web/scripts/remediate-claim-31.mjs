import { createAccount, createClient, chains } from "genlayer-js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const WINNER = "0x31e14df3b4f47F2428F3B78E7279691A78f70a05";
const AMOUNT = 10n * 10n ** 18n;
const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("ALPHA_COURT_SIGNER_PRIVATE_KEY missing");

const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });

const beforeWinner = await client.getBalance({ address: WINNER });
const beforeKeeper = await client.getBalance({ address: account.address });
console.log("before winner", beforeWinner.toString());
console.log("before keeper", beforeKeeper.toString());

if (beforeKeeper < AMOUNT) throw new Error("keeper balance too low");

const hash = await client.sendTransaction({
  to: WINNER,
  value: AMOUNT,
  account,
});
console.log("sent", hash);

const receipt = await client.waitForTransactionReceipt({
  hash,
  retries: 80,
  interval: 3000,
});
const afterWinner = await client.getBalance({ address: WINNER });
const afterKeeper = await client.getBalance({ address: account.address });

const evidence = {
  kind: "manual_correction",
  claimId: "31",
  reason: "Studio emit_transfer to EOA failed (0x568be786… value_credited=false). This is a separate native GEN send, not a contract payout.",
  to: WINNER,
  amountGen: "10",
  amountAtto: AMOUNT.toString(),
  from: account.address,
  txHash: hash,
  receiptStatus: receipt.status ?? receipt.statusName,
  execution: receipt.consensus_data?.leader_receipt?.[0]?.execution_result ?? receipt.result,
  balances: {
    winnerBefore: beforeWinner.toString(),
    winnerAfter: afterWinner.toString(),
    keeperBefore: beforeKeeper.toString(),
    keeperAfter: afterKeeper.toString(),
  },
};
writeFileSync(join(OUT, "claim-31-manual-correction.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
