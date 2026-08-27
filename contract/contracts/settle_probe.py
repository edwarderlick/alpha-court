# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

# ProofWorks-shaped payout probe.
#
# payout_probe.py paid out from inside the SAME payable call that received
# the value, and alpha_court pays out from inside the same transaction that
# runs the LLM consensus round (resolve_verdict -> _payout_for_claim).
# ProofWorks (tommycet/proofworks-genlayer, same runner pin, same Studionet)
# does neither: create_task is payable and only accrues, evaluate_task is
# non-det and moves no money, finalize_task is deterministic and is "the
# single place value transfers happen".
#
# This probe isolates that difference and nothing else: fund() accrues,
# pay_out() sends in a later, separate, purely deterministic transaction.


@gl.evm.contract_interface
class _ExternalRecipient:
	class View:
		pass

	class Write:
		pass


class SettleProbe(gl.Contract):
	funded: u256
	paid: u256
	stored: Address
	log: DynArray[str]

	def __init__(self):
		self.funded = u256(0)
		self.paid = u256(0)
		self.stored = Address("0x0000000000000000000000000000000000000000")

	@gl.public.write.payable
	def fund(self) -> None:
		v = gl.message.value
		if int(v) <= 0:
			raise gl.vm.UserError("[EXPECTED] fund needs value")
		self.funded = u256(int(self.funded) + int(v))
		self.log.append("FUNDED " + str(int(v)))

	@gl.public.write
	def pay_out(self, to: str, amount_atto: str) -> None:
		"""Deterministic only. No nondet round, no value received here.

		`to` is a plain str coerced with Address() here, exactly as the
		official faucet.py and ProofWorks' _send_value_to_eoa do. Taking
		it as a typed `Address` parameter straight off calldata (what
		payout_probe.ping does) is what produced SystemError: 2 inval.
		"""
		amount = int(amount_atto)
		if amount <= 0:
			raise gl.vm.UserError("[EXPECTED] amount must be positive")
		if amount > int(self.balance):
			raise gl.vm.UserError("[EXPECTED] not enough balance")
		_ExternalRecipient(Address(to)).emit_transfer(value=u256(amount))
		self.paid = u256(int(self.paid) + amount)
		self.log.append("PAID " + str(to) + " " + str(amount))

	@gl.public.view
	def state(self) -> str:
		import json
		return json.dumps({
			"funded": str(int(self.funded)),
			"paid": str(int(self.paid)),
			"balance": str(int(self.balance)),
			"log": list(self.log),
		})

	@gl.public.write
	def remember(self, to: str) -> None:
		self.stored = Address(to)
		self.log.append("REMEMBERED " + str(to))

	@gl.public.write
	def pay_stored(self, amount_atto: str) -> None:
		"""Production shape: recipient is an Address read back from
		storage, exactly like _pay_native's staker / appeal_filer."""
		amount = int(amount_atto)
		if amount > int(self.balance):
			raise gl.vm.UserError("[EXPECTED] not enough balance")
		_ExternalRecipient(self.stored).emit_transfer(value=u256(amount))
		self.paid = u256(int(self.paid) + amount)
		self.log.append("PAID_STORED " + str(amount))
