import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unsafeSignerWithoutRedis } from "./keeper-safety";

describe("unsafeSignerWithoutRedis", () => {
  it("refuses a real signer key on the disk backend -- the exact incident shape", () => {
    // .env.local's real ALPHA_COURT_SIGNER_PRIVATE_KEY + `npm run dev`
    // with no Redis configured falls back to "disk". This must refuse,
    // not silently run a real keeper the credit lock can't protect.
    const reason = unsafeSignerWithoutRedis(true, "disk");
    assert.notEqual(reason, null);
    assert.match(reason!, /redis/i);
  });

  it("refuses a real signer key on the in-memory Vercel fallback too", () => {
    const reason = unsafeSignerWithoutRedis(true, "memory");
    assert.notEqual(reason, null);
  });

  it("allows a real signer key when Redis is genuinely configured", () => {
    assert.equal(unsafeSignerWithoutRedis(true, "redis"), null);
  });

  it("allows no signer key regardless of backend -- nothing real can be sent anyway", () => {
    assert.equal(unsafeSignerWithoutRedis(false, "disk"), null);
    assert.equal(unsafeSignerWithoutRedis(false, "memory"), null);
  });
});
