"""
Direct-mode tests for appeals (Build Prompt 3), rewritten for Build Prompt
4's real leader-verdict / validator-check mechanism.

CONTESTED no longer comes from a deadline price landing within
PRICE_TOLERANCE of the threshold (that AMBIGUOUS shortcut is fully removed
-- see alpha_court.py's header). It now comes from the real leader/validator
round genuinely failing to reach a clean decisive HELD/BROKEN verdict --
simulated here, as in test_alpha_court.py, via the mock LLM hook returning
hedging text that _parse_decisive_outcome can't resolve to a single side
(see alpha_court.py header, Step 0 finding 3).

resolve_appeal (Build Prompt 4) no longer grades a fresh verdict against a
stored "original side" -- provisional_lean is gone, and UPHELD/OVERTURNED
collapsed into a single APPEAL_OUTCOME_SETTLED, since resolve_appeal now
reuses the exact same _resolve_verdict_with_consensus function as round 1:
a genuine second attempt, not a review. Because both rounds share the same
task/criteria text (there's no more "appellate framing" to distinguish
them), the mock hook here returns a QUEUE of responses -- one per
ExecPromptTemplate call, in order -- so each test can make round 1 fail
(hedge) and independently control what round 2 says.

Bond destination (post-master-spec correction -- see alpha_court.py's
header "spec correction" note): SETTLED returns the bond to the filer;
NO_AGREEMENT/REFUNDED forfeits it, split EVENLY across all original
stakers. This contract's first version had both directions backwards
(SETTLED forfeited-and-folded, NO_AGREEMENT returned) before
alpha-court-master-spec.md §6/§7 confirmed the correct mapping.
"""

import json

import pytest

from test.direct.tx_helpers import mock_studio_tx, next_tx_hash, register_appeal, register_stake

FUTURE_DEADLINE = "2999-01-01T00:00:00.000Z"

ATTO = 10**18

HEDGE = "This is genuinely too close to call either way."


def deploy(direct_deploy):
	return direct_deploy("alpha_court.py", "test-surf-key", "0x1111111111111111111111111111111111111111")


def mock_price(direct_vm, price: float):
	direct_vm.mock_web(
		r".*api\.asksurf\.ai.*market/price.*",
		{"status": 200, "body": json.dumps({"data": {"price": price}}).encode()},
	)


def install_hook(direct_vm, responses: list[str]):
	"""
	Extends test_staking.py's install_transfer_hook with a QUEUE of
	ExecPromptTemplate responses instead of one fixed/task-keyed response --
	round 1 and the appeal round (resolve_appeal) now share the exact same
	task/criteria text (Build Prompt 4 removed the separate "appellate"
	framing), so they can no longer be told apart by inspecting the request;
	call ORDER is what distinguishes them instead. The last entry repeats
	for any further calls beyond the list's length.
	"""
	state = {"i": 0}

	def hook(vm, request):
		from test.direct.tx_helpers import apply_native_send

		applied = apply_native_send(vm, request)
		if applied is not None:
			return applied
		if "ExecPromptTemplate" in request:
			i = min(state["i"], len(responses) - 1)
			state["i"] += 1
			return {"ok": responses[i]}
		return None

	direct_vm._gl_call_hook = hook


def balance_of(direct_vm, address: bytes) -> int:
	return direct_vm._balances.get(address, 0)


def force_evidence_locked(contract, claim_id: str, deadline_price: float) -> None:
	"""Same storage reach-in as test_staking.py's helper of the same name --
	see that module for the full justification (direct mode's frozen clock
	can't reach the real deadline within one deployment)."""
	claim = contract.claims[claim_id]
	claim.deadline_price_atto = int(deadline_price * ATTO)
	claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	claim.state = "EVIDENCE_LOCKED"
	contract.claims[claim_id] = claim


def force_contested_at(contract, claim_id: str, contested_at: str) -> None:
	"""Backdates claim.contested_at directly -- the only way to make the
	48-hour appeal window appear elapsed within one direct-mode deployment
	(the frozen clock can't move forward in real time, but a stored past
	timestamp can be compared against it for real by expire_appeal's own
	code)."""
	claim = contract.claims[claim_id]
	claim.contested_at = contested_at
	contract.claims[claim_id] = claim


def make_contested(
	direct_vm,
	contract,
	direct_alice,
	direct_bob,
	direct_charlie,
	direct_owner,
	*,
	bob_for: float = 0,
	charlie_for: float = 0,
	charlie_against: float = 0,
	owner_against: float = 0,
	threshold: str = "3000",
	direction: str = "above",
	deadline_price: float = 3500.0,
) -> str:
	"""
	Reaches CONTESTED for real, through resolve_verdict() itself (not by
	forcing claim.state directly), so the bond computation inside
	resolve_verdict's CONTESTED branch runs for real, off real staked pool
	totals. install_hook must already be installed by the caller with its
	FIRST queued response being a hedge (HEDGE) -- this consumes exactly
	one ExecPromptTemplate call.
	"""
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", threshold, direction, FUTURE_DEADLINE)

	if bob_for:
		register_stake(contract, direct_vm, claim_id, "for", int(bob_for * ATTO), direct_bob)
	if charlie_for:
		register_stake(contract, direct_vm, claim_id, "for", int(charlie_for * ATTO), direct_charlie)
	if charlie_against:
		register_stake(contract, direct_vm, claim_id, "against", int(charlie_against * ATTO), direct_charlie)
	if owner_against:
		register_stake(contract, direct_vm, claim_id, "against", int(owner_against * ATTO), direct_owner)

	force_evidence_locked(contract, claim_id, deadline_price)

	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "CONTESTED"
	assert claim["consensus_result"] == ""
	return claim_id


# ---------------------------------------------------------------------
# Appeal bond calculation -- multiple pool sizes, both clamp boundaries
# ---------------------------------------------------------------------


def test_appeal_bond_clamps_to_floor_when_25pct_under_1_gen(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=1.0, charlie_against=1.0,  # pool = 2 GEN, 25% = 0.5 GEN < 1 GEN floor
	)
	claim = contract.get_claim(claim_id)
	assert float(claim["appeal_bond"]) == pytest.approx(1.0, rel=1e-9)  # floor engaged


def test_appeal_bond_clamps_to_ceiling_when_25pct_over_5_gen(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=10.0, charlie_for=10.0, owner_against=10.0,  # pool = 30 GEN, 25% = 7.5 GEN > 5 GEN ceiling
	)
	claim = contract.get_claim(claim_id)
	assert float(claim["appeal_bond"]) == pytest.approx(5.0, rel=1e-9)  # ceiling engaged


def test_appeal_bond_unclamped_middle_case(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=4.0, charlie_against=4.0,  # pool = 8 GEN, 25% = 2 GEN -- within [1, 5]
	)
	claim = contract.get_claim(claim_id)
	assert float(claim["appeal_bond"]) == pytest.approx(2.0, rel=1e-9)  # unclamped


# ---------------------------------------------------------------------
# file_appeal -- guards
# ---------------------------------------------------------------------


def test_file_appeal_wrong_state_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)  # still OPEN

	direct_vm.sender = direct_bob
	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=int(1 * ATTO))
	with direct_vm.expect_revert("claim is not CONTESTED"):
		contract.file_appeal(claim_id, next_tx_hash())


def test_file_appeal_wrong_bond_amount_reverts(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=4.0, charlie_against=4.0,  # bond = 2 GEN exactly
	)

	direct_vm.sender = direct_bob
	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=int(1.9 * ATTO))
	with direct_vm.expect_revert("appeal bond must be exactly the stored bond amount"):
		contract.file_appeal(claim_id, next_tx_hash())

	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=int(2.1 * ATTO))
	with direct_vm.expect_revert("appeal bond must be exactly the stored bond amount"):
		contract.file_appeal(claim_id, next_tx_hash())


def test_file_appeal_exact_bond_transitions_to_appeal_pending(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=4.0, charlie_against=4.0,  # bond = 2 GEN exactly
	)

	register_appeal(contract, direct_vm, claim_id, int(2.0 * ATTO), direct_bob)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "APPEAL_PENDING"
	assert claim["appeal_filer"].lower() == ("0x" + direct_bob.hex()).lower()


# ---------------------------------------------------------------------
# resolve_appeal -- SETTLED (either side) and NO_AGREEMENT, hand-calculated
# ---------------------------------------------------------------------


def test_resolve_appeal_wrong_state_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=4.0, charlie_against=4.0,
	)
	# CONTESTED, not APPEAL_PENDING -- appeal never filed.
	with direct_vm.expect_revert("claim is not APPEAL_PENDING"):
		contract.resolve_appeal(claim_id)


def test_resolve_appeal_settled_held_returns_bond_to_filer(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""
	FOR: bob=2, charlie=3 -> FOR pool=5. AGAINST: owner=4 -> AGAINST pool=4.
	Pool=9, bond=25% of 9=2.25 GEN (unclamped). Round 1 hedges (CONTESTED).
	Appeal filer: charlie (a FOR staker). Round 2 gives a real, decisive
	HELD verdict -> SETTLED -> FOR wins via the PLAIN payout formula (the
	bond is never folded into it -- master spec §6/§7, confirmed after this
	contract's first version guessed the opposite); the bond is instead
	returned to the filer as a separate transfer.

	Plain payout (winning_pool=5, losing_pool=4, no bond involved):
	bob:     2 + (2/5)*4 = 2 + 1.6 = 3.6  GEN
	charlie: 3 + (3/5)*4 = 3 + 2.4 = 5.4  GEN, PLUS her 2.25 GEN bond back
	         separately (she filed the appeal) = 7.65 GEN total balance
	owner (losing side): 0
	"""
	install_hook(direct_vm, [HEDGE, "After review, the panel finds the claim was HELD."])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_for=3.0, owner_against=4.0,
		threshold="3000", direction="above", deadline_price=3500.0,
	)
	claim = contract.get_claim(claim_id)
	assert float(claim["appeal_bond"]) == pytest.approx(2.25, rel=1e-9)

	register_appeal(contract, direct_vm, claim_id, int(2.25 * ATTO), direct_charlie)

	direct_vm.sender = direct_alice  # permissionless
	contract.resolve_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["appeal_outcome"] == "SETTLED"
	assert claim["consensus_result"] == "HELD"
	assert "HELD" in claim["second_verdict_text"]

	expected_bob = 3_600_000_000_000_000_000
	expected_charlie_payout = 5_400_000_000_000_000_000
	expected_charlie_bond = int(2.25 * ATTO)
	assert balance_of(direct_vm, direct_bob) == expected_bob
	assert balance_of(direct_vm, direct_charlie) == expected_charlie_payout + expected_charlie_bond
	assert balance_of(direct_vm, direct_owner) == 0

	# The payout formula itself is still verified against real on-chain
	# stakes (winning_pool=5, losing_pool=4, no bond folded in).
	expected_bob = 3_600_000_000_000_000_000
	expected_charlie_payout = 5_400_000_000_000_000_000
	winning_pool = int(float(claim["stake_for_total"]) * 10**18)
	losing_pool = int(float(claim["stake_against_total"]) * 10**18)
	bob_stake = int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex()))
	charlie_stake = int(contract.get_stake(claim_id, "for", "0x" + direct_charlie.hex()))
	assert bob_stake + (bob_stake * losing_pool) // winning_pool == expected_bob
	assert charlie_stake + (charlie_stake * losing_pool) // winning_pool == expected_charlie_payout
	assert float(claim["appeal_bond"]) == pytest.approx(2.25, rel=1e-9)


def test_resolve_appeal_settled_broken_returns_bond_regardless_of_side(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""
	Same pool shape as the HELD test above (FOR=5, AGAINST=4, bond=2.25),
	but round 2's fresh verdict is BROKEN this time -- proving bond return
	is NOT tied to any "original side" (there isn't one under Build Prompt
	4's design -- see module docstring): SETTLED always returns the bond to
	the filer no matter which side the fresh verdict ends up favoring.
	Filer: owner (the AGAINST staker, i.e. the side that ends up winning
	here -- filing an appeal doesn't require staking on any particular
	side, or staking at all).

	Plain payout (winning_pool=4, losing_pool=5, no bond involved):
	owner: 4 + (4/4)*5 = 4 + 5 = 9 GEN, PLUS her 2.25 GEN bond back
	       separately = 11.25 GEN total balance
	bob, charlie (now losing side): 0

	deadline_price=2000.0 (below the 3000 "above" threshold) so BROKEN is
	the real, deterministic answer here -- the naive-outcome cross-check
	(added after this test was first written) would otherwise reject a
	mock leader saying BROKEN against a locked snapshot that actually says
	HELD (3500.0), same as it correctly rejects any real dishonest verdict.
	"""
	install_hook(direct_vm, [HEDGE, "After review, the panel finds the claim was BROKEN."])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_for=3.0, owner_against=4.0,
		threshold="3000", direction="above", deadline_price=2000.0,
	)

	register_appeal(contract, direct_vm, claim_id, int(2.25 * ATTO), direct_owner)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["appeal_outcome"] == "SETTLED"
	assert claim["consensus_result"] == "BROKEN"

	expected_owner_payout = 9_000_000_000_000_000_000
	expected_owner_bond = int(2.25 * ATTO)
	assert balance_of(direct_vm, direct_owner) == expected_owner_payout + expected_owner_bond
	assert balance_of(direct_vm, direct_bob) == 0
	assert balance_of(direct_vm, direct_charlie) == 0

	# The payout formula itself is still verified (winning_pool=4, losing_pool=5).
	expected_owner_payout = 9_000_000_000_000_000_000
	winning_pool = int(float(claim["stake_against_total"]) * 10**18)
	losing_pool = int(float(claim["stake_for_total"]) * 10**18)
	owner_stake = int(contract.get_stake(claim_id, "against", "0x" + direct_owner.hex()))
	assert owner_stake + (owner_stake * losing_pool) // winning_pool == expected_owner_payout


def test_resolve_appeal_no_agreement_refunds_everyone_and_splits_bond_evenly(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""
	FOR: bob=2. AGAINST: charlie=3. Pool=5, bond=1.25 GEN. Round 1 hedges
	(CONTESTED). Round 2 ALSO hedges (a second, genuine failure to reach a
	decisive verdict) -> NO_AGREEMENT -> REFUNDED via the dedicated refund
	function: exact original stakes back to both sides (no proportional
	math), PLUS the appeal bond forfeited and split EVENLY across the two
	original stake records (master spec §6/§7 -- NOT returned to the filer,
	which is the opposite of what this contract's first version did).
	Filer: owner, uninvolved in staking, gets nothing here (only stakers
	share the forfeited bond).

	bond share per stake record: 1.25 / 2 = 0.625 GEN each
	bob:     2 (stake) + 0.625 (bond share) = 2.625 GEN
	charlie: 3 (stake) + 0.625 (bond share) = 3.625 GEN
	owner:   0 (not a staker; bond was forfeited, not returned to her)
	"""
	install_hook(direct_vm, [HEDGE, "Still cannot be resolved either way after further review."])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=3.0,
		threshold="3000", direction="above", deadline_price=3500.0,
	)
	claim = contract.get_claim(claim_id)
	assert float(claim["appeal_bond"]) == pytest.approx(1.25, rel=1e-9)

	register_appeal(contract, direct_vm, claim_id, int(1.25 * ATTO), direct_owner)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"
	assert claim["second_verdict_text"] != ""  # real (if hedging) text preserved

	expected_bob = 2_625_000_000_000_000_000  # 2 GEN stake + 0.625 GEN bond share
	expected_charlie = 3_625_000_000_000_000_000  # 3 GEN stake + 0.625 GEN bond share
	assert balance_of(direct_vm, direct_bob) == expected_bob
	assert balance_of(direct_vm, direct_charlie) == expected_charlie
	assert balance_of(direct_vm, direct_owner) == 0

	# The refund + even bond-split formula is still verified against real
	# on-chain stakes and the real stored bond.
	bob_stake = int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex()))
	charlie_stake = int(contract.get_stake(claim_id, "against", "0x" + direct_charlie.hex()))
	bond = int(round(float(claim["appeal_bond"]) * 10**18))
	share = bond // 2  # bob + charlie are the two unique staker addresses
	expected_bob = 2_625_000_000_000_000_000  # 2 GEN stake + 0.625 GEN bond share
	expected_charlie = 3_625_000_000_000_000_000  # 3 GEN stake + 0.625 GEN bond share
	assert bob_stake + share == expected_bob
	assert charlie_stake + share == expected_charlie


def test_resolve_appeal_no_agreement_bond_splits_per_address_not_per_record(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""
	Build Prompt 4.5: proves _distribute_bond_evenly's fix directly -- an
	address that staked BOTH FOR and AGAINST on the same claim must get
	exactly ONE even share, not one per stake record. alice (also the
	claim's poster) stakes FOR=3 in addition to bob's FOR=2, and separately
	stakes AGAINST=3 in addition to charlie's AGAINST=4 -- a real, already-
	exercised pattern elsewhere in this codebase (test_staking.py's
	three-way-split test has the claimant stake against her own claim too).

	Pool: FOR = 2 (bob) + 3 (alice) = 5. AGAINST = 4 (charlie) + 3 (alice) = 7.
	Total = 12 GEN -> bond = 25% of 12 = 3 GEN (unclamped).
	Unique staker addresses: bob, charlie, alice = 3 -> bond share = 3/3 = 1
	GEN each (clean division, no dust, so the "per address not per record"
	distinction is the ONLY thing this test's numbers could be hiding --
	the old, incorrect per-record logic would have given alice 2 shares
	out of 4 total stake records instead of 1 share out of 3 addresses,
	producing different, wrong totals below).

	Round 1 and round 2 both hedge -> NO_AGREEMENT -> REFUNDED. Filer:
	owner, uninvolved in staking.

	bob:     2 (stake refund)                 + 1 (bond share) = 3 GEN
	charlie: 4 (stake refund)                 + 1 (bond share) = 5 GEN
	alice:   3 + 3 = 6 (TWO stake refunds, one per record, unaffected by
	         this fix) + 1 (ONE bond share, not two)            = 7 GEN
	owner:   0 (filer, but bond was forfeited, not returned to her)
	"""
	install_hook(direct_vm, [HEDGE, "Still cannot be resolved either way after further review."])
	contract = deploy(direct_deploy)

	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	register_stake(contract, direct_vm, claim_id, "for", int(2 * ATTO), direct_bob)

	register_stake(contract, direct_vm, claim_id, "against", int(4 * ATTO), direct_charlie)

	register_stake(contract, direct_vm, claim_id, "for", int(3 * ATTO), direct_alice)
	register_stake(contract, direct_vm, claim_id, "against", int(3 * ATTO), direct_alice)

	force_evidence_locked(contract, claim_id, deadline_price=3500.0)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "CONTESTED"
	assert float(claim["appeal_bond"]) == pytest.approx(3.0, rel=1e-9)

	register_appeal(contract, direct_vm, claim_id, int(3.0 * ATTO), direct_owner)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"

	expected_bob = 3_000_000_000_000_000_000
	expected_charlie = 5_000_000_000_000_000_000
	expected_alice = 7_000_000_000_000_000_000
	assert balance_of(direct_vm, direct_bob) == expected_bob
	assert balance_of(direct_vm, direct_charlie) == expected_charlie
	assert balance_of(direct_vm, direct_alice) == expected_alice
	assert balance_of(direct_vm, direct_owner) == 0

	# The refund + even (per-ADDRESS, not per-record) bond-split formula is
	# still verified against real on-chain stakes and the real stored bond.
	bob_stake = int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex()))
	charlie_stake = int(contract.get_stake(claim_id, "against", "0x" + direct_charlie.hex()))
	alice_for = int(contract.get_stake(claim_id, "for", "0x" + direct_alice.hex()))
	alice_against = int(contract.get_stake(claim_id, "against", "0x" + direct_alice.hex()))
	bond = int(round(float(claim["appeal_bond"]) * 10**18))
	share = bond // 3  # bob, charlie, alice -- three unique addresses, not four stake records

	expected_bob = 3_000_000_000_000_000_000
	expected_charlie = 5_000_000_000_000_000_000
	expected_alice = 7_000_000_000_000_000_000
	assert bob_stake + share == expected_bob
	assert charlie_stake + share == expected_charlie
	assert alice_for + alice_against + share == expected_alice  # ONE share, not two


def test_resolve_appeal_cannot_be_called_twice(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE, "The claim was HELD after review."])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=4.0, charlie_against=4.0,
	)
	register_appeal(contract, direct_vm, claim_id, int(2.0 * ATTO), direct_bob)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)
	with direct_vm.expect_revert("claim is not APPEAL_PENDING"):
		contract.resolve_appeal(claim_id)


# ---------------------------------------------------------------------
# expire_appeal -- no-appeal-filed path
# ---------------------------------------------------------------------


def test_expire_appeal_before_window_elapsed_reverts(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=3.0,
	)
	# contested_at is "now" (the frozen deploy-time clock) -- window hasn't elapsed.
	with direct_vm.expect_revert("appeal window has not elapsed yet"):
		contract.expire_appeal(claim_id)


def test_expire_appeal_wrong_state_reverts(direct_vm, direct_deploy, direct_alice):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)  # OPEN
	with direct_vm.expect_revert("claim is not CONTESTED"):
		contract.expire_appeal(claim_id)


def test_expire_appeal_after_window_elapsed_refunds_exact_stakes(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=3.0,
	)
	# Backdate contested_at well past 48h before the frozen "now" -- no
	# appeal was ever filed (appeal_filer is still the ZERO_ADDRESS sentinel).
	force_contested_at(contract, claim_id, "2000-01-01T00:00:00.000Z")

	direct_vm.sender = direct_owner  # permissionless -- anyone can call
	contract.expire_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_filer"] is None  # confirms this is the no-appeal-filed path, not resolve_appeal's

	assert balance_of(direct_vm, direct_bob) == 2 * ATTO
	assert balance_of(direct_vm, direct_charlie) == 3 * ATTO
	assert balance_of(direct_vm, direct_owner) == 0

	# The exact-stake-refund amounts are still verified on-chain.
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 2 * ATTO
	assert int(contract.get_stake(claim_id, "against", "0x" + direct_charlie.hex())) == 3 * ATTO
