"""
Steward review finding: staking and appeal-filing were guarded only by
claim.state, never by an independent timestamp check. state only changes
when someone actually calls lock_deadline_evidence / expire_appeal --
both permissionless, but not automatic. That leaves a real window where
the real deadline (or the real 48-hour appeal window) has already passed
but state hasn't moved yet, in which a late stake or a late appeal could
otherwise succeed.

_stake and file_appeal now check gl.message_raw["datetime"] against
claim.deadline / _appeal_window_elapsed directly, independent of state.
These tests prove it: state is deliberately left unmoved (the transition
function that would normally flip it is never called) and the deadline/
window is backdated via direct storage reach-in -- the same established
pattern test_appeals.py's force_contested_at already uses, needed because
direct mode's clock is frozen at deploy time (see that module's docstring
for the full, already-documented justification).
"""

from __future__ import annotations

import pytest

from test.direct.test_alpha_court import FUTURE_DEADLINE, deploy, mock_price

ATTO = 10**18


def test_stake_after_real_deadline_reverts_even_though_state_is_still_open(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	"""Deadline is real and already past; lock_deadline_evidence is
	deliberately never called, so claim.state is still OPEN. A stake here
	must revert on the timestamp check alone -- state-only enforcement
	would have let this through."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	claim = contract.claims[claim_id]
	assert claim.state == "OPEN"  # never transitioned
	claim.deadline = "2000-01-01T00:00:00.000Z"  # real deadline, already passed
	contract.claims[claim_id] = claim

	direct_vm.sender = direct_bob
	direct_vm.value = int(2 * ATTO)
	with direct_vm.expect_revert("deadline has already passed"):
		contract.stake_for(claim_id)
	direct_vm.value = 0

	# No stake was actually recorded.
	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 0
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "OPEN"
	assert float(claim["stake_for_total"]) == pytest.approx(0.0, abs=1e-12)


def test_stake_before_deadline_still_succeeds(direct_vm, direct_deploy, direct_alice, direct_bob):
	"""Sanity: the new check must not reject a genuinely on-time stake."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	direct_vm.sender = direct_bob
	direct_vm.value = int(2 * ATTO)
	contract.stake_for(claim_id)
	direct_vm.value = 0

	assert int(contract.get_stake(claim_id, "for", "0x" + direct_bob.hex())) == 2 * ATTO


def test_file_appeal_after_real_window_elapsed_reverts_even_though_state_is_still_contested(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""48-hour window is real and already elapsed; expire_appeal is
	deliberately never called, so claim.state is still CONTESTED. Filing
	an appeal here must revert on the timestamp check alone."""
	from test.direct.test_appeals import HEDGE, install_hook, make_contested

	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=3.0,
	)
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "CONTESTED"

	# Real 48h window, already elapsed -- same backdating pattern
	# test_appeals.py's force_contested_at uses for expire_appeal's own
	# window test.
	stored = contract.claims[claim_id]
	stored.contested_at = "2000-01-01T00:00:00.000Z"
	contract.claims[claim_id] = stored

	direct_vm.sender = direct_owner
	direct_vm.value = int(float(claim["appeal_bond"]) * ATTO)
	with direct_vm.expect_revert("appeal window has elapsed"):
		contract.file_appeal(claim_id)
	direct_vm.value = 0

	# No appeal was actually filed.
	claim = contract.get_claim(claim_id)
	assert claim["state"] == "CONTESTED"
	assert claim["appeal_filer"] is None


def test_file_appeal_within_window_still_succeeds(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
	"""Sanity: the new check must not reject a genuinely on-time appeal."""
	from test.direct.test_appeals import HEDGE, install_hook, make_contested

	install_hook(direct_vm, [HEDGE])
	contract = deploy(direct_deploy)
	claim_id = make_contested(
		direct_vm, contract, direct_alice, direct_bob, direct_charlie, direct_owner,
		bob_for=2.0, charlie_against=3.0,
	)
	claim = contract.get_claim(claim_id)

	direct_vm.sender = direct_owner
	direct_vm.value = int(float(claim["appeal_bond"]) * ATTO)
	contract.file_appeal(claim_id)
	direct_vm.value = 0

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "APPEAL_PENDING"
