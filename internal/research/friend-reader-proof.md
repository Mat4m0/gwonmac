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
finds a candidate through the indexed accessor, direct root wrapper, record
constructor and remover, field writers, bounded UTF-16 copy, two scalar writers,
and native Friends UI consumers. It checks complete normalized bodies and the
constructor's direct relationships to array growth and name copying. Relocatable
function indices and static addresses receive semantic roles. The table root is
derived from participating calls.

Input SHA-256 identifies the tested bytes. It does not authorize the reader.
Every result has `runtimeAuthority: false`, including `status: candidate`.
The inspector is imported only by its offline command and tests. It neither
changes a client artifact nor adds a runtime capability.

The [artifact experiments](../../tests/client-artifact/friend-table-evidence.test.ts)
exercise unrelated body changes, root relocation, independent accessor/writer,
constructor, and name-copy reindexing, changed index checks, record size and
field offsets, duplicate record roles and root wrappers, and broken root
relationships. The changed modules must remain valid WASM.
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
| Record lifecycle | constructor `8822`; remover `8820`; array growth `8818` |
| Identity and names | UUID writer `8833`; alias writer `8832`; character writer `8831`; bounded copy `358` |
| Derived record layout | 172 bytes; category `+0`; status `+4`; UUID `+8`; alias `+24`; character `+64`; slot `+104`; map `+108` |

Those values are regression evidence, not production constants.

## Executed native lifecycle experiments

The [shared native fixture](../../tests/fixtures/native-friends.ts), used by the
[lifecycle experiments](../../tests/native/friend-lifecycle-evidence.test.ts),
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

## Private invalidation experiment

The [invalidation experiments](../../tests/native/friend-invalidation-evidence.test.ts)
add one private unsigned counter to the temporary module. The counter changes
at these reviewed sites in the retained input:

| Site | Notification point |
| --- | --- |
| Friend table clear `8839` | Function entry, before record clearing |
| Login start `10116` | Function entry, before provider dispatch |
| Logout `10244` | Function entry, before the logout request |
| Friend teardown `8850` | Function entry, before callback removal |
| Connection change `10240` | Before the active-connection pointer store |
| Connection events `10236` | Before each active-connection pointer store on close, destruction, or failed data dispatch |
| Connection publication `10278` | Before the active-connection pointer store |

The [lifecycle inspector](../../src/main/certification/friend-lifecycle-evidence.ts)
now identifies these function bodies, the request and queue path, and all five
direct stores to the active-connection pointer by semantic shape and required
relationships. They remain uninstalled candidate hooks with
`runtimeAuthority: false`. The unmodified input remains unchanged. Both native and instrumented variants run
against the same synthetic inputs. The comparison checks native return values,
complete fixture-memory hashes, queued payload copies, and modeled effects
after each operation. Only the private counter differs.

Twelve new scenarios pass. They cover a transition between observer ticks,
clear followed by reuse of a slot, all three exercised connection-loss branches,
replacement, teardown, counter exhaustion, behavior preservation, and refusal
of another module. Counter changes are observed before provider dispatch,
disconnect notification, callback removal, and connection storage release.
Ordinary successful data dispatch does not change the counter.
The static coverage check finds all five immediate stores overlapping the
active-connection pointer in exactly those three connection functions. It also
finds no materialization of that exact address as an `i32.const`. This covers
the inspected direct stores; it is not a general alias-analysis proof.

The counter starts at `1`. Exhaustion reaches terminal `0`, which cannot become
an accepted generation again. A changed counter invalidates a previous selection;
it does not establish authentication, table readiness, or fresh server data.

**Result:** the private counter preserves the tested transitions that sampling
alone missed. The retained input has one relocation-aware lifecycle candidate,
including complete direct-store coverage for the active connection pointer.
No runtime capability, companion region, or Travel integration is installed.

Production integration must withdraw the companion's accepted snapshot at the
notification, not merely remember a counter until the next reader tick. The
selection handler must validate the current companion region before resolving
the friend. A cached renderer row alone is insufficient. The existing map-only
Travel command remains the action after that resolution.

## Processed completion and bounded decoding

The [queue fixture](../../tests/fixtures/native-friend-queue.ts) now executes
native `10084`, `10068`, and `9998` through the original queue and callback
machinery: `876`, `493`, `491`, `494`, `499`, `501`, `502`, `503`, `222`,
`889`, `888`, `474`, and `475`. Native string comparison and bounded copying
also execute. Allocation, locks, scheduling, account-property updates, and
logging have explicit substitutes. A recording callback replaces the real
Friends event handler. No game startup, socket, or live account executes.

Eight [queue scenarios](../../tests/native/friend-queue-evidence.test.ts) pass:

- Initial entries precede the successful login completion when the callback
  receives them. Wrong-request and already-completed entries are ignored.
- A successful completion with no entries differs from an undrained or empty
  queue. Failed completion uses the same event ID but carries an error.
- FIFO order and copied payloads survive a block boundary with 100 entries.
- An event queued inside a callback waits for the next drain.
- A disabled context can return enqueue success while dropping the event.
- A closed queue refuses the event.

This establishes a processed completion boundary in the tested context. It
does not execute the real Friends callback or establish server freshness.
Completion at enqueue time or at the end of an arbitrary drain is insufficient.

The [private session gate](../../src/companion-kernel/friend_session.rs) binds
that boundary to one request ID, connection ID, and session epoch. It withdraws
acceptance synchronously on invalidation and admits only after one matching
successful completion queued exactly one event `14` and that event was later
delivered to the native roster callback. The gate keeps ordinals, not a
second roster.
Counter exhaustion or an impossible notification order reaches terminal epoch
`0` and cannot admit again.

Four additional reader-harness scenarios cover admission after drain,
synchronous invalidation, a previously queued completion across replacement
login, failed and mismatched completions, a queue context that reports success
while dropping, and processed-before-queued ordering. The old queued completion
has a lower ordinal and cannot unlock the replacement login. These tests prove
the private mechanism; its notification sites are not yet installed or
structurally certified in the production transform.

The [Rust record reader](../../src/companion-kernel/friend_records.rs) is now
implemented and compiled in a
[standalone harness](../../tests/fixtures/friend-records-kernel.rs). It uses the
companion's real bounded memory helpers. It is not yet linked into the shipped
kernel: certification and session admission must precede live activation.

The reader traverses at most 4096 sparse slots and returns at most 128 friend
records. These are work limits, not claimed game limits. Exceeding either
refuses the complete result instead of truncating it. It validates pointers,
capacity, the null sentinel, slot ownership, categories, status, terminated
UTF-16 names, and nonzero unique identity keys. Alias equality does not merge
friends. Keys include the supplied session generation and UUID, and exclude
the slot number. Raw UUIDs and pointers do not leave the reader. A decoded
empty table is not itself an accepted or synchronized snapshot.

Fourteen [reader and session scenarios](../../tests/native/friend-records-evidence.test.ts) pass.
One instantiates the reader with the native fixture's memory, then reads records
created by `8822`, updated by `8834` and `8835`, removed by `8820`, and replaced
through the native free-slot path. The reader observes the native alias copy,
empty-character fallback, status, and map. A replacement gets a different key.
The experiment reserves array capacity and substitutes hash insertion and
allocator release; it does not prove the complete native hash ownership or
allocation lifecycle. The other cases exercise malformed memory, sparse slots,
output overflow, duplicate aliases and identities, slot movement, session-key
changes, and UTF-16 refusal.

The offline inspector now derives and mutation-tests the reader's complete
record layout from those native roles. This is still input-bound evidence with
`runtimeAuthority: false`; no live observer or Travel authority is added.

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
The queue experiment establishes ordering in one synthetic context. Still
required: structurally identify a transition signal that withdraws previous
session records and admits current-session records. Do not replace this with the host's current character
key, own status, connection pointer, or a sampled authentication flag alone.

The inspected login completion callback `9998` commits login data and emits
auth event `14`. Its success path writes account and character UUID fields
and copies the selected character name. The request pump calls completion
through vtable `+16`. The completion and queue now execute together. The
remaining admission proof must relate that processed completion to one accepted
roster generation. A generic pending request can also represent another operation; state `3` is not a friend-list request type.

Queueing is also relevant: `876` submits the event through `493`, which copies
the payload into the native queue. `872` schedules work. The earlier lifecycle
fixture substitutes event collection, while the new queue fixture executes delivery.
It confirms that observing `9998` return does not mean earlier roster events
have reached the callback. Bind processed completion to the current session
before allowing publication. Do not turn the invalidation counter into a
readiness flag.

### The certified runtime transform remains incomplete

The inspectors now identify the complete bounded record layout, name copying,
UUID writer, allocation growth, removal, sparse-slot ownership, status/map
writers, login request capture, completion and exact queue path, roster callback,
generic event dispatcher, roster registration, and every direct invalidation
site. The queue wraps inner user-event `14` in outer category `36`; the roster
callback is registered for that outer category. It changes records for inner
events `38`, `39`, `40`, and `44`, and returns without changes for inner event
`14`. A hook after that return can establish delivery. The outer event `14`
consumer is unrelated and must not be used for friend-session admission. The
[closed certificate](../../src/main/certification/friend-observer-certificate.ts)
binds both reports to the exact input hash, semantic verifier ABI, and two
semantic proof digests. The utility-process verifier derives it and the main
process accepts only its closed schema. The remaining work is for the production
transform to re-run the proof and install only those certified notifications.
Until then, the session gate and reader remain test-only components.

## Exact local evidence

Set `GW_CLIENT_WASM` to the official local artifact under investigation. Run
these commands from the worktree; no game window or network request is needed:

```bash
mkdir -p build/friend-evidence
node --import ./scripts/ts-hook.mjs scripts/friend-table-evidence.ts "$GW_CLIENT_WASM" > build/friend-evidence/table.json
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/client-artifact/friend-table-evidence.test.ts > build/friend-evidence/mutations.tap 2>&1
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/client-artifact/friend-lifecycle-evidence.test.ts > build/friend-evidence/lifecycle-mutations.tap 2>&1
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/native/friend-lifecycle-evidence.test.ts > build/friend-evidence/lifecycle.tap 2>&1
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/native/friend-lifecycle-evidence.test.ts tests/native/friend-invalidation-evidence.test.ts > build/friend-evidence/invalidation.tap 2>&1
node --import ./scripts/ts-hook.mjs --test --test-reporter=tap --test-timeout=120000 tests/native/friend-*.test.ts > build/friend-evidence/native.tap 2>&1
pnpm check > build/friend-evidence/check.log 2>&1
```

The command exits `0` for one candidate, `1` for unavailable/ambiguous evidence,
and `2` for invocation or file-read failure. Exit `0` does not mean certified.
Preserve stdout directly. Keep generated evidence local; never include real
friend names, UUIDs, rosters, or search text in persisted diagnostics.

| Acceptance boundary | Current result |
| --- | --- |
| Candidate identification | One candidate on the inspected cached input |
| Complete structural record-layout proof | One candidate; changed roles, sizes, and offsets are refused |
| Native lifecycle function experiments | Eleven synthetic scenarios passed; full-client scheduling remains unproved |
| Private invalidation mechanism | Twelve additional scenarios passed on the retained input; runtime hook certification remains open |
| Structural lifecycle proof | One candidate; role movement passes and changed calls, stores, or duplicates are refused |
| Isolated verifier certificate | Closed input- and ABI-bound record implemented; production does not consume it yet |
| Real transform predecessors | Template-save, Core Enhancement, and Tools Enhancement each retain one observer candidate |
| Processed native completion | Eight queue scenarios passed |
| Current-session correlation | Private ordinal gate passes four scenarios; production hooks remain unproved |
| Bounded record decoding | Rust implementation and fourteen reader/session scenarios pass; not installed |
| Account/disconnect/reconnect invalidation | Structurally identified and executed in isolation; not installed |
| Companion observation installed | No |
| Palette integration | No |
| Live behavior witnessed | No |
| Friend Travel requested / destination reached | No / no |

## Resume here

The next milestone is one certified read-only observer, ready to compare with
the native Friends panel. Do not start another broad implementation survey.
One concrete gate remains before live activation: have the production transform
re-run and consume the isolated-verifier certificate, then install the certified
lifecycle notifications, session gate, bounded reader, and snapshot region. The
record layout and private current-session admission mechanism pass their offline
mutations and native execution scenarios; neither grants runtime authority by
itself.

After those gates pass, link the existing Rust reader into the companion and
reuse region installation and the sequence feed. No second roster store or
generic renderer callback is needed. Keep reported location separate from
freshness: these experiments do not establish that a retained map was refreshed
by the server after reconnect.

Observe only while Tools, Travel, the open palette, and supported-region policy
permit it. Friend certification refusal must leave ordinary Travel available.
Successful unchanged reads remain fresh; stopped observation withdraws state.
Use a session-local identity that cannot become another friend after slot reuse.
At selection, re-resolve identity and the displayed map. A changed map requires
a new selection. Keep all game commands in the existing Travel owner.

Follow [Core and Tools development](../../docs/enhancement-development.md) and
[WASM host and certification](../../docs/wasm-host.md) for integration.
