import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alreadyCredited, creditedCount, isDone, type CreditableTransfer } from "./payout-credit-rules";

function row(overrides: Partial<CreditableTransfer>): CreditableTransfer {
  return {
    to: "0xabc",
    txHash: "0xdeadbeef",
    kind: "payout",
    credited: false,
    ...overrides,
  };
}

describe("alreadyCredited / isDone", () => {
  it("a real send that came back uncredited (e.g. CANCELED) is NOT done -- must be retried", () => {
    // Claim #18/#21 shape: a real 0x... txHash, credited:false (balance
    // never actually moved). Previously a bare `some(t => t.kind === X)`
    // check treated this as final and permanently blocked retries.
    const transfers = [row({ txHash: "0xrealsend", credited: false })];
    assert.equal(isDone(transfers[0]!), false);
    assert.equal(alreadyCredited(transfers, "payout"), false);
  });

  it("a real send that verifiably credited the winner IS done -- must not be re-sent", () => {
    const transfers = [row({ txHash: "0xrealsend", credited: true })];
    assert.equal(alreadyCredited(transfers, "payout"), true);
  });

  it("the keeper-paying-itself no-op is done (retrying is pointless -- it can never credit)", () => {
    const transfers = [row({ txHash: "uncredited:self:1:0xabc:payout", credited: false })];
    assert.equal(alreadyCredited(transfers, "payout"), true);
  });

  it("no row at all -- not done", () => {
    assert.equal(alreadyCredited([], "payout"), false);
  });

  it("`to` filter only matches rows for that address", () => {
    const transfers = [row({ to: "0xother", credited: true })];
    assert.equal(alreadyCredited(transfers, "payout", "0xabc"), false);
  });

  it("creditedCount only counts rows that actually completed", () => {
    const transfers = [
      row({ kind: "refund", credited: true }),
      row({ kind: "refund", credited: false, txHash: "0xfailed" }),
    ];
    assert.equal(creditedCount(transfers, "refund"), 1);
  });
});
