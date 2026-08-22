## Summary

Deploying a contract to GLSim fails at consensus with `TypeError: class is not
marked for usage within storage, please, annotate it with @allow_storage`,
reported against the **top-level contract class itself** (not a field's
dataclass type), even though nothing about that class differs from the
SDK's own documented `gl.Contract` usage. `genvm-lint check` validates the
same contract cleanly against the real pinned GenVM runner, and the
identical contract logic deploys and runs successfully many times over
under `genlayer-test`'s direct-mode loader — so this is not a contract
authoring bug, and appears specific to GLSim's storage-codegen path.

## Versions

- `genlayer-test` (provides both `glsim` and `gltest`): **0.29.2** (latest available via pip at time of filing)
- `genlayer` CLI: **0.39.2**
- `genlayer-py` SDK: **0.16.3**
- `genlayer-dev` skill: **1.1.3**
- Pinned GenVM runner (per `genvm-lint`): `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
- Python: 3.12.10
- OS: Windows 11 (no Docker available in this environment — real local Studio via `genlayer up` was not an alternative we could try)

## Repro steps

```bash
glsim --port 4000 --validators 3 --no-browser
gltest test/integration/ -v -s
```

(`gltest.config.yaml` points the `localnet` network at `http://127.0.0.1:4000/api`.)

## Verbatim error (from the real transaction receipt)

```
gltest.exceptions.DeploymentError: Deployment transaction failed: {'hash': '0x0000000000000000000000000000000000000000000000000000000000000004', 'status': 7, 'from_address': '0x72bf75ec9d4f41daa2c4e7da59291d8b9cd713d7', 'to_address': '0x0000000000000000000000000000000000000000', 'type': 0, 'nonce': 0, 'value': 0, 'gaslimit': 0, 'created_at': '2026-08-14T05:27:06.204916+00:00', 'data': {'calldata': {'readable': '{"args":["test-surf-key","http://127.0.0.1:50410"]}'}, 'contract_address': None}, 'consensus_data': {'votes': {'0x0000000000000000000000000000000000000000': 'agree', '0x0000000000000000000000000000000000000001': 'agree', '0x0000000000000000000000000000000000000002': 'agree'}, 'leader_receipt': [{'execution_result': 'ERROR', 'genvm_result': {'stdout': '', 'stderr': "('class is not marked for usage within storage, please, annotate it with @allow_storage', <class '_contract_glsim_contract_04f326011212d2c3.AlphaCourt'>)"}, 'mode': 'leader', 'vote': None, 'node_config': {'address': '0x0000000000000000000000000000000000000000', 'provider': 'glsim', 'model': 'direct', 'config': {}, 'plugin': 'glsim', 'plugin_config': {}, 'stake': 1}, 'calldata': {'readable': '{"args":["test-surf-key","http://127.0.0.1:50410"]}'}, 'eq_outputs': {}, 'result': {'status': 'rollback', 'payload': "('class is not marked for usage within storage, please, annotate it with @allow_storage', <class '_contract_glsim_contract_04f326011212d2c3.AlphaCourt'>)"}}], 'validators': [{'execution_result': 'ERROR', 'genvm_result': {'stdout': '', 'stderr': "('class is not marked for usage within storage, please, annotate it with @allow_storage', <class '_contract_glsim_contract_04f326011212d2c3.AlphaCourt'>)"}, 'mode': 'validator', 'vote': 'agree', ...}, ...],
'status_name': 'FINALIZED'}
```

The class named in the error is `AlphaCourt` itself — the `gl.Contract`
subclass — not any of its `@allow_storage`-decorated field dataclasses
(`Claim`, `Stake`, `Passport`, `CategoryStat`), all of which are already
correctly decorated.

## Minimal-repro attempts (negative results, useful signal)

We tried to isolate the exact trigger by incrementally growing a bare
`gl.Contract` under the same GLSim instance/version, checking the raw
deploy-transaction receipt after each step (via `ContractFactory.deploy_contract_tx`, not the higher-level `.deploy()`, to see the raw consensus result directly):

| Contract shape | Deploy result |
|---|---|
| Bare `gl.Contract`, no fields | ✅ SUCCESS |
| + one `u256` field | ✅ SUCCESS |
| + `TreeMap[str, u256]` field (no dataclass) | ✅ SUCCESS |
| + `TreeMap[str, FlatDataclass]` (flat `@allow_storage` dataclass, primitive fields only) | ✅ SUCCESS |
| + `TreeMap[str, OuterDataclass]` where `OuterDataclass` nests a second `@allow_storage` dataclass field | ✅ SUCCESS (deploy only; a triggering *write* wasn't reachable — see below) |
| + two separate `TreeMap[str, DataclassX]` / `TreeMap[str, DataclassY]` fields plus two `DynArray[str]` fields (mirroring the real contract's field count/shape) | ✅ SUCCESS |

None of these isolated shape changes reproduced the error under GLSim
0.29.2 in our environment — only the real, full contract does, reliably,
every time. We were not able to narrow it further given the size of that
contract (14 methods, 5 storage-collection fields, 4 `@allow_storage`
dataclasses) without spending disproportionate time on trial and error, so
we're filing with the full real repro rather than a synthetic minimal one.
We separately hit an apparently-unrelated `gltest` client-side issue
(`ValueError: Failed to get schema from all clients`) when calling
`ContractFactory.build_contract` against some of the passing minimal
deploys above, which blocked pushing a *write* transaction (as opposed to
just deploy) through some of the intermediate shapes — worth noting in
case it's actually the same underlying schema-introspection code path,
but we can't confirm that connection.

## Two things this is confirmed NOT to be

- **Not a contract bug**: `genvm-lint check contracts/alpha_court.py`
  passes cleanly (validates directly against the same pinned GenVM
  runner's real storage codegen). The identical contract also deploys and
  runs correctly, repeatedly, via `genlayer-test`'s direct-mode loader
  (65/65 tests passing), and via a real GenLayer Studio testnet deployment
  (chainId 61999) — full Price Threshold create→stake→lock→resolve
  lifecycle completed successfully on real Studio with this exact
  contract source.
- **Not fixed by explicit `@allow_storage` on the contract class**: adding
  `@allow_storage` directly above `class AlphaCourt(gl.Contract):` (even
  though neither the SDK's own contract skeleton example nor another
  working, previously-tested contract in this codebase does this) did not
  change the error.
- **Not caused by a nested `@allow_storage` dataclass field**: flattening
  a previously-nested `PriceSnapshot` dataclass's fields directly onto the
  parent `Claim` dataclass (removing the one level of dataclass-within-
  dataclass nesting the contract had) did not change the error either.

## Environment

- OS: Windows 11, no Docker available (so real local Studio via
  `genlayer up` could not be tried as an alternative).
- `gltest.config.yaml` `localnet` network pointed at GLSim on
  `http://127.0.0.1:4000/api`.
- The integration test points the contract's own configurable
  `surf_base_url` constructor argument at a local HTTP fixture server
  (plain `requests`-based, not part of GenVM) so real multi-validator
  consensus can be exercised without spending real Surf API credits —
  unrelated to the bug itself, just explaining the `args=["test-surf-key",
  "http://127.0.0.1:PORT"]` seen in the deploy calldata above.

## Impact

This blocks any GLSim-based integration testing (real multi-validator
consensus, without the cost/latency of real Studio) for any contract
matching whatever shape triggers this — for us, a contract with 5 storage
collections (`TreeMap`/`DynArray`) and 4 `@allow_storage` dataclasses. The
equivalent contract deploys and runs correctly on real Studio testnet, so
this appears to be strictly a GLSim-specific storage-codegen defect, not a
GenVM/runner-wide one.
