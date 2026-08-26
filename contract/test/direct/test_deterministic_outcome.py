"""
FairSplit-class audit: consensus_result vs an independent, deterministic
recomputation from the same locked snapshot fields.

test_consensus_gap.py already closed the Concord-shaped gap (no second
leader-supplied channel can diverge from the agreed verdict_text). This
file closes the FairSplit-shaped one: nothing previously forced the
leader's *stated word* to agree with what the locked numbers actually say.
_naive_outcome (alpha_court.py) now recomputes HELD/BROKEN with zero LLM
involvement, and _resolve_verdict_with_consensus rejects a parsed verdict
that disagrees with it -- routed through the exact same empty-result path
the conflicting-words case already uses, so a disagreeing leader lands on
CONTESTED/NO_AGREEMENT, never a false HELD/BROKEN.

Covers all three claim types (Price Threshold, Relative Performance,
Fundamentals Threshold) and both verdict rounds (resolve_verdict,
resolve_appeal) per the review's own scope: a partial cross-check would
leave exactly the gap this exists to close.
"""

from __future__ import annotations

import pytest

from test.direct.tx_helpers import bond_atto, register_appeal

from test.direct.test_alpha_court import FUTURE_DEADLINE, deploy, install_verdict_hook, mock_price
from test.direct.test_appeals import HEDGE, install_hook
from test.direct.test_fundamentals import (
	force_evidence_locked_fundamentals,
	mock_onchain_indicator,
)
from test.direct.test_relative_performance import (
	force_evidence_locked_rp,
	mock_price_for,
)

ATTO = 10**18


def _lock_price_claim(direct_vm, direct_alice, contract, posting: float, deadline: float, threshold="3000", direction="above"):
	direct_vm.sender = direct_alice
	mock_price(direct_vm, posting)
	claim_id = contract.create_claim("ETH/USD", threshold, direction, FUTURE_DEADLINE)
	claim = contract.claims[claim_id]
	claim.state = "EVIDENCE_LOCKED"
	claim.deadline_price_atto = int(deadline * ATTO)
	claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	contract.claims[claim_id] = claim
	return claim_id


def _file_and_resolve_appeal(direct_vm, direct_owner, direct_alice, contract, claim_id):
	register_appeal(contract, direct_vm, claim_id, bond_atto(contract, claim_id), direct_owner)
	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)


# ---------------------------------------------------------------------
# Price Threshold -- round 1 (resolve_verdict)
# ---------------------------------------------------------------------


def test_price_threshold_leader_held_but_naive_broken_is_contested(
	direct_vm, direct_deploy, direct_alice
):
	"""deadline 2000 vs threshold 3000, direction 'above' -> naive says
	BROKEN. Leader dishonestly/mistakenly asserts HELD anyway."""
	contract = deploy(direct_deploy)
	claim_id = _lock_price_claim(direct_vm, direct_alice, contract, posting=2950.5, deadline=2000.0)

	text = (
		"HELD. The deadline price of 2000.0 is above the claimed threshold "
		"of 3000.0 (posting price was 2950.5)."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["verdict_text"] == text  # real agreed text preserved
	assert claim["consensus_result"] == ""
	assert claim["state"] == "CONTESTED"


def test_price_threshold_leader_broken_but_naive_held_is_contested(
	direct_vm, direct_deploy, direct_alice
):
	"""deadline 3500 vs threshold 3000, direction 'above' -> naive says
	HELD. Leader asserts BROKEN anyway."""
	contract = deploy(direct_deploy)
	claim_id = _lock_price_claim(direct_vm, direct_alice, contract, posting=2950.5, deadline=3500.0)

	text = (
		"BROKEN. The deadline price of 3500.0 never rose above the claimed "
		"threshold of 3000.0 (posting price was 2950.5)."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["consensus_result"] == ""
	assert claim["state"] == "CONTESTED"


def test_price_threshold_leader_matches_naive_still_resolves(
	direct_vm, direct_deploy, direct_alice
):
	"""Sanity: the cross-check must not reject a verdict that's actually
	correct -- same claim shape as the HELD-but-naive-BROKEN test above,
	just with the leader telling the truth this time."""
	contract = deploy(direct_deploy)
	claim_id = _lock_price_claim(direct_vm, direct_alice, contract, posting=2950.5, deadline=3500.0)

	text = (
		"HELD. The deadline price of 3500.0 is above the claimed threshold "
		"of 3000.0 (posting price was 2950.5)."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["consensus_result"] == "HELD"
	assert claim["state"] == "RESOLVED"


# ---------------------------------------------------------------------
# Relative Performance -- round 1 (resolve_verdict)
# ---------------------------------------------------------------------


def test_relative_performance_leader_held_but_naive_broken_is_contested(
	direct_vm, direct_deploy, direct_alice
):
	"""asset_a (ETH) +5% (2000->2100), asset_b (SOL) +30% (100->130) ->
	naive says BROKEN (a did not outperform b). Leader asserts HELD."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)
	claim_id = contract.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)
	force_evidence_locked_rp(contract, claim_id, deadline_price_a=2100.0, deadline_price_b=130.0)

	text = (
		"asset_a (ETH/USD) moved from 2000.0 to 2100.0, a +5% change. asset_b "
		"(SOL/USD) moved from 100.0 to 130.0, a +30% change. Since 5% exceeds "
		"30%, asset_a outperformed asset_b, so the verdict is HELD."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["verdict_text"] == text
	assert claim["consensus_result"] == ""
	assert claim["state"] == "CONTESTED"


# ---------------------------------------------------------------------
# Fundamentals Threshold -- round 1 (resolve_verdict)
# ---------------------------------------------------------------------


def test_fundamentals_leader_held_but_naive_broken_is_contested(
	direct_vm, direct_deploy, direct_alice
):
	"""NUPL: deadline -0.3 vs threshold -0.2, direction 'above' -> naive
	says BROKEN (-0.3 does not exceed -0.2). Leader asserts HELD anyway --
	also proves the naive check decodes the FUNDAMENTALS_SIGNED_OFFSET
	correctly for a negative value, not just a positive TVL-style one."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_onchain_indicator(direct_vm, "BTC", "NUPL", -0.1)
	claim_id = contract.create_fundamentals_claim("BTC", "NUPL", "-0.2", "above", FUTURE_DEADLINE)
	force_evidence_locked_fundamentals(contract, claim_id, deadline_value=-0.3)

	text = (
		"HELD. The deadline NUPL of -0.3 exceeds the claimed threshold of "
		"-0.2 (posting NUPL was -0.1)."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["verdict_text"] == text
	assert claim["consensus_result"] == ""
	assert claim["state"] == "CONTESTED"


# ---------------------------------------------------------------------
# Appeal round (resolve_appeal) -- all three claim types
# ---------------------------------------------------------------------


def test_resolve_appeal_price_threshold_leader_held_but_naive_broken_is_no_agreement(
	direct_vm, direct_deploy, direct_alice, direct_owner
):
	contract = deploy(direct_deploy)
	claim_id = _lock_price_claim(direct_vm, direct_alice, contract, posting=2950.5, deadline=2000.0)

	mismatched = (
		"HELD. The deadline price of 2000.0 is above the claimed threshold "
		"of 3000.0 (posting price was 2950.5)."
	)
	install_hook(direct_vm, [HEDGE, mismatched])
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	assert contract.get_claim(claim_id)["state"] == "CONTESTED"

	_file_and_resolve_appeal(direct_vm, direct_owner, direct_alice, contract, claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["second_verdict_text"] == mismatched
	assert claim["consensus_result"] == ""
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"


def test_resolve_appeal_relative_performance_leader_broken_but_naive_held_is_no_agreement(
	direct_vm, direct_deploy, direct_alice, direct_owner
):
	"""asset_a +20% (2000->2400), asset_b +10% (100->110) -> naive says
	HELD (a outperformed b). Leader asserts BROKEN on the appeal round."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)
	claim_id = contract.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)
	force_evidence_locked_rp(contract, claim_id, deadline_price_a=2400.0, deadline_price_b=110.0)

	mismatched = (
		"asset_a (ETH/USD) moved from 2000.0 to 2400.0, a +20% change. asset_b "
		"(SOL/USD) moved from 100.0 to 110.0, a +10% change. Since 20% does "
		"not exceed 10%, asset_a did not outperform asset_b, so the verdict "
		"is BROKEN."
	)
	install_hook(direct_vm, [HEDGE, mismatched])
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	assert contract.get_claim(claim_id)["state"] == "CONTESTED"

	_file_and_resolve_appeal(direct_vm, direct_owner, direct_alice, contract, claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["second_verdict_text"] == mismatched
	assert claim["consensus_result"] == ""
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"


def test_resolve_appeal_fundamentals_leader_broken_but_naive_held_is_no_agreement(
	direct_vm, direct_deploy, direct_alice, direct_owner
):
	"""TVL: deadline 4e9 vs threshold 3.5e9, direction 'above' -> naive
	says HELD. Leader asserts BROKEN on the appeal round."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_onchain_indicator(direct_vm, "BTC", "NUPL", -0.5)
	claim_id = contract.create_fundamentals_claim("BTC", "NUPL", "0.0", "above", FUTURE_DEADLINE)
	force_evidence_locked_fundamentals(contract, claim_id, deadline_value=0.3)

	mismatched = (
		"BROKEN. The deadline NUPL of 0.3 does not exceed the claimed "
		"threshold of 0.0."
	)
	install_hook(direct_vm, [HEDGE, mismatched])
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	assert contract.get_claim(claim_id)["state"] == "CONTESTED"

	_file_and_resolve_appeal(direct_vm, direct_owner, direct_alice, contract, claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["second_verdict_text"] == mismatched
	assert claim["consensus_result"] == ""
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"
