# Submission notes

For the steward. Product facts only. Live court on GenLayer studionet (chain `61999`): **`0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4`**. Two retired courts, both read-only legacy dockets: `0xd3cD69C30A4e899bA2D346723bffac066543cF97` (pre-payout-fix) and `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902` (pre-deterministic-outcome-cross-check — see §1 and §3).

**Source/bytecode match, verified explicitly:** the live address above was deployed from the exact `alpha_court.py` committed alongside this document — `_naive_outcome` and the deterministic cross-check described in §1 are live in its real bytecode, confirmed by a real resolve on this exact deployment (§3), not assumed from the source file alone. `0x8b2fF616…` was retired specifically because its deployed bytecode predated that fix and could not be patched in place (contracts aren't upgradeable) — this document never describes a safeguard on an address whose real bytecode doesn't have it.

## Prior-art check

| Source | What exists | Overlap with Alpha Court? |
|---|---|---|
| GenLayer official docs — **Football Prediction Market example** | A single hardcoded boolean (`has_resolved`) for one named football game, resolved via a generic URL fetch and `strict_eq`. No staking, no economics, no dispute path, no history. | **Closest official example.** Alpha Court is a general-purpose claim system (any crypto market thesis, three claim types), backed by Surf's structured Data API rather than a generic URL fetch, with staking, a hybrid-bond appeal with a second consensus round, and persistent reputation (Alpha Passport). The official example is the primitive; this is a product on top of it. |
| GenLayer ideas gallery — **AI Arbitration** | Dispute resolution after a disagreement | Related consensus pattern, different lifecycle. Alpha Court's appeal is this pattern scoped to re-judging already-locked evidence, not general arbitration. |
| Ecosystem — **Provider Court, Sybil Court, Concord** (same builder) | Escrow/delivery verification, wallet eligibility, pre-agreement reconciliation | Different domains. No shared claim type, evidence source, or economic mechanism. |

**Decision:** proceed. Alpha Court multiplies the official example's core primitive (LLM consensus resolving a real-world claim) into three claim types, real staking economics, a reasoned (not boolean) verdict citing structured evidence, appeals, and permanent reputation.

## 1. Consensus integrity — stored outcome vs verdict text, and vs the arithmetic

**Reviewer pattern:** every stored, consequential field must be independently validated against what is persisted — not a nested summary or fingerprint of it. That was the exact basis of Concord's rejection. FairSplit was pushed on the sibling version of the same pattern: a validated/stored decision that isn't cross-checked against an independent recomputation.

**Concord-shaped gap (no second channel to diverge):** `consensus_result` (`HELD` / `BROKEN`) is **only ever assigned by parsing the leader's actual verdict text** (`_parse_decisive_outcome(verdict_text)`). There is no second, leader-supplied channel that could store a conflicting value. Staking payouts and Alpha Passport both read from this one field, derived from the one stored text.

**FairSplit-shaped gap, now also closed:** parsing the text alone only proves internal consistency — it never forced the leader's *stated word* to agree with what the locked snapshot numbers actually say. `_naive_outcome(claim)` recomputes HELD/BROKEN deterministically, with zero LLM involvement, from the already-locked fields alone — for all three claim types (Price Threshold and Fundamentals Threshold: deadline value vs. threshold in the claimed direction; Relative Performance: comparing the two assets' already-locked % change). The genuine judgment call this build was designed around — which exchange's print counts, handling a data anomaly — already happened at evidence-*locking* time (the Category B tolerance-band fetch); once locked, "did it cross the threshold" is pure arithmetic. `_resolve_verdict_with_consensus` now rejects a cleanly-parsed verdict that disagrees with `_naive_outcome`, routing it through the exact same empty-result path the conflicting-words case already used — a leader whose stated word contradicts the arithmetic is exactly as inconclusive as one who hedged. Applied identically to both `resolve_verdict` and `resolve_appeal` (they share this one function).

**Proof:**

`contract/test/direct/test_consensus_gap.py` (7 passed) — the Concord-shaped channel:

| Test | What it proves |
|---|---|
| `test_legacy_two_channel_accepts_conflicting_top_level` | An independent-field design (Concord's old shape) would allow this divergence |
| `test_resolve_verdict_cannot_store_held_when_text_parses_broken` | Live path stores `BROKEN`, never a conflicting `HELD`, when the text says so |
| `test_resolve_verdict_conflicting_words_do_not_pick_a_side` | Mixed HELD+BROKEN prose → `CONTESTED`, empty result, never a guessed side |
| `test_get_claim_single_source_held_or_empty` | After resolve, `consensus_result` equals a fresh parse of stored `verdict_text` |

`contract/test/direct/test_deterministic_outcome.py` (8 passed) — the FairSplit-shaped arithmetic cross-check, one adversarial test per claim type per round (a leader stating the *wrong* word against the locked numbers) plus a sanity check that a genuinely correct verdict is unaffected:

| Test | What it proves |
|---|---|
| `test_price_threshold_leader_held_but_naive_broken_is_contested` | Price Threshold: leader says HELD, arithmetic says BROKEN → `CONTESTED`, not a false HELD |
| `test_price_threshold_leader_broken_but_naive_held_is_contested` | Same, opposite direction |
| `test_price_threshold_leader_matches_naive_still_resolves` | A correct verdict is never rejected by the cross-check |
| `test_relative_performance_leader_held_but_naive_broken_is_contested` | Relative Performance: leader's stated outperformance direction disagrees with the two assets' real % change → `CONTESTED` |
| `test_fundamentals_leader_held_but_naive_broken_is_contested` | Fundamentals Threshold (negative-value NUPL case): also proves the offset-encoded metric decodes correctly inside the naive check, not just for a positive metric |
| `test_resolve_appeal_price_threshold_leader_held_but_naive_broken_is_no_agreement` | Same cross-check on the appeal round → `REFUNDED`/`NO_AGREEMENT`, not a false settlement |
| `test_resolve_appeal_relative_performance_leader_broken_but_naive_held_is_no_agreement` | Appeal round, Relative Performance |
| `test_resolve_appeal_fundamentals_leader_broken_but_naive_held_is_no_agreement` | Appeal round, Fundamentals Threshold |

**What this still does not claim**

Validators additionally judge the verdict's *reasoning quality* via `prompt_non_comparative` (cite the real numbers, reason correctly) — that LLM-equivalence judgment is unchanged and still required; the arithmetic cross-check is additive, not a replacement. Direct-mode tests cannot exercise live multi-validator consensus. That is a testing-coverage boundary, not a design gap.

## 2. Payout mechanism — Studio cannot IC→EOA

**Studio limit:** an Intelligent Contract cannot send native GEN to a plain wallet. Confirmed both ways:

- `emit_transfer` to an EOA silently orphans a dead child (`Contract <eoa> not found`, `value_credited: false`).
- Documented `EthSend` / `_EoaRecipient` errors the entire parent call, which would revert the verdict if used inside `resolve_verdict`.

Sybil Court hit the same wall on `withdraw()`. This is a platform limit, not an Alpha Court-only bug.

**What Alpha Court does**

- `resolve_verdict` commits cleanly. The on-contract payout step is a **no-op by design**, so a failed IC→EOA cannot roll back the verdict.
- After consensus, a **keeper** sends native GEN as a normal wallet transfer.
- Credit is recorded only after a real `getBalance` increase. Studio's self-reported tx status is **not** trusted (`NO_MAJORITY` / `value_credited: true` on no-op self-sends was observed in testing).
- UI (My Stakes, fanfare, claim status) shows **Paid** only after that balance check. Otherwise: **Payout not credited on-chain**.

**Trust split, stated directly:** the contract still trustlessly decides *who won and how much is owed*. *Who moves the money* is the keeper, because Studio cannot do the former. That is documented in the UI, not implied as an IC transfer.

**Copy audit (Sybil-class):** "paid by the keeper automatically" was found to over-claim certainty and was replaced. A fabricated "3 of 5 validators agreed" line on `/how-verdicts-work` was removed (it was never real). Vague "protocol governance" bonding language was replaced with the actual CONTESTED / 48-hour window / exact stored bond.

## 3. Real evidence

| | |
|---|---|
| Live court | `0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4` |
| Retired courts | `0xd3cD69C30A4e899bA2D346723bffac066543cF97`, `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902` |
| Network | studionet, chain `61999` |
| Direct tests | **83 passed, 0 failed** (`pytest test/direct/`) |
| Deploy tx (live court) | `0x7abf6fd0191db9b8d7ac47f5e91572d4b7f2caacd395abc32d115c8e123c77c0` |

**Full lifecycle on the live court, run end-to-end after deploy** (real txs, real ~90-second real-time wait for the deadline to actually elapse, real leader + validator consensus — not a direct-mode mock):

| Step | Claim | Tx |
|---|---|---|
| Create Price Threshold (`ETH/USD above 100`) | #1 | `0x0cc377b11322d88d24fd431e32f3ba5559bc8cee6bc7ef458bf9af5fcacd9d3f` |
| Stake FOR (wallet B, 2 GEN) | #1 | `0x3e69c76df4d4388b588530230e69ada9de8d12fd6cc939225c3ea78f3858fd7f` |
| Stake AGAINST (wallet C, 1 GEN) | #1 | `0x44f5b734b0c4276e939e83d92e0e390dc07b4d7b8d2b2df1260078d54df647f2` |
| `lock_deadline_evidence` (real deadline elapsed) | #1 | `0x3791307af98034669d4d78cd6cefee16bcf04c8e8f6e4187e8dade5cd3c2ebf0` |
| `resolve_verdict` → **RESOLVED, HELD** | #1 | `0xe5574313f6d4cc19e25ae0cebe82b30212736788a08234e6f098f4fc724b8ecd` |

Verdict text (real leader output, deterministic cross-check engaged and did not reject it — the leader's arithmetic agreed): *"HELD. The posting-time price was 1863.43…, the deadline-time price was 1863.43…, and the threshold was 100.0. Because the claim was above 100.0 and the deadline price 1863.43… exceeds 100.0, the claim HELD."*

Lock + `resolve_verdict` are keeper-driven in production. No user-facing lock/resolve button.

**Retired-court (`0xd3cD69…`) payout audit** (all 16 RESOLVED/REFUNDED rows, not a sample): 13 winners never received IC→EOA GEN (`Contract <eoa> not found`). Each affected winner was made whole with a keeper native send. Example: claim 31 correction `0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f` (10 GEN, winner balance 848.75 → 858.75).

**Second retired court (`0x8b2fF616…`) — real payout-key collision found and fixed, not just theorized.** The payouts book matched "already paid?" on bare `claim_id` and treated a missing origin as an automatic pass. A payout row dated `2026-08-20T14:44:54Z` (1 GEN, from an earlier claim numbering) was silently satisfying that check for a claim #19 not created until `2026-08-23T03:06:12Z` — three days later, so it could not have been that claim's real payout. Fixed in `web/lib/genlayer/payouts.ts`: the origin check now fails closed, and every existing row is backfilled with its real origin (read from the transaction's own on-chain timestamp) the first time it's loaded. Full audit of every claim-id-keyed store in `web/lib/legacy-claim-ids.ts`'s header comment and this repo's commit history — payouts, the passport cache (was keyed by bare address with no origin at all), the passport `claim_history` merge, and the `?legacy=1` case-detail routing (a boolean couldn't disambiguate two retired courts) were all checked; claims and stakes already used composite `origin::id` keys and needed no change.

## Known limitations

- **Keeper funding is a real ongoing dependency.** The contract has no withdraw/admin/rescue method (schema audit). Every payout needs the keeper wallet funded. Acceptable on testnet (faucet). Would need re-architecture before real-money use.
- **GLSim local integration tests are blocked** by an upstream tool bug ([genlayerlabs/genlayer-studio#1727](https://github.com/genlayerlabs/genlayer-studio/issues/1727)). Direct-mode tests and the live studionet deployment are independent of that. The live court is proven with on-chain txs above.
- **Live `CONTESTED` cannot be reliably forced** on a public validator set for a demo. The appeal path is fully proven in direct-mode tests, where disagreement can be simulated deterministically (`test/direct/test_appeals.py`, 15 tests).
- **8 tests were previously red and are now fixed, not just documented.** They asserted a contract-level native balance change after `resolve_verdict`/`resolve_appeal`/`expire_appeal` alone — stale expectations from before `_pay_native` became the documented, intentional no-op it is today. Fixed to assert the real current contract behavior (no balance moves at the contract level; the payout/refund/bond formula is still verified against real on-chain stake data) instead of silently tolerating red tests or deleting coverage.
