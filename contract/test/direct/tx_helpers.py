"""Helpers for the non-custodial deposit path.

Direct-mode tests cannot attach payable value anymore. Each stake/bond
is a mocked Studio `eth_getTransactionByHash` response whose canonical
{from,to,value,status} the contract strict_eq-fetches, matching the
real probe on 0x55F07Ac9….
"""

from __future__ import annotations

import json
import re

TEST_TREASURY = "0x1111111111111111111111111111111111111111"
ATTO = 10**18


def apply_native_send(vm, request) -> bytes | None:
	"""Credit a simulated emit_transfer. Storage-Address EOA sends are
	EthSend (the proven _ExternalRecipient path). IC-to-IC is PostMessage."""
	msg = request.get("EthSend") or request.get("PostMessage")
	if not msg:
		return None
	addr = msg["address"]
	addr_bytes = addr.as_bytes if hasattr(addr, "as_bytes") else bytes(addr)
	value = int(msg.get("value", 0))
	vm._balances[addr_bytes] = vm._balances.get(addr_bytes, 0) + value
	return b""

_tx_counter = 0


def next_tx_hash() -> str:
	global _tx_counter
	_tx_counter += 1
	return "0x" + format(_tx_counter, "x").zfill(64)


def sender_hex(sender) -> str:
	if hasattr(sender, "hex"):
		h = sender.hex()
		return ("0x" + h) if not h.startswith("0x") else h
	text = str(sender)
	return text if text.startswith("0x") else "0x" + text


def deploy_court(direct_deploy, surf_base_url=None):
	if surf_base_url is None:
		return direct_deploy("alpha_court.py", "test-surf-key", TEST_TREASURY)
	return direct_deploy("alpha_court.py", "test-surf-key", TEST_TREASURY, surf_base_url)


def mock_studio_tx(
	direct_vm,
	*,
	sender,
	value_atto,
	to: str = TEST_TREASURY,
	status: str = "FINALIZED",
	missing: bool = False,
):
	if missing:
		payload = {"jsonrpc": "2.0", "id": 1, "result": None}
	else:
		payload = {
			"jsonrpc": "2.0",
			"id": 1,
			"result": {
				"from_address": sender_hex(sender).lower(),
				"to_address": to.lower(),
				"value": int(value_atto),
				"status": status,
			},
		}
	# Direct mode matches URL + method (default GET). Insert at the front
	# so a later stake/bond in the same test sees this transfer, not an
	# earlier Studio POST mock. Surf GET mocks are unaffected.
	direct_vm._web_mocks.insert(
		0,
		(
			re.compile(r".*studio\.genlayer\.com.*"),
			{
				"status": 200,
				"body": json.dumps(payload).encode(),
				"method": "POST",
			},
		),
	)


def register_stake(contract, direct_vm, claim_id, side, amount_atto, sender, tx_hash=None):
	tx_hash = tx_hash or next_tx_hash()
	mock_studio_tx(direct_vm, sender=sender, value_atto=amount_atto)
	direct_vm.sender = sender
	if side == "for":
		contract.stake_for(claim_id, tx_hash)
	else:
		contract.stake_against(claim_id, tx_hash)
	return tx_hash


def bond_atto(contract, claim_id) -> int:
	return int(float(contract.get_claim(claim_id)["appeal_bond"]) * ATTO)


def register_appeal(contract, direct_vm, claim_id, amount_atto, sender, tx_hash=None):
	tx_hash = tx_hash or next_tx_hash()
	mock_studio_tx(direct_vm, sender=sender, value_atto=amount_atto)
	direct_vm.sender = sender
	contract.file_appeal(claim_id, tx_hash)
	return tx_hash
