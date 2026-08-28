# <img src="web/public/brand/mark-192.png" width="36" height="36" alt="" /> Alpha Court

**On-chain prediction court on GenLayer.** Post a claim, stake GEN for or against it, lock Surf evidence at the deadline, and settle with validator consensus.

[![License: MIT](https://img.shields.io/badge/License-MIT-bd00ff.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg)](https://nextjs.org)
[![GenLayer](https://img.shields.io/badge/GenLayer-Studio-c7f300.svg)](https://www.genlayer.com)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-white.svg)](https://vercel.com)

**Live demo:** [alpha-court.vercel.app](https://alpha-court.vercel.app)

Live Studionet court (chain `61999`): [`0x0312c04cA7a5D29025f01d9487e62Fb4fe182C04`](https://studio.genlayer.com)

Deposit address is the court itself (`treasury = SELF`). Users send GEN here; the contract verifies the transfer by hash and pays winners from that same balance.

Alpha Court is a prediction-market court. A claim is a timed, staked question about the world. Validators freeze public evidence at the deadline and try to agree **HELD** or **BROKEN**. If they cannot agree, the claim is **CONTESTED**: a 48-hour appeal window, then a second consensus round or a refund.

---

## At a glance

- **The loop:** post a claim → others stake GEN for or against it → at the deadline, evidence gets frozen → GenLayer validators reach consensus on HELD or BROKEN (or the claim is CONTESTED and goes to appeal) → winners get paid.
- **Three claim types today:** a price crossing a threshold, one asset outperforming another, or an on-chain/DeFi metric crossing a threshold.
- **Lock samples Surf historically.** `lock_deadline_evidence` queries `/market/price` with documented `from`/`to` (1-day lookback) and freezes the last payload point at or before the claim deadline. Deadlines are canonical UTC (`YYYY-MM-DDTHH:MM:SSZ`). If the winning side has no stakers, deposited stakes are refunded. If a NO_AGREEMENT appeal has zero original stakers, the 1 GEN floor bond returns to the filer.
- **Payouts on Studionet are contract-initiated.** `resolve_verdict` calls `_pay_native`, which `emit_transfer`s to the winner. Real live proof: claim #1 on `0x0312c04c…`, resolve `0x7473f85d…`, child `0x525cab65…` credited 2 GEN to wallet B (38 → 40 GEN). A second `retry_payout` rolls back (`claim already paid`); B's balance stays 40 GEN. No keeper send in that payout. The keeper still exists to *call* lock/resolve/expire on a clock.

Jump to: [How money moves on Studionet](#how-money-moves-on-studionet) · [What Alpha Court is](#what-alpha-court-is) · [Architecture](#architecture) · [Local development](#local-development) · [Honesty and known limits](#honesty-and-known-limits) · [Roadmap](#roadmap--not-yet-built)

---

## How money moves on Studionet

Users send GEN to the court address. The contract re-fetches that transfer (`eth_getTransactionByHash` + `strict_eq` on `{from,to,value,status}`) and records the stake. At resolve, `_pay_native` reconstructs the recipient from a storage `Address` via `Address(hex)` — the shape proven in settle_probe Run C (`0x758CA957…` / `0xaa9b35c3…` / recipient delta exactly `7000000000000000` atto) — and `emit_transfer`s from the contract's own balance. Passing a calldata-typed `Address` straight into that interface is what used to raise `SystemError: 2 inval`; that was a type-handling bug, not a Studionet platform limit.

| Layer | What it does |
|---|---|
| Intelligent contract | Decides who won, holds the verified deposits, and pays winners/refunds via `emit_transfer`. |
| Keeper (Next.js) | Calls `lock_deadline_evidence` / `resolve_verdict` / `expire_appeal` / `resolve_appeal` on a clock. It does **not** send the payout GEN. |

**This is Studionet-specific.** Testnet Asimov / Bradbury (chain `4221`) still sit on the GenLayer Chain ghost-contract path the official docs describe; IC→EOA there is a real, open limitation. If this project ever leaves Studionet, `_pay_native` has to be re-proven on that network. The pinned runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` is the one this Studionet instance accepts; genvm-lint reports a newer upstream runner. The current official faucet failed to even deploy here.

**Retired courts (do not settle on any — legacy docket, read-only):**

| Address | Retired because |
|---|---|
| `0xd3cD69C30A4e899bA2D346723bffac066543cF97` | Superseded by the second deployment below. Historical unpaid winners are a known leftover from an earlier pass; only claim 31 was made whole there. |
| `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902` | Source and deployed bytecode drifted apart: the deterministic outcome cross-check (`_naive_outcome`, closing a FairSplit-shaped consensus gap) was added to `alpha_court.py` after this deployment, so its live bytecode never had the fix. Its 22 settled claims are preserved through the legacy-docket merge. |
| `0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4` | Real steward review found two more gaps this deployment's bytecode never had the fix for: the keeper's payout decision read the Redis stake cache instead of contract state, and `stake_for`/`stake_against`/`file_appeal` enforced deadlines only via `claim.state`, not an independent timestamp check. Both fixed in `alpha_court.py` (`get_stakers_for_claim` + direct `gl.message_raw["datetime"]` checks) — see "Payout authority and deadline enforcement" below. |
| `0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85` | Custodial payable stakes, retired when the design moved to tx-hash deposits while `_pay_native` was still a no-op. |
| `0x219e753176D1157bC22376e10d06e4E21E401417` | Tx-hash deposits to a shared EOA treasury; payouts still keeper-sent. Retired when `_pay_native` was un-stubbed and treasury rotated to the contract (`SELF`) so spent hashes cannot replay. |
| `0x1b8Fc1a2B16352228f2016DB1BBbeAaBA9192B37` | Contract-held payout worked, but `retry_payout` was permissionless with no `paid` flag, so a `RESOLVED` claim could be paid again from pooled deposits. |

Contracts can't be upgraded in place, so each fix above meant a fresh deployment rather than a patch. Claim ids restart from 1 on every new deployment, so every store that looks claims up by id is keyed by `origin_contract::claim_id`, never a bare id — see `web/lib/legacy-claim-ids.ts`.

---

## What Alpha Court is

### Claim types

| Type | Question shape |
|---|---|
| **Price threshold** | Asset vs a number (`ETH/USD above 3000`) |
| **Relative performance** | Asset A vs asset B over the window |
| **Fundamentals** | A named metric vs a threshold (e.g. BTC MVRV) |

### Lifecycle in plain language

1. Someone **posts** a claim. Posting-time evidence is fetched inline. The claim stays **OPEN** for staking until the deadline.
2. Others **stake 1–10 GEN** FOR or AGAINST.
3. After the deadline, anyone (in practice the keeper) calls `lock_deadline_evidence`. Surf historical `from`/`to` is queried; the last point at or before the declared deadline is frozen. Staking closes. State is **EVIDENCE_LOCKED**.
4. `resolve_verdict` runs a leader verdict + validator check on the locked snapshots.
   - Decisive **HELD** or **BROKEN** → **RESOLVED**. Passport records a win/loss. Contract pays winners via `emit_transfer`. If the winning side has no stakers, every deposited stake is refunded.
   - No single side → **CONTESTED**. Stakes stay locked.
5. **CONTESTED** has a **48-hour** window from `contested_at`.
   - File an appeal with **exactly** the stored bond (25% of the pool, clamped 1–5 GEN) → **APPEAL_PENDING**.
   - No appeal → `expire_appeal` → **REFUNDED**. Contract refunds original stakes via `emit_transfer`.
6. **APPEAL_PENDING** is a second consensus round on the same locked snapshots (never re-fetched).
   - Decisive verdict → **SETTLED** / **RESOLVED**. Bond returns to the filer. Contract pays winners + returns bond via `emit_transfer`.
   - Still no agreement → **NO_AGREEMENT** / **REFUNDED**. Bond is forfeited and split evenly across original staker addresses. If nobody staked, the bond returns to the filer instead of sitting in the contract. Contract refunds stakes + bond shares via `emit_transfer`.
   - One dispute cycle. No third round.
