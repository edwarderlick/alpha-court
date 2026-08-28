"""
Focused test suite addressing the Steward resubmission review:
1. "make deadline evidence verifiably correspond to the claim's declared time... delayed locking cannot change the sampled settlement time"
2. "parse and validate deadlines canonically"
3. "add a defined refund or reallocation path when the winning side has no stakers"
4. "every terminal payout branch accounts for all deposited funds"
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

STAKER_A = bytes.fromhex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
STAKER_B = bytes.fromhex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
FILER = bytes.fromhex("cccccccccccccccccccccccccccccccccccccccc")

ATTO = 10**18


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


# ============================================================================
# 1. Canonical Deadline Parsing & Validation Tests
# ============================================================================

def test_create_claim_enforces_canonical_deadline(direct_deploy, direct_vm):
	mock_price(direct_vm, 2000.0)
	c = deploy(direct_deploy)
	
	# Rejects non-canonical format (missing 'T' separator)
	with pytest.raises(Exception, match="deadline must contain 'T' separator"):
		c.create_claim("ETH/USD", "3000.0", "above", "2026-10-01 12:00:00Z")
	
	# Rejects missing Z or UTC indicator
	with pytest.raises(Exception, match="must be a canonical UTC ISO8601 string ending in 'Z'"):
		c.create_claim("ETH/USD", "3000.0", "above", "2026-10-01T12:00:00")
		
	# Rejects non-UTC timezone offset (+02:00)
	with pytest.raises(Exception, match="must be a canonical UTC ISO8601 string ending in 'Z'"):
		c.create_claim("ETH/USD", "3000.0", "above", "2026-10-01T12:00:00+02:00")
		
	# Rejects unpadded date components
	with pytest.raises(Exception, match="must be formatted as YYYY-MM-DD"):
		c.create_claim("ETH/USD", "3000.0", "above", "2026-9-1T12:00:00Z")
		
	# Rejects empty deadline
	with pytest.raises(Exception, match="deadline is required"):
		c.create_claim("ETH/USD", "3000.0", "above", "")

	# Rejects past deadline
	with pytest.raises(Exception, match="deadline must be in the future"):
		c.create_claim("ETH/USD", "3000.0", "above", "2020-01-01T00:00:00Z")

	# Accepts valid canonical format with Z
	cid = c.create_claim("ETH/USD", "3000.0", "above", "2026-10-01T12:00:00.000Z")
	assert c.get_claim(cid)["deadline"] == "2026-10-01T12:00:00.000Z"


def test_relative_and_fundamentals_claim_enforces_canonical_deadline(direct_deploy, direct_vm):
	mock_price(direct_vm, 2000.0)
	c = deploy(direct_deploy)
	
	with pytest.raises(Exception, match="must contain 'T' separator"):
		c.create_relative_performance_claim("ETH", "SOL", "2026-10-01 12:00:00Z")

	direct_vm.mock_web(
		r".*api\.asksurf\.ai.*",
		{"status": 200, "body": json.dumps({"data": [{"timestamp": "2026-08-20T00:00:00Z", "value": 1.5}]}).encode()},
	)
	with pytest.raises(Exception, match="must be a canonical UTC ISO8601 string ending in 'Z'"):
		c.create_fundamentals_claim("BTC", "MVRV", "2.0", "above", "2026-10-01T12:00:00")


# ============================================================================
# 2. Delayed Locking Cannot Change Sampled Settlement Time / Evidence
# ============================================================================

def test_delayed_locking_samples_declared_deadline_evidence(direct_deploy, direct_vm):
	"""
	Verifies that lock_deadline_evidence requests and pins evidence strictly
	to the declared deadline timestamp (claim.deadline), rather than the later
	time when lock_deadline_evidence happens to be called.
	"""
	mock_price(direct_vm, 2000.0)
	c = deploy(direct_deploy)
	
	cid = c.create_claim("ETH/USD", "2500.0", "above", DECLARED_DEADLINE)
	
	# Simulate deadline having passed: backdate stored deadline to permit lock_deadline_evidence
	claim = c.claims[cid]
	claim.deadline = "2026-08-01T12:00:00Z"
	c.claims[cid] = claim
	
	# Mock specifically intercepting the historical requested timestamp=2026-08-01T12:00:00Z
	mock_price(
		direct_vm,
		2800.0,
		url_pattern=r".*api\.asksurf\.ai.*market/price\?symbol=ETH/USD&timestamp=2026-08-01T12:00:00Z.*",
	)
	
	c.lock_deadline_evidence(cid)
	
	locked_claim = c.get_claim(cid)
	assert locked_claim["state"] == "EVIDENCE_LOCKED"
	assert locked_claim["deadline_price"] == "2800.0"
	# The sampled settlement timestamp verifiably corresponds to the declared deadline
	assert locked_claim["deadline_snapshot_at"] == "2026-08-01T12:00:00Z"


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
