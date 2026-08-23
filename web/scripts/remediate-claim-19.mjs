import { createAccount, createClient, chains } from "genlayer-js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const WINNER = "0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const AMOUNT = 10n * 10n ** 18n;
const CLAIM_ORIGIN = "0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902"; // now-retired court claim 19 lived on
const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("ALPHA_COURT_SIGNER_PRIVATE_KEY missing");

const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account, endpoint: "https://studio.genlayer.com/api" });

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
  claimId: "19",
  claimOrigin: CLAIM_ORIGIN,
  reason:
    "Payout-key collision (bare claim_id, fail-open origin check in payoutsFor) let a real but unrelated 2026-08-20 payout row satisfy the 'already paid?' check for this claim, created 2026-08-23 -- three days later, temporally impossible as a real payout. The retry sweep never actually credited this winner. Fixed at the code level (payouts.ts now fails closed + backfills origin), but the court that hosted claim 19 (0x8b2fF616...) is now retired following this session's redeploy, so the keeper's own eligible() filter excludes it from ever being auto-retried again -- manual correction, same as claim 31 on the first retired court.",
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
  realCredit: afterWinner > beforeWinner,
};
writeFileSync(join(OUT, "claim-19-manual-correction.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
