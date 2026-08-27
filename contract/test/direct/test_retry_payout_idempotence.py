"""Adversarial: retry_payout must not pay twice now that _pay_native sends.

retry_payout was written when _pay_native was a no-op, so re-running it
was free. Claim now carries paid=True after a real payout, and a second
call must revert with a visible error -- not silently return -- so a
future regression cannot hide behind a no-op.
"""

from test.direct.test_staking import (
	ATTO,
	FUTURE_DEADLINE,
	balance_of,
	deploy,
	force_evidence_locked,
	install_transfer_hook,
	mock_price,
)
from test.direct.tx_helpers import register_stake


def _resolve_bob_wins(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
	install_transfer_hook(direct_vm)
	contract = deploy(direct_deploy)

	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	register_stake(contract, direct_vm, claim_id, "for", int(2 * ATTO), direct_bob)
	register_stake(contract, direct_vm, claim_id, "against", int(2 * ATTO), direct_charlie)

	force_evidence_locked(contract, claim_id, deadline_price=3500.0)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["paid"] is True
	after_first = balance_of(direct_vm, direct_bob)
	assert after_first == 4 * ATTO, "bob should win his 2 + charlie's 2"
	return contract, claim_id, after_first


def test_retry_payout_second_call_is_rejected(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
	"""Load-bearing: an authorized second call after a real payout reverts
	with 'already paid' and does not move GEN. A silent no-op would also
	leave the balance unchanged and would mask a regression."""
	contract, claim_id, after_first = _resolve_bob_wins(
		direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
	)

	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("claim already paid"):
		contract.retry_payout(claim_id)

	assert balance_of(direct_vm, direct_bob) == after_first
	assert contract.get_claim(claim_id)["paid"] is True


def test_retry_payout_rejects_stranger_even_if_unpaid_flag_forced(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
	"""Defense in depth: a losing staker cannot re-run payout even if the
	paid flag is cleared in storage (the previous live drain was exactly
	that call, with no flag at all)."""
	contract, claim_id, after_first = _resolve_bob_wins(
		direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
	)

	claim = contract.claims[claim_id]
	claim.paid = False
	contract.claims[claim_id] = claim
	assert contract.get_claim(claim_id)["paid"] is False

	direct_vm.sender = direct_charlie
	with direct_vm.expect_revert("only the claim poster or keeper may retry payout"):
		contract.retry_payout(claim_id)

	assert balance_of(direct_vm, direct_bob) == after_first


def test_retry_payout_unauthorized_does_not_silently_succeed(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
	"""Losing staker calling retry_payout after a real payout is rejected
	cleanly (already paid, or unauthorized -- either is a revert, not a
	second send)."""
	contract, claim_id, after_first = _resolve_bob_wins(
		direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
	)

	direct_vm.sender = direct_charlie
	with direct_vm.expect_revert("only the claim poster or keeper may retry payout"):
		contract.retry_payout(claim_id)

	assert balance_of(direct_vm, direct_bob) == after_first
	assert contract.get_claim(claim_id)["paid"] is True
