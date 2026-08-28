"""
Focused test suite addressing the Steward resubmission review:
1. "make deadline evidence verifiably correspond to the claim's declared time... delayed locking cannot change the sampled settlement time"
2. "parse and validate deadlines canonically"
3. "add a defined refund or reallocation path when the winning side has no stakers"
4. "every terminal payout branch accounts for all deposited funds"

Lock tests would FAIL if the contract still used live `?symbol=` only, an
undocumented timestamp= query param, data[0], or assigned fetched_at from
claim.deadline instead of the selected payload point.
"""

import json
import re
import pytest

from test.direct.tx_helpers import (
	apply_native_send,
	mock_studio_tx,
	next_tx_hash,
	register_appeal,
	register_stake,
)

TEST_TREASURY = "0x1111111111111111111111111111111111111111"
DECLARED_DEADLINE = "2026-10-01T12:00:00Z"
FUTURE_DEADLINE = "2999-01-01T00:00:00.000Z"
LOCK_DEADLINE = "2026-08-01T12:00:00Z"
LOCK_UNIX_TO = 1785585600  # unix(LOCK_DEADLINE)
LOCK_UNIX_FROM = LOCK_UNIX_TO - 86400
CORRECT_SNAPSHOT = "2026-08-01T11:00:00Z"
TRAP_POST_DEADLINE = "2026-08-01T18:00:00Z"

STAKER_A = bytes.fromhex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
STAKER_B = bytes.fromhex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
FILER = bytes.fromhex("cccccccccccccccccccccccccccccccccccccccc")

ATTO = 10**18

# FIRST element is a post-deadline / live trap. A later element is the
# last point at or before LOCK_DEADLINE. data[0] or a live fetch must not win.
PRICE_TRAP_SERIES = {
	"data": [
		{"timestamp": TRAP_POST_DEADLINE, "value": 9999.0},
		{"timestamp": CORRECT_SNAPSHOT, "value": 2800.0},
	]
}
SOL_TRAP_SERIES = {
	"data": [
		{"timestamp": TRAP_POST_DEADLINE, "value": 8888.0},
		{"timestamp": "2026-08-01T10:00:00Z", "value": 100.0},
	]
}
FUND_TRAP_SERIES = {
	"data": [
		{"timestamp": TRAP_POST_DEADLINE, "value": 9999.0},
		{"timestamp": CORRECT_SNAPSHOT, "value": 2.8},
	]
}


def deploy(direct_deploy):
	return direct_deploy("alpha_court.py", "test-surf-key", TEST_TREASURY)


def mock_price(direct_vm, price: float, url_pattern: str = r".*api\.asksurf\.ai.*market/price.*"):
	direct_vm._web_mocks.insert(
		0,
		(
			re.compile(url_pattern),
			{"status": 200, "body": json.dumps({"data": {"price": price}}).encode()},
		),
	)


def mock_live_trap(direct_vm, asset: str, price: float = 9999.0):
	"""Matches live `?symbol=` and undocumented timestamp=; does not match from/to."""
	pattern = rf".*market/price\?symbol={re.escape(asset)}(?!&from=).*"
	direct_vm._web_mocks.insert(
		0,
		(
			re.compile(pattern),
			{"status": 200, "body": json.dumps({"data": {"price": price}}).encode()},
		),
	)


def mock_lock_series(direct_vm, asset: str, series: dict):
	"""Lock path must hit from= and to= (unix seconds). timestamp= / bare symbol miss this."""
	pattern = (
		rf".*market/price\?symbol={re.escape(asset)}"
		rf"&from={LOCK_UNIX_FROM}&to={LOCK_UNIX_TO}.*"
	)
	direct_vm._web_mocks.insert(
		0,
		(
			re.compile(pattern),
			{"status": 200, "body": json.dumps(series).encode()},
		),
	)


def mock_json(direct_vm, url_pattern: str, payload: dict):
	direct_vm._web_mocks.insert(
		0,
		(
			re.compile(url_pattern),
			{"status": 200, "body": json.dumps(payload).encode()},
		),
	)


def install_payout_and_verdict_hook(direct_vm, verdict_text: str = "HELD. Price exceeds threshold."):
	def hook(vm, request):
		applied = apply_native_send(vm, request)
		if applied is not None:
			return applied
		if "ExecPromptTemplate" in request:
			return {"ok": verdict_text}
		return None
	direct_vm._gl_call_hook = hook


def balance_of(direct_vm, address: bytes) -> int:
	return direct_vm._balances.get(address, 0)


def set_vm_time(direct_vm, iso: str) -> None:
	if hasattr(direct_vm, "_datetime"):
		direct_vm._datetime = iso


def force_stored_deadline(contract, claim_id: str, deadline: str = LOCK_DEADLINE) -> None:
	claim = contract.claims[claim_id]
	claim.deadline = deadline
	contract.claims[claim_id] = claim


def assert_canonical_deadline_rejections(create_fn):
	with pytest.raises(Exception, match="deadline must contain 'T' separator"):
		create_fn("2026-10-01 12:00:00Z")
	with pytest.raises(Exception, match="must be a canonical UTC ISO8601 string ending in 'Z'"):
		create_fn("2026-10-01T12:00:00")
	with pytest.raises(Exception, match="must be a canonical UTC ISO8601 string ending in 'Z'"):
		create_fn("2026-10-01T12:00:00+02:00")
	with pytest.raises(Exception, match="must be formatted as YYYY-MM-DD"):
		create_fn("2026-9-1T12:00:00Z")
	with pytest.raises(Exception, match="deadline is required"):
		create_fn("")
	with pytest.raises(Exception, match="deadline must be in the future"):
		create_fn("2020-01-01T00:00:00Z")
