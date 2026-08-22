# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

# Minimal proof that the EOA emit_transfer path credits GEN.
# Do not use gl.get_contract_at(eoa).emit_transfer — Studio treats that as
# an Intelligent-Contract call and finishes ERROR / value_credited=false.

@gl.evm.contract_interface
class _EoaRecipient:
	class View:
		pass

	class Write:
		pass


class PayoutProbe(gl.Contract):
	def __init__(self):
		pass

	@gl.public.write.payable
	def ping(self, to: Address) -> None:
		amount = gl.message.value
		if int(amount) <= 0:
			raise gl.vm.UserError("[EXPECTED] ping needs value")
		_EoaRecipient(to).emit_transfer(value=amount)
