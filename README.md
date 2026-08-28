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
