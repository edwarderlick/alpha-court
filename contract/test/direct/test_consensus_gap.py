"""
Concord-class audit: stored consensus_result vs agreed verdict text.

The review pattern: a leader must not be able to persist HELD/BROKEN that
disagrees with the verdict prose validators accepted.

Alpha Court's current design has one stored text (`verdict_text`) and
derives `consensus_result` from it via `_parse_decisive_outcome` in the
same function that received the consensus output. There is no nested
decision channel. These tests:

  1. Document that a *two-channel* store (text vs independent outcome)
     would accept the Concord-style attack.
  2. Prove resolve_verdict always stores parse(verdict_text), so a
     HELD field cannot sit next to BROKEN-only prose (and vice versa).
  3. Prove mixed HELD+BROKEN prose is CONTESTED, not a picked side.
"""

from __future__ import annotations

from test.direct.test_alpha_court import (
	FUTURE_DEADLINE,
	deploy,
	force_state,
	install_verdict_hook,
	mock_price,
)
from test.direct.tx_helpers import bond_atto, register_appeal


def _parse(text: str) -> str:
	"""Same rule as contracts/alpha_court.py `_parse_decisive_outcome`."""
	upper = text.upper()
	has_held = "HELD" in upper
	has_broken = "BROKEN" in upper
	if has_held and not has_broken:
		return "HELD"
	if has_broken and not has_held:
		return "BROKEN"
	return ""


def _legacy_two_channel_store(verdict_text: str, independent_outcome: str) -> dict:
	"""Pre-fix Concord shape: persist a party-supplied outcome separately
	from the agreed text. That is the hole these tests exist to close."""
	return {
		"verdict_text": verdict_text,
		"consensus_result": independent_outcome,
	}


def test_legacy_two_channel_accepts_conflicting_top_level():
	text = (
		"BROKEN. The deadline price of 2000.0 never rose above the claimed "
		"threshold of 3000.0."
	)
	stored = _legacy_two_channel_store(text, "HELD")
	assert _parse(stored["verdict_text"]) == "BROKEN"
	assert stored["consensus_result"] == "HELD"
	assert stored["consensus_result"] != _parse(stored["verdict_text"])


def test_parse_held_only_and_broken_only():
	assert _parse("HELD. Deadline 3500.0 is above 3000.0.") == "HELD"
	assert _parse("BROKEN. Deadline 2000.0 is not above 3000.0.") == "BROKEN"


def test_parse_mixed_held_and_broken_is_undecided():
	mixed = (
		"The claim might have HELD on posting, but at the deadline it is BROKEN."
	)
	assert _parse(mixed) == ""


def _lock_price_claim(direct_vm, direct_deploy, direct_alice, posting: float, deadline: float):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, posting)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)
	force_state(contract, claim_id, "EVIDENCE_LOCKED")
	claim = contract.claims[claim_id]
	claim.deadline_price_atto = int(deadline * 10**18)
	claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	contract.claims[claim_id] = claim
	return contract, claim_id


def test_resolve_verdict_consensus_matches_parsed_held_text(
	direct_vm, direct_deploy, direct_alice
):
	contract, claim_id = _lock_price_claim(direct_vm, direct_deploy, direct_alice, 2950.5, 3500.0)
	text = (
		"HELD. The deadline price of 3500.0 is above the claimed threshold "
		"of 3000.0 (posting price was 2950.5)."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	claim = contract.get_claim(claim_id)
	assert claim["verdict_text"] == text
	assert claim["consensus_result"] == _parse(text) == "HELD"
	assert claim["state"] == "RESOLVED"


def test_resolve_verdict_cannot_store_held_when_text_parses_broken(
	direct_vm, direct_deploy, direct_alice
):
	"""The Concord attack payload: prose is BROKEN-only, a two-channel
	store could still persist HELD. Current resolve_verdict must not."""
	contract, claim_id = _lock_price_claim(direct_vm, direct_deploy, direct_alice, 2950.5, 2000.0)
	text = (
		"BROKEN. The deadline price of 2000.0 never rose above the claimed "
		"threshold of 3000.0 (posting price was 2950.5)."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	claim = contract.get_claim(claim_id)
	assert _parse(claim["verdict_text"]) == "BROKEN"
	assert claim["consensus_result"] == "BROKEN"
	assert claim["consensus_result"] != "HELD"
	assert claim["state"] == "RESOLVED"


def test_resolve_verdict_conflicting_words_do_not_pick_a_side(
	direct_vm, direct_deploy, direct_alice
):
	contract, claim_id = _lock_price_claim(direct_vm, direct_deploy, direct_alice, 2950.5, 3005.0)
	text = (
		"A posting-time read might have HELD, but the deadline comparison "
		"is BROKEN relative to the threshold."
	)
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	claim = contract.get_claim(claim_id)
	assert _parse(text) == ""
	assert claim["consensus_result"] == ""
	assert claim["state"] == "CONTESTED"
	assert claim["verdict_text"] == text


def test_resolve_appeal_cannot_store_held_when_second_text_parses_broken(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""Same Concord payload as resolve_verdict, on the appeal round:
	second_verdict_text is BROKEN-only; consensus_result must be BROKEN,
	never an independent HELD."""
	from test.direct.test_appeals import HEDGE, install_hook, make_contested

	text = (
		"BROKEN. After a second look the deadline price of 2000.0 never rose "
		"above the claimed threshold of 3000.0."
	)
	install_hook(direct_vm, [HEDGE, text])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=2.0,
		threshold="3000", direction="above", deadline_price=2000.0,
	)
	register_appeal(contract, direct_vm, claim_id, bond_atto(contract, claim_id), direct_owner)
	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)
	claim = contract.get_claim(claim_id)
	assert claim["second_verdict_text"] == text
	assert _parse(claim["second_verdict_text"]) == "BROKEN"
	assert claim["consensus_result"] == "BROKEN"
	assert claim["consensus_result"] != "HELD"
	assert claim["state"] == "RESOLVED"
	assert claim["appeal_outcome"] == "SETTLED"


def test_resolve_appeal_conflicting_words_are_no_agreement_not_a_side(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	from test.direct.test_appeals import HEDGE, install_hook, make_contested

	text = (
		"A posting-time read might have HELD, but the deadline comparison "
		"is BROKEN relative to the threshold."
	)
	install_hook(direct_vm, [HEDGE, text])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=2.0,
	)
	register_appeal(contract, direct_vm, claim_id, bond_atto(contract, claim_id), direct_owner)
	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)
	claim = contract.get_claim(claim_id)
	assert _parse(text) == ""
	assert claim["second_verdict_text"] == text
	assert claim["consensus_result"] == ""
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"


def test_get_claim_single_source_held_or_empty(direct_vm, direct_deploy, direct_alice):
	"""Every get_claim after resolve: if consensus_result is HELD/BROKEN,
	it equals parse(verdict_text). No other writer exists."""
	contract, claim_id = _lock_price_claim(direct_vm, direct_deploy, direct_alice, 3100.0, 4000.0)
	text = "HELD. Deadline 4000.0 exceeds threshold 3000.0 given posting 3100.0."
	install_verdict_hook(direct_vm, text)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	claim = contract.get_claim(claim_id)
	parsed = _parse(claim["verdict_text"])
	assert claim["consensus_result"] == parsed
	assert parsed in ("HELD", "BROKEN", "")
