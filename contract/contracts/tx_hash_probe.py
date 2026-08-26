# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Throwaway Step-0 probe: can GenVM validators independently fetch a real
Studio native-send transaction by hash and strict_eq-agree on its canonical
{from, to, value, status}?

Known keeper-send (SUBMISSION.md claim-31 correction, 10 GEN):
  0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f
Expected (from a direct Studio RPC read, 2026-08-27):
  from   0x374d46e81973dd8797f14f586aee94aac27e39a3
  to     0x31e14df3b4f47f2428f3b78e7279691a78f70a05
  value  10000000000000000000
  status FINALIZED

Not production. Do not reuse as the court."""

from genlayer import *
import json

STUDIO_RPC = "https://studio.genlayer.com/api"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"


def _normalize_status(raw) -> str:
	status = str(raw).strip().upper()
	# Studio's HTTP JSON uses "FINALIZED"; some client wrappers use 7.
	if status in ("7", "STATUS.FINALIZED"):
		return "FINALIZED"
	return status


def _normalize_value(raw) -> str:
	if raw is None:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} tx missing value")
	if isinstance(raw, bool):
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} tx value is bool")
	if isinstance(raw, int):
		return str(raw)
	text = str(raw).strip()
	if text.startswith("0x") or text.startswith("0X"):
		return str(int(text, 16))
	# Decimal string, possibly with a trailing .0 from a JSON number
	if "." in text:
		text = text.split(".", 1)[0]
	if not text.isdigit():
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} unparseable value: {text}")
	return str(int(text))


def _canonicalize_tx(tx: dict) -> str:
	from_addr = str(
		tx.get("from_address") or tx.get("from") or tx.get("sender") or ""
	).strip().lower()
	to_addr = str(
		tx.get("to_address") or tx.get("to") or tx.get("recipient") or ""
	).strip().lower()
	if not from_addr.startswith("0x") or not to_addr.startswith("0x"):
		raise gl.vm.UserError(
			f"{ERROR_EXTERNAL} missing from/to: from={from_addr} to={to_addr}"
		)
	payload = {
		"from": from_addr,
		"status": _normalize_status(tx.get("status")),
		"to": to_addr,
		"value": _normalize_value(tx.get("value")),
	}
	return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _fetch_canonical_tx(tx_hash: str) -> str:
	body = json.dumps(
		{
			"jsonrpc": "2.0",
			"id": 1,
			"method": "eth_getTransactionByHash",
			"params": [tx_hash],
		}
	).encode("utf-8")
	res = gl.nondet.web.post(
		STUDIO_RPC,
		body=body,
		headers={"Content-Type": "application/json"},
	)
	if res.status is None or res.status >= 500:
		raise gl.vm.UserError(f"{ERROR_TRANSIENT} RPC status={res.status}")
	if res.status >= 400:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} RPC status={res.status}")
	if res.body is None:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} empty RPC body")
	data = json.loads(res.body.decode("utf-8"))
	if not isinstance(data, dict):
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} RPC body is not an object")
	if "error" in data and data["error"]:
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} RPC error={data['error']}")
	tx = data.get("result")
	if not isinstance(tx, dict):
		raise gl.vm.UserError(f"{ERROR_EXTERNAL} tx not found for {tx_hash}")
	canon = _canonicalize_tx(tx)
	print("PROBE_CANON=" + canon)
	return canon


class TxHashProbe(gl.Contract):
	last_tx_hash: str
	last_result: str

	def __init__(self):
		self.last_tx_hash = ""
		self.last_result = ""

	@gl.public.write
	def probe_known(self) -> None:
		# Hardcoded so this probe measures RPC + strict_eq, not calldata
		# encoding of 0x-hex strings (the CLI/JS encoder turned a 32-byte
		# hash into an int on the first attempt).
		tx_hash = "0x74d2d0ed6b0e375c61a207ffea663b72197f4e47207392f73e9f77d58b91398f"

		def fetch() -> str:
			return _fetch_canonical_tx(tx_hash)

		result = gl.eq_principle.strict_eq(fetch)
		print("PROBE_CONSENSUS=" + str(result))
		self.last_tx_hash = tx_hash
		self.last_result = str(result)

	@gl.public.view
	def get_result(self) -> dict:
		return {"tx_hash": self.last_tx_hash, "canonical": self.last_result}
