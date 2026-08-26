"""
Direct-mode tests for the Fundamentals Threshold claim type (Build Prompt 7).

Reuses every established pattern from the rest of this suite: storage
reach-ins for the deadline-time snapshot (lock_deadline_evidence's real
happy path needs a deadline that's actually passed, which direct mode's
frozen clock can't produce -- same standing limitation every prior claim
type's deadline fetch has had since Build Prompt 1), and the leader-only
install_verdict_hook pattern for controlling resolve_verdict's outcome.

Response shape note (Step 0 finding 1, alpha_court.py header): both real
Fundamentals endpoints return a TIME-SERIES array under "data"
({"data": [{"timestamp":.., "value":..}], ...}), not /market/price's
single-object envelope -- mock_fundamentals below mirrors that real shape.
"""

import json
import sys

import pytest

FUTURE_DEADLINE = "2999-01-01T00:00:00.000Z"

ATTO = 10**18


def deploy(direct_deploy):
	return direct_deploy("alpha_court.py", "test-surf-key", "0x1111111111111111111111111111111111111111")


def fundamentals_offset() -> int:
	"""Reads FUNDAMENTALS_SIGNED_OFFSET off the already-loaded contract
	module (sys.modules caches it under gltest's own dynamic loader --
	same constraint noted throughout this suite: genlayer.gl isn't
	importable via a plain sys.path import outside that loader) rather
	than hardcoding a value that could silently drift from the real
	constant."""
	return sys.modules["_contract_alpha_court"].FUNDAMENTALS_SIGNED_OFFSET


def mock_fundamentals(direct_vm, url_pattern: str, value: float, timestamp: int = 1700000000):
	"""Mirrors the real TIME-SERIES response shape confirmed during Step 0
	for both Fundamentals endpoints -- a list of {timestamp, value} points
	under "data", not /market/price's single-object envelope."""
	direct_vm.mock_web(
		url_pattern,
		{
			"status": 200,
			"body": json.dumps({"data": [{"timestamp": timestamp, "value": value}]}).encode(),
		},
	)


def mock_tvl(direct_vm, protocol: str, value: float):
	mock_fundamentals(direct_vm, rf".*project/defi/metrics\?q={protocol}.*", value)


def mock_onchain_indicator(direct_vm, symbol: str, metric: str, value: float):
	mock_fundamentals(
		direct_vm, rf".*market/onchain-indicator\?symbol={symbol}&metric={metric.lower()}.*", value
	)


def install_verdict_hook(direct_vm, response_text: str) -> None:
	def hook(vm, request):
		if "ExecPromptTemplate" in request:
			return {"ok": response_text}
		return None

	direct_vm._gl_call_hook = hook


def force_evidence_locked_fundamentals(contract, claim_id: str, deadline_value: float) -> None:
	offset = fundamentals_offset()
	claim = contract.claims[claim_id]
	claim.deadline_price_atto = int(round((deadline_value + offset) * ATTO))
	claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	claim.state = "EVIDENCE_LOCKED"
	contract.claims[claim_id] = claim


# ---------------------------------------------------------------------
# create_fundamentals_claim -- whitelist and asset-restriction enforcement
# ---------------------------------------------------------------------


def test_create_fundamentals_claim_non_whitelisted_metric_reverts(
	direct_vm, direct_deploy, direct_alice
):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("metric must be one of"):
		contract.create_fundamentals_claim("BTC", "RSI", "1.5", "above", FUTURE_DEADLINE)


def test_create_fundamentals_claim_onchain_metric_wrong_asset_reverts(
	direct_vm, direct_deploy, direct_alice
):
	"""MVRV/NUPL/SOPR only support symbol=BTC on the real Surf API (Step 0
	finding 3) -- confirms that restriction is actually enforced, not just
	documented."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("MVRV only supports asset 'BTC'"):
		contract.create_fundamentals_claim("ETH", "MVRV", "2.0", "above", FUTURE_DEADLINE)


def test_create_fundamentals_claim_tvl_allows_arbitrary_protocol(
	direct_vm, direct_deploy, direct_alice
):
	"""TVL has no symbol restriction -- confirms the BTC-only rule is
	specific to the three on-chain indicator metrics, not applied blanket
	across the whole whitelist."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_tvl(direct_vm, "uniswap", 3_500_000_000.0)

	claim_id = contract.create_fundamentals_claim(
		"uniswap", "TVL", "3000000000", "above", FUTURE_DEADLINE
	)

	claim = contract.get_claim(claim_id)
	assert claim["claim_type"] == "FUNDAMENTALS_THRESHOLD"
	assert claim["metric"] == "TVL"
	assert claim["asset"] == "uniswap"
	assert float(claim["threshold"]) == pytest.approx(3_000_000_000.0, rel=1e-9)
	assert float(claim["posting_price"]) == pytest.approx(3_500_000_000.0, rel=1e-9)
	assert claim["state"] == "OPEN"


def test_create_fundamentals_claim_past_deadline_reverts(direct_vm, direct_deploy, direct_alice):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("deadline must be in the future"):
		contract.create_fundamentals_claim(
			"BTC", "NUPL", "0.1", "above", "2000-01-01T00:00:00.000Z"
		)


# ---------------------------------------------------------------------
# resolve_verdict -- HELD and BROKEN across two different metrics
# ---------------------------------------------------------------------


def test_fundamentals_tvl_held_with_real_cited_evidence(direct_vm, direct_deploy, direct_alice):
	"""TVL crosses the threshold on the claimed 'above' side."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_tvl(direct_vm, "uniswap", 3_000_000_000.0)
	claim_id = contract.create_fundamentals_claim(
		"uniswap", "TVL", "3500000000", "above", FUTURE_DEADLINE
	)

	force_evidence_locked_fundamentals(contract, claim_id, deadline_value=4_000_000_000.0)

	install_verdict_hook(
		direct_vm,
		"The deadline TVL of 4000000000.0 exceeds the claimed threshold of "
		"3500000000.0 (posting TVL was 3000000000.0), so the verdict is HELD.",
	)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["consensus_result"] == "HELD"
	assert "HELD" in claim["verdict_text"]
	for figure in ("4000000000.0", "3500000000.0", "3000000000.0"):
		assert figure in claim["verdict_text"]


def test_fundamentals_nupl_broken_with_negative_values(direct_vm, direct_deploy, direct_alice):
	"""
	NUPL is the one whitelisted metric that goes negative -- this proves
	the FUNDAMENTALS_SIGNED_OFFSET encode/decode round-trips correctly all
	the way through creation, storage, the facts string handed to the
	leader, and back out through get_claim, not just for a positive value
	like TVL above.

	posting NUPL = -0.1, deadline NUPL = -0.3, threshold = -0.2, direction
	"above" -> -0.3 does NOT exceed -0.2 -> BROKEN.
	"""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_onchain_indicator(direct_vm, "BTC", "NUPL", -0.1)
	claim_id = contract.create_fundamentals_claim("BTC", "NUPL", "-0.2", "above", FUTURE_DEADLINE)

	claim = contract.get_claim(claim_id)
	assert float(claim["threshold"]) == pytest.approx(-0.2, rel=1e-9)
	assert float(claim["posting_price"]) == pytest.approx(-0.1, rel=1e-9)

	force_evidence_locked_fundamentals(contract, claim_id, deadline_value=-0.3)

	install_verdict_hook(
		direct_vm,
		"The deadline NUPL of -0.3 does not exceed the claimed threshold of "
		"-0.2 (posting NUPL was -0.1), so the verdict is BROKEN.",
	)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["consensus_result"] == "BROKEN"
	assert float(claim["deadline_price"]) == pytest.approx(-0.3, rel=1e-9)
	assert "BROKEN" in claim["verdict_text"]
	for figure in ("-0.3", "-0.2", "-0.1"):
		assert figure in claim["verdict_text"]


# ---------------------------------------------------------------------
# Alpha Passport -- three genuinely separate category entries
# ---------------------------------------------------------------------


def test_passport_category_breakdown_separates_all_three_claim_types(
	direct_vm, direct_deploy, direct_alice
):
	"""
	The real proof staking/appeals/Passport stayed generic across a THIRD
	claim type: one address posts one win of each type, and get_passport
	must show three genuinely separate category entries.
	"""
	contract = deploy(direct_deploy)

	# Price Threshold win.
	direct_vm.sender = direct_alice
	direct_vm.mock_web(
		r".*api\.asksurf\.ai.*market/price.*",
		{"status": 200, "body": json.dumps({"data": {"price": 2950.5}}).encode()},
	)
	pt_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)
	pt_claim = contract.claims[pt_id]
	pt_claim.deadline_price_atto = int(3500.0 * ATTO)
	pt_claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	pt_claim.state = "EVIDENCE_LOCKED"
	contract.claims[pt_id] = pt_claim
	install_verdict_hook(direct_vm, "Deadline 3500.0 exceeds threshold 3000.0 -- HELD.")
	direct_vm.sender = direct_alice
	contract.resolve_verdict(pt_id)
	assert contract.get_claim(pt_id)["consensus_result"] == "HELD"

	# Relative Performance win.
	direct_vm.sender = direct_alice
	direct_vm.mock_web(
		r".*symbol=BTC/USD.*",
		{"status": 200, "body": json.dumps({"data": {"price": 60000.0}}).encode()},
	)
	direct_vm.mock_web(
		r".*symbol=SOL/USD.*",
		{"status": 200, "body": json.dumps({"data": {"price": 100.0}}).encode()},
	)
	rp_id = contract.create_relative_performance_claim("BTC/USD", "SOL/USD", FUTURE_DEADLINE)
	rp_claim = contract.claims[rp_id]
	rp_claim.deadline_price_atto = int(72000.0 * ATTO)
	rp_claim.deadline_price_b_atto = int(105.0 * ATTO)
	rp_claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	rp_claim.state = "EVIDENCE_LOCKED"
	contract.claims[rp_id] = rp_claim
	install_verdict_hook(
		direct_vm,
		"asset_a went from 60000.0 to 72000.0 (+20%); asset_b went from 100.0 "
		"to 105.0 (+5%). asset_a outperformed, so HELD.",
	)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(rp_id)
	assert contract.get_claim(rp_id)["consensus_result"] == "HELD"

	# Fundamentals Threshold win.
	direct_vm.sender = direct_alice
	mock_tvl(direct_vm, "uniswap", 3_000_000_000.0)
	ft_id = contract.create_fundamentals_claim(
		"uniswap", "TVL", "3500000000", "above", FUTURE_DEADLINE
	)
	force_evidence_locked_fundamentals(contract, ft_id, deadline_value=4_000_000_000.0)
	install_verdict_hook(
		direct_vm, "Deadline TVL of 4000000000.0 exceeds threshold 3500000000.0 -- HELD."
	)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(ft_id)
	assert contract.get_claim(ft_id)["consensus_result"] == "HELD"

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 3
	assert passport["loss_count"] == 0
	assert passport["category_breakdown"] == {
		"PRICE_THRESHOLD": {"win_count": 1, "loss_count": 0},
		"RELATIVE_PERFORMANCE": {"win_count": 1, "loss_count": 0},
		"FUNDAMENTALS_THRESHOLD": {"win_count": 1, "loss_count": 0},
	}
	assert set(passport["claim_history"]) == {pt_id, rp_id, ft_id}
