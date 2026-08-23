/**
 * One-shot: copy local .data JSON books into Redis (or the active persist
 * backend). Safe to re-run; last write per field wins.
 *
 * Run: node --import tsx --conditions=react-server scripts/seed-persist.ts
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { hashReplace, metaSet, storageKind } from "../lib/persist";

const dir = join(process.cwd(), ".data");

function readJson(name: string): Record<string, unknown> | null {
  const file = join(dir, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

async function main() {
  const kind = storageKind();
  console.log("storage", kind);

  const claimsFile = readJson("claims-book.json");
  if (claimsFile) {
    const claims = Array.isArray(claimsFile.claims) ? claimsFile.claims : [];
    const fields: Record<string, unknown> = {};
    for (const c of claims) {
      if (!c || typeof c !== "object") continue;
      const row = c as { claim_id?: string; origin_contract?: string };
      if (!row.claim_id) continue;
      const origin = (row.origin_contract || "").toLowerCase();
      fields[`${origin}::${row.claim_id}`] = c;
    }
    await hashReplace("claims", fields);
    await metaSet(typeof claimsFile.refreshedAt === "number" ? claimsFile.refreshedAt : Date.now());
    console.log("seeded claims", Object.keys(fields).length);
  }

  const payoutsFile = readJson("payouts-book.json");
  if (payoutsFile) {
    const transfers = Array.isArray(payoutsFile.transfers) ? payoutsFile.transfers : [];
    const fields: Record<string, unknown> = {};
    for (const t of transfers) {
      if (!t || typeof t !== "object") continue;
      const row = t as { txHash?: string };
      if (!row.txHash) continue;
      fields[row.txHash.toLowerCase()] = t;
    }
    await hashReplace("payouts", fields);
    console.log("seeded payouts", Object.keys(fields).length);
  }

  const stakesFile = readJson("stake-positions.json");
  if (stakesFile) {
    const positions =
      stakesFile.positions && typeof stakesFile.positions === "object"
        ? (stakesFile.positions as Record<string, unknown>)
        : {};
    await hashReplace("stakes", positions);
    console.log("seeded stakes", Object.keys(positions).length);
  }

  const passportsFile = readJson("passports.json");
  if (passportsFile) {
    const byAddress =
      passportsFile.byAddress && typeof passportsFile.byAddress === "object"
        ? (passportsFile.byAddress as Record<string, unknown>)
        : {};
    await hashReplace("passports", byAddress);
    console.log("seeded passports", Object.keys(byAddress).length);
  }

  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
