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

## Executed native lifecycle experiments

The [native lifecycle fixture](../../tests/native/friend-lifecycle-evidence.test.ts)
extracts the inspected functions into a small, temporary WASM module. It changes
only direct-call indices. It retains native control flow, loads, stores, and
the request pump's indirect calls. Synthetic memory supplies names, requests,
and connection records. Explicit substitutes own copying, event collection,
network requests, completion notification, and request removal.

This fixture executes no game startup, socket, login, or live account access.
It refuses another input hash until its native roles are reviewed. It is an
explicit research command under `tests/native`, not a new fixed-build condition
in the automatic qualification of future ArenaNet clients.

Eleven scenarios pass (12 TAP tests including the parent):

| Executed native behavior | Consequence for the reader |
| --- | --- |
| `10084` accepts roster entries only for matching request ID `+32` and pending state `+20 == 3`. | A pending request is a useful relationship; it is not yet proof of a particular account or completed roster. |
| `10068` marks a matching request completed and records its result. Later entries are ignored. | Request completion provides a boundary to investigate for initial roster admission. |
| `9988` checks a pending request's captured connection ID `+28` against the current connection. It finishes with error `7` on replacement or disconnect in the fixture. | Connection identity matters independently of the memory address. |
| Once a request has been marked completed, `9988` does not perform that same connection comparison. | A completion result alone must not authorize a new accepted session. |
| `10084` does not itself compare the request's connection ID; `10085` and `10086` do not check authentication. | Upstream dispatch and ordering remain required evidence. |
| `8851` writes own status even when `10144` cannot send it. | Own status cannot establish connectivity or freshness. |
| `10244` sends logout and clears connection flag `+28 & 4`, while retaining the pointer and friend storage. `10243` then returns false. | The native authentication getter is stronger than pointer presence. |
| `10281` and `10073` can process a later login reply and restore the flag on the same connection. The sampled roster values remain unchanged in this fixture. | Polling those values alone cannot record an intervening logout/login transition. |
| `8834` changes status without clearing `+108`; `8835` changes the last reported map. | Re-reading a map does not prove that the server refreshed it. |
| `8839` and `8821` preserve allocated slots when clearing an already empty table. | Allocated empty storage is not a synchronization marker. |

The fixtures establish function-local behavior. They do **not** prove that
every supplied ordering is reachable in the full client. In particular, event
delivery, the real request destructor, the full login completion callback,
nonempty table clearing, and server ordering are not executed. Do not report
these counterexamples as witnessed cross-account leaks or live client bugs.

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

The native request pump and authentication getter are now exercised above.
Still required: establish callback ordering and structurally identify a
transition signal that withdraws previous-session records and admits
current-session records. Do not replace this with the host's current character
key, own status, connection pointer, or a sampled authentication flag alone.

The inspected login completion callback `9998` commits login data and emits
auth event `14`. Its success path writes account and character UUID fields
and copies the selected character name. The request pump calls completion
through vtable `+16`. These relationships identify the next narrow experiment:
prove how login start, table clear, successful completion, and disconnect relate
to one accepted roster generation. A generic pending request can also represent
another operation; state `3` is not a friend-list request type.

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
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/native/friend-lifecycle-evidence.test.ts > build/friend-evidence/lifecycle.tap 2>&1
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
| Native lifecycle function experiments | Eleven synthetic scenarios passed; full dispatch ordering remains unproved |
| Bounded live-record decoding | Not implemented |
| Account/disconnect/reconnect invalidation | Unproved |
| Companion observation installed | No |
| Palette integration | No |
| Live behavior witnessed | No |
| Friend Travel requested / destination reached | No / no |

## Resume here

Resolve the transition signal above before adding a runtime layout or UI.
The preferred tick-only reader is not yet sufficient: its proposed sampled
values can return to their previous values after a transition. Investigate a
narrow, certified lifecycle notification that invalidates the companion's
accepted generation synchronously. Keep that notification internal to the
derived client and companion. It must not add a generic renderer callback or
another roster store. A native monotonic session marker would be simpler if
one can be proved; none is identified by the current experiment.

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
