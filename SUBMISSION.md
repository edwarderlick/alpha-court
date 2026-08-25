# Submission notes

For the steward. Product facts only. Live court on GenLayer studionet (chain `61999`): **`0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85`**. Three retired courts, all read-only legacy dockets: `0xd3cD69C30A4e899bA2D346723bffac066543cF97` (pre-payout-fix), `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902` (pre-deterministic-outcome-cross-check), and `0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4` (pre-payout-authority/deadline-enforcement fix — see §4).

**Source/bytecode match, verified explicitly, every time:** the live address above was deployed from the exact `alpha_court.py` committed alongside this document — every safeguard described here (§1's deterministic cross-check, §4's on-chain payout enumeration and deadline checks) is live in its real bytecode, confirmed by a real end-to-end cycle on this exact deployment, not assumed from the source file alone. Each retired address above was retired specifically because its deployed bytecode predated the fix that superseded it and could not be patched in place (contracts aren't upgradeable) — this document never describes a safeguard on an address whose real bytecode doesn't have it.

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

**Trust split, stated directly, as explicitly as the steward's review asked for:** Studio cannot execute a contract-initiated native transfer to a plain wallet. **The contract still holds the original staked GEN — that has not changed and cannot change without a different platform capability.** The GitHub Actions keeper reimburses winners from its own funded wallet, with the exact recipient and amount independently verified against real chain state (`get_claim` + `get_stakers_for_claim`, §4), not a cache. We did not stop the contract from custodying funds; we made the reimbursement path fully verifiable against what the contract actually recorded. That is the choice this build made between the steward's two stated options — a working, verifiable reimbursement path, not a redesign that avoids custody. Nothing in this document should be read as claiming the contract itself releases the funds it holds.

**Copy audit (Sybil-class):** "paid by the keeper automatically" was found to over-claim certainty and was replaced. A fabricated "3 of 5 validators agreed" line on `/how-verdicts-work` was removed (it was never real). Vague "protocol governance" bonding language was replaced with the actual CONTESTED / 48-hour window / exact stored bond.

## 3. Real evidence

| | |
|---|---|
| Live court | `0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85` |
| Retired courts | `0xd3cD69C30A4e899bA2D346723bffac066543cF97`, `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902`, `0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4` |
| Network | studionet, chain `61999` |
| Direct tests | **90 passed, 0 failed** (`pytest test/direct/`) |
| Deploy tx (live court) | `0x3ffca220cbb54f350e1878fc128b6d2320e0b39a7f75f583e7ba810763957d32` |

**Two full lifecycles on the live court, run end-to-end after deploy** (real txs, real ~90-second real-time wait for the deadline to actually elapse, real leader + validator consensus — not a direct-mode mock):

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

**Chosen path, stated directly (per the steward's own framing of the choice):** fixed the payout/refund path so it's genuinely verifiable against contract state, rather than redesigning the staking model to avoid custody entirely. The keeper-native-send architecture stays (forced by the real Studio IC→EOA limitation, §2) — what changed is *where the keeper's recipient/amount data comes from*.

**4c. Full audit: every real native-GEN-send path in the codebase, not just the two that caused an incident.** Two duplicate-payment incidents have now happened through two different entry points into the same underlying risk (real signer key + a persistence backend the credit lock can't see across). Rather than assume the fix above closed the whole class, every function anywhere in the repo capable of moving real GEN was found and individually checked.

`sendAsKeeper` (`web/lib/genlayer/client.ts`) is the *only* native EOA-transfer primitive that exists anywhere in `web/lib` or `web/app` — confirmed by grepping every call to `sendTransaction`/`sendTransactionSync` in those two trees; it is the sole hit. Every function below was classified by whether it can reach that primitive (or an equivalent direct send) with a real signer key.

| Function / path | Can move real GEN? | Guard status |
|---|---|---|
| `creditResolvedWinners`, `creditRefundedStakers` (`keeper-credits.ts`) | Yes — the only two callers of `sendAsKeeper` | **Guarded this round** (4a) — `unsafeSignerWithoutRedis` checked before the lock or any chain read. Proven: direct calls with today's exact incident setup (real signer key, disk backend) now return `[]` before touching the chain, for both functions individually |
| `runKeeperTick` (`keeper.ts`) | Indirectly, via the above | Guarded since round 3 (`keeper-safety.ts`) |
| `/api/keeper/tick` (GET/POST) | Indirectly, via `runKeeperTick` | Inherits the guard; also bearer-secret gated |
| `/api/keeper/settle` (POST) | No — calls `writeAsKeeper` only, always with `value` omitted (defaults to 0); confirmed by grep, `writeAsKeeper` has exactly one caller in the whole repo and it never passes a value. A contract-state write (lock/resolve/expire/appeal), not a native send. If it resolves/expires a claim, any real payout is credited separately by the keeper's own retry-drain loop, through the already-guarded functions above, not by this route | Not a send path — no guard needed. Emergency/debug only, disabled unless `KEEPER_SECRET` is set, bearer-secret gated |
| `writeClaim` / demo-signing fallback (`client.ts`, used by `/api/claims`, `/api/claims/[id]/stake`, `/api/claims/[id]/appeal`, `/api/claims/[id]/resolve-appeal`, `/api/claims/[id]/expire-appeal`) | Yes, in principle — shares the same signer/wallet as the keeper (`getDemoClient()` calls `getSignerClient()`), and can attach real `value` to a contract call (funding a demo visitor's stake/appeal bond) | **Different risk class, not `unsafeSignerWithoutRedis`-applicable.** The incidents were caused by an idempotent "already paid?" ledger disagreeing across backends; demo-signing has no such ledger — each call is an independently-intended stake/appeal, not a payout that must never repeat. It has its own real gate instead: `requireDemoSigningEnabled()` throws unless `ALLOW_DEMO_SIGNING=true`, server-only env, fails closed by default (`.env.example` ships it `false`; confirmed not set in production's GitHub secrets, so it is off on the live deployment today) |
| `web/scripts/remediate-claim-19.mjs`, `remediate-claim-31.mjs`, `remediate-unpaid-12.mjs` | Yes — direct `client.sendTransaction` calls using the signer key | **Historical one-shot artifacts, not a live path.** Each is hardcoded to one specific already-remediated claim/winner/amount from a real past incident, already run exactly once, kept only as this project's permanent evidence record (established convention throughout this session). They never touch `payoutsFor`/`recordPayout` or the credit lock at all, so there is no cross-backend ledger to disagree — the only risk is a human re-running a finished script by hand, which `unsafeSignerWithoutRedis` cannot meaningfully prevent (it guards backend disagreement, not human error) and which is out of scope for this incident class |
| `web/scripts/stake-as.mjs` | Yes — uses the signer key to call `stake_for`/`stake_against` with real `value` | Same category as demo-signing: a contract-write stake action, not an idempotent payout, manually invoked by a human for test setup. No ledger, no applicable guard |
| Everything else that touches `sendTransaction` in `web/scripts/` (`walkthrough-predeploy-round2.mjs`, `walkthrough-predeploy-round2b.mjs`) | No | The string `eth_sendTransaction` only appears as a mock EIP-1193 provider method name for browser-wallet-flow testing — no real send |
| Contract itself (`_pay_native`) | No | Documented, intentional no-op — Studio cannot execute IC→EOA transfers (§2). This is *why* `sendAsKeeper` exists as the one real send path in the first place |

**Result: no new unguarded path found.** The two functions fixed this round were the only ones that both (a) can send real native GEN and (b) do so through the idempotent payout ledger the two incidents both stemmed from. Every other GEN-moving function in the repo either doesn't reach `sendAsKeeper` at all, or moves GEN through a path with no "already done?" ledger to disagree about — a different, already-understood risk shape, not this one.

## Known limitations

- **Keeper funding is a real ongoing dependency.** The contract has no withdraw/admin/rescue method (schema audit). Every payout needs the keeper wallet funded. Acceptable on testnet (faucet). Would need re-architecture before real-money use.
- **GLSim local integration tests are blocked** by an upstream tool bug ([genlayerlabs/genlayer-studio#1727](https://github.com/genlayerlabs/genlayer-studio/issues/1727)). Direct-mode tests and the live studionet deployment are independent of that. The live court is proven with on-chain txs above.
- **Live `CONTESTED` cannot be reliably forced** on a public validator set for a demo. The appeal path is fully proven in direct-mode tests, where disagreement can be simulated deterministically (`test/direct/test_appeals.py`, 15 tests).
- **8 tests were previously red and are now fixed, not just documented.** They asserted a contract-level native balance change after `resolve_verdict`/`resolve_appeal`/`expire_appeal` alone — stale expectations from before `_pay_native` became the documented, intentional no-op it is today. Fixed to assert the real current contract behavior (no balance moves at the contract level; the payout/refund/bond formula is still verified against real on-chain stake data) instead of silently tolerating red tests or deleting coverage.
