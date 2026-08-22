"""
Local HTTP fixture server standing in for the real Surf Data API
(https://api.asksurf.ai) during integration tests.

Why this exists (see Step 0 research notes in alpha_court.py's header,
and test/direct/test_alpha_court.py's module docstring for the full
picture): the only genlayer-test mode that exercises real multi-validator
consensus is `gltest` against a running simulator (GLSim/local Studio),
and that mode makes real outbound web calls -- there is currently no
documented mode combining "real consensus" with "mocked web response".
Rather than fake consensus or spend real Surf credits, this test points
the contract's configurable `surf_base_url` constructor argument at this
local server instead. Every validator that participates in consensus
makes a genuine, independent HTTP GET to this process -- real network
calls, real GenVM leader/validator agreement -- just not to asksurf.ai.

Endpoint shape mirrors what Step 0 confirmed for Surf's own
GET /market/price: {"data": {"price": <float>}, "meta": {...}}.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

_lock = threading.Lock()
_price_by_asset: dict[str, float] = {}
_request_log: list[str] = []


def set_price(asset: str, price: float) -> None:
	with _lock:
		_price_by_asset[asset] = price


def get_request_log() -> list[str]:
	with _lock:
		return list(_request_log)


class _Handler(BaseHTTPRequestHandler):
	def log_message(self, fmt, *args):  # noqa: A002 -- silence default stderr logging
		pass

	def do_GET(self):  # noqa: N802 -- http.server's required method name
		parsed = urlparse(self.path)
		with _lock:
			_request_log.append(self.path)

		if not parsed.path.endswith("/market/price"):
			self.send_response(404)
			self.end_headers()
			return

		qs = parse_qs(parsed.query)
		asset = qs.get("symbol", [None])[0]
		with _lock:
			price = _price_by_asset.get(asset)

		if price is None:
			self.send_response(404)
			self.end_headers()
			self.wfile.write(json.dumps({"error": f"no fixture price set for {asset}"}).encode())
			return

		body = json.dumps({"data": {"price": price}, "meta": {"credits_used": 0, "cached": False}}).encode()
		self.send_response(200)
		self.send_header("Content-Type", "application/json")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)


class SurfFixtureServer:
	def __init__(self, host: str = "127.0.0.1", port: int = 0):
		self._httpd = HTTPServer((host, port), _Handler)
		self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

	@property
	def base_url(self) -> str:
		host, port = self._httpd.server_address
		return f"http://{host}:{port}"

	def start(self) -> "SurfFixtureServer":
		self._thread.start()
		return self

	def set_price(self, asset: str, price: float) -> None:
		set_price(asset, price)

	def get_request_log(self) -> list[str]:
		return get_request_log()

	def stop(self) -> None:
		self._httpd.shutdown()
		self._httpd.server_close()
