"""
Windows workaround for a genlayer-test 0.29.2 bug (latest available version
as of this build -- checked `pip index versions genlayer-test`, no newer
release exists).

gltest.direct.loader._inject_message_to_fd0 creates a temp file, dup2()s
its fd onto stdin (fd 0), then calls os.unlink(path) on the still-open
file. POSIX allows unlinking an open file; Windows does not (raises
PermissionError: WinError 32 -- "the process cannot access the file
because it is being used by another process"). This fires on every single
direct-mode test, before any contract code runs, so it is unambiguously a
harness bug, not something wrong with alpha_court.py.

This monkeypatch is the same function with the unlink wrapped in a
try/except -- the fd0 injection itself (the part that actually matters)
already succeeded by that point; only the temp-file cleanup fails on
Windows, leaving a harmless stray file in the OS temp dir.
"""

import os
import tempfile

import gltest.direct.loader as loader


def _inject_message_to_fd0_windows_safe(vm) -> None:
	try:
		from genlayer.py import calldata
		from genlayer.py.types import Address
	except ImportError:
		return

	sender_addr = vm.sender
	if isinstance(sender_addr, bytes):
		sender_addr = Address(sender_addr)

	contract_addr = vm._contract_address
	if isinstance(contract_addr, bytes):
		contract_addr = Address(contract_addr)

	origin_addr = vm.origin
	if isinstance(origin_addr, bytes):
		origin_addr = Address(origin_addr)

	message_data = {
		"contract_address": contract_addr,
		"sender_address": sender_addr,
		"origin_address": origin_addr,
		"stack": [],
		"value": vm._value,
		"datetime": vm._datetime,
		"is_init": False,
		"chain_id": vm._chain_id,
		"entry_kind": 0,
		"entry_data": b"",
		"entry_stage_data": None,
	}

	encoded = calldata.encode(message_data)

	fd, path = tempfile.mkstemp()
	try:
		os.write(fd, encoded)
		os.lseek(fd, 0, os.SEEK_SET)

		original_stdin = os.dup(0)
		vm._original_stdin_fd = original_stdin

		os.dup2(fd, 0)
	finally:
		os.close(fd)
		try:
			os.unlink(path)
		except PermissionError:
			# Windows: file is still open via the fd 0 dup2(); the OS will
			# reclaim it once fd 0 is restored/closed. Non-fatal.
			pass


loader._inject_message_to_fd0 = _inject_message_to_fd0_windows_safe
