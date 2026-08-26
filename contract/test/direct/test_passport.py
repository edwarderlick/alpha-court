"""
Direct-mode tests for Alpha Passport (Build Prompt 5).

Passport writes are automatic side effects of the four terminal-transition
call sites already covered elsewhere in this suite -- resolve_verdict's
RESOLVED branch (test_alpha_court.py), resolve_appeal's SETTLED and
NO_AGREEMENT branches, and expire_appeal's REFUNDED path (both in
test_appeals.py). This file exercises _record_passport/get_passport
directly rather than re-deriving those state-machine paths from scratch --
reuses the same force_state/force_evidence_locked/install_hook patterns
already established in those files.
"""

import json

import pytest

from test.direct.tx_helpers import bond_atto, register_appeal

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
	"""Same response-queue hook as test_appeals.py's -- one entry per
	ExecPromptTemplate call, in order, since round 1 and the appeal round
	share the exact same task/criteria text (see alpha_court.py header)."""
	state = {"i": 0}

	def hook(vm, request):
		if "PostMessage" in request:
			msg = request["PostMessage"]
			addr = msg["address"]
			addr_bytes = addr.as_bytes if hasattr(addr, "as_bytes") else bytes(addr)
			value = int(msg.get("value", 0))
			vm._balances[addr_bytes] = vm._balances.get(addr_bytes, 0) + value
			return b""
		if "ExecPromptTemplate" in request:
			i = min(state["i"], len(responses) - 1)
			state["i"] += 1
			return {"ok": responses[i]}
		return None

	direct_vm._gl_call_hook = hook


def force_evidence_locked(contract, claim_id: str, deadline_price: float) -> None:
	claim = contract.claims[claim_id]
	claim.deadline_price_atto = int(deadline_price * ATTO)
	claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	claim.state = "EVIDENCE_LOCKED"
	contract.claims[claim_id] = claim


def force_contested_at(contract, claim_id: str, contested_at: str) -> None:
	claim = contract.claims[claim_id]
	claim.contested_at = contested_at
	contract.claims[claim_id] = claim


def post_and_resolve(
	direct_vm, contract, direct_alice, *, verdict_text: str, deadline_price: float = 3500.0
) -> str:
	"""Posts a claim as alice and resolves it directly (no staking involved
	-- passport tests care about the win/loss/history bookkeeping, not
	payout math, which is already covered elsewhere)."""
	install_hook(direct_vm, [verdict_text])
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)
	force_evidence_locked(contract, claim_id, deadline_price)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	return claim_id


def post_and_contest(direct_vm, contract, direct_alice, *, deadline_price: float = 3500.0) -> str:
	"""Posts a claim and drives it to CONTESTED via a hedging round-1
	response -- the appeal-path fixture shared by the SETTLED/NO_AGREEMENT
	passport tests below."""
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)
	force_evidence_locked(contract, claim_id, deadline_price)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "CONTESTED"
	return claim_id


# ---------------------------------------------------------------------
# Direct RESOLVED path -- HELD win, BROKEN loss
# ---------------------------------------------------------------------


def test_passport_held_win_recorded_on_resolved(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)
	claim_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="The deadline price of 3500.0 exceeds the 3000.0 threshold, so HELD.",
	)
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["consensus_result"] == "HELD"

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 1
	assert passport["loss_count"] == 0
	assert passport["category_breakdown"] == {"PRICE_THRESHOLD": {"win_count": 1, "loss_count": 0}}
	assert passport["claim_history"] == [claim_id]


def test_passport_broken_loss_recorded_on_resolved(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)
	claim_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="The deadline price of 2000.0 never exceeded the 3000.0 threshold, so BROKEN.",
		deadline_price=2000.0,
	)
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["consensus_result"] == "BROKEN"

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 0
	assert passport["loss_count"] == 1
	assert passport["category_breakdown"] == {"PRICE_THRESHOLD": {"win_count": 0, "loss_count": 1}}
	assert passport["claim_history"] == [claim_id]


# ---------------------------------------------------------------------
# SETTLED appeal path -- must independently record win/loss, not just
# the direct resolve_verdict path
# ---------------------------------------------------------------------


def test_passport_win_recorded_via_settled_appeal_path(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)
	install_hook(direct_vm, [HEDGE])
	claim_id = post_and_contest(direct_vm, contract, direct_alice)

	install_hook(direct_vm, ["After further review, the claim was HELD."])
	register_appeal(contract, direct_vm, claim_id, bond_atto(contract, claim_id), direct_alice)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["appeal_outcome"] == "SETTLED"
	assert claim["consensus_result"] == "HELD"

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 1
	assert passport["loss_count"] == 0
	assert passport["category_breakdown"] == {"PRICE_THRESHOLD": {"win_count": 1, "loss_count": 0}}
	assert passport["claim_history"] == [claim_id]


def test_passport_loss_recorded_via_settled_appeal_path(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)
	install_hook(direct_vm, [HEDGE])
	# deadline_price below the 3000 "above" threshold so BROKEN is the real,
	# deterministic answer -- the naive-outcome cross-check (added after
	# this test was first written) would otherwise reject a mock leader
	# saying BROKEN against a locked snapshot that actually says HELD
	# (post_and_contest's own default of 3500.0).
	claim_id = post_and_contest(direct_vm, contract, direct_alice, deadline_price=2000.0)

	install_hook(direct_vm, ["After further review, the claim was BROKEN."])
	register_appeal(contract, direct_vm, claim_id, bond_atto(contract, claim_id), direct_alice)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["appeal_outcome"] == "SETTLED"
	assert claim["consensus_result"] == "BROKEN"

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 0
	assert passport["loss_count"] == 1


# ---------------------------------------------------------------------
# REFUNDED (both paths) -- claim appears in history, win/loss UNCHANGED
# ---------------------------------------------------------------------


def test_passport_refunded_no_agreement_does_not_change_win_loss(
	direct_vm, direct_deploy, direct_alice
):
	contract = deploy(direct_deploy)

	# Establish a baseline win first, so "unchanged" is a real assertion
	# against a non-zero prior count, not just "stayed at zero."
	win_claim_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="The deadline price of 3500.0 exceeds the 3000.0 threshold, so HELD.",
	)
	passport_before = contract.get_passport("0x" + direct_alice.hex())
	assert passport_before["win_count"] == 1
	assert passport_before["loss_count"] == 0

	install_hook(direct_vm, [HEDGE])
	refunded_claim_id = post_and_contest(direct_vm, contract, direct_alice)

	install_hook(direct_vm, [HEDGE])  # round 2 ALSO hedges -> NO_AGREEMENT
	register_appeal(contract, direct_vm, refunded_claim_id, bond_atto(contract, refunded_claim_id), direct_alice)

	direct_vm.sender = direct_alice
	contract.resolve_appeal(refunded_claim_id)

	claim = contract.get_claim(refunded_claim_id)
	assert claim["state"] == "REFUNDED"
	assert claim["appeal_outcome"] == "NO_AGREEMENT"

	passport_after = contract.get_passport("0x" + direct_alice.hex())
	assert passport_after["win_count"] == 1  # unchanged from before the refund
	assert passport_after["loss_count"] == 0  # unchanged
	assert passport_after["category_breakdown"] == {
		"PRICE_THRESHOLD": {"win_count": 1, "loss_count": 0}
	}  # unchanged -- refund never touches category stats either
	assert set(passport_after["claim_history"]) == {win_claim_id, refunded_claim_id}  # BOTH present


def test_passport_refunded_no_appeal_filed_does_not_change_win_loss(
	direct_vm, direct_deploy, direct_alice
):
	contract = deploy(direct_deploy)

	loss_claim_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="The deadline price of 2000.0 never exceeded the 3000.0 threshold, so BROKEN.",
		deadline_price=2000.0,
	)
	passport_before = contract.get_passport("0x" + direct_alice.hex())
	assert passport_before["win_count"] == 0
	assert passport_before["loss_count"] == 1

	install_hook(direct_vm, [HEDGE])
	refunded_claim_id = post_and_contest(direct_vm, contract, direct_alice)
	force_contested_at(contract, refunded_claim_id, "2000-01-01T00:00:00.000Z")  # window elapsed

	direct_vm.sender = direct_alice
	contract.expire_appeal(refunded_claim_id)

	claim = contract.get_claim(refunded_claim_id)
	assert claim["state"] == "REFUNDED"

	passport_after = contract.get_passport("0x" + direct_alice.hex())
	assert passport_after["win_count"] == 0  # unchanged
	assert passport_after["loss_count"] == 1  # unchanged from before the refund
	assert set(passport_after["claim_history"]) == {loss_claim_id, refunded_claim_id}


# ---------------------------------------------------------------------
# get_passport -- mixed history across multiple claims, and the
# never-posted-anything default
# ---------------------------------------------------------------------


def test_get_passport_mixed_wins_losses_and_refunded(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)

	win_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="Deadline 3500.0 vs threshold 3000.0 -- HELD.",
	)
	loss_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="Deadline 2000.0 vs threshold 3000.0 -- BROKEN.",
		deadline_price=2000.0,
	)
	win2_id = post_and_resolve(
		direct_vm, contract, direct_alice,
		verdict_text="Deadline 4000.0 vs threshold 3000.0 -- HELD.",
		deadline_price=4000.0,
	)

	install_hook(direct_vm, [HEDGE])
	refunded_id = post_and_contest(direct_vm, contract, direct_alice)
	force_contested_at(contract, refunded_id, "2000-01-01T00:00:00.000Z")
	direct_vm.sender = direct_alice
	contract.expire_appeal(refunded_id)

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 2
	assert passport["loss_count"] == 1
	assert passport["category_breakdown"] == {"PRICE_THRESHOLD": {"win_count": 2, "loss_count": 1}}
	assert set(passport["claim_history"]) == {win_id, loss_id, win2_id, refunded_id}
	assert len(passport["claim_history"]) == 4  # every claim, nothing dropped


def test_get_passport_unknown_address_returns_zero(direct_vm, direct_deploy, direct_bob):
	contract = deploy(direct_deploy)
	passport = contract.get_passport("0x" + direct_bob.hex())
	assert passport["win_count"] == 0
	assert passport["loss_count"] == 0
	assert passport["category_breakdown"] == {}
	assert passport["claim_history"] == []
