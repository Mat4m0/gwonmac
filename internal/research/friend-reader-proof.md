# Quick Travel to friends: reader gate

Implementation started on 2026-09-03 from fetched `origin/main`, commit
`d8ffc7f06390dae571bcf04fde38e1a47c6002c6`, in `feat/friend-observation`.
This is normal feature development. The feature is **not integrated or ready
for gameplay testing**.

## Intended outcome

Open Quick Travel with Command-T or `/tp`. Search a friend alias or current
character. Select **Travel to [reported outpost]** through the existing map-only
Travel command. Show a reason when that destination is unavailable.

There is no separate Friends window, setting, service, or persistent roster.
Exact district joining remains unsupported. Friend information suggests a map;
the existing Travel path still owns unlock, region, and dispatch checks.

Implementation has two review boundaries:

1. Prove and integrate one bounded companion observation, including lifecycle.
2. Add friend results to the existing palette and revalidate identity and map
   at selection time. Confirm one real trip with Matthias.

The supplied implementation advice requires stopping before UI integration
when a required reader fact remains unproved. This work has reached that gate.

## Completed experiment

The [offline inspector](../../src/main/certification/friend-table-evidence.ts)
finds a candidate through the indexed accessor, direct root wrapper, two scalar
writers, and native Friends UI consumers. It checks complete normalized accessor
and writer bodies. It treats assertion string addresses and assertion call
indices as relocation operands. The root is derived from participating calls.

Input SHA-256 identifies the tested bytes. It does not authorize the reader.
Every result has `runtimeAuthority: false`, including `status: candidate`.
The inspector is imported only by its offline command and tests. It neither
changes a client artifact nor adds a runtime capability.

The [artifact experiments](../../tests/client-artifact/friend-table-evidence.test.ts)
exercise unrelated body changes, root relocation, independent accessor/writer
reindexing, changed index checks, changed scalar fields, duplicate root wrappers,
and broken root relationships. The changed modules must remain valid WASM.
These are targeted candidate-identification experiments, not a runnable rebuild
qualification or a proof that all unrelated client updates will survive.

On cached input
`1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`,
the inspector identifies one candidate:

| Role | Evidence in this input only |
| --- | --- |
| Table root | `5925656` (`0x5a6b18`) |
| Indexed accessor | function `8829`; pointer array `+0`, count `+8` |
| Root wrapper | function `8853` |
| Scalar writers | function `8834` stores `+4`; function `8835` stores `+108` |
| Native UI consumer | function `15250` reads both scalar fields |

Those values are regression evidence, not production constants.

## Named blockers and their evidence

### An allocated empty table is not proof of a synchronized roster

Constructor `8816` initializes the pointer array and adds a null sentinel slot.
Clear function `8821` removes records through `8820`; it does not restore the
array to an unallocated state. Functions `8838` and `8839` both clear records
and write own status `4` at table `+160`.

Thus a nonzero count with no friend records can follow construction or clear.
The count alone does not prove successful friend-service synchronization.
The complete allocation/capacity and sparse traversal proof also remains open.

### Own status is not a connection or freshness marker

Function `8851` writes the requested status at `5925816` (table `+160`)
before calling `10144`. The native status dropdown in `15249` uses `8851`.
The inspected game UI cleanup branches also call `8851(0)`.

Function `10144` checks `10242` before attempting the auth-side status request.
Consequently the local status write does not acknowledge a connection or a
fresh roster. Publishing old records whenever own status is nonzero would be
an unsupported inference.

### Known clearing paths do not yet cover all session transitions

Functions `11465` and `11491` call `8847` (friend clear) before the inspected
login request path. Function `8848` clears the table and registers the friend
callback. Function `8850` unregisters it and clears the table.

The auth connection query `10242` reads a separate pointer at `5930208`.
Connection establishment and removal paths include `10278`, `10236`, and
`10240`. These are useful candidates; a connection pointer by itself does not
prove that retained friend locations were refreshed after reconnect.

Still required: establish the callback ordering and a structurally identified
signal that withdraws previous-session records and admits current-session
records, including reconnect without an observed intervening game tick.
Do not replace that proof with the host's current character key.

### Record semantics and update survival remain incomplete

The inspector identifies only the accessor and two scalar fields. Name copying,
UUID ownership, allocation, removal, sparse slots, and lifecycle need their own
complete semantic relationships before a bounded runtime reader can use them.
The assertion callee itself and the complete UI consumer are not certified.
Source-string relocation and independent callback table-slot movement have not
been qualified by these experiments.

## Exact local evidence

Set `GW_CLIENT_WASM` to the official local artifact under investigation. Run
these commands from the worktree; no game window or network request is needed:

```bash
mkdir -p build/friend-evidence
node --import ./scripts/ts-hook.mjs scripts/friend-table-evidence.ts "$GW_CLIENT_WASM" > build/friend-evidence/table.json
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/client-artifact/friend-table-evidence.test.ts > build/friend-evidence/mutations.tap 2>&1
pnpm check > build/friend-evidence/check.log 2>&1
```

The command exits `0` for one candidate, `1` for unavailable/ambiguous evidence,
and `2` for invocation or file-read failure. Exit `0` does not mean certified.
Preserve stdout directly. Keep generated evidence local; never include real
friend names, UUIDs, rosters, or search text in persisted diagnostics.

| Acceptance boundary | Current result |
| --- | --- |
| Candidate identification | One candidate on the inspected cached input |
| Complete structural reader proof | Incomplete |
| Bounded live-record decoding | Not implemented |
| Account/disconnect/reconnect invalidation | Unproved |
| Companion observation installed | No |
| Palette integration | No |
| Live behavior witnessed | No |
| Friend Travel requested / destination reached | No / no |

## Resume here

Resolve the lifecycle signal above before adding a runtime layout or UI.
Turn empty/unavailable, disconnect, account switch, reconnect, and slot reuse
into executable refusal tests. Then add the Rust companion reader and reuse
the existing region installation and sequence feed.

Observe only while Tools, Travel, the open palette, and supported-region policy
permit it. Friend certification refusal must leave ordinary Travel available.
Successful unchanged reads remain fresh; stopped observation withdraws state.
Use a session-local identity that cannot become another friend after slot reuse.
At selection, re-resolve identity and the displayed map. A changed map requires
a new selection. Keep all game commands in the existing Travel owner.

Follow [Core and Tools development](../../docs/enhancement-development.md) and
[WASM host and certification](../../docs/wasm-host.md) for integration.
