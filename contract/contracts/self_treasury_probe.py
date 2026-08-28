# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

# Does a PLAIN native EOA -> contract-address transfer credit a spendable
# contract balance, when the contract defines no __receive__ and no payable
# method at all?
#
# This is exactly production's shape after `treasury = SELF`: stakers send
# raw eth_sendTransaction (no calldata) to the court address, then register
# the hash. If that value never lands in self.balance, _pay_native cannot
# pay anyone even though registration succeeded.
#
# Deliberately: no @gl.public.write.payable anywhere, no __receive__.


@gl.evm.contract_interface
class _ExternalRecipient:
	class View:
		pass

	class Write:
		pass


class SelfTreasuryProbe(gl.Contract):
	paid: u256

	def __init__(self):
		self.paid = u256(0)

	@gl.public.view
	def balance_now(self) -> str:
		return str(int(self.balance))

	@gl.public.write
	def pay(self, to: str, amount_atto: str) -> None:
		amount = int(amount_atto)
		if amount > int(self.balance):
			raise gl.vm.UserError("[EXPECTED] not enough balance: have " + str(int(self.balance)))
		_ExternalRecipient(Address(to)).emit_transfer(value=u256(amount))
		self.paid = u256(int(self.paid) + amount)
