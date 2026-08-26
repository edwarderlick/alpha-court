"""Adversarial tests for the non-custodial deposit path.

Mapped onto the steward's words: fabricated or mismatched tx hashes
cannot change recorded stakes, a reused hash is rejected, late stakes
and appeals still revert on the existing timestamp checks, and a
genuine matching transfer succeeds.
"""

from __future__ import annotations

import pytest

from test.direct.test_alpha_court import FUTURE_DEADLINE, deploy, mock_price
from test.direct.tx_helpers import (
	TEST_TREASURY,
	mock_studio_tx,
	next_tx_hash,
	register_stake,
)

ATTO = 10**18


def _open_claim(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)
	return contract, claim_id


def test_fabricated_missing_tx_hash_is_rejected(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	direct_vm.sender = direct_bob
	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=2 * ATTO, missing=True)
	with direct_vm.expect_revert("tx not found"):
		contract.stake_for(claim_id, next_tx_hash())
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 0


def test_mismatched_recipient_is_rejected(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	direct_vm.sender = direct_bob
	mock_studio_tx(
		direct_vm,
		sender=direct_bob,
		value_atto=2 * ATTO,
		to="0x2222222222222222222222222222222222222222",
	)
	with direct_vm.expect_revert("transfer to does not match treasury"):
		contract.stake_for(claim_id, next_tx_hash())
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 0


def test_mismatched_amount_is_rejected(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	"""A transfer below 1 GEN cannot be registered as a stake, even if
	from/to otherwise look right -- the contract reads the real value,
	never a caller-supplied amount."""
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	direct_vm.sender = direct_bob
	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=int(0.5 * ATTO))
	with direct_vm.expect_revert("stake must be at least 1 GEN"):
		contract.stake_for(claim_id, next_tx_hash())
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 0


def test_wrong_sender_is_rejected(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	direct_vm.sender = direct_bob
	mock_studio_tx(direct_vm, sender=direct_charlie, value_atto=2 * ATTO)
	with direct_vm.expect_revert("transfer from does not match caller"):
		contract.stake_for(claim_id, next_tx_hash())
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 0


def test_replayed_tx_hash_is_rejected_on_second_attempt(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	tx_hash = next_tx_hash()
	register_stake(
		contract, direct_vm, claim_id, "for", 2 * ATTO, direct_bob, tx_hash=tx_hash
	)
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 2 * ATTO
	assert contract.is_spent_tx(tx_hash) is True

	direct_vm.sender = direct_bob
	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=2 * ATTO)
	with direct_vm.expect_revert("tx_hash already consumed"):
		contract.stake_for(claim_id, tx_hash)
	# Second attempt did not double-count.
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 2 * ATTO


def test_genuine_matching_transfer_succeeds(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	assert contract.get_treasury().lower() == TEST_TREASURY.lower()
	register_stake(contract, direct_vm, claim_id, "for", 2 * ATTO, direct_bob)
	claim = contract.get_claim(claim_id)
	assert float(claim["stake_for_total"]) == pytest.approx(2.0, rel=1e-9)
	assert claim["treasury"].lower() == TEST_TREASURY.lower()


def test_late_stake_reverts_before_consuming_hash(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	contract, claim_id = _open_claim(direct_vm, direct_deploy, direct_alice)
	stored = contract.claims[claim_id]
	stored.deadline = "2000-01-01T00:00:00.000Z"
	contract.claims[claim_id] = stored

	tx_hash = next_tx_hash()
	direct_vm.sender = direct_bob
	with direct_vm.expect_revert("deadline has already passed"):
		contract.stake_for(claim_id, tx_hash)
	assert contract.is_spent_tx(tx_hash) is False
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 0
