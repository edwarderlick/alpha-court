import { createAccount, createClient, chains, generatePrivateKey } from "genlayer-js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "_verify", "predeploy");
mkdirSync(OUT, { recursive: true });
const FILE = join(OUT, "wallet-b.json");

let key;
try {
  key = JSON.parse(readFileSync(FILE, "utf8")).privateKey;
} catch {
  key = generatePrivateKey();
}
const account = createAccount(key);
const client = createClient({ chain: chains.studionet, account });

async function rpc(method, params) {
  const res = await fetch("https://studio.genlayer.com/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

const before = await client.getBalance({ address: account.address });
if (before < 20n * 10n ** 18n) {
  const funded = await rpc("sim_fundAccount", [account.address, 80]);
  console.log("faucet", funded);
}
const after = await client.getBalance({ address: account.address });
const out = {
  address: account.address,
  privateKey: key,
  balanceAtto: after.toString(),
  balanceGen: Number(after) / 1e18,
};
writeFileSync(FILE, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ address: out.address, balanceGen: out.balanceGen }));
