import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const KEY = (envText.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1]?.trim();
const WINNER = "0x31e14df3b4f47F2428F3B78E7279691A78f70a05";
const CORRECTION = "0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f";
const CHILD = "0x568be786c0700dfab0dcfdb90da9b9999dc5b6937e0e9cf811394f320a9362e4";
const RESOLVE = "0x790643f532cea1738972393e111cdb0786e127f3ac8fabd861b76a9165efe1b5";
const OUT = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(OUT, { recursive: true });

const account = createAccount(KEY);
const client = createClient({ chain: chains.studionet, account });

function pick(tx) {
  if (!tx) return null;
  return {
    hash: tx.hash,
    from: tx.from_address || tx.from,
    to: tx.to_address || tx.to,
    value: String(tx.value ?? ""),
    execution_result:
      tx.execution_result || tx.consensus_data?.leader_receipt?.[0]?.execution_result,
    value_credited: tx.value_credited,
    status: tx.status ?? tx.status_name,
    triggered_by: tx.triggered_by || null,
    triggered_transactions: tx.triggered_transactions || null,
  };
}

const [correction, child, resolve, winnerBal] = await Promise.all([
  client.getTransaction({ hash: CORRECTION }),
  client.getTransaction({ hash: CHILD }),
  client.getTransaction({ hash: RESOLVE }),
  client.getBalance({ address: WINNER }),
]);

const out = {
  winner: WINNER,
  winnerBalanceAtto: winnerBal.toString(),
  winnerBalanceGen: Number(winnerBal) / 1e18,
  resolve: pick(resolve),
  failedChild: pick(child),
  manualCorrection: pick(correction),
};
writeFileSync(join(OUT, "claim-31-onchain-verify.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
