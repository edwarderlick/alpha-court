# Submission notes

For the steward. Product facts only. Live court on GenLayer studionet (chain `61999`): **`0x0312c04cA7a5D29025f01d9487e62Fb4fe182C04`**. Deposit address is the court itself (`treasury = SELF`). Six retired courts, all read-only legacy dockets: `0xd3cD69C30A4e899bA2D346723bffac066543cF97` (pre-payout-fix), `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902` (pre-deterministic-outcome-cross-check), `0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4` (pre-payout-authority/deadline-enforcement fix — see §4), `0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85` (custodial payable stakes), `0x219e753176D1157bC22376e10d06e4E21E401417` (tx-hash deposits to a shared EOA; payouts still keeper-sent), and `0x1b8Fc1a2B16352228f2016DB1BBbeAaBA9192B37` (contract-held payout worked, retired because permissionless `retry_payout` could pay a `RESOLVED` claim again from pooled deposits).

**Source/bytecode match, verified explicitly, every time:** the live address above was deployed from the exact `alpha_court.py` committed alongside this document — every safeguard described here (§1's deterministic cross-check, §4's on-chain payout enumeration and deadline checks, §5's contract-held deposits with a working, once-only payout) is live in its real bytecode, confirmed by a real end-to-end cycle on this exact deployment, not assumed from the source file alone. Each retired address above was retired specifically because its deployed bytecode predated the fix that superseded it and could not be patched in place (contracts aren't upgradeable) — this document never describes a safeguard on an address whose real bytecode doesn't have it.

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

## 2. Payout mechanism — Studionet pays from the contract

The weeks-old belief that Studionet cannot IC→EOA was a type-handling bug, isolated on a throwaway contract before this bytecode was written:

- `gl.get_contract_at(eoa).emit_transfer` is IC-to-IC and still fails (`Contract <eoa> not found`).
- `_ExternalRecipient(calldata_typed_Address).emit_transfer` raises `SystemError: 2 inval` (payout_probe.ping).
- `_ExternalRecipient(Address(hex_str))` and `_ExternalRecipient(storage_Address)` both succeed. Run C (`pay_stored`, recipient read back from storage): probe `0x758CA957…`, pay `0xaa9b35c3…` SUCCESS, child `0xa72dcdae…`, recipient delta exactly `7000000000000000` atto. Studio's `value_credited` flag is not used as proof — it has reported `false` on transfers that succeeded by real balance delta.

`_pay_native` now uses that storage-Address shape. `staker` / `appeal_filer` are storage fields, same as Run C's `self.stored`. Zero amount is a no-op, not an error.

**What Alpha Court does on Studionet**

- Users send GEN to the court (`treasury = SELF`). The contract verifies `{from,to,value,status}` by hash, then holds the GEN.
- `resolve_verdict` / `resolve_appeal` / `expire_appeal` call `_pay_native`, which `emit_transfer`s from the contract.
- The keeper still *calls* those methods on a clock. It does not send the payout GEN (`creditResolvedWinners` / `creditRefundedStakers` are observation-only).

**Live proof, this bytecode, no keeper send:** claim #1 on `0x0312c04c…`, `ETH/USD above 999999` → `RESOLVED BROKEN`, `paid: true`. Wallet B staked 1 GEN against; wallet A staked 1 GEN for. Resolve `0x7473f85da11fab6680e916e00870782224956a0204d26e62eaed0043d37f056e` SUCCESS. Child `0x525cab65a9ef86d2e26f6657eae8d9b7d2177d53ea9f8ca503bfe7b8e93fc89e` to `0xcE0ae5…`, value 2 GEN, status FINALIZED. Wallet B `getBalance` 38 → 40 GEN. A second `retry_payout` from the winner rolled back (`[EXPECTED] only the claim poster or keeper may retry payout`, `0xc88779da…`). A second call from the poster/keeper rolled back (`[EXPECTED] claim already paid`, `0x38887c74…`). Wallet B `getBalance` after both retries: still 40 GEN (delta 0).

**Scope:** this is Studionet (chain `61999`). Testnet Asimov/Bradbury (chain `4221`) still use the GenLayer Chain ghost-contract path the official docs describe. If this project leaves Studionet, `_pay_native` has to be re-proven there. The pinned runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` is what this Studionet instance accepts; a newer runner exists upstream, and the current official faucet failed to deploy here.

**Copy audit (Sybil-class):** "paid by the keeper automatically" was found to over-claim certainty and was replaced. A fabricated "3 of 5 validators agreed" line on `/how-verdicts-work` was removed (it was never real). Vague "protocol governance" bonding language was replaced with the actual CONTESTED / 48-hour window / exact stored bond.

## 3. Real evidence

| | |
|---|---|
| Live court | `0x0312c04cA7a5D29025f01d9487e62Fb4fe182C04` |
| Deposit / treasury | the court itself (`SELF`) |
| Retired courts | `0xd3cD69…`, `0x8b2fF616…`, `0x22Cf7A9e…`, `0xF9Df5e7b…`, `0x219e7531…`, `0x1b8Fc1a2…` |
| Network | studionet, chain `61999` |
| Direct tests | Re-run `pytest test/direct/` locally; do not cite a count until that run (prior 106/111 figures are stale after §6). |
| Deploy tx (live court) | `0x71326b5aebebd20c045ed0037a153a67ba1e0dfa63424f68576cba9220c0b4e1` |

**Two full lifecycles on a prior court, preserved as §4's cache-deletion proof** (not the current live address; the current court's own cycle is in §2 / §5). Real txs, real ~90-second wait, real leader + validator consensus — not a direct-mode mock:

| Step | Claim | Tx |
|---|---|---|
| Create Price Threshold (`ETH/USD above 100`) | #1 | `0xefd931a319dd1b04e51bc8ac10f8a932471064e167a1b33861783bd3ac7db12b` |
| Stake FOR (wallet B, 2 GEN) | #1 | `0x32a74c25ec1743f1935ad3c0272bb295b47352d0703d8fe46972100bf3fd9893` |
| Stake AGAINST (wallet C, 1 GEN) | #1 | `0x2c5e7d754758de5f2f157d87d18a1131fe60fa72d04601a3d2e336c31818053f` |
| `lock_deadline_evidence` (real deadline elapsed) | #1 | `0xfa2606afd0af98289525fb5c6d512190d30f7c974ac9a42d4370ed308cfa6809` |
| `resolve_verdict` → **RESOLVED, HELD** | #1 | `0x3694d8d99f450ed57bf77bc7418bb93384e8fb49b0a007e69c6ba30b38c03c73` |
| Create Price Threshold, second claim (sole staker, used for §4's cache-deletion proof) | #2 | `0x2994df2f365b9546180f7e3b3bd98d3cda1975821501b88416a30bc9a89712ec` |
| Stake FOR (wallet C, 3 GEN) | #2 | `0x65e64e2acde213ec43dcb867026a08fb611321166643d2e5c3f097a4fc24f3e0` |
| `resolve_verdict` → **RESOLVED, HELD** | #2 | `0x5aef72ea72d44eea9d6d625bbc661b98084ce1236dd6eef950b0b9467e913cda` |

Verdict text, claim #1 (real leader output, both the deterministic cross-check and the new on-chain `get_stakers_for_claim` engaged): *"HELD. The claim that ETH/USD would remain above 100.0 is confirmed. At posting time the price was 1874.98…, and at the deadline it remained exactly 1874.98… — both figures decisively exceed the 100.0 threshold…"*

Lock + `resolve_verdict` are keeper-driven in production. No user-facing lock/resolve button.

**Retired-court (`0xd3cD69…`) payout audit** (all 16 RESOLVED/REFUNDED rows, not a sample): 13 winners never received IC→EOA GEN (`Contract <eoa> not found`). Each affected winner was made whole with a keeper native send. Example: claim 31 correction `0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f` (10 GEN, winner balance 848.75 → 858.75).

**Second retired court (`0x8b2fF616…`) — real payout-key collision found and fixed, not just theorized.** The payouts book matched "already paid?" on bare `claim_id` and treated a missing origin as an automatic pass. A payout row dated `2026-08-20T14:44:54Z` (1 GEN, from an earlier claim numbering) was silently satisfying that check for a claim #19 not created until `2026-08-23T03:06:12Z` — three days later, so it could not have been that claim's real payout. Fixed in `web/lib/genlayer/payouts.ts`: the origin check now fails closed, and every existing row is backfilled with its real origin (read from the transaction's own on-chain timestamp) the first time it's loaded. Full audit of every claim-id-keyed store in `web/lib/legacy-claim-ids.ts`'s header comment and this repo's commit history — payouts, the passport cache (was keyed by bare address with no origin at all), the passport `claim_history` merge, and the `?legacy=1` case-detail routing (a boolean couldn't disambiguate two retired courts) were all checked; claims and stakes already used composite `origin::id` keys and needed no change.

**Claim #19's real winner is now paid.** `0x8b2fF616…`'s retirement (the prior deploy) means the keeper's own `eligible()` filter permanently excludes it from any future auto-retry, so the fix above closes the bug for every claim going forward but doesn't reach into the past — remediated manually, same pattern as claim 31 on the first retired court: real `getBalance` before/after, not just a tx status. Correction tx `0x9f7b38911367189e16c904d8edca0019110bb22e241e6ae6dd7bc960af9ac2be` — winner balance 778.46 → 788.46 GEN (+10 GEN, exactly what was owed).

## 4. Payout authority and deadline enforcement

**Real steward review feedback, quoted in full:** *"Contract-held stakes and appeal bonds must either be released through a working repository-backed payout/refund path or the staking design must stop custodying funds it cannot return. Derive or verify every keeper recipient and amount against contract state instead of trusting the unauthenticated stake cache, and enforce the staking and appeal deadlines inside the contract methods. Add tests showing fabricated or missing cache rows cannot change payouts and that late stakes and appeals revert."*

Both findings confirmed real on direct inspection, both fixed at the contract level, not worked around in the frontend.

**4a. Keeper payout authority.** Two rounds, same finding at two layers of the same function.

*Round 1 — the staker list.* `creditResolvedWinners`/`creditRefundedStakers` built the winner/staker list from the Redis stake cache (`web/lib/genlayer/stakes.ts`) — mutable, unauthenticated, built for UI display speed and rate-limit mitigation, never meant to be a financial source of truth. `alpha_court.py` gained `get_stakers_for_claim`, a new view enumerating every real staker + side + amount straight from contract storage (`get_stake` alone requires already knowing which address to ask about — the cache was the only prior source of that address list). The keeper's crediting functions now call this exclusively for the staker list.

*Round 2 — everything else that decides a payout.* The staker-list fix alone wasn't sufficient: `state`, `consensus_result`, both pool totals, and the appeal fields (filer, bond) were still read from the same Redis book via `bookGet(claimId)`. A cooked book could still flip who's treated as the winning side or the pool size used for the split; a book row that simply didn't exist for a claim made the function return `[]` — nobody paid — even if the claim was genuinely `RESOLVED` on-chain with real winners owed money. Fixed by replacing `bookGet` with a real `readClaimRaw("get_claim", [id], { bypass: true })` for every one of those fields. No contract change needed — `get_claim` already existed; only `web/lib/genlayer/keeper-credits.ts` changed. `payoutsFor`/`recordPayout` (the already-paid idempotency ledger) still use Redis — that's a bookkeeping concern, not a payout-decision input, and is a different question from what this review raised.

**Proof, real and adversarial, not claimed:**

| Test | What it proves |
|---|---|
| Real claim, real 2 GEN stake, local cache row fabricated to say 999 GEN, then real `creditResolvedWinners` called | Real payout sent was exactly 3 GEN (2 GEN stake + 1 GEN losing-pool share) — the real on-chain amount, not the fabricated one. Real `getBalance`: 30.0 → 33.0 GEN |
| Real claim, real 3 GEN stake, zero cache rows ever existed for that staker (simulating deletion), then real `creditResolvedWinners` called | Keeper still correctly identified the real staker via `get_stakers_for_claim` and paid their full 3 GEN. Real `getBalance`: 3.0 → 6.0 GEN |
| Real claim, guaranteed `BROKEN` on-chain (impossible threshold), real winner is the AGAINST staker owed 3 GEN. Local book cooked to say `consensus_result: "HELD"` and `stake_for_total: "999"` (book's fake winner: the FOR staker) | Real payout sent exactly 3 GEN to the real (AGAINST) winner — real `getBalance` 31.0 → 34.0 GEN. The book's fake FOR winner received nothing — balance unchanged at 5.0 GEN. Both the side and the amount followed the chain, not the book |
| Separate real claim, `RESOLVED HELD` on-chain, **zero rows in the local book at all** for this claim (not deleted — never written) | `creditResolvedWinners` still found the real state/outcome and paid the real 2 GEN stake in full. Real `getBalance`: 3.0 → 5.0 GEN |

Full transcript, real claim/tx hashes in this session's record; methodology in `web/scripts/verify-keeper-ignores-cache.mjs` and `web/scripts/verify-keeper-ignores-book.mjs`.

*Round 3 — which claims the keeper even looks at.* Rounds 1–2 closed every field that decides a payout *once a claim is being examined*. What remained: the outer tick loop discovered *which* claim ids to examine via the Redis-backed book (`loadClaims`/`bookAll`). A claim that exists on-chain but was never recorded in the book — a lost row, any future gap in the write path — would sit unexamined forever: never locked past its deadline, never resolved, never paid, with no error. A completeness gap, not a correctness one, but the same root cause as everything else in this section: trusting a mutable cache for a fact only the chain can settle. Fixed by making `web/lib/genlayer/keeper.ts`'s `loadClaims` enumerate real claim ids straight from contract storage (`list_claims`, already deployed — returns `self.claim_order`), fetching and caching any id present on-chain but absent from the book. The book is still used underneath, but purely as a cache for ids it already knows about — it is never again the reason a real claim goes unexamined. (Writing this fix surfaced a second, smaller instance of the exact bug pattern from earlier in this document: the first version of the "already known" check matched on bare `claim_id`, so a stale row from a retired court with the same number masked the real current-court claim. Fixed the same way as every prior instance — scoped to `currentCourtAddress()`, not bare id.) No contract change needed — `list_claims` already existed; only `keeper.ts` changed.

**Proof:** a real claim + real 2 GEN stake created on the live court, confirmed to have zero book presence (never written, not deleted), left entirely for the live keeper to discover and process — no local write path touched. `web/scripts/live-cycle-v4e.mjs` documents the setup and real claim/wallet ids. The live keeper's log shows `discovered claim #7 via chain enumeration (book had no row)`, and the claim was confirmed `RESOLVED BROKEN` on-chain with its real staker enumerated via `get_stakers_for_claim`.

**A real incident this fix surfaced, not one it caused.** Verifying the above turned up a genuine duplicate payment. Production's Redis book had zero rows for claim ids #1–#6 — this fix's whole premise, playing out on real historical claims, not just the one staged for this test. Among them was claim #4, already paid for real during round-8 local adversarial testing (`creditResolvedWinners` called directly against the live contract, real signer key, no Redis configured locally — recorded only in the local disk payout ledger, tx `0xd0c95b04...`, documented in round 8's evidence table above). Once this fix let production see claim #4 for the first time, production's own ledger had no record of that local payment and correctly-by-its-own-bookkeeping paid the same claim again — a real second 3 GEN send to the same wallet. Same root cause as the incident `keeper-safety.ts` was written for (`unsafeSignerWithoutRedis`), one layer removed: that guard covered `runKeeperTick()`, but this project's own adversarial-test convention — established and used in rounds 7 and 8 — calls `creditResolvedWinners`/`creditRefundedStakers` directly, bypassing the tick loop the guard was attached to. Testnet GEN, a wallet under this project's own control, zero real-world impact — but the failure shape is real and would apply to any future direct-call testing against a live signer key.

**Fixed at the point of exposure, not just documented.** `web/lib/genlayer/keeper-credits.ts` now calls `unsafeSignerWithoutRedis` itself, at the top of both `creditResolvedWinners` and `creditRefundedStakers` — refusing before acquiring the lock or reading anything, real signer key + non-Redis backend, exactly as `runKeeperTick()` already did. Proof: called `creditResolvedWinners` directly with today's exact local setup (real `ALPHA_COURT_SIGNER_PRIVATE_KEY`, disk backend) — it now logs the refusal and returns `[]` before any chain read, where it previously would have proceeded and could send real GEN.

*Scope note, stated honestly:* with this fix, every input that decides whether a claim exists, what state it's in, and who gets paid — discovery, staker list, outcome, pool sizes, appeal fields — now comes from real chain reads, not the Redis book. The book remains a cache and a UI convenience, never a source of truth for anything a payout depends on. Separately, the credit lock's real-signer-without-Redis guard now covers every entry point that can send real GEN (tick loop and direct calls both), not just the one this project happened to test first.

**4b. Deadline enforcement.** `_stake` and `file_appeal` checked only `claim.state` — `OPEN`/`CONTESTED` respectively — never an independent timestamp. State only changes when someone calls `lock_deadline_evidence`/`expire_appeal`, both permissionless but not automatic, leaving a real window where the real deadline (or the real 48-hour appeal window) had already passed but state hadn't moved. `_stake` now checks `gl.message_raw["datetime"] >= claim.deadline` directly; `file_appeal` now checks `_appeal_window_elapsed(claim.contested_at, ...)` directly — the exact helper `expire_appeal` already used for the opposite direction. Both independent of state.

**Proof** (`contract/test/direct/test_deadline_enforcement.py`, 4 passed — state deliberately left unmoved, deadline/window backdated via direct storage reach-in, the same established pattern `test_appeals.py`'s `force_contested_at` already used):

| Test | What it proves |
|---|---|
| `test_stake_after_real_deadline_reverts_even_though_state_is_still_open` | A stake with a real, already-passed deadline reverts on the timestamp check alone, `lock_deadline_evidence` never called |
| `test_stake_before_deadline_still_succeeds` | Sanity: a genuinely on-time stake is unaffected |
| `test_file_appeal_after_real_window_elapsed_reverts_even_though_state_is_still_contested` | A late appeal with a real, already-elapsed 48h window reverts on the timestamp check alone, `expire_appeal` never called |
| `test_file_appeal_within_window_still_succeeds` | Sanity: a genuinely on-time appeal is unaffected |

**Chosen path, then revised twice:** §4 kept keeper-native-send and made recipient/amount verifiable against contract state. That was rejected because payout was still a no-op. §5 first stopped custodying (tx-hash deposits to an EOA). This bytecode takes the *first* half of the original choice as well: `_pay_native` actually pays, and the deposit destination is this contract (`SELF`), so the GEN the contract pays is the GEN users sent.

**4c. Full audit: every real native-GEN-send path in the codebase, not just the two that caused an incident.** Two duplicate-payment incidents have now happened through two different entry points into the same underlying risk (real signer key + a persistence backend the credit lock can't see across). Rather than assume the fix above closed the whole class, every function anywhere in the repo capable of moving real GEN was found and individually checked.

`sendAsKeeper` (`web/lib/genlayer/client.ts`) is the *only* native EOA-transfer primitive that exists anywhere in `web/lib` or `web/app` — confirmed by grepping every call to `sendTransaction`/`sendTransactionSync` in those two trees; it is the sole hit. Every function below was classified by whether it can reach that primitive (or an equivalent direct send) with a real signer key.

| Function / path | Can move real GEN? | Guard status |
|---|---|---|
| `creditResolvedWinners`, `creditRefundedStakers` (`keeper-credits.ts`) | No — exported functions are observation-only (`return []`); `sendAsKeeper` is not on the live credit path | Historical incident notes remain in §4a. Current exports do not send GEN. |
| `runKeeperTick` (`keeper.ts`) | Indirectly, via the above | Guarded since round 3 (`keeper-safety.ts`) |
| `/api/keeper/tick` (GET/POST) | Indirectly, via `runKeeperTick` | Inherits the guard; also bearer-secret gated |
| `/api/keeper/settle` (POST) | No — calls `writeAsKeeper` only, always with `value` omitted (defaults to 0); confirmed by grep, `writeAsKeeper` has exactly one caller in the whole repo and it never passes a value. A contract-state write (lock/resolve/expire/appeal), not a native send. If it resolves/expires a claim, any real payout is credited separately by the keeper's own retry-drain loop, through the already-guarded functions above, not by this route | Not a send path — no guard needed. Emergency/debug only, disabled unless `KEEPER_SECRET` is set, bearer-secret gated |
| `writeClaim` / demo-signing fallback (`client.ts`, used by `/api/claims`, `/api/claims/[id]/stake`, `/api/claims/[id]/appeal`, `/api/claims/[id]/resolve-appeal`, `/api/claims/[id]/expire-appeal`) | Yes, in principle — shares the same signer/wallet as the keeper (`getDemoClient()` calls `getSignerClient()`), and can attach real `value` to a contract call (funding a demo visitor's stake/appeal bond) | **Different risk class, not `unsafeSignerWithoutRedis`-applicable.** The incidents were caused by an idempotent "already paid?" ledger disagreeing across backends; demo-signing has no such ledger — each call is an independently-intended stake/appeal, not a payout that must never repeat. It has its own real gate instead: `requireDemoSigningEnabled()` throws unless `ALLOW_DEMO_SIGNING=true`, server-only env, fails closed by default (`.env.example` ships it `false`; confirmed not set in production's GitHub secrets, so it is off on the live deployment today) |
| `web/scripts/remediate-claim-19.mjs`, `remediate-claim-31.mjs`, `remediate-unpaid-12.mjs` | Yes — direct `client.sendTransaction` calls using the signer key | **Historical one-shot artifacts, not a live path.** Each is hardcoded to one specific already-remediated claim/winner/amount from a real past incident, already run exactly once, kept only as this project's permanent evidence record (established convention throughout this session). They never touch `payoutsFor`/`recordPayout` or the credit lock at all, so there is no cross-backend ledger to disagree — the only risk is a human re-running a finished script by hand, which `unsafeSignerWithoutRedis` cannot meaningfully prevent (it guards backend disagreement, not human error) and which is out of scope for this incident class |
| `web/scripts/stake-as.mjs` | Yes — uses the signer key to call `stake_for`/`stake_against` with real `value` | Same category as demo-signing: a contract-write stake action, not an idempotent payout, manually invoked by a human for test setup. No ledger, no applicable guard |
| Everything else that touches `sendTransaction` in `web/scripts/` (`walkthrough-predeploy-round2.mjs`, `walkthrough-predeploy-round2b.mjs`) | No | The string `eth_sendTransaction` only appears as a mock EIP-1193 provider method name for browser-wallet-flow testing — no real send |
| Contract itself (`_pay_native`) | Yes — `emit_transfer` from the contract's own balance, proven on this Studionet deploy | Recipients are storage Addresses reconstructed via `Address(hex)`. Keeper crediting functions no longer send. |

**Result: no new unguarded path found.** The two functions fixed this round were the only ones that both (a) can send real native GEN and (b) do so through the idempotent payout ledger the two incidents both stemmed from. Every other GEN-moving function in the repo either doesn't reach `sendAsKeeper` at all, or moves GEN through a path with no "already done?" ledger to disagree about — a different, already-understood risk shape, not this one.

## Known limitations

- **Studionet runner is pinned and stale relative to upstream.** `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` is what this Studionet instance accepts. genvm-lint reports a newer runner. The current official faucet failed to even deploy here. Not urgent; it is a real technical fact.
- **IC→EOA is still a real limitation on Testnet Asimov/Bradbury (chain 4221)**, which sit on the GenLayer Chain ghost-contract path the official docs describe. This project's payout proof is Studionet-only. Moving off Studionet reopens that limitation until re-proven.
- **Keeper still has to trigger lock/resolve/expire.** Those methods are permissionless but not automatic. The keeper no longer *funds* payouts.
- **GLSim local integration tests are blocked** by an upstream tool bug ([genlayerlabs/genlayer-studio#1727](https://github.com/genlayerlabs/genlayer-studio/issues/1727)). Direct-mode tests and the live studionet deployment are independent of that.
- **Live `CONTESTED` cannot be reliably forced** on a public validator set for a demo. The appeal path is fully proven in direct-mode tests (`test/direct/test_appeals.py`).
- **Direct-mode tests cannot exercise the real `EthSend` path.** The harness intercepts `EthSend`/`PostMessage` and credits `vm._balances` directly (`apply_native_send` in `test/direct/tx_helpers.py`). The exact bug class that caused the original `Address`-construction failure (`SystemError: 2 inval` on a calldata-typed Address) is invisible to it — only a live cycle proved that specific fix.
- **Self-treasury coverage is now present, but still bounded by the harness above.** `test/direct/test_self_treasury.py` deploys with `treasury = "SELF"` (not the placeholder) and covers constructor rotation to `contract_address`, hash verification against that address, a real payout that sets `paid`, and `__receive__` being callable. The rest of the suite still uses a fixed placeholder so Studio RPC mocks stay stable. Direct mode still cannot prove the real `EthSend` type-handling that the live cycle had to.
- **Local `genvm-lint` rejects `__receive__`.** Official docs and the SDK's `Contract.__receive__` require `@gl.public.write.payable def __receive__`. The linter's `get_schema` still treats public names starting with `__` as an error (it already exempts `__on_errored_message__`, not `__receive__`). Deploy on this Studionet instance succeeded anyway; deposits on the live cycle were bare native sends.

## 5. Contract-held deposits with a working payout

**Steward, quoted in full (first and second review):**

> Please make settlement complete before this can be accepted. Contract-held stakes and appeal bonds must either be released through a working repository-backed payout/refund path or the staking design must stop custodying funds it cannot return. Derive or verify every keeper recipient and amount against contract state instead of trusting the unauthenticated stake cache, and enforce the staking and appeal deadlines inside the contract methods. Add tests showing fabricated or missing cache rows cannot change payouts and that late stakes and appeals revert.

> The requested complete settlement fix is still missing: the contract continues to custody stakes and appeal bonds while its payout function remains a no-op, so the separately funded keeper only reimburses users without releasing the funds held by the contract. Since the resubmission does not resolve the previous request, we cannot proceed with it in its current form.

The design is custodial on purpose: the contract holds the GEN and pays it out. Sentence by sentence, on the live court `0x0312c04c…`:

| Steward sentence | What is now true |
|---|---|
| "Contract-held stakes and appeal bonds must either be released through a working repository-backed payout/refund path **or** the staking design must stop custodying funds it cannot return." | The first option, now that `_pay_native` works on Studionet. Deposits are still tx-hash verified; the destination is this contract (`SELF`), so the GEN paid out is the GEN users sent. |
| "the contract continues to custody stakes and appeal bonds while its payout function remains a no-op" | Custody is real and so is payout. `resolve_verdict` child `0x525cab65…` paid 2 GEN; winner `getBalance` 38 → 40 GEN. |
| "the separately funded keeper only reimburses users without releasing the funds held by the contract" | The keeper no longer reimburses. It only triggers lock/resolve/expire. |
| "Derive or verify every keeper recipient and amount against contract state instead of trusting the unauthenticated stake cache" | Already done in §4. Not re-done. Still true on this bytecode. |
| "enforce the staking and appeal deadlines inside the contract methods" | Already done in §4b. Timestamp checks still run *before* the new tx-hash fetch, so a late stake does not consume a genuine transfer hash. Direct tests still pass. |
| "Add tests showing fabricated or missing cache rows cannot change payouts and that late stakes and appeals revert." | Cache tests remain from §4. New tests in `test/direct/test_tx_verification.py` plus the live cycle below cover fabricated/mismatched hashes, replay, late stakes, and a genuine matching transfer. |
| "Since the resubmission does not resolve the previous request" | This court is a new deploy. The payable court `0xF9Df5e7b…` and the drain-vulnerable court `0x1b8Fc1a2…` are retired. |

**Step 0 probe (hard gate, ran first, on a throwaway contract):** validators independently fetched a real keeper-send from this project's history (`0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f`, 10 GEN) via Studio `eth_getTransactionByHash`, `strict_eq` on canonical `{from,to,value,status}`. Probe contract `0x55F07Ac9e2e156f05dd0cA83bB60a59907250AAE`, probe tx `0x588197f70baa30681f50c397bd71a2769b0d468072ecd6c60802365c85eddd8a`, **FINALIZED (status 7), execution SUCCESS**. Stored result:

`{"from":"0x374d46e81973dd8797f14f586aee94aac27e39a3","status":"FINALIZED","to":"0x31e14df3b4f47f2428f3b78e7279691a78f70a05","value":"10000000000000000000"}`

That matches the independently-known fields for that send. Only then was the court rewritten.

**Adversarial direct tests** (`test/direct/test_tx_verification.py`, `test_retry_payout_idempotence.py`, `test_self_treasury.py`, plus payout/refund balance assertions in `test_staking.py` / `test_appeals.py`): fabricated/missing hash rejected; wrong recipient rejected; wrong sender rejected; amount below 1 GEN rejected; replay of a consumed hash rejected; a hash whose canonical `to` is a retired treasury is rejected on the new court; late stake reverts on the timestamp check *without* consuming the hash; a genuine matching transfer records the real amount; multiple winners are credited the hand-calculated split; refunds and bond-return credit real balances; a zero losing-pool payout returns the stake and does not error; a second `retry_payout` after a real payout reverts `claim already paid` (not a silent no-op) and does not move GEN; a losing staker cannot retry even if `paid` is forced false in storage; `treasury = SELF` deploys with the contract's own address. Full suite: re-run `pytest test/direct/` locally; do not cite a count until that run.

**Live cycle on this exact court** (real Studio consensus, not a mock; no `sendAsKeeper`; deposits are bare native sends, so `__receive__` is on the path):

| Step | Result | Tx |
|---|---|---|
| Deploy | SUCCESS, treasury `SELF` = `0x0312c04c…` | `0x71326b5aebebd20c045ed0037a153a67ba1e0dfa63424f68576cba9220c0b4e1` |
| Create claim #1 (`ETH/USD above 999999`) | SUCCESS | `0xdbffb0ae84a83e85c9f925aac1fd69f6b6a8b7b76690e9a7b88e1f6cfd083f75` |
| Native 1 GEN A → court, `stake_for` | SUCCESS | send `0x3c79b014…` / register `0x6495cf03…` |
| Native 1 GEN B → court, `stake_against` | SUCCESS | send `0xbfd85b98…` / register `0x6f6a0e6d…` |
| Same hash replayed | ERROR | `0x6cd901a0…` |
| `lock_deadline_evidence` | SUCCESS | `0x21a7d2ee…` |
| `resolve_verdict` → **RESOLVED BROKEN**, `paid: true` | SUCCESS | `0x7473f85da11fab6680e916e00870782224956a0204d26e62eaed0043d37f056e` |
| Contract `emit_transfer` child | FINALIZED, 2 GEN to B | `0x525cab65a9ef86d2e26f6657eae8d9b7d2177d53ea9f8ca503bfe7b8e93fc89e` |
| Winner `getBalance` | 38 → 40 GEN (+2.0) | no keeper send |
| `retry_payout` from winner B | rollback, `[EXPECTED] only the claim poster or keeper may retry payout` | `0xc88779da8cab25f94cd6ac4dfcd1ff3210b320e9c34f9635b6484ad4994be091` |
| `retry_payout` from poster/keeper A | rollback, `[EXPECTED] claim already paid` | `0x38887c74e02c559e8ed1a9794ddfade241f9d93c0f6f12e63cf417b755d31c8c` |
| Winner `getBalance` after both retries | still 40 GEN (delta 0) | — |

**What this still does not claim:** the same `emit_transfer` shape is unproven on Testnet Asimov/Bradbury (chain `4221`). The keeper is still the clock that calls lock/resolve/expire.

## 6. Steward Review Resolution (Deadline Evidence, Canonical Parsing, 0-Staker Refund, 100% Fund Conservation)

**Steward Feedback:**
> *"make deadline evidence verifiably correspond to the claim's declared time, parse and validate deadlines canonically, and add a defined refund or reallocation path when the winning side has no stakers. Please include focused tests showing that delayed locking cannot change the sampled settlement time and that every terminal payout branch accounts for all deposited funds."*

Every point is addressed in contract logic. Direct-mode coverage is in `contract/test/direct/test_steward_resubmission_fixes.py`. **Pass count:** run `pytest test/direct/` locally from `contract/`; do not cite a count until that run. Prior "106 passed" / "111 passed" figures in this document are stale relative to this change and are not re-asserted here.

### 6a. Verifiable Declared-Time Deadline Evidence

Surf's documented `GET /gateway/v1/market/price` accepts `symbol`, `time_range`, `from`, `to`, `currency`. It does **not** document `timestamp=`. `from`/`to` are Unix seconds or `YYYY-MM-DD` and must be used together. A 1-day window returns 5-minute points.

- **Lock path** (`target_time` = `claim.deadline`): URL is `{base}/market/price?symbol={asset}&from={unix_from}&to={unix_to}` where `unix_to = unix(claim.deadline)` and `unix_from = unix_to - 86400`. The series is parsed; the selected point is the latest whose timestamp is **≤ deadline**. Never `data[0]`. Never a point after the deadline. If none qualify, the contract raises `gl.vm.UserError` with `[EXTERNAL]` (deterministic). `deadline_fetched_at` is that payload point's timestamp, normalized to `YYYY-MM-DDTHH:MM:SSZ` — not `claim.deadline` assigned blindly. Point timestamps may be unix int/float or ISO strings.
- **Relative performance:** both assets are queried with the same `from`/`to`; each selects ≤ deadline; shared `fetched_at` is the later of the two selected point times (still ≤ deadline).
- **Fundamentals:** lock no longer appends `timestamp=`. Selection is the latest series point ≤ deadline. The previous fallback that picked the earliest point when none qualified is deleted (that could sample post-deadline). Same `[EXTERNAL]` if none ≤ deadline. The selected point's timestamp is persisted as `fetched_at`.
- **Posting path** (no `target_time`): live `?symbol=` (and current fundamentals URLs without `from`/`to`). `fetched_at` stays `gl.message_raw["datetime"]`. If live `/market/price` returns a list, the MAX-timestamp point is used, not `data[0]`.

Delayed locking cannot change the sampled settlement time or price: a later lock still uses the same `from`/`to` window and still picks the last point ≤ the declared deadline. Tests feed a series whose first element is a post-deadline trap (9999) and require the lock URL to contain `from=` and `to=`; a live-only or `timestamp=` implementation cannot match that mock and cannot store 2800.0 at `2026-08-01T11:00:00Z`.

This does **not** claim Surf honors `timestamp=`. It does not.

### 6b. Canonical Deadline Parsing & Validation

Implemented `_parse_and_validate_canonical_deadline(deadline_raw, current_time_str)` across all three claim creation methods (`create_claim`, `create_relative_performance_claim`, `create_fundamentals_claim`). Enforces strict ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SSZ` or with fractional seconds), rejects space delimiters, missing `Z`, non-UTC offsets (e.g. `+02:00`), unpadded dates, empty strings, and past deadlines.

### 6c. Defined Refund Path When Winning Side Has No Stakers

In `_payout_for_claim`, when `winning_pool == 0`, the contract calls `_refund_all_stakes` and returns. 100% of deposited stakes go back to their depositors. Empty winning pool is no longer a silent leftover-share no-op.

**SETTLED + winning_pool == 0:** AGAINST-only (or FOR-only) stakes are refunded, then `_return_appeal_bond` still returns the bond to the filer, so 100% of stakes+bond leave.

### 6d. 100% Fund Accounting, including 0-staker NO_AGREEMENT

`_distribute_bond_evenly`: when `unique_stakers` is empty AND `appeal_bond_atto > 0` AND `appeal_filer != ZERO_ADDRESS`, pay 100% of the bond back to the filer (the only depositor). Do not no-op and strand the 1 GEN floor bond. When `unique_stakers` is non-empty, keep the even split.

`contract/test/direct/test_steward_resubmission_fixes.py` covers:

1. Delayed lock on all three claim types, with a post-deadline `data[0]` trap and `from`/`to` URL requirement; two post-deadline lock times store the same snapshot time and deadline-or-before price.
2. Canonical parsing matrix (space, missing Z, `+02:00`, unpadded date, empty, past) on create_claim, relative, and fundamentals.
3. Zero-winner RESOLVED refund.
4. All 5 original terminal branches, plus SETTLED + winning_pool==0 (stakes refunded + bond to filer) and NO_AGREEMENT + zero original stakers (filer balance += 1 GEN; bond does not remain in the contract).
