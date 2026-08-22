# Alpha Court — Build Prompts 1 & 2: State Machine, Price Threshold, Staking

Contract: `contracts/alpha_court.py`. Category A (display-only) stub: `services/surf_display.py`.

## Setup

```bash
pip install -r requirements.txt
```

## Lint

```bash
genvm-lint check contracts/alpha_court.py
```

## Direct-mode tests (fast, leader-only, mocked web/LLM)

```bash
pytest test/direct/ -v
```

65/65 passing (13 in `test_alpha_court.py` + 13 staking tests in `test_staking.py` + 15 appeal
tests in `test_appeals.py` + 8 Alpha Passport tests in `test_passport.py` + 9 Relative
Performance tests in `test_relative_performance.py` + 7 Fundamentals Threshold tests in
`test_fundamentals.py`, new this round — see "Build Prompt 7 — Fundamentals Threshold Claim
Type" below). Covers: business logic, state-machine reverts,
immutability guards on both snapshots and the verdict, the real leader-verdict /
validator-check mechanism (a HELD scenario and a BROKEN scenario with real cited reasoning
asserted against, plus both distinct ways a round can fail to reach a decisive verdict — see
Build Prompt 4 below), stake min/max bounds, OPEN-only stake rejection (spanning
the claim's real duration, not a brief post-creation window — see the correction below),
repeated-stake accumulation, the optional claimant posting stake, multi-staker proportional
payout (hand-calculated expected payouts, asserted against real simulated balances — see
`test_staking.py`'s module docstring for how, since direct mode doesn't simulate value
transfers by default), and the full appeal flow (bond calc at both clamp boundaries, both
`resolve_appeal` outcomes with hand-calculated payouts, and the no-appeal-filed
`expire_appeal` path — see "Build Prompt 3 — Appeals" and "Build Prompt 4" below).

## Integration tests (real GenVM/GLSim consensus, local Surf fixture — see below)

```bash
glsim --port 4000 --validators 3 --no-browser
gltest test/integration/ -v -s
```

**Current status: blocked on a GLSim-specific bug**, not a contract bug — see
`test/integration/test_alpha_court_integration.py`'s module docstring for the full trail
(genvm-lint passes clean, direct mode fully exercises the same contract successfully, and two
different attempted workarounds didn't change the error). Deployment against GLSim
(genlayer-test==0.29.2, latest available) fails with `class is not marked for usage within
storage, please, annotate it with @allow_storage` reported against `AlphaCourt` itself. No
Docker was available on this machine to try real local Studio (`genlayer up`) instead, and the
remote hosted `studionet` can't reach a localhost-bound fixture server. The tests are written
and believed correct; they document exactly what they'd prove once this is resolved.

## Step 0 research findings (see `contracts/alpha_court.py`'s header for the full detail)

Checked against the actual installed genlayer-dev skill (v1.1.3, matching installed `genlayer`
CLI 0.39.2) and, where that wasn't enough, against the real pinned-runner SDK source cached
locally by `genvm-lint` (`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`):

1. **Non-det web calls**: `gl.nondet.web.get(url, headers=...)` / `.post(...)` — both real,
   confirmed in source. `.render()`/`.request()` also real but serve different purposes
   (headless-browser rendering / the generic method `get`/`post` call internally), not
   alternate names for the same thing.
2. **`gl.eq_principle`**: exactly `strict_eq`, `prompt_comparative`, `prompt_non_comparative`,
   confirmed in source. Category B (price tolerance) uses a **custom validator function** run
   via `gl.vm.run_nondet` instead of `prompt_comparative`, since a numeric tolerance check
   should be exact arithmetic, not an LLM judgment call. The stubbed verdict uses
   `gl.eq_principle.prompt_non_comparative(fn, task=..., criteria=...)` directly — a real,
   exact match for "leader writes, validators check against criteria."
3. **`sim_createRandomValidators`**: not a current mechanism. Real equivalents:
   `genlayer init --numValidators <n>` (initial local Studio setup) and
   `genlayer localnet validators create-random --count <n>` (add validators to a running local
   Studio). For a small dev-time validator count specifically, **GLSim** is the lighter option:
   `glsim --port 4000 --validators 3 --no-browser`.
4. **Mock mechanism**: `direct_vm.mock_web()`/`mock_llm()` are real (direct-mode
   `genlayer-test`), but direct mode runs the **leader function only** — validator/
   equivalence-principle logic is never exercised there. The only mode with real multi-validator
   consensus (`gltest` against GLSim/local Studio/testnet) does **not** support mocking. This
   contract's `surf_base_url` constructor argument is configurable specifically so the
   integration test can point real consensus at a local HTTP fixture server
   (`test/integration/fixture_surf_server.py`) instead of `api.asksurf.ai` — real validators,
   real independent HTTP calls, zero real Surf credits, without pretending a
   mocked-consensus mode exists that doesn't.
5. **Surf Data API**: real, via asksurf.ai's own docs (matches the "Live data via Surf"
   branding throughout the Alpha Court design). Auth: `Authorization: Bearer $SURF_API_KEY`
   (matches the build prompt exactly). Base URL: `https://api.asksurf.ai/gateway/v1`. Spot
   price: `GET /market/price`. Exact response JSON field names were **not** verified — Surf's
   own docs defer to `surf market-price --help`, unreachable without their CLI/an API key —
   so `_parse_surf_price` parses defensively and raises a clear, deterministic error on an
   unrecognized shape rather than guessing.

## Real bugs found and fixed while building this (not silently worked around)

- **Contract bug**: `gl.message.raw["datetime"]` doesn't exist — `gl.message` is a reduced
  NamedTuple with no `.raw`. The real deterministic clock is the separate top-level
  `gl.message_raw["datetime"]`. Caught by running the direct-mode suite, confirmed against
  actual SDK source, fixed.
- **Tooling bug (Windows-only)**: `gltest.direct.loader._inject_message_to_fd0` calls
  `os.unlink()` on a temp file it still holds open via `os.dup2()`; Windows disallows unlinking
  an open file (POSIX allows it). Patched locally (wrapped in `try/except PermissionError`) in
  both `test/direct/conftest.py` (this project's own test process) and directly in the
  installed `gltest` package (needed for GLSim's separate server process to pick up the same
  fix). Genlayer-test 0.29.2 is the latest available version; no upstream fix exists yet.
- **Tooling limitation**: `direct_vm.warp()` updates the VM's internal clock but does not
  refresh `gl.message_raw["datetime"]` after initial contract load — so a claim's deadline
  cannot flip from "future" to "past" within one direct-mode deployment. Deadline-passed
  coverage was moved to the integration test (real elapsed wall-clock time, no cheatcode
  needed there at all) once that's unblocked.
- **Tooling bug (unresolved)**: the GLSim storage-codegen issue described above.

## Build Prompt 2 — Staking

Replaces the Build Prompt 1 staking TODO with real fields and logic: `stake_for`/
`stake_against` (payable, OPEN-only, 1–10 GEN bounds, repeated calls accumulate), an optional
claimant posting stake on `create_claim` (same bounds, backs the claimant's own FOR side),
proportional payout wired directly into `resolve_verdict`'s `RESOLVED` branch
(`payout = stake + (stake / winning_pool) * losing_pool`, integer floor division — see
`_payout_for_claim`'s docstring on the resulting dust being expected, not a bug), and
`CONTESTED` claims left with all stakes locked (no payout, no refund, no appeal-bond logic —
explicitly deferred to Build Prompt 3).

### Step 0 findings

`alpha-court-master-spec.md` was again not available (still not present on disk, still not
attached to the prompt) — implemented directly from Build Prompt 2's own explicit Tasks
section, flagged rather than silently assumed to match the referenced §6.

1. **GEN value pattern** — confirmed directly against real SDK source
   (`genlayer/gl/annotations.py`: `@gl.public.write.payable` is real, exactly as documented)
   *and* against Provider Court's own real, previously-Studio-tested contract, not assumed to
   match either blindly. Receiving: `@gl.public.write.payable` + check `gl.message.value`
   (a real `u256`). Paying out: `gl.get_contract_at(addr).emit_transfer(value=amount,
   on="finalized")`.
2. **Real gotcha, learned by Provider Court on live Studio**: `emit_transfer()` is a
   **one-way send with no claw-back**. Their first version paid out inside a function that
   later became re-triggerable via their appeal path; real consensus caught a double-payout
   bug from that re-entry. Applied here: `resolve_verdict()` already has a hard one-time guard
   and `CONTESTED` is a dead end this prompt with no re-triggering path, so payout is safe to
   wire directly into that same one-time-guarded call — a deliberate, reasoned choice citing
   their lesson, not an unexamined default.

### New real bugs/gaps found while building this (on top of Build Prompt 1's three)

- **Storage-nesting bug, resolved differently than expected**: initially assumed per-staker
  records could nest inside `Claim` (a `TreeMap`/`DynArray` field on the dataclass). Avoided
  that shape entirely from the start given Build Prompt 1's still-unresolved nested-dataclass
  GLSim bug — stake records live in their own top-level `TreeMap[str, Stake]` +
  `DynArray[str]` key list on the Contract class, mirroring the two patterns already proven
  working (`TreeMap[str, Claim]`, `claim_order: DynArray[str]`).
- **`direct_vm.warp()` timing, now precisely characterized**: confirmed by direct experiment
  (not assumption) that `gl.message_raw` is injected exactly once, at `direct_deploy()` time,
  using whatever `VMContext._datetime` reads at that instant. Warping *before* `deploy()`
  works (the injected value reflects it); warping *after* `deploy()` does nothing (matches
  Build Prompt 1's finding, now with a confirmed mechanism). Net effect: within one direct-mode
  deployment, a deadline can never appear to move from "future" to "past" — creation requires
  it in the future relative to the frozen clock, and `lock_deadline_evidence` requires the
  frozen clock to have reached it, which mathematically can't both hold. Worked around in
  `test_staking.py` via `force_evidence_locked` (renamed from `force_verdict_pending` — see
  "Master spec correction" below), which reaches into the real contract
  instance's storage directly (`contract.claims[claim_id]`, a non-callable attribute the
  direct-mode proxy passes straight through unwrapped) to set the fields
  `lock_deadline_evidence` would have set, so `resolve_verdict` — the thing actually under
  test — still runs for real.
- **Direct mode doesn't simulate `PostMessage` (what `emit_transfer` sends) by default**:
  confirmed by reading `gltest/direct/wasi_mock.py` — `_handle_gl_call` has no `"PostMessage"`
  case, falls through to an optional `_gl_call_hook` (`None` by default). The real SDK's own
  `_ContractAtEmitMethod.__call__` discards `gl_call`'s return value entirely, so an
  un-simulated transfer is a **silent no-op that looks like success**, not an error — a test
  that only checks "`resolve_verdict` didn't raise" would pass regardless of whether payout
  math is correct at all. Worked around by installing `direct_vm._gl_call_hook` (an existing,
  undocumented VMContext extension point — the same one glsim mode uses) to actually apply the
  transferred value to `vm._balances`, so real balances can be asserted against.
- **`direct_vm.mock_llm()` doesn't intercept `gl.eq_principle.prompt_non_comparative`**:
  confirmed via `vm._traces` showing `"Unknown gl_call request type: ['ExecPromptTemplate']"`.
  `prompt_non_comparative` sends `{"ExecPromptTemplate": {...}}` (confirmed in
  `genlayer/gl/eq_principle.py`), not the plain `{"ExecPrompt": {...}}` shape `mock_llm()`
  matches against. Left unhandled, the call silently returns `None` rather than raising, which
  then crashed `resolve_verdict` on `claim.verdict_text = None` — not a contract bug (the
  contract's use of `prompt_non_comparative` is real and correct per Build Prompt 1's source
  confirmation). Same `_gl_call_hook` extension point used above also handles
  `"ExecPromptTemplate"`, returning a plain `{"ok": "<text>"}` dict (the outer `gl_call`
  wrapper calldata-encodes it automatically, matching what `_decode_nondet` expects).

## Master spec correction — state machine ordering

`alpha-court-master-spec.md` (v1) arrived after Build Prompts 1 and 2 were both built and
passing. Cross-checking the implementation against it confirmed everything else (Price
Threshold data model, Category A/B separation, staking bounds and payout formula, CONTESTED
behavior) but surfaced one real, material discrepancy in §2's state diagram, confirmed by the
user to fix immediately:

- **Spec (§2, §6)**: the posting-time snapshot is fetched as part of the claim going `OPEN` —
  inside `create_claim` itself, not a separate transaction. `EVIDENCE_LOCKED` is reached only
  at/after the deadline, via the *deadline*-time snapshot fetch. §6 is explicit that "others may
  stake FOR or AGAINST the claim while it's OPEN, before evidence locks" — i.e. for the claim's
  real duration, not a brief window right after creation.
- **What was built instead (Build Prompts 1/2)**: a separate `lock_posting_evidence` method
  performed the OPEN → EVIDENCE_LOCKED transition immediately after creation, so `EVIDENCE_LOCKED`
  was reached almost immediately rather than at the deadline.
- **Real impact**: `stake_for`/`stake_against` are gated on `state == OPEN`. Because
  `lock_posting_evidence` collapsed a claim into `EVIDENCE_LOCKED` right away, the staking window
  was open for essentially zero time instead of the claim's real duration — directly
  contradicting §6.

Fix applied:

- `create_claim` now calls `_fetch_price_with_consensus` inline, before constructing the `Claim`,
  and embeds the real posting-time price/timestamp directly. The claim is created already
  `OPEN` with real posting evidence, no separate step.
- `lock_posting_evidence` removed entirely — it no longer exists as a method.
- `lock_deadline_evidence` now performs the OPEN → EVIDENCE_LOCKED transition (previously it
  required `EVIDENCE_LOCKED` and produced `VERDICT_PENDING`). This is also what closes the
  staking window, now for real.
- `resolve_verdict` now requires `EVIDENCE_LOCKED` (previously `VERDICT_PENDING`).
  `VERDICT_PENDING` remains a defined `ClaimState` value per the spec's enum but is never a
  separately-reached resting state in this implementation — documented as such in the contract
  and test docstrings rather than silently dropped.

Re-verification after the fix:

- `genvm-lint check` — clean, 8 methods (down from 9; `lock_posting_evidence` is gone).
- `test/direct/test_alpha_court.py` rewritten for the new flow — 15 tests (down from 17; two
  tests were specific to the now-removed `lock_posting_evidence` and no longer apply).
- `test/direct/test_staking.py` rewritten for the new flow (mocks a price fetch before every
  `create_claim`; `force_verdict_pending` renamed to `force_evidence_locked` and no longer
  sets posting-time fields, since real `create_claim` already sets them) — 13 tests, unchanged
  count. The final regression test was renamed `test_full_state_machine_with_staking` and now
  explicitly asserts the staking window spans well past claim creation, as positive proof the
  bug is fixed.
- Combined direct-mode suite: **28/28 passing.**
- `test/integration/test_alpha_court_integration.py` updated for consistency with the new flow
  (docstrings, the evidence-locking test's assertions and request-log count, and
  `test_lock_posting_evidence_rejects_invalid_price` renamed/rewritten to
  `test_create_claim_rejects_invalid_price` since `create_claim` is now the method that must
  reject a bad price). Not re-run — this file is still blocked by the separate, unresolved GLSim
  storage-codegen bug documented above and in its own module docstring; the edits are
  correctness-only, unverified by execution pending that blocker's resolution.

## Build Prompt 3 — Appeals

Wires the remaining state transitions Build Prompt 1 left as TODOs: `CONTESTED ->
APPEAL_PENDING -> RESOLVED/REFUNDED`, and `CONTESTED -> REFUNDED` when no appeal is filed
within the 48-hour window. New methods: `file_appeal` (payable, CONTESTED-only, requires
*exactly* the stored bond), `resolve_appeal` (permissionless, runs the second consensus round
and settles all three outcomes), `expire_appeal` (permissionless, CONTESTED-only, time-gated).

### Step 0 findings

`alpha-court-master-spec.md` was again not attached/available this round (confirmed missing,
not silently assumed — same situation as Build Prompts 1 and 2's own headers; both of those
eventually got a real spec arrival that confirmed/corrected the flagged assumptions, so the
same may happen here). Findings, checked directly against the pinned runner's real SDK source
(`genlayer/gl/eq_principle.py`, `genlayer/gl/genvm_contracts.py`), not skill-doc prose alone:

1. **Second leader/validator round, same locked evidence**: leader selection for a given
   transaction is a consensus/GenVM-protocol-level concern — `gl.eq_principle.
   prompt_non_comparative` (and `gl.vm.run_nondet` underneath it) has no contract-facing
   parameter for "pick this validator as leader." Each new transaction gets its own leader
   assignment from the validator set per the protocol's own rotation rule (master spec §5, not
   something contract code can or should try to influence). What the contract fully controls —
   and what actually matters for "shares the same locked evidence" — is never re-fetching:
   `resolve_appeal`'s facts string is built from `claim.posting_price_atto`/
   `deadline_price_atto` exactly as already stored, no new `gl.nondet.web.get` call anywhere in
   the appeal path. Structurally identical shape to round 1: `gl.eq_principle.
   prompt_non_comparative(fn, task=..., criteria=...)`.
2. **Multi-path fund holding**: no new gotcha beyond what Build Prompt 2's header already
   found (`emit_transfer` is a one-way send, no claw-back — confirmed again by re-reading
   `genvm_contracts.py`). This prompt adds two more terminal payout paths (refund, and
   upheld/overturned payout with the bond folded in) alongside the original RESOLVED payout —
   safe for the same reason BP2 established: every path is reached through a mutually
   exclusive, one-time-guarded state transition (`CONTESTED`, `APPEAL_PENDING`, `RESOLVED`,
   `REFUNDED` are all dead ends with no re-entry edge back into them), so no call site can
   double-pay the same claim.

### A real design gap, flagged rather than silently resolved

Build Prompt 3's own task text describes the appeal as upholding or overturning "the first
verdict" and paying "the original winning side" — language that presumes a `CONTESTED` claim
already has a favored side from round 1. But Build Prompt 1's `CONTESTED` trigger (confirmed
correct against the master spec once it arrived, per the "Master spec correction" section
above) is `OUTCOME_AMBIGUOUS`: the deadline price landed within `PRICE_TOLERANCE` of the
threshold — precisely the case where round 1's deterministic computation does **not** produce
a HELD/BROKEN winner at all. There is no stored "first verdict favoring a side" for a
`CONTESTED` claim under the code as it stands; re-running the exact same deterministic formula
on the exact same stored snapshot would just return `AMBIGUOUS` again forever (it's pure
arithmetic on already-fixed inputs, not something a second opinion can meaningfully "agree or
disagree" with).

**Resolution adopted (flagged, not spec-confirmed):** at the moment a claim becomes
`CONTESTED`, compute a `provisional_lean` alongside the bond — the same crossing check
`_compute_deterministic_outcome` uses, but *without* the tolerance-band `AMBIGUOUS` carve-out,
so it always resolves to a discrete HELD or BROKEN "which way the raw numbers point, even
though the gap was too tight to call automatically," purely from the two already-agreed
snapshots (no new fetch, no new consensus needed for the lean itself). This is "the first[
-round] side" the appeal's second round agrees with (`UPHELD`) or rejects (`OVERTURNED`).
Round 2 itself asks the leader/validator pair for a genuine, decisive HELD-or-BROKEN judgment
call (never `AMBIGUOUS` — the criteria explicitly forbids it) via the same
`prompt_non_comparative` mechanism as round 1, with different task/criteria text ("appellate"
framing) forcing a pick — and deliberately **without** revealing `provisional_lean` to the
leader, so an "agreement" is a genuine independent match rather than the LLM reading back what
it was told. If the returned text parses to exactly one of HELD/BROKEN, it's compared to the
provisional lean (agree → `UPHELD`, disagree → `OVERTURNED`); if it parses to neither or both,
that's `NO_AGREEMENT` → `REFUNDED`. This is additive only — it doesn't touch `resolve_verdict`'s
existing `AMBIGUOUS`-detection logic, `consensus_result` semantics, or any Build Prompt 1/2
test or behavior.

### Design decisions

- **Bond formula**: 25% of `(stake_for_total_atto + stake_against_total_atto)` at the exact
  moment `resolve_verdict` transitions a claim to `CONTESTED`, clamped to `[1, 5]` GEN,
  computed once via `_compute_appeal_bond` and stored on `claim.appeal_bond_atto` — never
  recomputed later, per the build prompt's own non-negotiable.
- **`file_appeal` bond requirement**: exact match, not "at least" — the simpler of the two
  options the build prompt explicitly left as a judgment call; "at least" would need its own
  overpayment-refund/dust-handling path for no real benefit.
- **`APPEAL_PENDING` is a real persisted state**, unlike `VERDICT_PENDING` — `file_appeal` sets
  it in its own distinct transaction; `resolve_appeal` is a separate later call that runs round
  2 and advances to `RESOLVED`/`REFUNDED`, following the build prompt's own task breakdown
  (task 2 vs. tasks 3+4) rather than collapsing everything into one call.
- **Forfeited-bond destination** (the one assumption the build prompt's own text flagged, not
  independently reconfirmed against a spec this round either): folded into the existing
  proportional payout's losing-side pool before the split runs, implemented as an
  `extra_losing_pool_atto` parameter added to the existing `_payout_for_claim` (default `0` for
  the original `RESOLVED` call site, so Build Prompt 2's own payout math and tests are
  untouched) — winning stakers' payout = `stake + stake * (losing_pool + forfeited_bond) //
  winning_pool`. No new payout formula written this prompt.
- **`_refund_all_stakes`** is genuinely separate from `_payout_for_claim` — no proportional
  split, no winner, every staker on both sides gets back exactly their own stake. Used by both
  `REFUNDED` triggers (`resolve_appeal`'s `NO_AGREEMENT` branch and `expire_appeal`'s
  no-appeal-filed branch).
- **`expire_appeal`'s guard is just `state == CONTESTED` plus the time check** — sufficient on
  its own to prove no appeal was ever filed, since `file_appeal` moves a claim to
  `APPEAL_PENDING` immediately; a claim still sitting in `CONTESTED` can only have gotten there
  by the window running out untouched. No appeal bond is touched on this path (none was ever
  posted).
- **48-hour window clock**: starts at `claim.contested_at`, captured via `gl.message_raw
  ["datetime"]` at the exact moment `resolve_verdict` sets `CONTESTED` (same clock source as
  every other timestamp in this contract) — not touched or reinterpreted from how `CONTESTED`
  itself gets reached.
- **One dispute cycle, no third round**: `resolve_appeal` is guarded by `state ==
  APPEAL_PENDING` plus an `appeal_outcome != ""` immutability check; once resolved to
  `RESOLVED`/`REFUNDED` there is no edge back into `APPEAL_PENDING` or `CONTESTED` for that
  claim, so a second appeal round is structurally impossible, not just discouraged.

### Testing notes

`test/direct/test_appeals.py` reaches `CONTESTED` the same way `test_staking.py` reaches
`EVIDENCE_LOCKED`: for real, through `resolve_verdict()` itself (not by forcing `claim.state`
directly), so the bond/lean computation inside `resolve_verdict`'s `CONTESTED` branch is
exercised for real, off real staked pool totals — only the deadline-time snapshot needs the
established `force_evidence_locked` storage reach-in (direct mode's frozen clock can't reach a
real deadline within one deployment). The three `resolve_appeal` outcomes are driven by
extending the existing `_gl_call_hook` pattern: the hook inspects the `ExecPromptTemplate`
request's `task` text to tell round-1's fixed response apart from round-2's (via a substring
unique to `APPEAL_VERDICT_TASK`), and each test supplies whatever appeal-round response text
it needs (containing "HELD", "BROKEN", or neither) to drive `UPHELD`/`OVERTURNED`/
`NO_AGREEMENT` respectively. `expire_appeal`'s window-elapsed path uses a new, narrowly-scoped
storage reach-in (`force_contested_at`) to backdate `claim.contested_at` well past 48 hours
before the frozen "now" — the only way to make that comparison come out true within one
direct-mode deployment, same category of workaround as `force_evidence_locked`, not a new kind
of test hack.

`test/integration/`'s appeal coverage was not attempted this round — that suite remains
blocked by the separate, unresolved GLSim storage-codegen bug documented above (unrelated to
anything in this prompt).

## Build Prompt 4 — Real Leader-Verdict / Validator-Check Mechanism

Replaces the deterministic-outcome stub that stood in for the leader-verdict mechanism since
Build Prompt 1 with the real thing: the leader now genuinely reasons over the two locked
snapshots to write a HELD/BROKEN verdict (no precomputed answer handed to it), and every other
validator independently checks that reasoning via `gl.eq_principle.prompt_non_comparative`'s
real non-comparative equivalence check. `AMBIGUOUS`, `_compute_deterministic_outcome`, and
`provisional_lean` are all fully removed — see `contracts/alpha_court.py`'s header for the
complete detail.

**Note on the test-count discrepancy**: this prompt's own text described "the full existing
70-test suite (28 state-machine + 42 staking/appeal)." The actual suite prior to this round was
42 (15 + 13 + 14), not 70, and not split 28/42 — flagging this plainly rather than silently
adopting a number that doesn't match the repository's real history. Post-BP4 the suite is
40/40 (13 + 13 + 14).

### Step 0 findings

`alpha-court-master-spec.md` §5 was again not attached/available this round (confirmed
missing, not silently assumed).

1. **Exactly what the old stub was** (read closely, not assumed either way, per this prompt's
   own instruction): `gl.eq_principle.prompt_non_comparative` WAS a real SDK primitive, used
   for real — but the actual HELD/BROKEN/AMBIGUOUS *decision* was made entirely by
   `_compute_deterministic_outcome`, pure Python arithmetic on the two already-stored
   snapshots, *before* the LLM call ever ran. The facts string handed to the leader literally
   included `"Deterministic outcome: {consensus_result}"` — the leader was told the answer —
   and the old `VERDICT_CRITERIA` required the verdict text to "state the deterministic outcome
   exactly as given in the facts." The LLM's only real job was restating an already-decided
   answer in prose; it had no actual decision-making power. This prompt's new facts string
   contains only the raw snapshot values, no outcome hint.
2. **Confirmed current SDK pattern for "leader generates once, validators independently check
   via non-comparative equivalence"**: unchanged from Build Prompt 3's own finding —
   `gl.eq_principle.prompt_non_comparative(fn, *, task, criteria)` remains the real, current
   primitive, re-confirmed this round against both the pinned runner's local SDK source and
   docs.genlayer.com's own equivalence-principle page ("Non-comparative validation does *not*
   mean trust the leader... \[the validator\] must read the same input/source data and decide
   whether the leader output is valid under clear criteria"). What changes here is the
   *content* of `task`/`criteria` (forcing a real decisive call, never a hint), not the
   primitive itself.
3. **How to simulate genuine validator DISAGREE in direct-mode tests** — confirmed by reading
   `gltest/direct/wasi_mock.py`'s `_handle_run_nondet` and `gltest/direct/loader.py`'s
   `_direct_run_nondet` directly. Direct mode still runs only the leader function (unchanged
   from Build Prompts 1–3's own established finding). Two distinct, both-real mechanisms
   produce `CONTESTED` in direct-mode tests without real multi-validator consensus:
   - The installed `_gl_call_hook` returns text that doesn't parse to a single clean
     HELD/BROKEN via `_parse_decisive_outcome` (reused from Build Prompt 3's appeal parsing) —
     simulates a verdict that was returned but is too hedged/unclear to act on.
   - The hook *raises* `gl.vm.UserError` while handling the leader's `ExecPromptTemplate`
     call — surfaces as a real `gl.vm.UserError` at the `prompt_non_comparative` call site
     inside the contract, exercising `_resolve_verdict_with_consensus`'s own `try/except`
     for real. **Real gotcha found while building this**: direct mode's `gl.vm.run_nondet` is
     patched by `gltest/direct/loader.py`'s `_direct_run_nondet`, which calls `leader_fn()`
     under a bare `try/finally` (no `except`) — unlike GLSim's `wasi_mock.py`
     `_handle_run_nondet`, it does *not* wrap arbitrary leader exceptions into a `UserError`
     itself. A hook that raises a *plain* `Exception` propagates uncaught out of the test
     entirely (confirmed by actually running it and reading the resulting traceback — first
     attempt failed this way). Fixed by having the hook raise `gl.vm.UserError` specifically,
     fetched off the already-loaded contract module (`sys.modules["_contract_alpha_court"]
     .gl.vm.UserError`), matching what the real protocol always surfaces regardless.

### A real architecture consequence, flagged loudly (not a routine footnote)

Tracing finding 3(b) all the way through the SDK matters for more than testing. Per
`genlayer/gl/vm.py`'s `unpack_result` (confirmed against source): a non-`Return` result from a
nested `RunNondet` call is *raised*, not returned — the leader's proposed (rejected) verdict
text is structurally unrecoverable by the calling contract code once genuine disagreement
happens; the protocol does not hand back un-agreed data.

This collides directly with this prompt's own task 3 instruction: "Everywhere BP3's appeal
logic previously read `provisional_lean` as 'the original side,' it now reads the real leader
verdict's actual side directly." Under Build Prompt 3, `CONTESTED` came from
`OUTCOME_AMBIGUOUS` — a case where a real verdict-with-a-side was never at issue in the first
place, so `provisional_lean` was invented as a substitute. Under *this* prompt, `CONTESTED`
means "no verdict was ever agreed," by construction — every `CONTESTED` claim, for either
reason above, structurally has no real leader-verdict side to read. There is no way to satisfy
"no `provisional_lean`, read the real verdict's side instead" literally, because for every
claim where that instruction would apply, no real verdict side exists to read.

**Resolution adopted (flagged, not spec-confirmed — the largest structural call in this
prompt)**: `provisional_lean` is removed with no replacement field. `resolve_appeal` is
re-shaped to reuse `_resolve_verdict_with_consensus` verbatim as a genuine second attempt at
the same real leader-verdict mechanism — exactly what "appeal" should mean once `CONTESTED`
means "round 1 never produced an agreed verdict": a second, independently-led try per master
spec §5's leader-rotation model, not a review of a verdict that never existed.

- Second attempt reaches a clean, agreed HELD/BROKEN → `RESOLVED`, using *that* real,
  freshly-derived verdict and side (this is what "reads the real leader verdict's actual side
  directly" now honestly means — a real verdict exists on this claim for the first time). The
  old `UPHELD`/`OVERTURNED` distinction is gone with it: there is no "original side" left to
  have upheld or overturned, so both collapse into one outcome, `APPEAL_OUTCOME_SETTLED`. The
  bond is still forfeited and folded into the losing pool exactly as `UPHELD` did (Build
  Prompt 2's payout formula, unmodified) — reframed honestly as "the filer's bond funded
  getting a real, final verdict where round 1 couldn't," not "the filer lost." This holds
  regardless of *which* side the fresh verdict favors (tested explicitly — see below).
- Second attempt *also* fails to reach one → `REFUNDED` via the existing dedicated refund
  function, bond returned to the filer — identical to Build Prompt 3's `NO_AGREEMENT` branch,
  unchanged. One dispute cycle, no third round, per the existing non-negotiable (still
  enforced by `resolve_appeal`'s `appeal_outcome` immutability guard).

`APPEAL_VERDICT_TASK`/`APPEAL_VERDICT_CRITERIA` and the now-single-purpose
`_resolve_appeal_with_consensus` are deleted entirely, not left as dead code — round 1 and the
appeal round are no longer different in kind (round 1 always attempts a decisive call now
too), so the separate "appellate framing" text that existed purely to force a decisive pick
where round 1's stub didn't is no longer needed.

### What changed in the contract

- `VERDICT_TASK`/`VERDICT_CRITERIA` rewritten: the leader receives only raw posting/deadline
  prices, threshold, and direction — no outcome hint — and must commit to exactly one of HELD
  or BROKEN, citing the exact numbers, with hedge words (`ambiguous`, `unclear`, `inconclusive`,
  `too close to call`) explicitly forbidden by the criteria.
- `_resolve_verdict_with_consensus` rewritten: wraps the `prompt_non_comparative` call in
  `try/except gl.vm.UserError` (genuine consensus failure → `("", "")`), and parses the
  returned text via `_parse_decisive_outcome` (reused, previously appeal-only) when the call
  does succeed (`consensus_result` is `""` if that parse fails too, but `verdict_text` is
  preserved since real, agreed text exists in that case).
- `resolve_verdict`: `RESOLVED` iff `consensus_result` is a real `HELD`/`BROKEN`; `CONTESTED`
  otherwise. The now-redundant `verdict_text != ""` immutability guard was removed (the `state
  == EVIDENCE_LOCKED` guard alone is sufficient re-entry protection, since state and
  `verdict_text` change atomically in the same write).
- `resolve_appeal`: calls `_resolve_verdict_with_consensus` directly instead of a separate
  `_resolve_appeal_with_consensus`; branches on `SETTLED`/`NO_AGREEMENT` instead of
  `UPHELD`/`OVERTURNED`/`NO_AGREEMENT`.
- `Claim.provisional_lean` field removed; `create_claim`'s constructor call and `get_claim`'s
  view dict updated to match.
- `OUTCOME_AMBIGUOUS`, `_compute_deterministic_outcome`, `_compute_provisional_lean`,
  `APPEAL_VERDICT_TASK`, `APPEAL_VERDICT_CRITERIA`, `_resolve_appeal_with_consensus`,
  `APPEAL_OUTCOME_UPHELD`, `APPEAL_OUTCOME_OVERTURNED` all deleted. `APPEAL_OUTCOME_SETTLED`
  added in their place.

### Test suite changes

- `test_alpha_court.py`: removed the six `_compute_deterministic_outcome` unit tests (the
  function no longer exists) and the `_FakeClaim`/`_compute` helpers built around it. Added
  four new `resolve_verdict` tests: a HELD scenario and a BROKEN scenario (both asserting the
  real verdict text contains the decisive word *and* the exact cited price numbers, not just
  the resulting state), and both distinct "no agreement" mechanisms from Step 0 finding 3
  (unparseable-text → `CONTESTED` with real text preserved; hook-raises-`UserError` →
  `CONTESTED` with no text at all, matching real protocol behavior). Net: 15 → 13 tests.
- `test_staking.py`: `install_transfer_hook` gained a `verdict_text` parameter (default text
  containing "HELD," matching every payout test's deadline price/direction combination, since
  `consensus_result` is now derived purely from parsed mock-LLM text rather than deterministic
  price math). `test_contested_leaves_stakes_locked` rewritten to reach `CONTESTED` via hedging
  response text instead of a deadline price within `PRICE_TOLERANCE` of the threshold (that
  path no longer exists). Test count unchanged (13).
- `test_appeals.py`: `install_hook` rewritten from task-text sniffing (round 1 vs. the appeal
  round used to have different task text) to a response *queue*, one entry per
  `ExecPromptTemplate` call in order — necessary because round 1 and the appeal round now share
  the exact same task/criteria text, so they can no longer be told apart by inspecting the
  request. `make_contested` reaches `CONTESTED` via a hedging first response instead of a
  near-threshold deadline price. The `UPHELD`/`OVERTURNED` test pair was replaced with two
  `SETTLED` tests — one where round 2 returns HELD, one where it returns BROKEN — both showing
  the bond is forfeited and folded into the payout regardless of which side wins, proving
  forfeiture is no longer tied to any "original side." Test count unchanged (14).
- Combined direct-mode suite: **40/40 passing.**
- `test/integration/`'s module docstring still references the old "deterministic
  HELD/BROKEN/AMBIGUOUS outcome logic" — not updated this round, consistent with that suite
  remaining blocked by the unrelated, unresolved GLSim storage-codegen bug and Build Prompt 3's
  own precedent of leaving integration-test edits for when that blocker clears.

## Post-Build-Prompt-4 master spec correction — appeal bond destination

`alpha-court-master-spec.md` (v1) arrived after Build Prompt 4 shipped. Cross-checking against
it confirmed the big structural call in Build Prompt 4 — collapsing `UPHELD`/`OVERTURNED` into
one `SETTLED` outcome, reusing `_resolve_verdict_with_consensus` verbatim for the appeal round
— was independently correct (§5/§7 describe exactly that shape: "a genuine second attempt...
not a review of a verdict that never existed"). What the spec caught, and what this contract
had **backwards**, was bond destination:

- **What was built**: `SETTLED` forfeited the bond, folding it into the losing pool before the
  proportional payout split (`extra_losing_pool_atto`); `NO_AGREEMENT`/`REFUNDED` returned it
  to the filer.
- **Spec (§6, §7)**: *"On `CONTESTED` → appeal filed → `SETTLED`... Appeal bond is returned to
  whoever filed it."* *"On `CONTESTED` → appeal filed → `REFUNDED`... Appeal bond is forfeited
  and split evenly across all original stakers... real deterrent against filing an appeal into
  evidence that's genuinely too ambiguous to ever resolve."* Exactly backwards from the guess.

Fix applied:

- `_payout_for_claim`'s `extra_losing_pool_atto` parameter removed entirely — reverted to
  Build Prompt 2's original, unmodified formula (nothing ever folds the bond in anymore).
- `resolve_appeal`'s `SETTLED` branch: plain `_payout_for_claim(claim)` + `_return_appeal_bond
  (claim)` (bond → filer, as a separate transfer from the proportional payout).
- `resolve_appeal`'s `NO_AGREEMENT` branch: `_refund_all_stakes(claim)` (unchanged) +
  new `_distribute_bond_evenly(claim)` instead of `_return_appeal_bond` — splits the bond into
  equal shares, one per stake *record* (not per unique address — flagged as a reasonable
  reading of "all original stakers," not spec-confirmed at that level of detail; a staker who
  posted both a FOR and an AGAINST stake on the same claim would get two shares under this
  reading), floor-divided with any remainder left as dust in the contract's balance (same
  accepted-dust pattern as the proportional payout split).
- `expire_appeal`'s no-appeal-filed `REFUNDED` path is unaffected — no bond was ever posted
  there, so there's nothing to distribute either way.

Re-verification after the fix:

- `genvm-lint check` — clean, still 11 methods.
- Only 2 of the 14 `test_appeals.py` tests needed fixing (the two that directly asserted bond
  math): renamed `test_resolve_appeal_settled_held_folds_bond_into_winning_payout` →
  `test_resolve_appeal_settled_held_returns_bond_to_filer` and
  `test_resolve_appeal_settled_broken_still_folds_bond_regardless_of_side` →
  `test_resolve_appeal_settled_broken_returns_bond_regardless_of_side` (this second test's
  *expected total* had happened to be numerically identical either way — owner was the sole
  staker on a 1:1-ratio winning pool, where folding a bond in and adding it separately produce
  the same sum — so it passed even before the fix; only the docstring's claimed mechanism was
  wrong, now corrected), and `test_resolve_appeal_no_agreement_refunds_everyone_and_returns_bond`
  → `..._and_splits_bond_evenly` with corrected per-staker amounts (each staker's exact stake
  plus an even bond share, not the full bond to the filer alone).
- Combined direct-mode suite: **40/40 passing**, unchanged count (no tests added or removed,
  only two corrected).

## Build Prompt 4.5 — Bond Outcome for SETTLED / REFUNDED

Follow-up to the correction above: fixes a real bug in `_distribute_bond_evenly` that the
prior round's spec cross-check hadn't caught yet, because that round's spec text hadn't
disambiguated it. This round's `alpha-court-master-spec.md` §6/§7 is explicit where the prior
version left it implicit: *"split evenly across every **address** that had an original stake
on that claim."*

The previous implementation split the bond one even share **per stake record** (one share per
`stake_keys` entry) rather than per unique address. That's wrong whenever a single address
holds two records on the same claim — which is a real, already-exercised pattern in this
codebase (`test_staking.py`'s three-way-split test already has the claimant stake `AGAINST`
her own claim after an optional `FOR` posting stake): that address would have received two
bond shares instead of one.

Fixed: `_distribute_bond_evenly` now de-duplicates by the staker's hex address (`dict[str,
Address]` keyed on `stake.staker.as_hex.lower()`) before computing `bond_atto //
unique_staker_count`, so every address gets exactly one share regardless of how many stake
records it holds on that claim.

**Rounding, documented per this prompt's own requirement**: plain integer floor division,
rounding *down* toward the contract's smallest GEN unit (atto) — the same direction and
reasoning `_payout_for_claim`'s proportional payout split already uses elsewhere in this
contract. Any remainder (at most `unique_staker_count - 1` atto-units, dust-scale) stays in
the contract's balance rather than being distributed, rather than rounding up and risking
paying out more than was ever forfeited.

### Verification

- `test_resolve_appeal_settled_held_returns_bond_to_filer` /
  `..._settled_broken_returns_bond_regardless_of_side` (both already existed, unchanged) —
  confirm the bond lands back with the filer untouched on `SETTLED`, regardless of which side
  the fresh verdict favors.
- `test_resolve_appeal_no_agreement_refunds_everyone_and_splits_bond_evenly` (already existed,
  unchanged) — two single-side stakers, bond splits evenly between them.
- **New**: `test_resolve_appeal_no_agreement_bond_splits_per_address_not_per_record` — the
  test this prompt's verification section asked for. bob stakes `FOR`, charlie stakes
  `AGAINST`, and alice (the claim's own poster) stakes **both** `FOR` and `AGAINST` on the same
  claim (two separate records, one address) — a pool sized (12 GEN total, 3 GEN bond, 3 unique
  addresses) so the even split is a clean 1 GEN/address with zero dust, isolating the
  per-record-vs-per-address distinction as the only thing the asserted numbers could be
  hiding. Hand-calculated: bob `2 + 1 = 3` GEN, charlie `4 + 1 = 5` GEN, alice
  `(3 + 3) + 1 = 7` GEN (two stake refunds, summed, but only ONE bond share) — the old
  per-record logic would have given alice 2 bond shares out of 4 total records instead of 1
  out of 3 addresses, producing different (wrong) totals; this test would have caught that
  regression had it existed before the fix.
- `genvm-lint check` — clean, still 11 methods.
- Combined direct-mode suite: **41/41 passing** (40 existing + 1 new).

## Build Prompt 5 — Alpha Passport

Adds reputation: a per-claimant-address record of wins, losses, a claim-type-keyed category
breakdown, and full append-only claim history, written automatically as a side effect of every
terminal state transition this contract has (never a separately-triggered function).

### Data model

Two new storage dataclasses, following the exact flat-fields-only discipline every other
storage type in this file already uses (see the header's storage-nesting notes from Build
Prompts 1/2 — no TreeMap/DynArray fields nested inside another `@allow_storage` dataclass):

- **`Passport`**: `address`, `win_count`, `loss_count` — one record per claimant (poster)
  address, created lazily on that address's first terminal claim.
- **`CategoryStat`**: `address`, `claim_type`, `win_count`, `loss_count` — one record per
  `(address, claim_type)` pair. `CLAIM_TYPE_PRICE_THRESHOLD = "PRICE_THRESHOLD"` is the only
  claim type that exists through Build Prompt 5, but the storage shape is genuinely
  claim-type-keyed from day one (a real `TreeMap` keyed by a composite `f"{address_hex}:
  {claim_type}"` string, mirroring the `stakes`/`stake_keys` composite-key pattern already
  proven working in this contract), not a flat counter that would need restructuring once
  Relative Performance/Fundamentals exist.

Two new Contract-level collections, mirroring the same `stake_keys`-style pattern used
everywhere else that needs a queryable one-to-many index without relying on unconfirmed
`TreeMap` range/prefix iteration: `category_keys` (every `category_stats` key ever created,
in order) and `claim_history_keys` (every `f"{address_hex}:{claim_id}"` ever recorded, across
every claimant, in order — `get_passport` filters this by address prefix, same as `get_stake`
filters `stake_keys` by claim prefix).

### Win/loss counting rule (§8, `_record_passport`)

One function, `_record_passport(claim, outcome)`, called from all four terminal-transition
call sites:

| Call site | `outcome` passed | Effect |
|---|---|---|
| `resolve_verdict`'s `RESOLVED` branch | `consensus_result` (`HELD`/`BROKEN`) | win or loss |
| `resolve_appeal`'s `SETTLED` branch | `second_consensus_result` | win or loss |
| `resolve_appeal`'s `NO_AGREEMENT` branch | `""` | history-only |
| `expire_appeal` (no-appeal-filed `REFUNDED`) | `""` | history-only |

`outcome` reuses the exact same three-way domain `claim.consensus_result` already has
(`OUTCOME_HELD` / `OUTCOME_BROKEN` / `""`) rather than inventing a new enum. `""` always means
"append to claim history, touch nothing else" — no win/loss/category change on either
`REFUNDED` path, per the build prompt's own explicit "deliberate transparency choice, not an
oversight." Claim history is appended unconditionally, before the outcome check, so it's the
one effect that happens on every call regardless of outcome.

### Non-negotiables confirmed by the implementation

- **Flat, unweighted win rate**: `_record_passport` takes no stake-size or claim-difficulty
  input anywhere — a win is a win regardless of how much GEN was staked on either side of the
  claim.
- **Automatic, not manually triggered**: no new public write method exists for recording a
  result — the only way `_record_passport` runs is as the last step of an already-existing
  state-transition call (`resolve_verdict`, `resolve_appeal`, `expire_appeal`), exactly
  mirroring how `_payout_for_claim`/`_refund_all_stakes` are already wired in.
- **Nothing deletable**: `claim_history_keys` is append-only; no code path in this contract
  ever removes an entry from it, contested/refunded claims included.

### Testing notes

`test_passport.py` deliberately does *not* re-derive full staking/appeal scenarios from
scratch — the state-machine paths themselves (payout math, bond math, the three appeal
outcomes) are already covered by `test_alpha_court.py`/`test_appeals.py`; this file exercises
`_record_passport`/`get_passport` directly using the same `force_evidence_locked`/
`install_hook` response-queue patterns already established there, with zero stakers involved
(passport bookkeeping is independent of payout math, so keeping these tests stake-free keeps
the assertions focused on exactly what's under test). Covers: a `HELD` win and a `BROKEN` loss
via the direct `resolve_verdict` path; the same win/loss check repeated via the `SETTLED`
appeal path specifically (`resolve_appeal`, a genuinely different call site than
`resolve_verdict` — confirms the hook covers both transitions, not just one, per this build
prompt's own verification requirement); both `REFUNDED` paths (`NO_AGREEMENT` and
no-appeal-filed), each asserted against a *non-zero* prior win/loss count established earlier
in the same test to prove "unchanged" is a real assertion, not just "stayed at zero"; a mixed
multi-claim `get_passport` scenario (2 wins, 1 loss, 1 refund across 4 claims, asserting the
exact counts, the category breakdown, and that all 4 claim IDs appear in history with none
dropped); and the never-posted-anything default (zeros, empty collections, no pre-registration
required).

- `genvm-lint check` — clean, now 12 methods (4 view, 8 write — `get_passport` is the new view).
- Combined direct-mode suite: **49/49 passing** (41 existing, unmodified, + 8 new).

## Build Prompt 6 — Relative Performance Claim Type

Adds the second claim type: `"asset_a will outperform asset_b"` over a window ending at a
deadline (master spec §3b). No threshold/direction field — outperformance is the comparison
itself. New entry point `create_relative_performance_claim(asset_a, asset_b, deadline)`,
separate from `create_claim` (the two claim types take genuinely different inputs). Everything
else — staking, appeals, the leader-verdict/validator-check mechanism, Alpha Passport — is
reused, extended only where the claim-type difference actually requires it.

### Step 0 findings

1. **Surf endpoint reuse**: no new endpoint, no new auth pattern — `SURF_PRICE_PATH =
   "/market/price"` (confirmed real since Build Prompt 1) is called twice per snapshot instead
   of once. Confirmed by design that nothing in the SDK restricts how many `gl.nondet.web.get`
   calls a `leader_fn` may make sequentially — it's ordinary Python control flow inside the
   sandboxed function, not a special one-call-per-block primitive — and confirmed for real by
   this round's own new tests actually running two independent fetches inside one non-det
   block.
2. **A real, deliberate tradeoff, not an accidental gotcha**: bundling both assets' fetches
   into one non-det round makes the snapshot *atomic* — either both prices come back and
   validate together, or the whole round fails and retries via leader rotation. There's no
   partial snapshot where one asset locks in and the other doesn't. This is the *correct*
   tradeoff for this claim type (a lone asset_a price isn't a usable Relative Performance
   snapshot at all), and it's also what lets both prices legitimately share one `fetched_at`
   timestamp instead of two that could drift apart under a two-round design.
3. **Cost confirmation (§4b's ~4N estimate)**: confirmed by design and by
   `test_relative_performance_posting_fetch_costs_two_real_calls` — each validator's own
   leader_fn/validator_fn execution inside one non-det round makes 2 real HTTP calls (one per
   asset), so one snapshot costs 2N real Surf calls across N validators, and a fully-resolved
   claim (posting + deadline) costs 2N + 2N = 4N total — matching §4b exactly. Bundling changes
   how many non-det *rounds* are spent (one per snapshot instead of two), not the total real
   HTTP call count.

### Data model

`Claim` is extended, not forked into a second dataclass or a second `TreeMap` — GenVM storage
has no established polymorphism primitive in this codebase, so one flat shape serves every
claim type, with unused fields sitting at a zero/empty sentinel per type:

- New `claim_type` field (`CLAIM_TYPE_PRICE_THRESHOLD` | `CLAIM_TYPE_RELATIVE_PERFORMANCE`) —
  the one field that decides which of the rest are meaningful.
- New `asset_b`, `posting_price_b_atto`, `deadline_price_b_atto` fields — empty/zero for Price
  Threshold claims. `asset` doubles as "asset_a" for Relative Performance (not renamed, to
  avoid touching every existing call site/test for a purely cosmetic change).
- `threshold_atto`/`direction` are `0`/`""` for Relative Performance claims — genuinely unused,
  not repurposed, per this prompt's own non-negotiable against bolting Price-Threshold-shaped
  fields onto a claim type that doesn't have a threshold or direction.
- Both assets' prices for a given snapshot share ONE `posting_fetched_at`/`deadline_fetched_at`
  timestamp (not a second pair of `_b` timestamp fields) — honest, since they really are
  fetched together in the same call (see Step 0 finding 2).

`get_claim`'s view dict gained `claim_type`, `asset_b`, `posting_price_b`, `deadline_price_b`
(all `None` for Price Threshold claims — asserted explicitly in
`test_get_claim_price_threshold_has_no_asset_b`).

### Category B evidence fetch

`_fetch_price_with_consensus` (single-asset, Build Prompt 1) generalized into
`_fetch_prices_with_consensus(assets: list[str], ...)` — one non-det round covering however
many assets are passed, with the validator accepting iff *every* price is within
`PRICE_TOLERANCE` of the leader's. `_fetch_price_with_consensus` now just calls the plural
version with a one-element list, preserving every existing Price Threshold call site
unchanged. `lock_deadline_evidence` branches on `claim.claim_type` to fetch one asset or two,
same underlying function either way.

### Leader verdict / validator check

`_resolve_verdict_with_consensus` (the one function every claim type's verdict flows through,
reused verbatim in structure) now branches on `claim.claim_type` to pick the right facts/task/
criteria before the shared consensus call and parse logic run unchanged — `resolve_verdict`/
`resolve_appeal` stay completely claim-type-agnostic, per task 6. `_build_price_threshold_facts`
and `_build_relative_performance_facts` hold the two claim types' raw-facts construction; both
follow Build Prompt 4's "no precomputed answer" principle — the leader receives all four raw
prices and must derive both assets' percentage change and compare them itself, never a
precomputed delta or verdict.

**A flagged, honest limitation on §3b's "material context" instruction**: the spec asks the
verdict to weigh context beyond the raw delta where Surf surfaces it (e.g. a volume anomaly),
since a large % move on thin volume reads differently than the same move on real volume. This
contract's Category B fetch mechanism — reused unchanged, just extended to two assets — only
ever pulls spot price; there is no volume/on-chain-event/social-data fetch anywhere in this
codebase to hand the leader as that context. `RELATIVE_PERFORMANCE_VERDICT_CRITERIA` asks the
leader to flag anything *derivable from the given prices alone* that looks unusual (a move so
large it resembles a data glitch) — the honest ceiling of what's actually fetchable today, not
a fabricated volume signal. A real volume/context fetch would be new Category B infrastructure,
out of this prompt's scope.

### Staking, appeals, Passport — the flagged gap

Staking and appeals needed **zero changes** — `_payout_for_claim`, `_refund_all_stakes`,
`_distribute_bond_evenly`, `file_appeal`, `resolve_appeal`, `_compute_appeal_bond` all already
operated purely on claim ID, pool totals, and the shared `HELD`/`BROKEN`/`""` `consensus_result`
domain, with no Price-Threshold-specific logic anywhere — confirming Build Prompts 2/3 were
built claim-type-generic as intended.

**Alpha Passport was not fully claim-type-generic, and this prompt fixes it**: `_record_passport`
hardcoded `CLAIM_TYPE_PRICE_THRESHOLD` when building the category-breakdown key, because
`Claim` had no `claim_type` field yet when Build Prompt 5 shipped and only one claim type
existed. With a second real claim type now in play, every Relative Performance win/loss would
have been silently miscategorized as `PRICE_THRESHOLD` under the old code. Fixed to read
`claim.claim_type` instead — exactly the kind of earlier-prompt gap task 6 asked to be flagged,
not silently patched. `test_passport_category_breakdown_separates_relative_performance_from_price_threshold`
is the direct proof: one address with a win of each claim type shows two genuinely separate
category entries, not one merged or mislabeled bucket.

### Category A

`services/surf_display.py` gained `get_relative_performance_display(asset_a, asset_b, api_key)`
— reuses `get_display_price` for each asset (two ordinary HTTP calls, no `gl.*` symbols, same
`requests`/`os` imports `genvm-lint`'s AST safety check already forbids inside contract code)
rather than a second module, since the existing one's shape already fits. Deliberately does
*not* compute or return a % comparison between the two assets — that judgment is exactly what
the real Category B verdict mechanism exists to make under consensus over immutable locked
snapshots; a display preview computing "asset_a is winning" would blur Category A into
Category B, which every prior prompt's non-negotiables forbid. Callers do that arithmetic
client-side from the two raw prices this function returns.

### Testing notes

`test_relative_performance.py` reuses every established pattern from the rest of this suite:
`force_evidence_locked`-style storage reach-ins (extended for the second price field) since
`lock_deadline_evidence`'s real happy path needs a deadline that has actually passed, which
direct mode's frozen-at-deploy-time clock can't produce (the same limitation Price Threshold's
own deadline fetch has had since Build Prompt 1); the leader-only `install_verdict_hook`
pattern for controlling `resolve_verdict`'s outcome. The cost-confirmation test
(`test_relative_performance_posting_fetch_costs_two_real_calls`) wraps
`VMContext._match_web_mock` (the real per-request dispatch point, confirmed by reading
`gltest/direct/vm.py`) to count actual fetch attempts — proving 2 real HTTP calls happen for
one posting snapshot, not 1 deduplicated call, and pairs it with a regression guard confirming
Price Threshold's own posting fetch still costs exactly 1. Only the posting-side half of the
4N total is executable in direct mode, per the reasons above; the deadline-side fetch is
structurally the identical function call and remains integration-test-only, same as it always
has been for this contract.

- `genvm-lint check` — clean, now 13 methods (4 view, 9 write —
  `create_relative_performance_claim` is the new write method).
- Combined direct-mode suite: **58/58 passing** (49 existing, unmodified, + 9 new).

## Build Prompt 7 — Fundamentals Threshold Claim Type

Adds the third and final v1 claim type: "this on-chain/DeFi metric crosses this threshold"
(e.g. "Uniswap TVL will exceed $X"), whitelisted to exactly TVL/MVRV/NUPL/SOPR (master spec
§3c). `alpha-court-master-spec.md` was asked to be attached specifically for this prompt but
was **not** actually present this round either — proceeded on the v1 spec text already given
earlier in this project, cross-checked this round against Surf's real, live API docs (fetched
directly during Step 0, not guessed), since this claim type touches genuinely new endpoints
the first two never did.

### Step 0 findings (real endpoints, fetched live — not analogized from `/market/price`)

1. **Real endpoints confirmed against docs.asksurf.ai directly** (same base URL already in
   use):
   - On-chain indicators (MVRV, NUPL, SOPR): `GET /market/onchain-indicator?symbol=<SYM>
     &metric=<mvrv|sopr|nupl>`
   - TVL: `GET /project/defi/metrics?q=<protocol>&metric=tvl`

   Both return a **time-series array** (`{"data": [{"timestamp":.., "value":.., ...}], ...}`),
   structurally different from `/market/price`'s single-object envelope — `_parse_fundamentals_value`
   picks the max-timestamp point rather than assuming `data[0]` is latest, since sort order
   isn't documented (same defensive-parsing discipline `_parse_surf_price` already established).

2. **The real, checked answer to "does update frequency differ by metric"**: confirmed against
   Surf's own docs for both endpoint families — the on-chain indicator endpoint documents
   `granularity: day`, and the TVL data catalog explicitly describes TVL tables as "gap-filled —
   every day has a value" (daily aggregates, not real-time). All four whitelisted metrics turn
   out to be already-finalized, once-per-day values — none behave like Price Threshold/Relative
   Performance's near-instant spot price. §4b's **exact-match** rule applies uniformly across
   all four — a real finding from checking each one individually, not an assumption that
   happened to come out uniform.

3. **A real conflict between the spec's own example and the real API**: §3c's own illustrative
   claim is "AAVE MVRV will cross Y", but the real Surf API only supports `symbol=BTC` for
   mvrv/sopr/nupl — "other symbols return empty data" (confirmed directly from Surf's published
   skill docs). `create_fundamentals_claim` enforces `asset == "BTC"` for these three metrics
   and rejects anything else outright at creation time; TVL has no such restriction (it takes
   an arbitrary protocol identifier, matching the spec's own Uniswap example).

4. **A real storage bug caught before it shipped**: NUPL is a genuine on-chain metric that can
   go **negative** (roughly -1 to 1 across market cycles), but the shared `threshold_atto`/
   `posting_price_atto`/`deadline_price_atto` fields this claim type reuses from Price
   Threshold (per task 2) are `u256` — unsigned. Storing a negative NUPL value directly would
   silently corrupt. Rather than changing those fields' type to a signed integer (genlayer does
   define a real `i256`, but changing it would touch Price Threshold's/Relative Performance's
   already-proven storage for a Fundamentals-only edge case — bigger than this prompt's
   "additive, not a rebuild" non-negotiable calls for), fixed with a documented additive offset
   (`FUNDAMENTALS_SIGNED_OFFSET = 1_000_000`) applied only when encoding/decoding a Fundamentals
   Threshold claim's metric fields into/out of those shared `u256` fields — a uniform shift
   preserves ordering (crossing/direction comparisons are unaffected) and is decoded back to the
   real signed value everywhere it's ever surfaced (`get_claim`, the verdict facts string).
   `test_fundamentals_nupl_broken_with_negative_values` proves the full round-trip with a
   negative threshold, posting value, and deadline value all at once.

### Data model

Reuses Price Threshold's exact shape (task 2) — no new dataclass, no new `TreeMap`. One new
field: `metric` (one of `FUNDAMENTALS_METRICS`, `""` for the other two claim types) —
`threshold_atto`/`direction`/`posting_price_atto`/`deadline_price_atto` mean exactly what they
already do for Price Threshold, just carrying the signed offset described above. `asset` holds
the symbol/protocol identifier (`"BTC"` for an on-chain indicator, `"uniswap"` for TVL).

### Category B evidence fetch

New `_fetch_fundamentals_value`/`_parse_fundamentals_value` (the time-series-aware fetch/parse
pair) and `_fetch_fundamentals_with_consensus` (exact-match equivalence, not tolerance-band —
`FUNDAMENTALS_EXACT_MATCH_EPSILON` absorbs only floating-point round-trip noise across two
independent JSON parses of the same daily figure, not a meaningful real-world tolerance).
`lock_deadline_evidence` gained a third branch alongside Price Threshold's and Relative
Performance's, using this new function.

### Leader verdict / validator check

`_resolve_verdict_with_consensus` (the one function every claim type's verdict flows through)
gained a third branch: `_build_fundamentals_threshold_facts` + `FUNDAMENTALS_VERDICT_TASK`/
`FUNDAMENTALS_VERDICT_CRITERIA`, same shape as Price Threshold's (a single value crossing a
threshold, per task 5) — kept as distinct constants rather than reusing `VERDICT_TASK`/
`VERDICT_CRITERIA` verbatim only because that wording explicitly says "Price Threshold claim"
and "price snapshots," which would misdescribe a TVL/MVRV/NUPL/SOPR claim to the leader; the
facts string itself names the actual metric. `resolve_verdict`/`resolve_appeal` needed zero
changes — the branch lives entirely inside the one shared function, exactly as task 6 asked.

### Staking, appeals, Passport — verified generic, no changes needed this time

Build Prompt 6 found a real Passport bug (a hardcoded claim type) that only surfaced once a
second claim type existed — this prompt explicitly re-audited every claim-type touchpoint
rather than assuming "should already be generic" a second time. Result: `_payout_for_claim`,
`_refund_all_stakes`, `_distribute_bond_evenly`, `_compute_appeal_bond`, `file_appeal`,
`resolve_appeal`, `expire_appeal`, and `_record_passport` (already fixed to read
`claim.claim_type` dynamically in Build Prompt 6) all needed **zero changes** — confirmed by
grep for every `claim_type ==`/`CLAIM_TYPE_` reference in the file, which turned up only the
three legitimate branch points (the verdict-facts builder, the deadline-fetch dispatcher, and
the three `Claim(...)` constructors) and nothing hardcoded elsewhere.
`test_passport_category_breakdown_separates_all_three_claim_types` is the direct proof: one
address with a win of each of the three claim types shows three genuinely separate category
entries, not two merged into one or a third silently miscategorized.

### Category A

`services/surf_display.py` gained `get_fundamentals_display(asset, metric, api_key)` — same
structural isolation as the other two display functions (plain `requests` call, no `gl.*`
symbols, no shared code path with the contract's Category B fetch), reusing the real confirmed
endpoints and the same max-timestamp time-series parsing discipline as the contract's own
`_parse_fundamentals_value`. No threshold comparison is computed here either, for the same
Category A/B separation reason `get_relative_performance_display` doesn't compute a %
comparison.

### Testing notes

`test_fundamentals.py` covers: whitelist rejection (a non-whitelisted metric reverts, and
separately that the BTC-only restriction is enforced specifically for the three on-chain
indicator metrics, not blanket across the whole whitelist, with TVL confirmed to allow an
arbitrary protocol); HELD for TVL and BROKEN for NUPL specifically (two different metrics, per
the verification requirement), both asserted against real cited verdict text; the negative-NUPL
round-trip proof described above; and the three-way Passport category breakdown. Deadline-time
snapshots use the same storage reach-in pattern as every other claim type's tests (direct
mode's frozen clock can't reach a real deadline within one deployment) — the reach-in helper
here (`force_evidence_locked_fundamentals`) reads `FUNDAMENTALS_SIGNED_OFFSET` off the already-
loaded contract module rather than hardcoding a copy of it, so the test can't silently drift
from the real constant.

- `genvm-lint check` — clean, now 14 methods (4 view, 10 write — `create_fundamentals_claim`
  is the new write method).
- Combined direct-mode suite: **65/65 passing** (58 existing, unmodified, + 7 new).

## Build Prompt 8 — Real Studio Testnet Deployment

First real deployment against GenLayer Studio testnet (chainId 61999, `https://studio.genlayer.com/api`), proving the contract against real GenVM multi-validator consensus rather than mocked validators. This deployment found and fixed **two real, contract-breaking bugs that direct-mode tests structurally cannot catch**, because direct mode never calldata-encodes a return value over the wire.

### Real evidence

- **Deployed contract (final, working version)**: `0xd3cD69C30A4e899bA2D346723bffac066543cF97`
- **Deploy tx**: `0xb7619569e1c93154e3750cc43b5854a0ea040762660f3053069705aa13d7c0ab` — ACCEPTED, 3 agree / 2 idle
- **`create_claim`** (ETH/USD, threshold 3000, "above"): `0xca80428983dc75239d23f89e12a88acaffd6814322b9dacdaca0f4172dfa8bdd` — real posting-time Category B fetch, MAJORITY_AGREE. Real fetched price: `1869.8920798200925`.
- **`stake_for`** (1 GEN): `0x3dadb34986f9e0dcc4eb466861d706216c309dbc6f54d0a83c0573a8621fe76f`
- **`stake_against`** (1 GEN): `0x775adc53ad5b0c45bd208c9f3c77193e9009758b690b14b7f170647f75b1574d`
- **`lock_deadline_evidence`**: `0xb9576aac09b82e99a8afe4abc0779431dd5951902a0e464eb9d988ece35d7733` — real deadline-time fetch + real multi-validator comparative-tolerance consensus. Real fetched price: `1880.4418746262188`.
- **`resolve_verdict`**: `0x16a2e4abbcbd1c2a1ee039595037b9d3c94126aafd2747b611d4a94aaf265db8` — real leader-verdict generation + real non-comparative validator check. Result: `RESOLVED` / `BROKEN`, with real cited verdict text: *"The Price Threshold claim was BROKEN. The posting-time price was 1869.8920798200925, and the deadline-time price was 1880.4418746262188, which is below the claimed threshold of 3000.0..."*
- **Real payout confirmed**: deploy account balance moved 100 → 98 GEN after the full run. Since the same account staked both FOR and AGAINST (1 GEN each) and the AGAINST side won, the 2 GEN staked round-tripped back in full via the real proportional payout — the observed 2 GEN net cost is gas across 6 transactions (~0.33 GEN/tx), not a stake loss, confirming the payout math executed correctly on-chain.
- **Category A, independently verified**: `services/surf_display.get_display_price("ETH/USD", ...)` called directly, outside the contract entirely — real response: `{'asset': 'ETH/USD', 'price': 1880.4418746262188, 'source': 'surf', 'display_only': True}`. Confirms Category A and Category B are genuinely independent in practice (separate code path, separate call, no shared state), not just structurally separated in code.

Two earlier deployment attempts on the way to the above are also real, on-chain, and left as evidence of the debugging trail (not hidden): `0x8ac832b85f31b9d3aff978daa90153135efe2ff21f5ddd2ecfdf3f0da844f82e` (first deploy, contract worked but `create_claim` failed — bug #1 below) and `0x6e4a76da645064c66f68c11298f779bb573f7295e5372896c261d371e314621d` (second deploy, fixed bug #1, but `get_claim` then crashed — bug #2 below) at contract addresses `0x360f4eBA905867aCCba18A4c3aF8F2cDE102742f` and `0x37b65E23f1Ac9FbC0bE8c985671DbBA53c73f930` respectively — both superseded by the final deployment above.

### Two real bugs found and fixed, invisible to 65/65 passing direct-mode tests

**Bug 1 — `float` is not a valid GenVM calldata type, crossing a nondet `leader_fn` boundary.** Confirmed against `genlayer/py/calldata.py` source: the encoder supports `int` and `str`, not a raw Python `float`. Every `gl.vm.run_nondet` leader/validator function in this contract (`_fetch_prices_with_consensus`, `_fetch_fundamentals_with_consensus`) returned prices/metric values as raw floats in their result dict — direct mode never actually calldata-encodes a nondet leader_fn's return value, so this was invisible through 58 passing tests. On real Studio, `create_claim`'s very first live call failed with `MAJORITY_DISAGREE`/`UNDETERMINED`; the trace showed a real Python `TypeError: not calldata encodable 1872.75...: float`. Fixed by carrying every numeric value through the nondet boundary as a `str`, parsed back to `float` on both sides of the crossing.

**Bug 2 — the same rule applies to a `@gl.public.view` method's return value.** After fixing bug 1, `create_claim` succeeded for real, but `get_claim` then crashed on real Studio with a bare `exit_code 1` — the exact same calldata-encoding rule applies to a view method's *return value*, which also crosses the wire. `get_claim` returned 8 raw floats (`threshold`, `posting_price`, `deadline_price`, `posting_price_b`, `deadline_price_b`, `stake_for_total`, `stake_against_total`, `appeal_bond`). Fixed the same way — every numeric field is now `str(value)`, with `None` preserved for unset fields; callers parse with `float()` client-side. All 35 affected assertions across `test_alpha_court.py`/`test_appeals.py`/`test_fundamentals.py`/`test_passport.py`/`test_relative_performance.py`/`test_staking.py` were updated to `float(claim["field"])` to match — direct mode's own proxy never enforced this return-value encoding either, so nothing in the existing suite would have caught the regression without the live run.

Both bugs share one root cause and one lesson: **direct-mode tests validate business logic; they cannot validate the wire-encoding contract with real GenVM**, because direct mode's proxy passes Python objects straight through rather than round-tripping them through the real calldata encoder in either direction (nondet results in, method returns out). This is exactly what Build Prompt 8 existed to catch.

### A real, non-contract CLI bug found along the way

The `genlayer` CLI's `--args` parser (`parseScalar` in the compiled CLI, confirmed against source) unconditionally coerces any numeric-looking string argument to a JS number — there is no way to force a value like claim_id `"1"` to stay a string through `genlayer call`/`genlayer write`. Every claim-scoped method takes `claim_id: str`, so this made the CLI unusable for any call needing a claim ID once a claim actually existed (`unknown claim_id` or a raw `TypeError: '<' not supported between instances of 'int' and 'str'` inside the contract's own `TreeMap` lookup, depending on the exact numeric-string value). Worked around by using the `genlayer-py` Python SDK directly (`genlayer_py.create_client(chain=genlayer_py.studionet, ...)` + `read_contract`/`write_contract`) for every call from `create_claim` onward, which correctly encodes a Python `str` as a calldata string. This is a real CLI limitation worth reporting upstream, not a contract issue — flagged per this project's "confirm, don't assume the tooling matches" discipline (Step 0 task 1 asked to confirm the deployment flow, not just replicate Provider Court's; this divergence is exactly what that check was for).

### Step 0 findings

1. **Deployment flow confirmed for real, not assumed**: `genlayer deploy --contract <path> --args <constructor args...>` against the CLI's already-configured `studionet` network (`genlayer network set studionet`, already active in this environment) — no Docker, no local Studio. Matches Provider Court's flow in shape, diverges in the CLI-arg-parser bug above, which Provider Court's own deployment likely never hit (no numeric-string identifiers in their constructor/method args).
2. **Rate limit confirmed for real, and it's a different dimension than Provider Court's history noted**: Provider Court's own history cites a ~5,000–10,000/day *shared* limit; the limit actually hit during this deployment was **30 requests/minute** on `eth_getTransactionByHash` polling — a per-minute RPC throttle, not the daily one. Hit once (during the first deploy's receipt-polling), respected by backing off ~65s rather than retrying blindly, per this prompt's own non-negotiable.
3. **Faucet process confirmed for real**: Studio has a *built-in* faucet (💧 button in Studio's own account selector UI at studio.genlayer.com), not the separate public testnet-asimov/testnet-bradbury faucet (which requires 0.01 ETH mainnet verification). GEN funding for this run came from the user funding the deploy account directly via that in-Studio faucet (100 GEN, confirmed on-chain).

### Surf credit consumption

Observed transaction/consensus structure (exact dashboard-level credit accounting isn't available from this environment — Surf's own account portal would have the precise figure): `create_claim`'s posting fetch and `lock_deadline_evidence`'s deadline fetch each ran one real non-comparative-tolerance consensus round with a 5-validator set (3 agree / 2 idle pattern observed on both), consistent with §4b's ~2N-per-snapshot model for Price Threshold (2 snapshots × N validators ≈ 10 real Surf calls for the claim's full Category B lifecycle), plus 1 independent Category A call. Reported plainly rather than guessed to more decimal precision than the available evidence supports.

### Scope note

Per this prompt's own non-negotiable, no attempt was made to force live validator disagreement or a live `CONTESTED`/appeal round — that path stays proven by the existing direct-mode suite (`test_appeals.py`), not re-attempted on a live network where genuine disagreement can't be forced deterministically.
