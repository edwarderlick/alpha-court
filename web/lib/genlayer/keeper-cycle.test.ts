import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { UnconfirmedSubmissionError } from "./errors";
import {
  APPEAL_WINDOW_MS,
  emptyKeeperTickResult,
  runKeeperCycle,
  type KeeperClaim,
  type KeeperCycleIO,
  type KeeperLiveClaim,
} from "./keeper-cycle";

function claim(partial: Partial<KeeperClaim> & Pick<KeeperClaim, "claim_id" | "state">): KeeperClaim {
  return {
    deadline: "2099-01-01T00:00:00.000Z",
    ...partial,
  };
}

function io(opts?: {
  write?: KeeperCycleIO["write"];
  live?: Record<string, KeeperLiveClaim>;
  credit?: KeeperCycleIO["creditWinners"];
  refund?: KeeperCycleIO["creditRefunds"];
  now?: number;
}): { calls: { fn: string; args: string[] }[]; io: KeeperCycleIO } {
  const calls: { fn: string; args: string[] }[] = [];
  const live = opts?.live ?? {};
  return {
    calls,
    io: {
      write: async (fn, args) => {
        calls.push({ fn, args });
        if (opts?.write) return opts.write(fn, args);
        return { txHash: `0x${fn}-${args[0]}`, receipt: {} };
      },
      refreshBook: async (id, fallbackState) => live[id] ?? { state: fallbackState },
      indexTransfers: async () => {},
      creditWinners: opts?.credit ?? (async () => []),
      creditRefunds: opts?.refund ?? (async () => []),
      now: () => opts?.now ?? Date.parse("2026-08-22T00:00:00.000Z"),
    },
  };
}

describe("keeper cycle — APPEAL_PENDING bounded exit", () => {
  it("calls resolve_appeal on APPEAL_PENDING with no manual second step", async () => {
    const { calls, io: cycleIo } = io({
      live: { "41": { state: "RESOLVED", consensus_result: "HELD" } },
    });
    const result = await runKeeperCycle(
      [claim({ claim_id: "41", state: "APPEAL_PENDING" })],
      cycleIo,
    );

    assert.deepEqual(calls, [{ fn: "resolve_appeal", args: ["41"] }]);
    assert.deepEqual(result.appealed, ["41"]);
    assert.deepEqual(result.resolved, []);
    assert.deepEqual(result.expired, []);
    assert.deepEqual(result.locked, []);
    assert.deepEqual(result.errors, []);
  });

  it("credits winners after an appeal that settled HELD/BROKEN", async () => {
    const credited: string[] = [];
    const { io: cycleIo } = io({
      live: { "42": { state: "RESOLVED", consensus_result: "BROKEN" } },
      credit: async (claimId, parentTx) => {
        credited.push(`${claimId}:${parentTx}`);
        return [{ to: "0xabc", value: "3" }];
      },
    });
    const result = await runKeeperCycle(
      [claim({ claim_id: "42", state: "APPEAL_PENDING" })],
      cycleIo,
    );
    assert.deepEqual(result.appealed, ["42"]);
    assert.deepEqual(credited, ["42:0xresolve_appeal-42"]);
  });

  it("drains a claim already in REFUNDED without writing expire_appeal or resolve_appeal", async () => {
    const refunded: string[] = [];
    const { calls, io: cycleIo } = io({
      live: { "70": { state: "REFUNDED" } },
      refund: async (claimId, parentTx) => {
        refunded.push(`${claimId}:${parentTx}`);
        return [{ to: "0xabc", value: "2" }];
      },
    });
    const result = await runKeeperCycle(
      [claim({ claim_id: "70", state: "REFUNDED" })],
      cycleIo,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(result.expired, []);
    assert.deepEqual(result.appealed, []);
    assert.deepEqual(result.refunded, ["70"]);
    assert.deepEqual(refunded, ["70:"]);
  });

  it("native-sends refunds after expire_appeal with no extra click", async () => {
    const refunded: string[] = [];
    const now = Date.parse("2026-08-22T00:00:00.000Z");
    const contestedAt = new Date(now - APPEAL_WINDOW_MS - 1).toISOString();
    const { calls, io: cycleIo } = io({
      now,
      live: { "60": { state: "REFUNDED" } },
      refund: async (claimId, parentTx) => {
        refunded.push(`${claimId}:${parentTx}`);
        return [{ to: "0xabc", value: "2" }];
      },
    });
    const result = await runKeeperCycle(
      [claim({ claim_id: "60", state: "CONTESTED", contested_at: contestedAt })],
      cycleIo,
    );
    assert.deepEqual(calls, [{ fn: "expire_appeal", args: ["60"] }]);
    assert.deepEqual(result.expired, ["60"]);
    assert.deepEqual(refunded, ["60:0xexpire_appeal-60"]);
  });

  it("indexes a refund and does not credit winners when the second round is NO_AGREEMENT", async () => {
    const kinds: string[] = [];
    const credited: string[] = [];
    const refunded: string[] = [];
    const { calls, io: cycleIo } = io({
      live: { "43": { state: "REFUNDED" } },
      credit: async (claimId) => {
        credited.push(claimId);
        return [];
      },
      refund: async (claimId, parentTx) => {
        refunded.push(`${claimId}:${parentTx}`);
        return [{ to: "0xabc", value: "2" }];
      },
    });
    cycleIo.indexTransfers = async (opts) => {
      kinds.push(opts.kind);
    };
    const result = await runKeeperCycle(
      [claim({ claim_id: "43", state: "APPEAL_PENDING" })],
      cycleIo,
    );
    assert.deepEqual(calls, [{ fn: "resolve_appeal", args: ["43"] }]);
    assert.deepEqual(result.appealed, ["43"]);
    assert.deepEqual(kinds, ["refund"]);
    assert.deepEqual(credited, []);
    assert.deepEqual(refunded, ["43:0xresolve_appeal-43"]);
  });

  it("does not wait on a user: CONTESTED is not treated as APPEAL_PENDING", async () => {
    const { calls, io: cycleIo } = io({
      now: Date.parse("2026-08-22T00:00:00.000Z"),
    });
    const result = await runKeeperCycle(
      [
        claim({
          claim_id: "44",
          state: "CONTESTED",
          contested_at: "2026-08-21T00:00:00.000Z",
        }),
      ],
      cycleIo,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(result.appealed, []);
    assert.deepEqual(result.expired, []);
  });

  it("still expires CONTESTED after the 48h window with no appeal filed", async () => {
    const now = Date.parse("2026-08-22T00:00:00.000Z");
    const contestedAt = new Date(now - APPEAL_WINDOW_MS - 1).toISOString();
    const { calls, io: cycleIo } = io({ now });
    const result = await runKeeperCycle(
      [claim({ claim_id: "45", state: "CONTESTED", contested_at: contestedAt })],
      cycleIo,
    );
    assert.deepEqual(calls, [{ fn: "expire_appeal", args: ["45"] }]);
    assert.deepEqual(result.expired, ["45"]);
    assert.deepEqual(result.appealed, []);
  });

  it("still resolves EVIDENCE_LOCKED via resolve_verdict (no regression)", async () => {
    const { calls, io: cycleIo } = io({
      live: { "46": { state: "RESOLVED", consensus_result: "HELD" } },
    });
    const result = await runKeeperCycle(
      [claim({ claim_id: "46", state: "EVIDENCE_LOCKED" })],
      cycleIo,
    );
    assert.deepEqual(calls, [{ fn: "resolve_verdict", args: ["46"] }]);
    assert.deepEqual(result.resolved, ["46"]);
    assert.deepEqual(result.appealed, []);
  });

  it("processes one APPEAL_PENDING per tick so a backlog still drains automatically", async () => {
    const { calls, io: cycleIo } = io({
      live: {
        "47": { state: "RESOLVED" },
        "48": { state: "RESOLVED" },
      },
    });
    const result = await runKeeperCycle(
      [
        claim({ claim_id: "47", state: "APPEAL_PENDING" }),
        claim({ claim_id: "48", state: "APPEAL_PENDING" }),
      ],
      cycleIo,
    );
    assert.deepEqual(calls, [{ fn: "resolve_appeal", args: ["47"] }]);
    assert.deepEqual(result.appealed, ["47"]);

    const second = io({ live: { "48": { state: "RESOLVED" } } });
    const next = await runKeeperCycle(
      [claim({ claim_id: "48", state: "APPEAL_PENDING" })],
      second.io,
    );
    assert.deepEqual(second.calls, [{ fn: "resolve_appeal", args: ["48"] }]);
    assert.deepEqual(next.appealed, ["48"]);
  });

  it("counts an unconfirmed resolve_appeal as appealed once the book is already terminal", async () => {
    const { io: cycleIo } = io({
      live: { "49": { state: "RESOLVED", consensus_result: "HELD" } },
      write: async () => {
        throw new UnconfirmedSubmissionError("0xunconfirmed", new Error("Failed to fetch"));
      },
      credit: async () => [{ to: "0xabc", value: "1" }],
    });
    const result = await runKeeperCycle(
      [claim({ claim_id: "49", state: "APPEAL_PENDING" })],
      cycleIo,
    );
    assert.deepEqual(result.appealed, ["49"]);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.action, "appeal");
  });

  it("does not invent a resolve_appeal write for OPEN or RESOLVED claims", async () => {
    const { calls, io: cycleIo } = io();
    const result = await runKeeperCycle(
      [
        claim({ claim_id: "50", state: "OPEN", deadline: "2099-01-01T00:00:00.000Z" }),
        claim({ claim_id: "51", state: "RESOLVED" }),
      ],
      cycleIo,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(result.appealed, []);
  });
});

describe("emptyKeeperTickResult", () => {
  it("includes appealed so a tick cannot silently drop the field", () => {
    const result = emptyKeeperTickResult("2026-08-22T00:00:00.000Z");
    assert.equal(result.at, "2026-08-22T00:00:00.000Z");
    assert.deepEqual(result.appealed, []);
    assert.deepEqual(result.refunded, []);
  });
});

describe("production keeper wiring", () => {
  it("runKeeperTick actually delegates to the cycle that calls resolve_appeal", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "keeper.ts"), "utf8");
    assert.match(src, /runKeeperCycle\(/);
    assert.match(src, /write:\s*writeAsKeeper/);
    assert.match(src, /contested_at:\s*c\.contested_at/);
    assert.match(src, /creditRefunds:\s*creditRefundedStakers/);
  });

  it("exported credit functions are no-ops so a fabricated cache row cannot send GEN", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "keeper-credits.ts"),
      "utf8"
    );
    assert.match(
      src,
      /export async function creditResolvedWinners\([\s\S]*?\{[\s\S]*?return \[\];[\s\S]*?\}/
    );
    assert.match(
      src,
      /export async function creditRefundedStakers\([\s\S]*?\{[\s\S]*?return \[\];[\s\S]*?\}/
    );
    assert.match(src, /would double-pay/);
  });
});
