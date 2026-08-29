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


# ============================================================================
# 1. Canonical Deadline Parsing & Validation Tests
# ============================================================================

def test_create_claim_enforces_canonical_deadline(direct_deploy, direct_vm):
	mock_price(direct_vm, 2000.0)
	c = deploy(direct_deploy)

	assert_canonical_deadline_rejections(
		lambda dl: c.create_claim("ETH/USD", "3000.0", "above", dl)
	)

	# Accepts valid canonical format with millis or lowercase z, normalizes to canonical YYYY-MM-DDTHH:MM:SSZ
	cid = c.create_claim("ETH/USD", "3000.0", "above", "2026-10-01T12:00:00.000Z")
	assert c.get_claim(cid)["deadline"] == "2026-10-01T12:00:00Z"

	cid2 = c.create_claim("ETH/USD", "3000.0", "above", "2026-10-01T12:00:00z")
	assert c.get_claim(cid2)["deadline"] == "2026-10-01T12:00:00Z"


def test_relative_claim_enforces_canonical_deadline(direct_deploy, direct_vm):
	mock_price(direct_vm, 2000.0)
	c = deploy(direct_deploy)
	assert_canonical_deadline_rejections(
		lambda dl: c.create_relative_performance_claim("ETH/USD", "SOL/USD", dl)
	)


def test_fundamentals_claim_enforces_canonical_deadline(direct_deploy, direct_vm):
	mock_json(
		direct_vm,
		r".*api\.asksurf\.ai.*",
		{"data": [{"timestamp": "2026-08-20T00:00:00Z", "value": 1.5}]},
	)
	c = deploy(direct_deploy)
	assert_canonical_deadline_rejections(
		lambda dl: c.create_fundamentals_claim("BTC", "MVRV", "2.0", "above", dl)
	)


# ============================================================================
# 2. Delayed Locking Cannot Change Sampled Settlement Time / Evidence
# ============================================================================

def test_delayed_locking_samples_declared_deadline_evidence(direct_deploy, direct_vm):
	"""Price Threshold: lock must use from/to, skip the post-deadline trap
	(data[0] / live 9999), and persist the payload point's timestamp."""
	mock_live_trap(direct_vm, "ETH/USD", 9999.0)
	c = deploy(direct_deploy)

	cid1 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	cid2 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	force_stored_deadline(c, cid1)
	force_stored_deadline(c, cid2)
	mock_lock_series(direct_vm, "ETH/USD", PRICE_TRAP_SERIES)

	set_vm_time(direct_vm, "2026-08-02T00:00:00Z")
	c.lock_deadline_evidence(cid1)
	locked1 = c.get_claim(cid1)

	set_vm_time(direct_vm, "2026-08-10T18:00:00Z")
	c.lock_deadline_evidence(cid2)
	locked2 = c.get_claim(cid2)

	assert locked1["state"] == "EVIDENCE_LOCKED"
	assert locked1["deadline_price"] == "2800.0"
	assert locked1["deadline_snapshot_at"] == CORRECT_SNAPSHOT
	assert locked2["deadline_price"] == locked1["deadline_price"]
	assert locked2["deadline_snapshot_at"] == locked1["deadline_snapshot_at"]


def test_delayed_locking_relative_performance_uses_from_to_and_payload_time(
	direct_deploy, direct_vm
):
	mock_live_trap(direct_vm, "ETH/USD", 9999.0)
	mock_live_trap(direct_vm, "SOL/USD", 8888.0)
	c = deploy(direct_deploy)

	cid1 = c.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)
	cid2 = c.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)
	force_stored_deadline(c, cid1)
	force_stored_deadline(c, cid2)
	mock_lock_series(direct_vm, "ETH/USD", PRICE_TRAP_SERIES)
	mock_lock_series(direct_vm, "SOL/USD", SOL_TRAP_SERIES)

	set_vm_time(direct_vm, "2026-08-02T00:00:00Z")
	c.lock_deadline_evidence(cid1)
	locked1 = c.get_claim(cid1)

	set_vm_time(direct_vm, "2026-08-10T18:00:00Z")
	c.lock_deadline_evidence(cid2)
	locked2 = c.get_claim(cid2)

	assert locked1["deadline_price"] == "2800.0"
	assert locked1["deadline_price_b"] == "100.0"
	# shared fetched_at = later of the two selected points (11:00 > 10:00)
	assert locked1["deadline_snapshot_at"] == CORRECT_SNAPSHOT
	assert locked2["deadline_price"] == locked1["deadline_price"]
	assert locked2["deadline_price_b"] == locked1["deadline_price_b"]
	assert locked2["deadline_snapshot_at"] == locked1["deadline_snapshot_at"]


def test_delayed_locking_fundamentals_selects_point_at_or_before_deadline(
	direct_deploy, direct_vm
):
	# Posting-time series (no extra query params).
	mock_json(
		direct_vm,
		r".*market/onchain-indicator\?symbol=BTC&metric=mvrv.*",
		{"data": [{"timestamp": "2026-07-01T00:00:00Z", "value": 1.5}]},
	)
	c = deploy(direct_deploy)
	cid1 = c.create_fundamentals_claim("BTC", "MVRV", "2.0", "above", FUTURE_DEADLINE)
	cid2 = c.create_fundamentals_claim("BTC", "MVRV", "2.0", "above", FUTURE_DEADLINE)
	force_stored_deadline(c, cid1)
	force_stored_deadline(c, cid2)

	# If lock still appends timestamp=, this trap wins (only post-deadline 9999).
	mock_json(
		direct_vm,
		r".*onchain-indicator.*timestamp=.*",
		{"data": [{"timestamp": TRAP_POST_DEADLINE, "value": 9999.0}]},
	)
	# Lock URL without timestamp=: trap series, must skip data[0].
	mock_json(
		direct_vm,
		r".*market/onchain-indicator\?symbol=BTC&metric=mvrv$",
		FUND_TRAP_SERIES,
	)

	set_vm_time(direct_vm, "2026-08-02T00:00:00Z")
	c.lock_deadline_evidence(cid1)
	locked1 = c.get_claim(cid1)

	set_vm_time(direct_vm, "2026-08-10T18:00:00Z")
	c.lock_deadline_evidence(cid2)
	locked2 = c.get_claim(cid2)

	assert locked1["deadline_price"] == "2.8"
	assert locked1["deadline_snapshot_at"] == CORRECT_SNAPSHOT
	assert locked2["deadline_price"] == locked1["deadline_price"]
	assert locked2["deadline_snapshot_at"] == locked1["deadline_snapshot_at"]


def test_lock_rejects_single_dict_payload_after_deadline(direct_deploy, direct_vm):
	"""A single dict payload (non-list) after the deadline must be rejected with [EXTERNAL]
	and must not freeze post-deadline price 9999."""
	mock_live_trap(direct_vm, "ETH/USD", 9999.0)
	c = deploy(direct_deploy)
	cid = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	force_stored_deadline(c, cid)
	mock_lock_series(
		direct_vm,
		"ETH/USD",
		{"data": {"timestamp": TRAP_POST_DEADLINE, "price": 9999.0}},
	)
	set_vm_time(direct_vm, "2026-08-02T00:00:00Z")
	with pytest.raises(Exception, match=r"\[EXTERNAL\]"):
		c.lock_deadline_evidence(cid)
	unlocked = c.get_claim(cid)
	assert unlocked["state"] == "OPEN"
	assert unlocked["deadline_snapshot_at"] == ""


def test_lock_accepts_single_dict_payload_at_or_before_deadline(direct_deploy, direct_vm):
	"""A single dict payload (non-list) with timestamp <= deadline is accepted,
	storing the point's timestamp (not request deadline)."""
	mock_live_trap(direct_vm, "ETH/USD", 9999.0)
	c = deploy(direct_deploy)
	cid = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	force_stored_deadline(c, cid)
	mock_lock_series(
		direct_vm,
		"ETH/USD",
		{"data": {"timestamp": CORRECT_SNAPSHOT, "price": 2800.0}},
	)
	set_vm_time(direct_vm, "2026-08-02T00:00:00Z")
	c.lock_deadline_evidence(cid)
	locked = c.get_claim(cid)
	assert locked["state"] == "EVIDENCE_LOCKED"
	assert locked["deadline_price"] == "2800.0"
	assert locked["deadline_snapshot_at"] == CORRECT_SNAPSHOT


def test_lock_fetched_at_never_falls_back_to_request_deadline(direct_deploy, direct_vm):
	"""If point timestamp is missing or unparseable, lock must raise [EXTERNAL]
	and never fall back to request deadline."""
	mock_live_trap(direct_vm, "ETH/USD", 9999.0)
	c = deploy(direct_deploy)
	cid = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	force_stored_deadline(c, cid)
	mock_lock_series(
		direct_vm,
		"ETH/USD",
		{"data": [{"price": 2800.0}]},
	)
	set_vm_time(direct_vm, "2026-08-02T00:00:00Z")
	with pytest.raises(Exception, match=r"\[EXTERNAL\]"):
		c.lock_deadline_evidence(cid)
	unlocked = c.get_claim(cid)
	assert unlocked["state"] == "OPEN"
	assert unlocked["deadline_snapshot_at"] == ""


# ============================================================================
# 3. Defined Refund Path When Winning Side Has No Stakers
# ============================================================================

def test_zero_stakers_on_winning_side_refunds_all_deposited_funds(direct_deploy, direct_vm):
	"""
	When a claim resolves HELD (winning side = FOR), but nobody staked FOR
	(FOR pool = 0), and stakers staked AGAINST (e.g. 5 GEN):
	_payout_for_claim must execute _refund_all_stakes and refund 100% of
	the AGAINST stake, leaving 0 funds trapped in the contract.
	"""
	mock_price(direct_vm, 2000.0)
	install_payout_and_verdict_hook(
		direct_vm,
		"HELD. At posting time ETH was 2000.0 and at deadline was 3000.0, exceeding threshold 2500.0.",
	)
	c = deploy(direct_deploy)
	cid = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)

	# User B stakes 5 GEN AGAINST (Nobody stakes FOR)
	register_stake(c, direct_vm, cid, "against", 5 * ATTO, STAKER_B)
	assert balance_of(direct_vm, STAKER_B) == 0

	# Advance to EVIDENCE_LOCKED with price 3000 (above threshold 2500 -> HELD)
	claim = c.claims[cid]
	claim.state = "EVIDENCE_LOCKED"
	claim.deadline_price_atto = 3000 * ATTO
	claim.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid] = claim

	c.resolve_verdict(cid)

	resolved = c.get_claim(cid)
	assert resolved["state"] == "RESOLVED"
	assert resolved["consensus_result"] == "HELD"
	assert resolved["paid"] is True

	# Verify that Staker B (the sole AGAINST staker) received a 100% refund of their 5 GEN
	assert balance_of(direct_vm, STAKER_B) == 5 * ATTO


# ============================================================================
# 4. Comprehensive Audit: Every Terminal Payout Branch Accounts for 100% of Funds
# ============================================================================

def test_all_terminal_payout_branches_account_for_all_deposited_funds(direct_deploy, direct_vm):
	"""
	Verify 100% fund disbursement and conservation across all terminal payout paths:
	Branch 1: Normal RESOLVED win (Proportional pool split)
	Branch 2: Zero-winner RESOLVED (Full stake refund)
	Branch 3: REFUNDED via expire_appeal (Full stake refund)
	Branch 4: SETTLED via resolve_appeal (Proportional win + 100% bond return)
	Branch 5: NO_AGREEMENT via resolve_appeal (Full stake refund + 100% bond split)
	"""
	mock_price(direct_vm, 2000.0)
	install_payout_and_verdict_hook(direct_vm, "HELD. Price 3000 exceeds 2500.")
	c = deploy(direct_deploy)

	# --- Branch 1: Normal RESOLVED Win (2 GEN FOR vs 1 GEN AGAINST) ---
	cid1 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	register_stake(c, direct_vm, cid1, "for", 2 * ATTO, STAKER_A)
	register_stake(c, direct_vm, cid1, "against", 1 * ATTO, STAKER_B)

	claim1 = c.claims[cid1]
	claim1.state = "EVIDENCE_LOCKED"
	claim1.deadline_price_atto = 3000 * ATTO
	claim1.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid1] = claim1

	c.resolve_verdict(cid1)
	# Winner (A) gets 2 GEN stake + 1 GEN losing pool = 3 GEN (100% of 3 GEN deposited)
	assert balance_of(direct_vm, STAKER_A) == 3 * ATTO
	assert balance_of(direct_vm, STAKER_B) == 0

	# --- Branch 2: Zero-Winner RESOLVED (0 GEN FOR vs 3 GEN AGAINST -> HELD outcome refunds 3 GEN) ---
	cid2 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	register_stake(c, direct_vm, cid2, "against", 3 * ATTO, STAKER_B)

	claim2 = c.claims[cid2]
	claim2.state = "EVIDENCE_LOCKED"
	claim2.deadline_price_atto = 3000 * ATTO
	claim2.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid2] = claim2

	bal_b_before = balance_of(direct_vm, STAKER_B)
	c.resolve_verdict(cid2)
	# Against staker B receives 100% refund of 3 GEN stake (100% of 3 GEN deposited)
	assert balance_of(direct_vm, STAKER_B) == bal_b_before + 3 * ATTO

	# --- Branch 3: REFUNDED via expire_appeal (2 GEN FOR + 1 GEN AGAINST) ---
	cid3 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	register_stake(c, direct_vm, cid3, "for", 2 * ATTO, STAKER_A)
	register_stake(c, direct_vm, cid3, "against", 1 * ATTO, STAKER_B)

	claim3 = c.claims[cid3]
	claim3.state = "CONTESTED"
	claim3.contested_at = "2026-08-20T00:00:00Z"
	c.claims[cid3] = claim3

	bal_a_before = balance_of(direct_vm, STAKER_A)
	bal_b_before = balance_of(direct_vm, STAKER_B)

	c.expire_appeal(cid3)
	# Both get exact stake refunded: A +2 GEN, B +1 GEN (100% of 3 GEN deposited)
	assert balance_of(direct_vm, STAKER_A) == bal_a_before + 2 * ATTO
	assert balance_of(direct_vm, STAKER_B) == bal_b_before + 1 * ATTO

	# --- Branch 4: SETTLED Appeal (Winners paid + bond returned to filer) ---
	cid4 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	register_stake(c, direct_vm, cid4, "for", 2 * ATTO, STAKER_A)
	register_stake(c, direct_vm, cid4, "against", 2 * ATTO, STAKER_B)

	claim4 = c.claims[cid4]
	claim4.state = "CONTESTED"
	claim4.contested_at = "2026-08-28T00:00:00Z"
	claim4.appeal_bond_atto = 1 * ATTO
	c.claims[cid4] = claim4

	register_appeal(c, direct_vm, cid4, 1 * ATTO, FILER)

	claim4 = c.claims[cid4]
	assert claim4.state == "APPEAL_PENDING"
	claim4.deadline_price_atto = 3000 * ATTO
	claim4.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid4] = claim4

	bal_a_before = balance_of(direct_vm, STAKER_A)
	bal_f_before = balance_of(direct_vm, FILER)

	c.resolve_appeal(cid4)
	# Winner A gets 2 + 2 = 4 GEN. Filer gets 1 GEN bond back. Total 5 GEN (100%)
	assert balance_of(direct_vm, STAKER_A) == bal_a_before + 4 * ATTO
	assert balance_of(direct_vm, FILER) == bal_f_before + 1 * ATTO

	# --- Branch 5: NO_AGREEMENT Appeal (Stakes refunded + bond evenly split) ---
	cid5 = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	register_stake(c, direct_vm, cid5, "for", 2 * ATTO, STAKER_A)
	register_stake(c, direct_vm, cid5, "against", 2 * ATTO, STAKER_B)

	claim5 = c.claims[cid5]
	claim5.state = "CONTESTED"
	claim5.contested_at = "2026-08-28T00:00:00Z"
	claim5.appeal_bond_atto = 1 * ATTO
	c.claims[cid5] = claim5

	register_appeal(c, direct_vm, cid5, 1 * ATTO, FILER)

	claim5 = c.claims[cid5]
	assert claim5.state == "APPEAL_PENDING"
	claim5.deadline_price_atto = 3000 * ATTO
	claim5.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid5] = claim5

	# Inconclusive hook for round 2
	install_payout_and_verdict_hook(direct_vm, "Evidence is inconclusive.")

	bal_a_before = balance_of(direct_vm, STAKER_A)
	bal_b_before = balance_of(direct_vm, STAKER_B)

	c.resolve_appeal(cid5)
	# Stakers A and B get 2 GEN stake refund + 0.5 GEN bond share each = 2.5 GEN each (100% of 5 GEN deposited)
	assert balance_of(direct_vm, STAKER_A) == bal_a_before + int(2.5 * ATTO)
	assert balance_of(direct_vm, STAKER_B) == bal_b_before + int(2.5 * ATTO)


def test_settled_zero_winner_refunds_against_stakes_and_returns_bond(
	direct_deploy, direct_vm
):
	"""SETTLED + winning_pool==0: AGAINST-only stakes refunded AND bond
	returned to filer; 100% of stakes+bond leave."""
	mock_price(direct_vm, 2000.0)
	install_payout_and_verdict_hook(direct_vm, "HELD. Price 3000 exceeds 2500.")
	c = deploy(direct_deploy)

	cid = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)
	register_stake(c, direct_vm, cid, "against", 3 * ATTO, STAKER_B)

	claim = c.claims[cid]
	claim.state = "CONTESTED"
	claim.contested_at = "2026-08-28T00:00:00Z"
	claim.appeal_bond_atto = 1 * ATTO
	claim.deadline_price_atto = 3000 * ATTO
	claim.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid] = claim

	register_appeal(c, direct_vm, cid, 1 * ATTO, FILER)

	bal_b_before = balance_of(direct_vm, STAKER_B)
	bal_f_before = balance_of(direct_vm, FILER)
	c.resolve_appeal(cid)

	settled = c.get_claim(cid)
	assert settled["state"] == "RESOLVED"
	assert settled["consensus_result"] == "HELD"
	assert balance_of(direct_vm, STAKER_B) == bal_b_before + 3 * ATTO
	assert balance_of(direct_vm, FILER) == bal_f_before + 1 * ATTO


def test_no_agreement_zero_stakers_returns_bond_to_filer(direct_deploy, direct_vm):
	"""NO_AGREEMENT + zero original stakers: 1 GEN floor bond must return
	to the filer, not remain stranded in the contract."""
	mock_price(direct_vm, 2000.0)
	c = deploy(direct_deploy)

	# create with no posting stake; skip staking entirely
	cid = c.create_claim("ETH/USD", "2500.0", "above", FUTURE_DEADLINE)

	claim = c.claims[cid]
	claim.state = "CONTESTED"
	claim.contested_at = "2026-08-28T00:00:00Z"
	claim.appeal_bond_atto = 1 * ATTO
	claim.deadline_price_atto = 3000 * ATTO
	claim.deadline_fetched_at = DECLARED_DEADLINE
	c.claims[cid] = claim

	register_appeal(c, direct_vm, cid, 1 * ATTO, FILER)
	claim = c.claims[cid]
	assert claim.state == "APPEAL_PENDING"

	install_payout_and_verdict_hook(direct_vm, "Evidence is inconclusive.")

	bal_f_before = balance_of(direct_vm, FILER)
	c.resolve_appeal(cid)

	refunded = c.get_claim(cid)
	assert refunded["state"] == "REFUNDED"
	assert refunded["appeal_outcome"] == "NO_AGREEMENT"
	assert balance_of(direct_vm, FILER) == bal_f_before + 1 * ATTO
