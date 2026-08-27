"""Direct-mode coverage for treasury = SELF.

These tests deploy with the production constructor arg ("SELF"), so
get_treasury() is the contract's own address rather than the placeholder
used by the rest of the suite. Direct mode can prove:

- constructor rotation to contract_address
- tx-hash verification against that self address
- resolve + paid-flag payout on that deployment
- __receive__ is present and callable

It cannot prove the real EthSend type-handling path. The harness
intercepts transfers and credits vm._balances directly -- the Address-
construction failure that broke the original _pay_native is invisible
here. That specific fix is proven only by a live cycle.
"""

from test.direct.test_staking import (
	ATTO,
	FUTURE_DEADLINE,
	balance_of,
	force_evidence_locked,
	install_transfer_hook,
	mock_price,
)
from test.direct.tx_helpers import TEST_TREASURY, mock_studio_tx, next_tx_hash, register_stake


def deploy_self(direct_deploy):
	return direct_deploy("alpha_court.py", "test-surf-key", "SELF")


def test_self_treasury_is_contract_address_not_placeholder(direct_deploy):
	contract = deploy_self(direct_deploy)
	treasury = contract.get_treasury()
	assert treasury.lower().startswith("0x")
	assert len(treasury) == 42
	assert treasury.lower() != TEST_TREASURY.lower()
	assert treasury.lower() == contract.get_treasury().lower()


def test_self_treasury_rejects_placeholder_deposit(
	direct_vm, direct_deploy, direct_alice, direct_bob
):
	contract = deploy_self(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	mock_studio_tx(direct_vm, sender=direct_bob, value_atto=int(2 * ATTO), to=TEST_TREASURY)
	direct_vm.sender = direct_bob
	with direct_vm.expect_revert("transfer to does not match treasury"):
		contract.stake_for(claim_id, next_tx_hash())


def test_self_treasury_accepts_deposit_to_contract_and_pays_once(
	direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
	install_transfer_hook(direct_vm)
	contract = deploy_self(direct_deploy)
	treasury = contract.get_treasury()

	direct_vm.sender = direct_alice
	mock_price(direct_vm, 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	register_stake(
		contract, direct_vm, claim_id, "for", int(2 * ATTO), direct_bob, to=treasury
	)
	register_stake(
		contract, direct_vm, claim_id, "against", int(2 * ATTO), direct_charlie, to=treasury
	)

	force_evidence_locked(contract, claim_id, deadline_price=3500.0)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["paid"] is True
	assert claim["treasury"].lower() == treasury.lower()
	assert balance_of(direct_vm, direct_bob) == 4 * ATTO

	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("claim already paid"):
		contract.retry_payout(claim_id)
	assert balance_of(direct_vm, direct_bob) == 4 * ATTO


def test_receive_is_callable(direct_vm, direct_deploy, direct_alice):
	contract = deploy_self(direct_deploy)
	direct_vm.sender = direct_alice
	direct_vm.value = int(1 * ATTO)
	contract.__receive__()
	assert contract.get_treasury().lower() != TEST_TREASURY.lower()
