"""
Direct-mode tests for the Relative Performance claim type (Build Prompt 6).

Reuses every pattern already established in test_alpha_court.py/
test_staking.py/test_appeals.py/test_passport.py: force_evidence_locked-style
storage reach-ins (direct mode's frozen clock can't reach a real deadline
within one deployment -- same limitation Price Threshold's own
lock_deadline_evidence happy path has had since Build Prompt 1), and the
install_verdict_hook leader-only pattern for controlling resolve_verdict's
outcome (direct mode runs only leader_fn -- see alpha_court.py's header).

Cost-confirmation note (see test_relative_performance_posting_fetch_costs_
two_real_calls below): this file can only exercise create_relative_
performance_claim's REAL posting-time fetch, not lock_deadline_evidence's --
that one requires a deadline that has actually passed, which direct mode's
frozen-at-deploy-time clock cannot produce (identical, already-documented
limitation to Price Threshold's own deadline fetch). The deadline-time
fetch is structurally the exact same _fetch_prices_with_consensus call,
so the posting-side proof here (2 real HTTP calls, one per asset, in one
non-det round) is the real, executable half of confirming §4b's ~4N
estimate; the other half remains integration-test-only, same as it always
has been for this contract's deadline fetches.
"""

import json

import pytest

FUTURE_DEADLINE = "2999-01-01T00:00:00.000Z"

ATTO = 10**18


def deploy(direct_deploy):
	return direct_deploy("alpha_court.py", "test-surf-key")


def mock_price_for(direct_vm, asset: str, price: float):
	"""Registers a price mock keyed to one specific asset's symbol in the
	query string (`?symbol=<asset>`) -- distinct from test_alpha_court.py's
	single-asset mock_price, since Relative Performance needs two DIFFERENT
	prices mocked at once and _match_web_mock matches by URL pattern, first
	registration wins (see gltest/direct/vm.py's _match_web_mock, confirmed
	by source)."""
	direct_vm.mock_web(
		rf".*api\.asksurf\.ai.*market/price\?symbol={asset}.*",
		{"status": 200, "body": json.dumps({"data": {"price": price}}).encode()},
	)


def install_verdict_hook(direct_vm, response_text: str) -> None:
	def hook(vm, request):
		if "ExecPromptTemplate" in request:
			return {"ok": response_text}
		return None

	direct_vm._gl_call_hook = hook


def force_evidence_locked_rp(
	contract, claim_id: str, deadline_price_a: float, deadline_price_b: float
) -> None:
	"""Same storage reach-in pattern as test_staking.py's/test_appeals.py's
	force_evidence_locked, extended for Relative Performance's second price
	field -- see this module's own docstring for why lock_deadline_evidence
	itself can't run for real here."""
	claim = contract.claims[claim_id]
	claim.deadline_price_atto = int(deadline_price_a * ATTO)
	claim.deadline_price_b_atto = int(deadline_price_b * ATTO)
	claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	claim.state = "EVIDENCE_LOCKED"
	contract.claims[claim_id] = claim


def count_web_calls(direct_vm) -> dict:
	"""Wraps VMContext._match_web_mock (the real per-request dispatch point,
	confirmed by reading gltest/direct/vm.py) to count every real web-fetch
	attempt the leader's execution makes -- the load-bearing number behind
	§4b's ~4N cost estimate (this counts the per-validator-leader side of
	it; N-way multiplication across real validators is an integration-test
	concern, per this module's docstring)."""
	original = direct_vm._match_web_mock
	counters = {"n": 0}

	def wrapper(url, method="GET"):
		counters["n"] += 1
		return original(url, method)

	direct_vm._match_web_mock = wrapper
	return counters


# ---------------------------------------------------------------------
# create_relative_performance_claim -- validation
# ---------------------------------------------------------------------


def test_create_relative_performance_claim_same_asset_reverts(
	direct_vm, direct_deploy, direct_alice
):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("asset_a and asset_b must be different"):
		contract.create_relative_performance_claim("ETH/USD", "ETH/USD", FUTURE_DEADLINE)


def test_create_relative_performance_claim_past_deadline_reverts(
	direct_vm, direct_deploy, direct_alice
):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	with direct_vm.expect_revert("deadline must be in the future"):
		contract.create_relative_performance_claim(
			"ETH/USD", "SOL/USD", "2000-01-01T00:00:00.000Z"
		)


def test_create_relative_performance_claim_happy_path_populates_both_assets(
	direct_vm, direct_deploy, direct_alice
):
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)

	claim_id = contract.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)

	claim = contract.get_claim(claim_id)
	assert claim["claim_type"] == "RELATIVE_PERFORMANCE"
	assert claim["asset"] == "ETH/USD"
	assert claim["asset_b"] == "SOL/USD"
	assert float(claim["posting_price"]) == pytest.approx(2000.0, rel=1e-9)
	assert float(claim["posting_price_b"]) == pytest.approx(100.0, rel=1e-9)
	assert claim["deadline_price"] is None
	assert claim["deadline_price_b"] is None
	assert claim["state"] == "OPEN"
	# No Price Threshold fields leak in for this claim type.
	assert float(claim["threshold"]) == 0.0
	assert claim["direction"] == ""


def test_get_claim_price_threshold_has_no_asset_b(direct_vm, direct_deploy, direct_alice):
	"""Confirms the reverse -- a Price Threshold claim's new asset_b/
	posting_price_b/deadline_price_b fields are None, not a stray empty
	string or zero leaking through."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2950.5)
	claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	claim = contract.get_claim(claim_id)
	assert claim["claim_type"] == "PRICE_THRESHOLD"
	assert claim["asset_b"] is None
	assert claim["posting_price_b"] is None
	assert claim["deadline_price_b"] is None


# ---------------------------------------------------------------------
# resolve_verdict -- HELD and BROKEN, with real cited evidence
# ---------------------------------------------------------------------


def test_relative_performance_held_with_real_cited_evidence(
	direct_vm, direct_deploy, direct_alice
):
	"""
	asset_a (ETH) genuinely outperforms asset_b (SOL): ETH +20% (2000 ->
	2400), SOL +10% (100 -> 110). Leader's real verdict text is asserted
	against directly -- not just the resulting state -- confirming it cites
	all four real prices, matching this build's verification requirement.
	"""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)
	claim_id = contract.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)

	force_evidence_locked_rp(contract, claim_id, deadline_price_a=2400.0, deadline_price_b=110.0)

	install_verdict_hook(
		direct_vm,
		"asset_a (ETH/USD) moved from 2000.0 to 2400.0, a +20% change. asset_b "
		"(SOL/USD) moved from 100.0 to 110.0, a +10% change. Since 20% exceeds "
		"10%, asset_a outperformed asset_b, so the verdict is HELD.",
	)

	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["consensus_result"] == "HELD"
	assert "HELD" in claim["verdict_text"]
	for figure in ("2000.0", "2400.0", "100.0", "110.0"):
		assert figure in claim["verdict_text"]


def test_relative_performance_broken_with_real_cited_evidence(
	direct_vm, direct_deploy, direct_alice
):
	"""asset_a (ETH) underperforms asset_b (SOL): ETH +5% (2000 -> 2100),
	SOL +30% (100 -> 130)."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)
	claim_id = contract.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)

	force_evidence_locked_rp(contract, claim_id, deadline_price_a=2100.0, deadline_price_b=130.0)

	install_verdict_hook(
		direct_vm,
		"asset_a (ETH/USD) moved from 2000.0 to 2100.0, a +5% change. asset_b "
		"(SOL/USD) moved from 100.0 to 130.0, a +30% change. Since 5% does not "
		"exceed 30%, asset_a did not outperform asset_b, so the verdict is BROKEN.",
	)

	direct_vm.sender = direct_alice
	contract.resolve_verdict(claim_id)

	claim = contract.get_claim(claim_id)
	assert claim["state"] == "RESOLVED"
	assert claim["consensus_result"] == "BROKEN"
	assert "BROKEN" in claim["verdict_text"]
	for figure in ("2000.0", "2100.0", "100.0", "130.0"):
		assert figure in claim["verdict_text"]


# ---------------------------------------------------------------------
# Category B cost confirmation (§4b's ~4N estimate)
# ---------------------------------------------------------------------


def test_relative_performance_posting_fetch_costs_two_real_calls(
	direct_vm, direct_deploy, direct_alice
):
	"""
	Confirms the leader-side building block behind §4b's ~4N estimate: one
	posting-time snapshot for a Relative Performance claim makes exactly 2
	real HTTP calls (one per asset), bundled into a single non-det round
	(one leader_fn execution), not deduplicated or shared. Multiplied by N
	real validators (each independently re-fetching both assets to check
	the leader), that's 2N calls per snapshot -- 2N (posting) + 2N
	(deadline) = 4N per fully-resolved claim, exactly matching §4b. See
	module docstring for why only the posting side is executable in direct
	mode.
	"""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)

	counters = count_web_calls(direct_vm)
	claim_id = contract.create_relative_performance_claim("ETH/USD", "SOL/USD", FUTURE_DEADLINE)

	assert counters["n"] == 2  # exactly one real fetch per asset, this snapshot

	# Independently confirms the two fetches weren't accidentally shared/
	# deduplicated -- each asset really did get its own distinct price.
	claim = contract.get_claim(claim_id)
	assert float(claim["posting_price"]) == pytest.approx(2000.0, rel=1e-9)
	assert float(claim["posting_price_b"]) == pytest.approx(100.0, rel=1e-9)


def test_price_threshold_posting_fetch_still_costs_one_real_call(
	direct_vm, direct_deploy, direct_alice
):
	"""Regression guard: confirms _fetch_prices_with_consensus's
	generalization didn't change Price Threshold's own cost (still exactly
	1 real call per snapshot, matching §4b's ~2N-for-Price-Threshold
	estimate unchanged)."""
	contract = deploy(direct_deploy)
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2950.5)

	counters = count_web_calls(direct_vm)
	contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)

	assert counters["n"] == 1


# ---------------------------------------------------------------------
# Alpha Passport -- category breakdown genuinely separates claim types
# ---------------------------------------------------------------------


def test_passport_category_breakdown_separates_relative_performance_from_price_threshold(
	direct_vm, direct_deploy, direct_alice
):
	"""
	The actual proof the claim-type-aware schema from Build Prompt 5 was
	built right (and that Build Prompt 6's _record_passport fix works): one
	address posts one PRICE_THRESHOLD claim (a win) and one
	RELATIVE_PERFORMANCE claim (a win), and get_passport must show BOTH as
	genuinely separate category entries, not merged or miscategorized.
	"""
	contract = deploy(direct_deploy)

	# Price Threshold claim, HELD.
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "ETH/USD", 2950.5)
	pt_claim_id = contract.create_claim("ETH/USD", "3000", "above", FUTURE_DEADLINE)
	pt_claim = contract.claims[pt_claim_id]
	pt_claim.deadline_price_atto = int(3500.0 * ATTO)
	pt_claim.deadline_fetched_at = "2020-01-01T00:10:00.000Z"
	pt_claim.state = "EVIDENCE_LOCKED"
	contract.claims[pt_claim_id] = pt_claim
	install_verdict_hook(direct_vm, "Deadline 3500.0 exceeds threshold 3000.0 -- HELD.")
	direct_vm.sender = direct_alice
	contract.resolve_verdict(pt_claim_id)
	assert contract.get_claim(pt_claim_id)["consensus_result"] == "HELD"

	# Relative Performance claim, HELD.
	direct_vm.sender = direct_alice
	mock_price_for(direct_vm, "BTC/USD", 60000.0)
	mock_price_for(direct_vm, "SOL/USD", 100.0)
	rp_claim_id = contract.create_relative_performance_claim(
		"BTC/USD", "SOL/USD", FUTURE_DEADLINE
	)
	force_evidence_locked_rp(contract, rp_claim_id, deadline_price_a=72000.0, deadline_price_b=105.0)
	install_verdict_hook(
		direct_vm,
		"asset_a (BTC/USD) went from 60000.0 to 72000.0 (+20%); asset_b (SOL/USD) "
		"went from 100.0 to 105.0 (+5%). asset_a outperformed, so HELD.",
	)
	direct_vm.sender = direct_alice
	contract.resolve_verdict(rp_claim_id)
	assert contract.get_claim(rp_claim_id)["consensus_result"] == "HELD"

	passport = contract.get_passport("0x" + direct_alice.hex())
	assert passport["win_count"] == 2
	assert passport["loss_count"] == 0
	assert passport["category_breakdown"] == {
		"PRICE_THRESHOLD": {"win_count": 1, "loss_count": 0},
		"RELATIVE_PERFORMANCE": {"win_count": 1, "loss_count": 0},
	}
	assert set(passport["claim_history"]) == {pt_claim_id, rp_claim_id}
