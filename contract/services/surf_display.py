"""
Category A -- display-only Surf price fetch.

This file is NOT a GenVM contract and is never imported by alpha_court.py
or any other contract file. It's a plain backend module meant to be called
from an ordinary Python process (API route, worker, CLI) to show a live
price on the frontend -- never inside contract consensus logic.

Structural (not just conventional) separation from Category B:
  - Different module, different file, no shared code path with
    alpha_court.py's _fetch_price_with_consensus / gl.vm.run_nondet.
  - Uses `requests` and `os`, both forbidden imports under GenVM's
    genvm-lint AST safety check -- so this module could not be pulled into
    contract consensus logic even by accident; `genvm-lint check` on
    alpha_court.py would fail immediately if it ever imported this file.
  - No gl.* symbols anywhere in this file; it doesn't run inside GenVM at
    all, doesn't participate in leader/validator consensus, and doesn't
    carry Category B's per-validator cost multiplier (a single ordinary
    HTTP call, not one call per validator).

Its result must never be written to contract state or used to settle a
claim -- it is a convenience readout only.
"""

import os

import requests

SURF_BASE_URL = "https://api.asksurf.ai/gateway/v1"
SURF_PRICE_PATH = "/market/price"


def get_display_price(asset: str, api_key: str | None = None) -> dict:
	"""
	Plain, ordinary HTTP call for display purposes only. UNVERIFIED
	response field names -- see alpha_court.py header note; Surf's own
	docs defer the exact `market-price` schema to `surf market-price
	--help`, which was not reachable during Step 0 research.
	"""
	api_key = api_key or os.environ.get("SURF_API_KEY")
	if not api_key:
		raise RuntimeError("SURF_API_KEY not configured")

	resp = requests.get(
		f"{SURF_BASE_URL}{SURF_PRICE_PATH}",
		params={"symbol": asset},
		headers={"Authorization": f"Bearer {api_key}"},
		timeout=10,
	)
	resp.raise_for_status()
	payload = resp.json()

	data = payload.get("data", payload) if isinstance(payload, dict) else payload
	if isinstance(data, list):
		data = data[0] if data else {}
	if not isinstance(data, dict):
		raise RuntimeError(f"Unrecognized Surf response shape: {type(data)}")

	for key in ("price", "value", "last", "spot_price", "close"):
		if key in data:
			return {
				"asset": asset,
				"price": float(data[key]),
				"source": "surf",
				"display_only": True,
			}

	raise RuntimeError(f"Unrecognized Surf price response shape: keys={list(data.keys())}")


def get_relative_performance_display(
	asset_a: str, asset_b: str, api_key: str | None = None
) -> dict:
	"""
	Build Prompt 6, task 4: live ticker/preview for a Relative Performance
	claim ("asset_a vs. asset_b") -- both assets' current prices, Category A
	only. Reuses get_display_price for each asset (two ordinary HTTP calls,
	not a non-deterministic block, not one call per validator) rather than
	inventing a second fetch path -- same structural isolation from
	Category B as Price Threshold's display already has: no gl.* symbols,
	no shared code path with alpha_court.py's _fetch_prices_with_consensus,
	same `requests`/`os` imports genvm-lint's AST safety check already
	forbids inside contract code. This module stays the one place Category
	A display logic lives; a second, separate module wasn't warranted since
	this one's shape (plain HTTP call -> plain dict) fits Relative
	Performance's two-asset case without modification, just a second
	function.

	No percentage-change comparison is computed here -- that's exactly the
	kind of "did asset_a outperform asset_b" JUDGMENT this contract's real
	Category B verdict mechanism exists to make, under real consensus, over
	immutable locked snapshots. A live display preview showing two raw
	current prices is honest; a live display preview computing and showing
	"asset_a is winning" would blur into pre-empting the actual verdict --
	exactly the Category A/B blur every prior prompt's non-negotiables
	forbid. Callers wanting a % comparison do that arithmetic client-side
	from the two raw prices returned here, same as any other display
	convenience.
	"""
	price_a = get_display_price(asset_a, api_key=api_key)
	price_b = get_display_price(asset_b, api_key=api_key)
	return {
		"asset_a": price_a,
		"asset_b": price_b,
		"source": "surf",
		"display_only": True,
	}


# Build Prompt 7: real endpoints for Fundamentals Threshold's two Surf data
# sources, confirmed directly against docs.asksurf.ai during Step 0 (see
# alpha_court.py's header) -- same paths the contract's Category B fetch
# uses, matching real endpoints on this display-only side too.
SURF_ONCHAIN_INDICATOR_PATH = "/market/onchain-indicator"
SURF_DEFI_METRICS_PATH = "/project/defi/metrics"

FUNDAMENTALS_METRIC_TVL = "TVL"


def get_fundamentals_display(asset: str, metric: str, api_key: str | None = None) -> dict:
	"""
	Build Prompt 7, task 4: live ticker/preview for a Fundamentals Threshold
	claim (e.g. "Uniswap TVL" or "BTC MVRV") -- current metric value,
	Category A only. Same structural isolation from Category B as the other
	two display functions above (plain `requests` call, no `gl.*` symbols,
	no shared code path with alpha_court.py's
	_fetch_fundamentals_with_consensus).

	Both real Surf endpoints behind this (confirmed during Step 0, see
	alpha_court.py's header) return a TIME-SERIES array rather than
	`/market/price`'s single-object envelope -- this picks the max-
	timestamp point, same defensive-parsing discipline as the contract's
	own `_parse_fundamentals_value`, not assuming `data[0]` is the latest.

	No threshold comparison is computed or returned here, for the same
	reason `get_relative_performance_display` doesn't compute a %
	comparison: "does this metric cross this threshold" is the actual
	verdict judgment, made under real consensus over immutable locked
	snapshots -- a display preview pre-computing that would blur Category A
	into Category B.
	"""
	api_key = api_key or os.environ.get("SURF_API_KEY")
	if not api_key:
		raise RuntimeError("SURF_API_KEY not configured")

	if metric == FUNDAMENTALS_METRIC_TVL:
		url = f"{SURF_BASE_URL}{SURF_DEFI_METRICS_PATH}"
		params = {"q": asset, "metric": "tvl"}
	else:
		url = f"{SURF_BASE_URL}{SURF_ONCHAIN_INDICATOR_PATH}"
		params = {"symbol": asset, "metric": metric.lower()}

	resp = requests.get(
		url,
		params=params,
		headers={"Authorization": f"Bearer {api_key}"},
		timeout=10,
	)
	resp.raise_for_status()
	payload = resp.json()

	data = payload.get("data") if isinstance(payload, dict) else None
	if not isinstance(data, list) or not data:
		raise RuntimeError("Unrecognized fundamentals response shape: no data points")

	best_point = None
	for point in data:
		if not isinstance(point, dict) or "value" not in point or "timestamp" not in point:
			continue
		if best_point is None or point["timestamp"] > best_point["timestamp"]:
			best_point = point
	if best_point is None:
		raise RuntimeError("Unrecognized fundamentals response shape: no valid data points")

	return {
		"asset": asset,
		"metric": metric,
		"value": float(best_point["value"]),
		"as_of": best_point["timestamp"],
		"source": "surf",
		"display_only": True,
	}
