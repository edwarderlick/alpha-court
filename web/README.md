# Alpha Court — Web

Next.js frontend. Screens were merged from Stitch exports (see the per-page
comments crediting each source `code.html`) before any contract work
started; this file tracks wiring those screens to the real deployed
contract, starting with Build Prompt 9.

## Setup

```bash
npm install
```

Create `.env.local` (gitignored, never commit):

```
# Live court. Retired addresses are read-only history -- never point a
# fresh setup at 0xd3cD69…, 0x8b2fF616…, 0x22Cf7A9e…, or 0xF9Df5e7b….
ALPHA_COURT_CONTRACT_ADDRESS=0x219e753176D1157bC22376e10d06e4E21E401417
NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS=0x219e753176D1157bC22376e10d06e4E21E401417
NEXT_PUBLIC_TREASURY_ADDRESS=0x374D46E81973dd8797f14f586AEE94AaC27e39A3
ALPHA_COURT_SIGNER_PRIVATE_KEY=0x...   # funded Studio testnet account, backend writes only
SURF_API_KEY=sk-surf-...               # Category A display reads only (lib/surf/display.ts)
```

```bash
npm run dev
```

## Settlement keeper

A clock on the Next.js server. It does **not** fetch Surf or pick HELD/BROKEN.
It only sends the same permissionless txs a human can click:

- `OPEN` + deadline passed → `lock_deadline_evidence`
- `EVIDENCE_LOCKED` → `resolve_verdict`
- `CONTESTED` + 48h elapsed → `expire_appeal`
- `APPEAL_PENDING` → `resolve_appeal`

Enable in `.env.local`:

```
KEEPER_ENABLED=true
NEXT_PUBLIC_KEEPER_ENABLED=true
KEEPER_MIN_CLAIM_ID=18
KEEPER_INTERVAL_MS=60000
```

`KEEPER_MIN_CLAIM_ID` skips older test dockets so the first start does not
lock every expired claim (each lock is a real Surf consensus round).

Restart `next dev` after changing these. Status: `GET /api/keeper/tick`.
Manual pass: `POST /api/keeper/tick` (Bearer `KEEPER_SECRET` if set).

## Build Prompt 9 — Frontend/Backend Wiring, Phase 1

Wires the already-merged screens to the real deployed contract
(`0xd3cD69C30A4e899bA2D346723bffac066543cF97` on GenLayer Studio testnet,
chainId 61999) for Price Threshold reads and the core create/stake write
flow. Relative Performance, Fundamentals, appeals UI, and a Category A
frontend surface are still deferred to later prompts.

### Step 0 findings

1. **`genlayer-js`'s real API** (confirmed from the installed package's own
   `.d.ts`, not assumed from `genlayer-py`'s shape): `createClient({chain,
   account | provider})`, then `client.readContract({address, functionName,
   args})` / `client.writeContract({address, functionName, args, value})` /
   `client.waitForTransactionReceipt({hash})`. `genlayer_js.chains.studionet`
   matches Build Prompt 8's real values exactly (chainId 61999, RPC
   `https://studio.genlayer.com/api`).
2. **The CLI's numeric-string ID coercion bug does not exist in the SDK.**
   Traced to source: the `genlayer` CLI's bug lived entirely in its own
   `--args` string-parsing layer, which genlayer-js has no equivalent of —
   `readContract`/`writeContract` take a raw JS array straight into the
   calldata encoder, no re-parsing step. Confirmed for real, not just by
   reading source: `get_claim(["1"])` and `stake_for(["2"])` both round-trip
   correctly against the live contract (see Real evidence below).
3. **The float-calldata constraint is protocol-level, confirmed in
   genlayer-js's own encoder**, not a Python-specific quirk:
   ```js
   case "number": {
     if (!Number.isInteger(data)) {
       reportError("floats are not supported", data);
     }
     ...
   ```
   (from `genlayer-js/dist/index.js`). Every price/threshold/metric this
   app sends or reads is therefore handled as a `string` end to end — see
   `lib/genlayer/client.ts`'s header.
4. **Merged frontend structure read in full before wiring anything**: routes
   under `app/*`, the one existing piece of shared state (`lib/store.tsx`),
   and `components/AppShell.tsx`. `lib/store.tsx`'s own docstring settles
   the wallet-connect question up front: *"Frontend-only UI state ... No
   real wallet/contract logic — visual only."* Confirmed a placeholder, not
   assumed either way.

### A gap the merged screens had that this prompt had to fill

Neither the merged app nor any of the raw Stitch export folders (checked
all of them, not just the merged ones) contained a staking form, or a
create-claim form with real fields (asset/threshold/direction/deadline) —
`post_a_claim_step_2` was static mock content ("$3,421.89", hardcoded
volume/latency numbers), and `case_detail` had no FOR/AGAINST controls at
all. This isn't a design decision to revisit — the design simply never
included these controls. Build Prompt 9 added a minimal real form
(`app/post-a-claim/page.tsx` step 2) and a minimal real stake widget
(`components/StakeForm.tsx`), styled consistently with the surrounding
panels rather than introducing new design language, since "reuse the
merged screens" couldn't apply to controls that were never there.

### Wallet connect: real answer, and the architecture decision that follows from it

**Placeholder**, confirmed above. Digging further: GenLayer's real wallet
integration goes through a **MetaMask Snap**
(`client.metamaskClient()` / `isGenLayerSnapInstalled`), not a plain
injected `window.ethereum` connection — a materially bigger integration
than a standard EVM wallet-connect, and disproportionate to this phase's
scope.

Given that, Phase 1 write flows (`create_claim`, `stake_for`,
`stake_against`) go through a **server-side signer** — a funded Studio
testnet account held only in `ALPHA_COURT_SIGNER_PRIVATE_KEY`, never in the
browser. Every write in this phase is therefore on-chain from the same
address regardless of who clicked the button in the UI. Real per-user
MetaMask Snap signing is explicit follow-up work for a later prompt, not
silently punted.

### Serialization enforced at a shared boundary

`lib/genlayer/client.ts` is the only file that imports `genlayer-js`.
Every API route goes through its `readClaim`/`writeClaim`, whose argument
type (`string | number(int) | boolean | null`) and header comment are the
single place the string-only discipline lives — a future call site can't
bypass it by hand-rolling its own `readContract` call, because there isn't
another one to hand-roll.

### Real evidence

- **Contract**: `0xd3cD69C30A4e899bA2D346723bffac066543cF97` (Studio
  testnet, chainId 61999) — the same contract Build Prompt 8 deployed and
  smoke-tested.
- **Real read, through `GET /api/claims`**, of the actual Build Prompt 8
  claim, live from the running app (not mock data):
  ```json
  {"claim_id":"1","claim_type":"PRICE_THRESHOLD","asset":"ETH/USD",
   "state":"RESOLVED","consensus_result":"BROKEN",
   "posting_price":"1869.8920798200925","deadline_price":"1880.4418746262188",
   "threshold":"3000.0","stake_for_total":"1.0","stake_against_total":"1.0", ...}
  ```
- **Real `create_claim`, through the actual UI form** (`/post-a-claim`
  step 2 → `POST /api/claims`): asset `BTC/USD`, threshold `50000`,
  direction `above`. Result: new claim id `2`, state `OPEN`.
  **Tx hash: `0xd40385fcc0cf75de614000642dac3bdd58547fc0ef09cc8041805058a98763e6`**
  (status ACCEPTED).
- **Real `stake_for`, through the actual UI widget** (`/cases/2` →
  `POST /api/claims/2/stake`), 1 GEN on claim 2.
  **Tx hash: `0x2e03d744310f37cc8688629111227e4bee516a6a805863eb3a820f2e33bd9b02`**
  (status ACCEPTED). Confirmed on-chain via a fresh `get_claim` read
  afterward: `stake_for_total` moved from `1.0` (pre-existing, from an
  earlier attempt that had raced the rate limit — see below) to `2.0`.
- **Real `get_passport`**, live: `{"address":"0x1e47d7d7...","win_count":0,
  "loss_count":1,"category_breakdown":{"PRICE_THRESHOLD":{"win_count":0,
  "loss_count":1}},"claim_history":["1"]}` — the actual Build Prompt 8
  poster's real win/loss record.
- **Category A/B separation independently re-confirmed at this layer**:
  `lib/genlayer/client.ts` only ever calls the deployed contract's own
  methods (Category B, real GenVM consensus underneath `create_claim`/
  `lock_deadline_evidence`); nothing in this prompt's API layer touches
  `services/surf_display.py` (Category A) — that module still has no
  frontend surface, per the explicit scope deferral, so there was nothing
  to accidentally conflate here.

### Studio rate limit, hit for real again

Mid-testing, `POST /api/claims/2/stake` hit `Rate limit exceeded: 30
requests per minute` on the receipt-polling step. Per Build Prompt 8's
same non-negotiable, this was not retried blindly — the call was left
alone and re-issued after backing off. The *first* attempt's client-facing
error turned out to be misleading: the underlying `stake_for` transaction
had already been broadcast and was accepted on-chain despite the client
seeing a 502 (the error was in polling for the receipt afterward, not in
submission). The second explicit stake call then also succeeded, so
`stake_for_total` on claim 2 reflects two real 1 GEN stakes (`2.0` total),
not one. Worth knowing for anyone re-running this: a rate-limited error
from this API layer doesn't guarantee the write didn't land — check
`get_claim`/`list_claims` before resubmitting the same action. A second,
separate rate-limit-adjacent hiccup returned an HTML error page instead of
JSON on a `browse-cases` read shortly after (`Unexpected token '<'`); same
handling — backed off, retried once, succeeded.

### Scope note

Relative Performance and Fundamentals Threshold claim types, the appeal UI
(`app/cases/[id]/appeal`), and a dedicated Category A display surface are
explicitly out of scope for this prompt, per the build prompt's own
non-negotiables.

## Build Prompt 10 — Frontend/Backend Wiring, Phase 2

Extends Build Prompt 9's shared layer to Relative Performance and
Fundamentals Threshold create/detail, the appeal UI, and real Category A
wiring in the dashboard. Every new call goes through the same
`lib/genlayer/client.ts` choke point Build Prompt 9 established — no
second calling pattern was added.

### Step 0 findings

1. **`file_appeal`/`resolve_appeal` call shape** (historical, Build Prompt 10):
   `file_appeal` used to be payable with exact `appeal_bond_atto`. **The live
   court is not payable.** `file_appeal(claim_id, tx_hash)` verifies a native
   send to the published treasury. `resolve_appeal`/`expire_appeal` still take
   no value and are permissionless. See `SUBMISSION.md` §5.
2. **Category A in TypeScript, not a Python bridge** — real decision,
   documented in `lib/surf/display.ts`'s header: the frontend is
   Next.js/TypeScript, the endpoints are three plain HTTP calls, and
   bridging to the Python module (spawning a process, an internal RPC)
   would add moving parts for no benefit over a direct `fetch`
   reimplementation. Structural separation preserved the same way the
   Python original enforces it — see "Category A wiring" below.
3. **`get_claim`'s real shape confirmed to differ genuinely per claim
   type**, from real on-chain reads (not assumed): Price Threshold and
   Fundamentals Threshold share `threshold`/`direction`/`posting_price`/
   `deadline_price` (Fundamentals adds `metric`, non-null only for that
   type); Relative Performance instead populates `asset_b`/
   `posting_price_b`/`deadline_price_b` and leaves `threshold`/`direction`
   at their zero/empty sentinel. `claim_type` + `metric`/`asset_b` being
   non-null is exactly how the claim-detail page picks a rendering branch.
4. **Genuine live `CONTESTED` not produced**, per the carried-over Build
   Prompt 8 constraint (forcing real validator disagreement isn't
   reliable, and isn't attempted). Documented honestly below rather than
   claiming otherwise.

### A real bug this prompt's testing caught: false-positive write success

Testing `resolve_appeal`/`expire_appeal` against a real `RESOLVED` claim
(claim 1, expected to correctly reject with `claim is not APPEAL_PENDING`)
instead came back as `{"txHash": "0x8a71...", "status": "ACCEPTED"}` — no
error, a real transaction hash, and nothing in Build Prompt 9's API layer
noticed anything was wrong. Root cause, confirmed by decoding the actual
receipt: `status_name` (`ACCEPTED`/`FINALIZED`) reflects whether the
**transaction reached consensus finalization**, which a cleanly-rejected
`UserError` does exactly as validly as a real success — every validator
correctly agreeing the leader was right to reject the call still
finalizes normally. The real signal is
`consensus_data.leader_receipt[0].result.status === "rollback"`, with
`.payload` holding the decoded revert message
(`"[EXPECTED] claim is not APPEAL_PENDING"` in this case). Fixed once, in
`writeClaim` itself (the shared choke point), so every route gets the fix
for free rather than needing a per-route check. This bug was latent in
every Build Prompt 9 write route too — worth knowing if anything from that
phase needs re-auditing, though the specific BP9 transactions on record
(`create_claim`, `stake_for`) were independently confirmed real via actual
on-chain state changes (new claim IDs appearing, `stake_for_total`
increasing), not just their reported status.

### Bond amount shown before commitment, computed exactly

`file_appeal` requires an *exact* atto match against `appeal_bond_atto`.
The contract already computes and stores that value once, at the moment a
claim goes `CONTESTED` (`_compute_appeal_bond`, 25% of the pool clamped to
[1, 5] GEN) — `get_claim`'s `appeal_bond` field is that real, precomputed
number, shown in `AppealPanel` *before* the "File Appeal" button is ever
clickable, not calculated client-side and not revealed only after
submission. Sending it back as a transaction value needed care: `get_claim`
can only expose `appeal_bond` as a float-divided decimal string (same
Build Prompt 8 discipline as every other numeric field), and round-tripping
that through `parseFloat(x) * 1e18` risks a double-precision rounding
error large enough to fail the contract's exact-match check. Fixed with
`genToAtto()` in `lib/genlayer/client.ts` — exact decimal-string-to-BigInt
arithmetic, no float multiplication anywhere in that path.

### Appeal window: another missing component, filled honestly

Same pattern as Build Prompt 9's missing staking form: no real countdown
timer existed anywhere in the merged app or any raw Stitch export folder
(checked `components/` for `setInterval`/`Date.now` before writing
anything — none). Every "12h 45m" / "14:22:09" in `case_detail_pro_theme`
and `appeal_flow_pro_theme` was static decorative text. Added one real
`components/Countdown.tsx`, reused in both places a countdown is now
needed (`AppealPanel`'s CONTESTED view) rather than building it twice.

### Category A wiring

`lib/surf/display.ts` reimplements `contract/services/surf_display.py`'s
three functions in TypeScript (`getDisplayPrice`, live single-asset;
`getRelativePerformanceDisplay`, two independent calls, no computed
comparison; `getFundamentalsDisplay`, same time-series max-timestamp
picking as the Python original) against the same real Surf endpoints
(`/market/price`, `/market/onchain-indicator`, `/project/defi/metrics`).
`app/api/display/route.ts` is GET-only and the sole caller of that module.
`components/DisplayTicker.tsx` calls only that route from the
`browse-cases` dashboard, shown per `OPEN` claim, labeled distinctly from
the contract-sourced posting/deadline prices.

**Code-level separation check** (not just a claim):
```bash
$ grep -rn "surf/display" lib/genlayer app/api/claims
$ grep -rn "genlayer/client\|genlayer-js" lib/surf app/api/display
```
Both commands return nothing except this file's own prose describing the
rule — `lib/surf/display.ts` and `lib/genlayer/client.ts` are two disjoint
module graphs; no route imports both.

### Real evidence

- **Real `create_relative_performance_claim` through the actual UI form**
  (asset_a `ETH/USD`, asset_b `BTC/USD`): new claim id `3`, state `OPEN`.
  **Tx: `0xf727f2956ecd710ded14b0fd05dee27917e39a15a23d4af69d0ac743c6433de6`**
  (ACCEPTED).
- **Real `create_fundamentals_claim` through the actual UI form** (asset
  `BTC`, metric `MVRV`, threshold `2.0`, direction `above` — `MVRV` is
  one of the three on-chain metrics locked to `asset == "BTC"`, enforced
  both by the contract and disabled/greyed in the form): new claim id `4`,
  state `OPEN`.
  **Tx: `0x10520dcfcc5eaacb16d8e49a10aea9af574eeebc86418899965f1f555981b71a`**
  (ACCEPTED).
- **All three claim-type shapes confirmed rendering distinctly from real
  data** on `/cases/1` (Price Threshold, resolved, shows real verdict
  text and `BROKEN`), `/cases/3` (Relative Performance, shows `ETH/USD`
  vs `BTC/USD` with both assets' posting→deadline prices, no
  threshold/direction section), `/cases/4` (Fundamentals, shows `MVRV`
  as the disputed-threshold label instead of a bare price).
- **Real Category A read**, live, through `/api/display?asset=ETH/USD`:
  `{"asset":"ETH/USD","price":1877.6103248160064,"source":"surf","displayOnly":true}`
  — zero contract calls involved.
- **Appeal routes verified against real, non-`CONTESTED`/non-`APPEAL_PENDING`
  state** (claim 1 is `RESOLVED`): `POST /api/claims/1/appeal` correctly
  rejected client-side (`"claim is RESOLVED, not CONTESTED"`, no
  transaction sent) before the false-positive bug above was found and
  fixed; `POST /api/claims/1/resolve-appeal` and `.../expire-appeal`, after
  the fix, correctly surface the real on-chain revert:
  `{"error":"[EXPECTED] claim is not APPEAL_PENDING"}`. **Genuine live
  `CONTESTED` state was not produced** — per Build Prompt 8's carried-over
  constraint, forcing real validator disagreement isn't reliable on a live
  network and wasn't attempted. The `CONTESTED`/`APPEAL_PENDING`/`REFUNDED`
  branches in `AppealPanel` are verified by code review against the real
  `get_claim` field shapes (`appeal_bond`, `contested_at`, `appeal_outcome`,
  `second_verdict_text`) and by the real revert-path tests above proving
  the underlying routes call the actual contract methods correctly — not
  by an end-to-end run through a live `CONTESTED` claim, which honestly
  wasn't achievable here.

### Scope note

A dedicated appeal-filing page reusing `appeal_flow_pro_theme`'s
standalone layout (`app/cases/[id]/appeal`) was not built — `AppealPanel`
lives inline on the case-detail page instead, since that's where the real
`CONTESTED` state and bond amount are already being read; the standalone
appeal route still shows its original static mock content, unwired.

## Build Prompt 11 — Real Wallet Signing

Replaces Build Prompt 9's server-side funded signer with real per-user
MetaMask (or any injected EIP-1193 wallet) signing for every write action,
keeping the demo signer only as an explicitly-gated local-dev fallback.

### Step 0 findings

1. **Real MetaMask Snap integration, confirmed directly against the
   installed `genlayer-js` source** (`node_modules/genlayer-js/dist/index.js`),
   not assumed: passing `account` to `createClient` as a plain address
   **string** (not an `Account` object from `createAccount()`) is what
   routes signing through `provider: window.ethereum` — confirmed in
   source (`getCustomTransportConfig`'s `isAddress` check). This alone is
   enough for a real write to succeed via standard `eth_sendTransaction`;
   **no Snap is required for it**. `client.connect(network)` is a
   separate, best-effort step that additionally switches/adds the
   wallet's chain and installs a GenLayer-specific Snap
   (`npm:genlayer-wallet-plugin`) via `wallet_getSnaps`/
   `wallet_requestSnaps` — Flask/Snap-capable-MetaMask-only, and
   confirmed (see below) to fail gracefully on any wallet that doesn't
   support it, without blocking anything.
2. **Provider Court's `lib/genlayer-wallet.ts`/`lib/store.tsx`/
   `lib/chain-client.ts` checked directly and confirmed to be their real,
   already-shipped implementation** (not a deferred/demo state) before
   reusing their structure here: real `createClient({chain, account:
   address, provider})`, a real `requireSigningPath()` demo-vs-wallet
   dispatcher, and a real server-side `requireDemoSigningEnabled()`
   boundary independent of the frontend's own flag. This project's
   `lib/genlayer/wallet.ts`, `lib/store.tsx`, and `lib/genlayer/actions.ts`
   mirror that structure directly, adapted to this contract's own methods.
3. **Snap availability**: not something a visitor installs from a normal
   MetaMask install — `wallet_requestSnaps` is rejected outright by
   non-Flask MetaMask (confirmed via a real scripted failure, see
   "Snap-not-installed" below). Since real signing doesn't depend on it
   (finding 1), this app never blocks or prompts a user to install it —
   it's shown as an optional, informational status only
   (`WalletChip`'s dropdown), not a gate.

### Architecture: where signing actually happens

Real per-user signing cannot happen in a Next.js API route — the server
has no access to a visitor's MetaMask. `lib/genlayer/actions.ts` is the
one dispatcher every write UI component calls (`StakeForm`, `post-a-claim`,
`AppealPanel` — no component calls `fetch` on a write route or
`getWalletWriteClient` directly itself):
- **Wallet connected**: signs and submits directly from the browser via
  `lib/genlayer/wallet.ts`'s `getWalletWriteClient(address)`
  (`createClient({chain, account: address, provider: window.ethereum})`),
  using Build Prompt 10's revert-detection fix ported to the browser
  (`waitFinalizedInBrowser`).
- **No wallet connected, demo signing allowed**: falls back to the
  existing `/api/claims/...` routes from Build Prompts 9/10, which are
  now gated server-side.

### Demo signing: off by default, real security boundary is server-side

Two flags, mirroring Provider Court's pattern exactly:
- `NEXT_PUBLIC_ALLOW_DEMO_SIGNING` — frontend-only; controls whether
  `lib/genlayer/actions.ts` *offers* the demo fallback when no wallet is
  connected. A connected wallet always signs for itself regardless of
  this flag.
- `ALLOW_DEMO_SIGNING` — server-only (no `NEXT_PUBLIC_` prefix, never
  reaches the client bundle), the real enforcement. `lib/genlayer/client.ts`'s
  `getDemoClient()` refuses to hand out a signer at all unless this is
  exactly `"true"`, independent of anything the frontend sent.

Both default to `"false"` in `.env.example` — a deployment that copies it
as-is has demo signing fully disabled. **Verified against the real
running server, not just read from source**: with `ALLOW_DEMO_SIGNING`
unset, `POST /api/claims` returned
`{"error":"[EXPECTED] demo signing is disabled on this deployment -- connect a real wallet to continue"}`
with no transaction sent. Local dev (`.env.local`, gitignored) sets both
to `"true"` for convenience, since no real MetaMask is available in this
environment for the project's own automated verification below.

### Real evidence

No real MetaMask extension exists in this environment, so real signing
was verified with a real Chromium browser (Playwright, already a
devDependency) driving the actual running app, with a real
EIP-1193-compatible `window.ethereum` injected via
`page.exposeFunction` — every `request()` call the app makes crosses that
real interface exactly as it would for genuine MetaMask, and is handled
by a Node-side function that does real signing and broadcasting (via
`viem`) with an **independently-generated keypair**
(`0x186220CA03aD4805bDF2C33A3236FA565f306ecA`), never the demo signer
(`0x374D46E81973dd8797f14f586AEE94AaC27e39A3`) or the original Build
Prompt 8 deploy account. Funded with a plain 3 GEN transfer from the demo
signer (ordinary value transfer, unrelated to the write-path code being
tested). All four required write actions, checked individually:

- **`create_claim`**, through the real UI (`/post-a-claim`): connect
  wallet → fill Price Threshold form → Submit. Real signed tx:
  `0x89813436ec6dfc4fdb436e0d44ffa527fe90b81527e2074faed8bf2dd85f61e4`.
  Confirmed on-chain: new claim `5`, `poster` field is
  `0x186220CA...` — the test wallet's own address, not the demo signer's
  — proving real per-user identity flows through end to end, not just a
  successful transaction.
- **`stake_for`**, through the real UI (`/cases/2`, `/cases/3`): two
  separate real signed txs,
  `0xfae9ad0f6574a32a95fb55888cda144588b29fdde145b0204d7bdbb3dda1bf25` and
  `0x54dd5022046ebf855936b193c818298753b554cdba7592426e956434731c059e`.
  Confirmed on-chain via a follow-up `get_claim` read: claim 2's
  `stake_for_total` moved `2.0 → 3.0`.
- **`stake_against`**, through the real UI (`/cases/3`), explicitly
  checked separately rather than assumed from `stake_for`: real signed
  tx `0x455923cbb9b8c3c62be894e7255e6fce9b156c4944eb7f8d121b522e5ba28df1`,
  contract method confirmed in the decoded calldata (`"method":
  "stake_against"`).
- **`file_appeal`**: wired through the identical dispatcher and
  code-reviewed (exact `genToAtto` bond arithmetic re-verified, same as
  Build Prompt 10), but **not fired against a genuine live `CONTESTED`
  claim** — same honest limitation as Build Prompt 10, now true for the
  wallet-signing path too, since forcing real validator disagreement
  isn't reliable on a live network and wasn't attempted here either.

A real, non-scripted revert was hit along the way and handled correctly:
one `create_claim` attempt used a deadline that had already passed by
the time consensus actually ran (a test-harness timezone bug, not an app
bug — filling `<input type="datetime-local">` needs the *browser's*
local time, and this Chromium's default locale is `Asia/Calcutta`, not
UTC). The app correctly surfaced `[EXPECTED] deadline must be in the
future` as a real error with **no false "Claim created" success shown** —
independent confirmation that Build Prompt 10's revert-detection
discipline (`waitFinalizedInBrowser`, ported from the server-side fix)
works correctly on the browser-signing path, not just the server one.

### Snap-not-installed and user-rejects-signing, both demonstrated for real

Using the same injected-provider harness:
- **Snap not installed**: `wallet_requestSnaps` made to throw (`"The
  method wallet_requestSnaps does not exist / is not available"`,
  matching a real non-Flask MetaMask's actual rejection). Result: connect
  still completes successfully, wallet shows connected — confirming
  Step 0 finding 1 for real, not just from reading source. `WalletChip`
  shows a non-blocking "GenLayer Snap not detected — optional, all
  actions still work without it" note in this state, rather than staying
  silent about it or gating anything on it.
- **User rejects signing**: `eth_sendTransaction` made to reject with a
  real MetaMask-shaped error (`code: 4001`, `"User rejected the
  request."`). Result: `StakeForm` shows the real rejection message
  (`"An unknown RPC error occurred. Details: User rejected the
  request."`); the "Confirmed. Tx:" success state was explicitly checked
  and confirmed **not** shown — no false-success reporting, matching the
  non-negotiable exactly.

### Scope note

`resolve_appeal`/`expire_appeal` (permissionless, no sender check on
either) were also wired through the same `lib/genlayer/actions.ts`
dispatcher for consistency, even though the build prompt's own
non-negotiable only named the four sender-identity-bound actions above.
Not independently fired live for the same `CONTESTED`-state reason as
`file_appeal`.

## Pre-Launch Audit

A systematic sweep of the whole app, not a re-verification of individual
features (those are covered above). Covers all 8 requested areas; each
item below is marked **fixed**, **flagged for follow-up**, or **checked,
clean**, with real evidence — no "probably fine."

### 1. Routing/navigation

- **Fixed — duplicate nav entry.** `AppShell.tsx`'s sidebar had two
  separate items, "Profile" (`account_circle`) and "Passport"
  (`vignette`), both pointing at `/alpha-passport`. Checked against the
  raw Stitch export (`alpha_passport_pro_theme/code.html`) before
  assuming it was a merge-time bug — it wasn't; the original design
  genuinely has two distinct sidebar items with placeholder `href="#"`
  each. But this app only has one page for that concept, so showing two
  identically-destined links side by side is a real, confusing gap on
  its own. Dropped "Profile", kept "Passport" (matches the page's own
  content and the top-nav's label). Verified live:
  `grep -c "Profile"` → `0`, `grep -c "Passport"` → `1` on the rendered
  `browse-cases` page.
- **Fixed — dead links to nonexistent claims.** `activity/page.tsx`
  linked to `/cases/492` and `/cases/893c99`, ids that never existed on
  the deployed contract. Folded into the Activity rewrite below (real
  claims, real ids, real links).
- **Checked, clean — `/system-states` and `/wallet-connect`.** Both
  exist outside the nav, on purpose per their own source comments (a
  design-system showcase page and a standalone wallet-modal demo route,
  respectively) — not forgotten pre-wiring. **Flagged for follow-up,
  not fixed here:** neither is gated in any way; both are publicly
  reachable in a real deployment. Low severity (no data, no write
  capability) but worth a decision before a real public launch — either
  remove them from the production build or leave them as intentional
  `/dev`-style routes.
- **Checked, clean — every other real route reachable, back-navigation
  intact.** `/`, `/browse-cases`, `/activity`, `/my-claims`,
  `/leaderboard`, `/alpha-passport`, `/post-a-claim`, `/how-verdicts-work`,
  `/cases/[id]` all return 200 live; `/cases/999` (nonexistent id) now
  returns a real 404 (see area 4) instead of crashing.
- **Fixed — two `<a href="/">` full-page-reload home links** (in
  `MarketingNav.tsx` and `app/page.tsx`'s footer), caught by
  `next/next/no-html-link-for-pages` lint, not by manual sweep — swapped
  for `next/link`. Minor (degraded nav perf, not broken), fixed since it
  was already flagged and cheap.

### 2. Real vs. placeholder content sweep

Three entire pages, all reachable from primary navigation, were **100%
static Stitch mock content** — not leftover forms or a missing widget
(Build Prompts 9/10's findings), but every card, every number, every
name on the page fabricated, never touched by any prior build prompt:

- **`/activity`** — two hardcoded fake disputes. Real bugs inside the
  mock content itself, not just "it's fake": stakes shown in **"1,250
  ETH"** (this protocol's unit is GEN, never ETH, anywhere else in the
  app) and a verdict labeled **"UPHELD"** — a real term from an early
  build prompt's outcome vocabulary that Build Prompt 4 explicitly
  collapsed into HELD/BROKEN only (see this repo's `contract/README.md`,
  "architecture consequence" note); it had quietly survived only here.
  **Fixed**: real claims (newest first, via a new shared
  `lib/genlayer/claims.ts`), real GEN amounts, real state labels, a real
  ticking countdown (reused `Countdown.tsx`, not a new one), claimant
  links to their real Passport.
- **`/leaderboard`** — three fake names/addresses/win rates
  (`0xAlpha...9f2`, 94.2%, 1,204 claims) that never existed on-chain.
  **Fixed**: real ranking via a new `lib/genlayer/leaderboard.ts` —
  since the contract has no single "list every passport" method, this
  derives the real candidate set from every unique poster across every
  real claim, then a real `get_passport` read per address, sorted by win
  rate. Also fixed the "View Passport" link, which pointed every row at
  the same generic `/alpha-passport` regardless of which row it was on
  (same unscoped-link bug pattern as item 1) — now
  `/alpha-passport?address={that row's real address}`. Removed a
  non-functional "Load More Data" button — there was no pagination logic
  behind it and every real result is already shown.
- **`/my-claims`** — covered in area 3 below; this one is a data-scoping
  bug, not just stale copy.

**Checked, clean** — the AAVE/MVRV stale-example concern named in this
prompt: `grep -rn "AAVE"` across `web/` found nothing; across
`contract/` found two hits, both in **historical** explanation of a
real, already-resolved spec/API conflict (correctly framed as past
context, not current guidance). No stale claim-type example presented
as valid anywhere. `how-verdicts-work`'s explainer copy checked and
matches the real architecture (claim → Surf evidence → leader verdict →
validator consensus → outcome/appeal) — illustrative, not fabricated
data, nothing to fix.

**Flagged for follow-up, not fixed here**: footer "Legal Terms / Court
Protocols / API Access / Security Audit" links (`browse-cases`,
`leaderboard`, `app/page.tsx`) are still `href="#"`. No such pages were
ever speced to exist — this is standard placeholder footer chrome, not a
functional gap, but should be resolved (real pages or removed) before a
real public launch.

**Fixed in a follow-up pass** (initially flagged here as the landing
page's "STAKE NOW" buttons linking to `/leaderboard` instead of
`/browse-cases`): closer inspection showed the flagged assumption itself
was wrong. Both CTAs sit inside a section explicitly titled "COMMUNITY
CONSENSUS / LEADERBOARD" (confirmed via the section's own `{/* BEGIN:
Leaderboard / Progress */}` comment, a season-countdown, and "STAKERS"
progress bars matching the real leaderboard page's own concept) — the
destination `/leaderboard` was already correct and intentional, not a
stale link. The real bug was the button *label*: "STAKE NOW" promises an
action `/leaderboard` cannot fulfill (it's read-only, no stake button
exists there at all — confirmed directly against that page's own real
implementation above). Confirmed against the page's other CTAs for the
right convention (e.g. "VIEW ALL" → `/browse-cases`, in the same file,
label matching destination capability) and relabeled both occurrences to
"VIEW LEADERBOARD" rather than redirecting the link, which would have
broken the section's own established context. Verified via a real
Playwright click-through: CTA → `/leaderboard` → real rankings page
renders.

### 3. Data scoping correctness

**Fixed — the central finding of this audit.** `/my-claims` showed the
exact same three fake claim cards to every visitor regardless of
connected wallet — not just stale copy, a page whose entire stated
purpose ("MY claims") failed to do the one thing it claims to do. Same
shape of bug as Provider Court's unfiltered buyer dashboard, called out
by name in this prompt's own context.

First fix attempt used `get_passport(address).claim_history` — real,
per-address, contract-exposed data, looked correct. **Verified wrong**
before shipping it: `claim_history` is only ever appended by
`_record_passport`, which the contract calls exclusively from
`resolve_verdict`'s `RESOLVED` branch, `resolve_appeal`, and
`expire_appeal` — never from `create_claim`. A wallet's still-`OPEN`
claims (the most common real case for an active claimant) would never
appear, silently telling a real user they'd posted nothing. Caught by
testing against the real Build Prompt 11 test wallet
(`0x186220CA03aD4805bDF2C33A3236FA565f306ecA`), which has a real `OPEN`
claim (#5) that this approach failed to show — confirmed via
`curl .../api/passport/0x1862...` returning `"claim_history":[]` despite
that wallet genuinely holding claim 5.

**Real fix**: filters the full real claim list (`GET /api/claims`,
already used by `browse-cases`/`activity`) by `poster === connected
address` — covers every state, not just terminal ones. **Re-verified
live** with the same Playwright + real-signing harness from Build Prompt
11 (independent keypair, not the demo signer): connects, and the page
correctly renders `CLAIM #5 · OPEN · ETH/USD above 3000.0`. Disconnected
state shows "Connect your wallet to see the claims you've posted" (not
mock data, not another wallet's data) — confirmed live via `curl` with
no wallet session.

**Checked, clean** — `/alpha-passport` was already real (Build Prompt
9), scoped by an explicit `?address=` query param with no default that
leaks a "current user" concept incorrectly; a genuinely fresh,
never-used address (`0x000...dEaD`) renders a clean zero-state (`N/A`
win rate, "No resolved claims yet", "No claims yet") rather than
crashing or showing stale/other data.

### 4. Error handling for real visitors

- **Fixed — no error boundary existed anywhere in the app.** Confirmed
  for real: `curl /cases/999` (a claim id that doesn't exist) crashed
  straight to Next's raw default error page
  (`<html id="__next_error__">`, zero app chrome) instead of anything a
  visitor could make sense of. Added `app/error.tsx` (friendly,
  branded, "Try again" + "Browse Dockets", logs the real error
  server-side only, never shown to the visitor) and `app/not-found.tsx`.
  `cases/[id]/page.tsx` now calls `notFound()` on any `get_claim`
  failure — confirmed **for real** (not assumed) that a reverted view
  call's error from `genlayer-js` is a generic `"execution failed"` /
  `"Missing or invalid parameters"`, never carrying the contract's own
  decoded `"[EXPECTED] unknown claim_id"` text the way a write's revert
  does — so a bad id can't be reliably told apart from a transient RPC
  failure by message content alone; documented plainly in code rather
  than pretending a clean split exists. Live re-check: `/cases/999` now
  returns a real `404` with the friendly not-found page.
- **Fixed — two API routes had no error handling at all**, inconsistent
  with every write route: `GET /api/claims` and
  `GET /api/passport/[address]`. A Studio rate limit or connect timeout
  (both hit for real, repeatedly, across this project's own testing)
  surfaced as a bare unhandled 500 with no JSON body on these two
  specifically. Added matching `try/catch` → `{error}` JSON, same
  pattern already used everywhere else.
- **Fixed — the rate-limit "backoff behavior" this prompt asked to
  verify turned out not to exist as real app code at all.** Re-checked
  directly rather than assumed: every prior "backoff" in this project
  (Build Prompts 8-10) was a human manually waiting between `curl`
  commands during testing, never code shipped in the app. Meanwhile this
  project's own testing hit three distinct real transient Studio
  failures across Build Prompts 8-11 and again during this very audit
  (a rate limit mid-receipt-poll, a connect timeout, an HTML error page
  returned instead of JSON) with nothing in the app retrying any of
  them. Checked how Provider Court's own shipped code
  (`lib/rpc-retry.ts`) handles this — confirmed real or already
  battle-tested against the same Studio infrastructure — and ported the
  same three confirmed-real failure patterns into a new
  `lib/genlayer/rpc-retry.ts`, wired into `readClaim` (server reads) and
  the receipt-polling step of both `writeClaim` (server demo path) and
  `waitFinalizedInBrowser` (real wallet path) — reads and polling only,
  **never** the write submission itself, so there's no double-send risk
  added anywhere.

### 5. Empty-state handling

- **Checked, clean** — `browse-cases` ("No claims on the contract
  yet."), `alpha-passport` (zero-state confirmed live above).
- **Fixed as part of area 3** — `my-claims` now has three real, distinct
  empty states: not connected, connected with zero claims (with a "Post
  a Claim" CTA), and a real loading state — previously just showed fake
  data unconditionally.
- **Fixed as part of area 2** — `leaderboard` now shows "No claims have
  resolved yet" when the derived ranking is empty, instead of always
  rendering three fixed fake rows regardless of real data.

### 6. Security/secrets hygiene

- **Checked, clean.** `web/.env.example` vs `.env.local`: every real
  secret (`ALPHA_COURT_SIGNER_PRIVATE_KEY`, `SURF_API_KEY`) is present
  only in the gitignored `.env.local`; `.env.example` has them blank.
  `NEXT_PUBLIC_ALLOW_DEMO_SIGNING`/`ALLOW_DEMO_SIGNING` already confirmed
  safe-by-default in Build Prompt 11 — re-confirmed here, not just
  assumed to still hold.
- **Checked, clean.** No real secret values (the demo signer's private
  key, the Build Prompt 11 test wallet's private key, the Surf API key)
  found anywhere outside `.env.local`, checked with a direct content
  search across `web/` and `contract/` (excluding `node_modules`), not
  just a directory-name assumption.
- **Fixed — `contract/` had no `.gitignore` at all.** Added one
  (`__pycache__/`, `.pytest_cache/`, `artifacts/`, `.env*`). No secrets
  were found inside anything it now excludes, but a from-scratch `git
  init` on that directory (mentioned as a real near-term step in this
  project's history) would otherwise have had no protection at all.
  Also removed an empty leftover `contract/scratch_repro/` directory
  from Build Prompt 8's GLSim repro work (already emptied; the directory
  itself just hadn't been cleaned up).
- **Note**: neither `contract/` nor `web/` is currently an actual git
  repository (`git status` → "not a git repository" in both) — so "no
  leaked secrets in git history" has no history to check yet. The
  content-search and `.gitignore` fixes above are what actually matters
  before that history starts.

### 7. Toggle/flag audit

Searched `web/app`, `web/lib`, `web/components` for `TODO`/`FIXME`/`HACK`
and for any `process.env.*` reference, to make sure nothing beyond
`NEXT_PUBLIC_ALLOW_DEMO_SIGNING`/`ALLOW_DEMO_SIGNING` was missed. Result:
those are the only two toggles in the codebase. No stray debug flags, no
`TODO`s, nothing else to audit here — **checked, clean**, not assumed
clean because Build Prompt 11 already covered "the demo-signing flag."

### 8. Documentation consistency

- **Checked, clean** — network naming (`studionet`, chainId `61999`) is
  consistent across `web/.env.example`, `web/README.md`, and every
  `lib/genlayer/*` source comment; no stray `testnet-asimov`/
  `testnet-bradbury`/mainnet references found.
- **Checked, clean** — the AAVE/MVRV stale-example concern, covered in
  area 2 above.
- **Checked, clean** — bond/window numbers shown in the UI
  (`AppealPanel`'s "25% of pool, clamped 1-5 GEN", the 48-hour appeal
  window, `StakeForm`'s "1-10 GEN" range) all matched directly against
  the real contract constants (`APPEAL_BOND_PCT_NUM = 25`,
  `APPEAL_BOND_FLOOR_ATTO`/`CEIL_ATTO` = 1/5 GEN,
  `APPEAL_WINDOW_HOURS = 48`, `MIN_STAKE_ATTO`/`MAX_STAKE_ATTO` = 1/10
  GEN) — no drift found.
- **Confirmed still accurate** (not a new finding, per this prompt's own
  instruction to distinguish that): the standalone
  `app/cases/[id]/appeal` page is still documented in this file's Build
  Prompt 10 section as unwired static mock content, superseded by the
  inline `AppealPanel` on the case-detail page — re-checked, still true,
  still accurately described.

## Build Prompt 12 — Real Incident: Submission Succeeded, Confirmation Didn't

During manual testing (a real Price Threshold claim, `SUI/USD` at
`0.6882`), the UI showed
`Error: An unknown RPC error occurred. Details: Failed to fetch` after
clicking Submit. Investigation found two real, connected problems, both
fixed:

### What actually happened

The error came from the **receipt-confirmation poll**
(`eth_getTransactionByHash`, called by `waitForTransactionReceipt` after
signing/broadcast already succeeded), not from signing or submission
itself. Checked the real contract state directly: **claim #6 existed**,
`SUI/USD, threshold 0.6882, above, OPEN` — the transaction had genuinely
succeeded. The UI had no way to tell "confirmation failed after a real
success" apart from "nothing was ever submitted," and retrying in that
state would have created a real duplicate claim.

### Fix 1 — wider retry budget for post-submission confirmation

The pre-launch audit's retry budget (`withTransientRetry`, 4 attempts,
~10.5s of backoff) wasn't long enough to ride out whatever blip caused
this. Widened the general default to 6 attempts / ~62s, and added a
separate, more patient budget specifically for **post-submission**
confirmation polling (`PATIENT_CONFIRMATION_ATTEMPTS = 7`,
`PATIENT_CONFIRMATION_BASE_DELAY_MS = 2000`, ~126s) — used by both
`writeClaim`'s receipt poll (server demo path) and
`waitFinalizedInBrowser` (real wallet path). Deliberately more patient
than the general-purpose default: a false "it failed" here risks a real
duplicate submission if the visitor retries, which a slower-but-honest
wait does not.

### Fix 2 — a real error type for "submitted but unconfirmed"

Even a wider budget can still be exhausted by a long enough real outage,
so the underlying ambiguity needed fixing too, not just made less likely.
Added `UnconfirmedSubmissionError` (`lib/genlayer/errors.ts`, isomorphic)
— thrown specifically when a write's submission already produced a real
tx hash but the confirmation poll then failed even after the patient
retry budget. Wired through the whole write surface, not just the one
flow that surfaced it:
- **Server demo path** (`lib/genlayer/client.ts`'s `writeClaim`): thrown
  directly; every write API route's catch block (`api-error.ts`'s new
  `apiErrorResponse` helper) returns `{error, txHash, unconfirmed: true}`
  instead of a bare error string.
- **Real wallet path** (`lib/genlayer/wallet.ts`'s
  `waitFinalizedInBrowser`): thrown directly, used by all five
  wallet-signed actions in `lib/genlayer/actions.ts`.
- **Demo path reconstruction** (`actions.ts`'s `jsonOrThrow`): rebuilds
  the same error type from the API's JSON response, so every UI
  component checks exactly one error type regardless of which path
  signed.
- **UI**: `StakeForm`, `post-a-claim`'s create-claim flow, and
  `AppealPanel` (all three actions, via a shared `handleResult` helper)
  all render this distinctly from a plain error — an amber warning
  showing the real tx hash and telling the visitor to check the claim's
  real state (not retry blindly) — and lock their submit controls while
  in that state, so a visitor can't immediately fire a second, duplicate
  submission from the same warning screen.

### Real evidence

- **The core logic verified directly**, not just by re-reading it: ran
  the actual `withTransientRetry`/`UnconfirmedSubmissionError` code
  (imported from the real files, small attempt count to run in seconds)
  against a fake poll that always throws `"Failed to fetch"` — correctly
  retried the specified number of times, then threw
  `UnconfirmedSubmissionError` carrying the real hash and a clear
  message. Separately confirmed `isTransientError` returns `true` for
  `"Failed to fetch"`/rate-limit messages and **`false`** for a genuine
  on-chain revert (`"[EXPECTED] claim is not APPEAL_PENDING"`) and for an
  unrelated generic error — the retry logic doesn't swallow real reverts
  or misfire on arbitrary errors.
- **Both signing paths re-verified end-to-end with real transactions**
  after these changes (every write action shares this code, so both
  needed re-checking, not just the one that surfaced the bug):
  demo-signed `create_claim` (`SOL/USD`, threshold `150`) —
  `0x8c3a8fd1dc4d7f678a285b604df37649de8e250b2ee4f572b7c5bf9611278db0`;
  real-wallet-signed `stake_for` (same Playwright + injected-provider
  harness as Build Prompt 11, independent keypair) —
  `0x6c829ece86ecc3f7e1d6ccaa951368da12defa297dcd2d2727780578eb3da75f`.
- **The widened retry budget's real value was observed directly, not
  just assumed**: a rapid test burst during this same session genuinely
  triggered Studio's real rate limit five times in a row (`GenLayer RPC
  error (gen_call): Rate limit exceeded: 30 requests per minute`, visible
  in the dev server's own log); `/leaderboard`'s read (the heaviest
  single page, aggregating multiple `get_passport` calls) hit this
  directly and still returned `200` after retrying for 71 real seconds,
  instead of failing.

### Scope note

This was investigated and fixed as a live bug report during manual
testing, not a scheduled build prompt — no other app logic was touched.

## Build Prompt 13 — Real Incident: "Shows to Do It Again," Link "Doesn't Route"

A second live bug report from the same manual-testing session, right
after Build Prompt 12: after a successful `create_claim`, the Submit
Claim button stayed fully active with the just-submitted values still in
the form (looked like an invitation to resubmit), and clicking "View on
Browse Dockets" appeared to do nothing.

### What was actually two different things

1. **Real bug, confirmed directly in code**: `disabled={status.kind ===
   "pending" || status.kind === "unconfirmed"}` never included `"done"`
   — after a real success, the button (and every form field) stayed
   fully interactive. Nothing stopped a visitor from clicking Submit
   again with the same values, which would have created a real duplicate
   claim.
2. **Not actually a broken link — confirmed by testing it three ways**:
   a normal click, a forced click, and a native `element.click()` on the
   raw DOM anchor all showed the URL not changing within a couple of
   seconds. But testing again with a realistic wait (`page.waitForURL`,
   120s timeout) showed the navigation **did complete — after 71.8
   seconds**, because Studio's real rate limit (self-inflicted by this
   session's own heavy testing, visible directly in the dev server log:
   `Rate limit exceeded: 30 requests per minute`, five times in a row)
   was throttling `/browse-cases`'s real data fetch, and Build Prompt
   12's retry logic was correctly retrying through it. With zero loading
   feedback during that wait, a real 71-second success looked identical
   to a dead link.

### Fixes

- **`post-a-claim/page.tsx`**: the Submit button now also disables (and
  relabels to "Claim Created") once `status.kind === "done"`, and every
  form field locks too — matches the pattern `StakeForm`/`AppealPanel`
  already used for the `"unconfirmed"` state (Build Prompt 12), now
  extended to plain success too.
- **`app/loading.tsx`** (new, didn't exist anywhere in the app before
  this): Next.js's App Router shows this automatically during any route
  transition where the destination segment's data fetch hasn't resolved
  yet — no per-page wiring needed. Turns a silent, multi-second-or-longer
  wait into a visible spinner instead of a frozen-looking page.

### Real evidence

- **The button fix, live**: submitted a real claim (`DOGE/USD`) through
  the actual UI. After success: `button:has-text("Claim Created")` is
  visible and disabled; the asset input (and by extension the rest of
  the locked form) is disabled.
- **The link was never actually broken**: same real claim's "View on
  Browse Dockets" click completed navigation in **502ms** once the
  self-inflicted rate-limit window had cleared — confirming the
  suspected root cause (real rate-limit-induced slowness plus zero
  loading feedback, not a routing bug) rather than guessing.

### Scope note

Also a live bug-report fix, not a scheduled build prompt. `loading.tsx`
is global (applies to every route without a more specific one of its
own) rather than added per-page, since the underlying cause (a real data
fetch taking longer than expected) applies to every route that reads
from the contract, not just this one.

## Build Prompt 14 — Whole-app lifecycle: lock, resolve, and the leftover holes

A "Sybil Court"-style pass over the whole app after Build Prompt 13:
create/stake worked, but the court itself could not finish a case, several
pages still lied with leftover mock chrome, and a few real write/read
bugs would make a successful transaction look like it never happened.

### The actual hole: claims could not settle

`lock_deadline_evidence` and `resolve_verdict` existed on the deployed
contract and were exercised in Build Prompt 8's live Studio run, but
**no UI, no action, and no API route called them**. After the deadline a
claim sat in `OPEN` forever. Staking never closed. No verdict, no
appeal, no passport write. That is the "tx is broken everywhere" report
in one missing panel.

Fixed:

- `lib/genlayer/actions.ts` — `lockDeadlineEvidence` / `resolveVerdict`,
  same wallet-vs-demo dispatcher as every other write.
- `POST /api/claims/[id]/lock-deadline` and
  `POST /api/claims/[id]/resolve-verdict` for the demo-signing path.
- `components/LifecyclePanel.tsx` on the case-detail page:
  - `OPEN` + deadline in the future → real countdown.
  - `OPEN` + deadline elapsed → **Lock Deadline Evidence**.
  - `EVIDENCE_LOCKED` → **Resolve Verdict**.
- Both buttons lock on success / unconfirmed (same discipline as
  post-a-claim / AppealPanel) and `router.refresh()` so the page shows
  the new state instead of a stale server render.

### Other real bugs this pass closed

- **Stale pages after a successful write.** Next.js App Router will
  statically cache a server render unless told not to. `readClaim` now
  calls `connection()` so every contract read is request-time. Combined
  with `router.refresh()` after stake / appeal / lock / resolve, a real
  success updates the numbers on the page that produced it.
- **Deadline timezone (again).** The post-a-claim default still used
  `toISOString().slice(0, 16)` (UTC) in a `datetime-local` (local) field
  — the exact Build Prompt 11 harness bug, still in the shipped form.
  Defaults now go through `toDatetimeLocalValue` (local wall-clock).
  Client also rejects a deadline already in the past, a non-numeric
  threshold, A==B relative assets, and a posting stake that isn't 0 or
  1–10 GEN, so those don't waste a real transaction.
- **Rate-limit self-DDoS.** `GET /api/claims`, `getAllClaims`, and the
  leaderboard used `Promise.all` over every `get_claim` / `get_passport`.
  That is how this project's own testing kept hitting Studio's 30/min
  cap and turning a real navigation into a 70-second "dead link." All
  three now go through `mapPool(..., 2)`.
- **Browse Dockets titles.** Relative Performance cards rendered
  `{asset} {direction} {threshold}` with the last two empty. Shared
  `claimTitle()` now used by browse-cases, activity, my-claims, and case
  detail.
- **Appeal form stayed live after a successful file.** `AppealPanel`
  only locked on `pending` / `unconfirmed`, so "File Appeal" could be
  clicked again and revert. Locks on `done` now, then refreshes.
- **Stake amount `NaN`.** `parseFloat("")` went straight to
  `genFloatToAtto` → `BigInt(NaN)`. Validated 1–10 before submit;
  totals refresh after a real stake (restaking is still allowed — the
  contract accumulates).
- **Post-a-claim step 2 had no wallet chrome.** The form that actually
  signs lived outside `AppShell`, so a visitor on step 2 could not
  connect a wallet. Both steps now share the shell. Success also links
  to `/cases/{id}` when the receipt's return value is a claim id.
- **`/cases/[id]/appeal` was still the raw Stitch mock** (fake case
  `#8924-A`, fake 1,000 GEN bond, static `12h 45m`). Redirects to the
  live case, where `AppealPanel` is.
- **Passport defaulted to a hardcoded deploy account.** Visiting
  `/alpha-passport` with no query showed someone else's record as if it
  were yours. No default now; a connected wallet is filled in via
  `PassportAddressGate`, otherwise a look-up empty state. Claim history
  uses `next/link`.
- **My Claims swallowed API errors.** A 502 `{error}` from Studio was
  treated as "this wallet has posted nothing." Surfaces the error now.
- **Sidebar `OPERATOR_01` / `TRUST_SCORE: 98.4`** was leftover mock.
  Replaced with the connected wallet (or a connect prompt).
- **Leaderboard `24:00:00 Current Season Ends`**, a working-looking
  Adjudicators toggle, and Season 4 / Last 30 Days options were all
  decorative. Replaced with the real ranked-claimant count; adjudicators
  disabled with an honest title; time filter is All Time only.

### Real evidence

Ran against the live deployed contract through the running app
(`http://localhost:3000`), not mocked:

- **Claim 16** was `OPEN` with a deadline already in the past
  (`2026-08-14T18:49:00Z`, DOGE/USD above 3000). The case page rendered
  **Lock Deadline Evidence** (not a countdown, not a dead end).
- **`lock_deadline_evidence`** via `POST /api/claims/16/lock-deadline`:
  tx `0xb65f186dc98779b17e597e18d8ac7dcec1af7ae83969203230d3791491796231`
  (ACCEPTED). Follow-up `get_claim`: `state: EVIDENCE_LOCKED`, real
  deadline snapshot `0.07347236188030923`.
- **`resolve_verdict`** via `POST /api/claims/16/resolve-verdict`:
  tx `0x010a411668b52971b8fdbc21f89732b56e0539f2102866d7319dabf675e83bed`
  (ACCEPTED). Follow-up `get_claim`: `state: RESOLVED`,
  `consensus_result: BROKEN`, real cited verdict text naming both
  snapshot prices and the 3000 threshold. Case page then showed
  RESOLVED / BROKEN / Verdict and no longer offered lock/resolve.
- **Revert path still honest**: a second lock on the now-RESOLVED claim
  returned `{"error":"[EXPECTED] claim is not OPEN"}` — not a false
  ACCEPTED hash.
- **Browse Dockets** titles now include the Relative Performance `vs`
  form (confirmed `vs BTC` + `RELATIVE PERFORMANCE` on the live page).
  Sidebar no longer shows `OPERATOR_01` / `TRUST_SCORE: 98.4`.
- **`/cases/16/appeal`** no longer serves the fake `#8924-A` / 1,000 GEN
  mock; the response carries a Next.js redirect to the live case.
- **`/alpha-passport`** with no query is the look-up empty state
  (`ALPHA PASSPORT` + look up), not a hardcoded deploy-account record.

### What this does not claim

Genuine live `CONTESTED` still cannot be forced on Studio (same
constraint as Build Prompts 8/10/11). `AppealPanel`'s CONTESTED /
APPEAL_PENDING / REFUNDED branches remain code-reviewed against the
real `get_claim` shape and the real revert paths, not an end-to-end
forced-disagreement run.
