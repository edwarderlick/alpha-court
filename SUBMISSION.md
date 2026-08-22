# Submission notes

For the steward. Product facts only. Live court on GenLayer studionet (chain `61999`): **`0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902`**. Retired court (pre-payout-fix, historical ids 1–33, still readable): `0xd3cD69C30A4e899bA2D346723bffac066543cF97`.

## Prior-art check

| Source | What exists | Overlap with Alpha Court? |
|---|---|---|
| GenLayer official docs — **Football Prediction Market example** | A single hardcoded boolean (`has_resolved`) for one named football game, resolved via a generic URL fetch and `strict_eq`. No staking, no economics, no dispute path, no history. | **Closest official example.** Alpha Court is a general-purpose claim system (any crypto market thesis, three claim types), backed by Surf's structured Data API rather than a generic URL fetch, with staking, a hybrid-bond appeal with a second consensus round, and persistent reputation (Alpha Passport). The official example is the primitive; this is a product on top of it. |
| GenLayer ideas gallery — **AI Arbitration** | Dispute resolution after a disagreement | Related consensus pattern, different lifecycle. Alpha Court's appeal is this pattern scoped to re-judging already-locked evidence, not general arbitration. |
| Ecosystem — **Provider Court, Sybil Court, Concord** (same builder) | Escrow/delivery verification, wallet eligibility, pre-agreement reconciliation | Different domains. No shared claim type, evidence source, or economic mechanism. |

**Decision:** proceed. Alpha Court multiplies the official example's core primitive (LLM consensus resolving a real-world claim) into three claim types, real staking economics, a reasoned (not boolean) verdict citing structured evidence, appeals, and permanent reputation.

## 1. Consensus integrity — stored outcome vs verdict text

**Reviewer pattern:** every stored, consequential field must be independently validated against what is persisted — not a nested summary or fingerprint of it. That was the exact basis of Concord's rejection.

**What Alpha Court does**

`consensus_result` (`HELD` / `BROKEN`) is **only ever assigned by parsing the leader's actual verdict text** (`_parse_decisive_outcome(verdict_text)`). There is no second, leader-supplied channel that could store a conflicting value. Staking payouts and Alpha Passport both read from this one field, derived from the one stored text.

**Proof** (`contract/test/direct/test_consensus_gap.py`, 7 passed):

| Test | What it proves |
|---|---|
| `test_legacy_two_channel_accepts_conflicting_top_level` | An independent-field design (Concord's old shape) would allow this divergence |
| `test_resolve_verdict_cannot_store_held_when_text_parses_broken` | Live path stores `BROKEN`, never a conflicting `HELD`, when the text says so |
| `test_resolve_verdict_conflicting_words_do_not_pick_a_side` | Mixed HELD+BROKEN prose → `CONTESTED`, empty result, never a guessed side |
| `test_get_claim_single_source_held_or_empty` | After resolve, `consensus_result` equals a fresh parse of stored `verdict_text` |

**What this does not claim**

Validators judge the verdict's *reasoning quality* via `prompt_non_comparative` (cite the real numbers, compare in the claimed direction). They do not independently re-derive a separate arithmetic outcome and fingerprint it the way a strict comparative check would. That property is an LLM-equivalence judgment, not a stored-field integrity property. Direct-mode tests cannot exercise live multi-validator consensus. That is a testing-coverage boundary, not a design gap.

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
| Live court | `0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902` |
| Retired court | `0xd3cD69C30A4e899bA2D346723bffac066543cF97` |
| Network | studionet, chain `61999` |
| Direct tests | **72** collected (`pytest test/direct/`) |

Lifecycle on the live court (real txs, not UI labels):

| Step | Claim | Tx |
|---|---|---|
| Create Price Threshold | #11 | `0xce4ea6d264d6fd9f8934ad89d01416e57c027bdd7e3126ce1e8194b5c7403d32` |
| Create Relative Performance | #12 | `0x625b110fbea4f5d891a20525a8d8974d74b50f6890cfc80feadb44a4673a8356` |
| Create Fundamentals (BTC MVRV) | #13 | `0xa422e238df7b4a475f4c08fafc5c5a04a3da52b2fb61ec83f1486e35f355518f` |
| Stake FOR (wallet A, 2 GEN) | #11 | `0x04cc670ef4807adfcd39e590ac401bf5e7cb46f9486ea3591d7137019b52d2ed` |
| Stake AGAINST (wallet B, 3 GEN) | #11 | `0xf0f8b27bd97cc95ecc5fc9fcc37bc1caf2ea25f18da0fbdf09debcf4007db82f` |
| Keeper native payout (B won #12, +2 GEN, `getBalance` verified) | #12 | `0x5c24717cc2847ce8b9874402f95231feddb7db72c13c54f83e20050b448749ad` |
| Keeper native payout (C won #11 share, +2 GEN, `getBalance` verified) | #11 | `0x93ea052776a13317c76151262714d0144cad5e8b8cfc78e94252011121ee9def` |

Lock + `resolve_verdict` are keeper-driven. No user-facing lock/resolve button.

**Retired-court payout audit** (all 16 RESOLVED/REFUNDED rows on `0xd3cD69…`, not a sample): 13 winners never received IC→EOA GEN (`Contract <eoa> not found`). Each affected winner was made whole with a keeper native send. Example: claim 31 correction `0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f` (10 GEN, winner balance 848.75 → 858.75).

## Known limitations

- **Keeper funding is a real ongoing dependency.** The contract has no withdraw/admin/rescue method (schema audit). Every payout needs the keeper wallet funded. Acceptable on testnet (faucet). Would need re-architecture before real-money use.
- **GLSim local integration tests are blocked** by an upstream tool bug ([genlayerlabs/genlayer-studio#1727](https://github.com/genlayerlabs/genlayer-studio/issues/1727)). Direct-mode tests and the live studionet deployment are independent of that. The live court is proven with on-chain txs above.
- **Live `CONTESTED` cannot be reliably forced** on a public validator set for a demo. The appeal path is fully proven in direct-mode tests, where disagreement can be simulated deterministically (`test/direct/test_appeals.py`, 15 tests).
