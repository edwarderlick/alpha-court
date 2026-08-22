import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest

from fixture_surf_server import SurfFixtureServer


@pytest.fixture(scope="session")
def surf_fixture_server():
	"""
	Local HTTP server standing in for the real Surf API (see
	fixture_surf_server.py's docstring for why). Session-scoped so all
	integration tests share one instance; each test sets its own price(s)
	via server.set_price(...) before triggering a contract call.
	"""
	server = SurfFixtureServer(host="127.0.0.1", port=0).start()
	yield server
	server.stop()
