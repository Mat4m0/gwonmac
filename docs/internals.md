# Internals

Guild Wars is an Emscripten/JSPI WebAssembly client whose platform
services are read from a JavaScript `Module` object. This repository supplies
those services in a macOS Electron application.

## Process model

```text
Electron main process
  ArenaNet client updater + atomic artifact publication
  native content-addressed chunk store
  gw://app protocol
  DNS + raw TCP ownership
  explicit HTTPS proxy routes
  encrypted owner-only saved-login handling
  settings + lifecycle + diagnostics
          │ narrow validated IPC
Sandboxed preload
          │ frozen window.gwNative capability object
Chromium renderer
  loading/settings UI
  Emscripten Module host
  JSPI WASM + WebGL/ANGLE
  default-on exact-build Toolbox foundation
```

The renderer has no Node integration. Context isolation, Chromium sandboxing,
web security, ASAR integrity, and app-only ASAR loading are enabled. Navigation,
redirects, permissions, external links, DNS names, socket destinations, ports,
proxy routes, IPC senders, and IPC payloads are validated in the main process.

`gw://app` is registered as a standard secure scheme before Electron becomes
ready. It serves packaged renderer assets, current JSPI artifacts, virtual
snapshot ranges, and an explicit set of proxy routes. It does not expose an
arbitrary filesystem or URL fetch capability.

## Source layout

| Path                      | Ownership                                                         |
| ------------------------- | ----------------------------------------------------------------- |
| `src/main/main.ts`        | composition root and application lifecycle                        |
| `src/main/client-runtime.ts` | atomic generation, update, rollback, cache, selected WASM       |
| `src/main/core/`          | updater, cache, DNS, sockets, credentials, settings, window state |
| `src/main/core/wasm-binary.ts` | WASM section codec shared by both transforms and the re-certifier |
| `src/main/protocol.ts`    | `gw://app` routing and range responses                            |
| `src/main/ipc.ts`         | validated native capability handlers                              |
| `src/main/diagnostics.ts` | bounded flight recorder, captures, export                         |
| `src/main/diagnostics/`   | closed event schema, export detector, pattern scanner             |
| `src/preload/preload.cjs` | self-contained sandbox-compatible bridge                          |
| `src/renderer/`           | launcher, `Module` host, input, graphics, diagnostics             |
| `src/toolbox-kernel/`     | freestanding read-only game-state companion WASM                  |
| `src/shared/`             | contracts, validation types, progress, errors                     |
| `src/tools/diagnostics/`  | `.gwdiag` validator, summary, comparison                          |
| `tools/`, `gwkey.py`      | developer-only binary analysis                                    |

The preload is deliberately self-contained CommonJS. Electron’s sandboxed
preload loader does not execute a local ESM dependency graph. Release tests
therefore assert that every canonical channel is present in both the preload
and the main-process wiring. The bridge and each nested namespace are frozen.

## Game update and snapshot cache

The main process downloads only:

```text
Gw.jspi.js
Gw.jspi.wasm
version.json
```

The remote manifest has bounded size, file and directory counts, names,
parent topology, and chunk references. Required product basenames must be
unique. Network bodies are streamed beneath call-site byte ceilings and gzip
decoding cannot exceed the manifest's exact expected chunk length.
Existing artifacts are verified chunk-by-chunk against the current manifest;
equal file length is not treated as proof of equality. New artifacts are built
in a part file, synced, and renamed only after every content hash passes.
The published local manifest retains the executable artifacts' sizes and chunk
hashes, so offline fallback is independently verifiable. A changed client is
kept as a candidate beside one verified previous generation until it has both
presented a frame and opened a game TCP connection. A login-screen frame alone
cannot discard the rollback generation. Failure before both signals durably
rejects that exact client fingerprint for the current host version and restores
the previous generation.
Invalid or legacy-unverifiable state is never promoted into the rollback slot.

`Gw.snapshot` is never assembled for on-demand mode. `ChunkStore` maps each
range onto 256 KB chunks, coalesces concurrent requests by content hash,
verifies downloaded bytes, and publishes chunks atomically. Its in-memory
residency set is initialized with one directory scan and updated on
publication. Snapshot requests never rescan every hash on disk.

The renderer keeps a disposable 256 MB LRU of chunk bytes. The main-process
content store is canonical. Snapshot range responses are `no-store`, and
Chromium's derived network cache is cleared at startup; otherwise it duplicates
hundreds of megabytes of already-resident native chunks. This does not remove
or redownload the canonical chunk store. `image.fileSize` stays synchronous
because the snapshot metadata is obtained before the Emscripten glue is
appended.

Download concurrency is capped at eight. This is a conduct constraint as well
as a performance setting: every installation uses the public client access key
against ArenaNet’s production service. Individual patch requests have a
30-second ceiling and retain the existing bounded exponential retry policy.

Full-image progress uses one time-weighted rate average after a short warm-up;
the same value drives the displayed transfer rate and ETA. The main process
derives native task feedback from the canonical `image` progress phase: the
Dock shows determinate or indeterminate progress and
`prevent-app-suspension` remains active until the download completes, pauses,
or fails. There is no renderer-owned download or power state.

## WASM host

`Module` must be declared with `var`; the generated glue redeclares it.
`Gw.jspi.js` asks for `Gw.wasm`, so `locateFile` explicitly selects
`Gw.jspi.wasm`. The protocol reads one immutable `ActiveClient` per request;
its chunk store, snapshot metadata, artifact directory, and selected WASM can
never come from different client generations. Full-file protocol responses stream from disk, allowing
`WebAssembly.instantiateStreaming` to compile without first retaining the
whole module in main-process memory. Cached Toolbox validation also streams
both hashes; the official bytes are loaded only for a cold transform. Asyncify
is not a production fallback.

Before `Gw.jspi.js` is appended, the renderer resolves the single
`dataStrategy` setting against native cache residency. `null` owns the
first-run choice, `quick` releases boot immediately, and incomplete `full`
owns the foreground downloader. Main owns native download execution, canonical
progress, and power state; the renderer keeps one coalesced UI operation phase
and derives presentation from progress plus cache residency. The game, audio
context, sockets, and WebGL runtime cannot start behind the launcher. Cache
residency—not a saved progress counter—is the download truth. Full Game
additionally runs the bounded content-hash verification pass at startup even
when every expected filename is resident; corruption cannot bypass the repair
path.

Awaited host calls always return promises:

```text
image.cacheAsync
dns.resolve
secureStorage.getCredentials/storeCredentials/clearCredentials
adProvider.showInterstitial
shop.initialize/inAppPurchase
```

The generated glue requires all three credential methods. They cross a narrow
IPC boundary to one native `CredentialsStore`, which writes encrypted
`credentials.bin` atomically with mode `0600`. Because ad-hoc builds have no
stable signing identity, the main process enables Chromium's
`use-mock-keychain` provider before ready. Electron `safeStorage` therefore
uses a local mock profile key rather than macOS Keychain: it prevents recurring
OS prompts and casual plaintext disclosure, but does not defend the saved
login from software running as the same user. An unreadable ciphertext is never
deleted by a read; the failure is recorded without credential content and the
game prompts again. A later explicit save atomically replaces it.
Browser cookies are cleared at startup and quit. Persistent IDBFS client
preferences and the dedicated saved-login file remain intact.
No federated provider is advertised, allowing the client’s username/password
flow to own the UI. The app has no independent update feed;
application replacements are manual, while the ArenaNet client updater remains
automatic. Properly guarded browser, analytics, age-signal, and federated-auth
namespaces are absent. The two namespaces with defective absence guards
(`adProvider` and `shop`) are narrow plain objects whose unavailable operations
reject with the promise shapes expected by the client.

The renderer owns one persistent game filesystem initialization before the
official client enters `main()`. It mounts and restores Emscripten IDBFS at
`app:`, creates `Templates/Skills` and `Templates/Equipment`, changes the
working directory to that mount, and persists the directory invariant before
releasing the run dependency. This keeps the client's relative build-template,
screenshot, chat-log, and preference writes in one durable origin. A restore
or initial persist failure stops startup instead of silently running against
ephemeral memory. At Emscripten's public file-operation boundary, Windows-style
backslashes are normalized to POSIX separators before lookup, create, rename,
or delete logic sees them. Static inspection of the current official WASM
shows that its template path builder normally inserts `/`; the normalization
is a boundary invariant, not an explanation of template-save success.

For template-save investigation only, launching the application with
`GW_TEMPLATE_FS_TRACE=1` adds `template-fs-trace=1` to the trusted renderer URL.
Before instantiation, the renderer then wraps the official module's
`__syscall_openat`, `__syscall_ftruncate64`, `fd_read`, `fd_write`,
`fd_pwrite`, `fd_seek`, and `fd_close` imports.
The bounded console trace records only the template kind, flags, descriptor,
errno, and requested/written byte counts. It never records a filename, path, or
file content, does not cross IPC, and is not included in `.gwdiag` exports.
Normal launches retain the original imports unchanged.

`internal/upstream/` holds the full record: the defect report written for
ArenaNet, the client internals we had to recover, the bridge contract, the
re-certification procedure for a new client build, and the investigation log.
Read it before changing anything below.

Every index and offset the transform carries belongs to one exact client build.
`pnpm template:recertify` re-derives them from a new one by shape — body bytes,
resolved signatures, and caller-set intersection — and refuses rather than
guessing when a locator finds the wrong number of candidates. It recovers
indices, not semantics; `internal/upstream/recertify.md` still owns re-measuring
what the client's path helpers actually do.

Four `Base/Os` file routines ship unimplemented and never reach Emscripten FS.
Creating a directory returns error 2 unconditionally, which is why a build save
fails before any syscall. Enumerating a directory does nothing, which is why
"Load from Skills Template" lists nothing, and deriving an entry's name writes
nothing. Deleting a file is `assert("not implemented")` followed by
`unreachable`, so removing or renaming a build aborts the client. A fifth
routine is implemented but wrong: `File::Open` mode 1 is meant to open an
existing file, and the client uses it to ask whether a rename's destination is
already taken — but in this build it opens `O_RDWR | O_CREAT`, so the probe
creates the file it is testing for and every rename is refused. The module
imports no `mkdir`, `getdents`, or `unlink`, so none of this is reachable from
JavaScript as shipped.

For the exact certified client hash, a deterministic transform appends five
forwarders and repoints only the template, chat-log, and screenshot call sites
at them. Appending leaves every existing function index valid, and the stub
bodies stay intact so the model paths that also call them keep today's
behaviour. Each forwarder passes the stub's arguments to the existing
`__syscall_newfstatat` import behind a dirfd marker no real call can produce.
The `File::Open` forwarder is the one exception: it asks the host first and
calls the real function only when the file is there, so the load and write
paths keep their own behaviour and only the probe changes.

The renderer answers the five markers against the mounted IDBFS: create a
directory tree, list a wildcard, turn an entry into the name the client keys a
template by, delete a file, and answer whether one exists. Renaming needs no
marker of its own — the client implements it as probe, write the new name, then
delete the old. Paths must stay relative and free of traversal, so the client
cannot address anything outside its own mount. Directory entries the
mount cannot describe are skipped rather than failing the whole listing. The
listing block is allocated with the client's own `malloc` because the client
frees it. Ordinary `newfstatat` calls remain unchanged.

Three details in that contract are load-bearing, and each one cost a round of
build, ship, and try again. The enumeration flag selects the entry kind — the
template scans ask for `*.txt` with files and `*` with directories — so
answering both with files fills the subdirectory list with folders named after
the templates. A template is keyed by its path below the type directory in
Windows form with a leading separator, `\Test`, which is what the client's own
save path builds and what its list filter matches against the current
subdirectory; a bare `Test` registers but never lists. And the host removes the
extension itself, because `Path::RemoveExtension` in this build takes the last
character of the name with it.

The downloaded official module remains canonical. The derived module is
verified by input hash, instruction signature, WebAssembly validation, and
expected output hash, then atomically cached and streamed by the existing
protocol path. Unknown builds use the official module. The derived cache is
rebuildable from the official artifact and old compatibility generations are
deleted when the selected client changes.

After native confirmation, the recovery action records a restart request.
Startup clears only IndexedDB for the owned `gw://app` session before a
renderer can mount IDBFS, then removes the request. It cannot clear the
separate native chunk cache or encrypted credential file. There is no native
arbitrary-file bridge.

### Toolbox instrumentation

The official `Gw.jspi.wasm` remains canonical. A session with the Toolbox
switched off applies only the certified template-save compatibility transform
described above: it does no Toolbox transform, fetches no kernel, installs no
Toolbox hook, starts no snapshot observer, and contains no Toolbox UI. There is
no Toolbox UI in any session.

Two gates, and only these two, enable the Toolbox path. `toolbox-policy.ts`
holds both: `TOOLBOX_AUTOMATION_ENABLED` stays non-packaged and
`GW_TOOLBOX_AUTOMATION`-gated, and `toolboxEnabledFor(settings)` adds the
player-facing `nativeCursor` setting, which defaults to **true** — every
shipped install runs the derived module, and the setting is how a player turns
it off. Automation did not move with it: no packaged build can reach that tier
whatever the environment says, which is what makes "does not send game input or
act on the player's behalf" a testable claim rather than a promise. Main reads
the setting once at startup and passes the result as
`ClientRuntime.toolboxEnabled`,
because the choice selects which WASM main the launch serves; a change takes
effect at the next game start. The same value writes the renderer's
`native-cursor=1` parameter — `toolbox-automation=1` for automation — and
`renderer-trust.ts` allow-lists both. `harness.js` dynamically imports
`toolbox.js` only when one of them is present, so a renderer URL without them
cannot reach the Toolbox at all.

Enabled sessions hash the official module after publication and recognize only
entries in the checked-in Toolbox build manifest. A known
hash is transformed deterministically into a separate cache entry keyed by
official hash, transform ABI, and manifest fingerprint. The transform clones
one typed function, installs one dispatcher, and embeds the verified layout as
a custom section. Unknown hashes and transform failures serve the official
module unchanged, so an uncertified build stays fully playable and the cursor
falls back to the plain macOS pointer.

`toolbox-transform.ts` is the pure byte transform. `toolbox-client.ts` owns
streaming hash validation, cache reuse, and atomic derived publication. The
manifest's ordered layout fields generate the embedded `layoutWords`; the
renderer does not maintain a second field-order list.

Build 38,771 hooks the exported `EmscriptenExeThreadMainLoop` at function index
446. It uses the stock table's null slot 0; the mutable global stores
`slot + 1`, preserving zero as disabled. No table growth or all-functions
instrumentation remains.

After runtime initialization in an enabled session, the renderer dynamically
loads the Toolbox runtime, allocates a config and
64-byte snapshot through the game's allocator, instantiates the dependency-free
`wasm32-unknown-unknown` companion against the exported memory, installs its
callback, and enables the dispatcher last. The callback calls the relocated
original exactly once before collecting checked map/player/target state.

Snapshot ABI v1 uses a named 68-byte `repr(C)` Layout and 64-byte Snapshot,
compile-time size assertions, checked pointer arithmetic, and an odd/even
sequence lock. It contains no pointers. The snapshot observer reads at most
once per animation frame and rejects unknown flags, invalid IDs/types/bands,
and non-finite values. It publishes structured `gwToolboxState` without
production DOM. The cursor consumer is the one part that reaches production
DOM, and only as an inline `cursor` on the game canvas; losing the cursor
clears that inline value and nothing else. No memory view or per-frame call
crosses preload or IPC.

The native socket manager owns all TCP handles. It permits only public-unicast
destinations and ports `6112`, `80`, and `443`, and closes an owner’s sockets on
reload, renderer loss, or quit. DNS accepts only approved ArenaNet/Guild Wars
suffixes and retains the raw DNS fallback needed for the `0.0.1.2` datacenter
sentinel.

Three ceilings bound one renderer: 64 sockets, 4 MiB queued on any single
socket, and 16 MiB queued across all of them together. The aggregate one is the
ceiling that matters — a per-socket limit alone leaves 64 × 4 MiB = 256 MiB of
main-process buffering reachable from one renderer. A send that would cross
either byte ceiling is refused before anything is queued, and the socket stays
open, so a refusal costs one packet rather than the connection. Owners are
accounted separately: a saturated renderer cannot spend, or free, another’s
budget.

Each write reserves its bytes before the write and releases them exactly once —
when the write callback runs, or at teardown for whatever the socket still
holds. Both halves are needed. A destroyed socket may never fire the callbacks
it owes, so teardown without reclamation leaks an owner’s budget until the
process exits; and a callback that arrives after teardown must not release the
same bytes twice, or the reclaimed budget is taken from sockets that are still
alive. After close, failure, renderer reload and quit, no owner holds any
reserved bytes.

Game socket payloads are views into WebAssembly memory. The renderer copies
each outbound view into a compact `Uint8Array` before crossing
`contextBridge`; otherwise Electron can serialize the view’s entire backing
memory for a packet only a few bytes long. Electron's compact IPC value is
written directly to the native socket without another `Buffer` copy. Main
still owns validation, backpressure, ordering, and the TCP write. Diagnostics reconcile logical,
source-backing, compact, IPC-backing, and written byte counts without recording
packet contents.

### Official-client memory floor

The generated client mounts Emscripten IDBFS at `app:` and restores
`app:/Gw.dat` before completing initialization. On the certified profile that
file is about 919 MB, while the official WASM linear memory is about 369 MiB.
Restoring IDBFS can therefore create a short-lived RSS peak above 1 GiB in both
the browser/main and renderer processes even though steady resident memory
falls sharply after the pages become reclaimable. This is not Toolbox state,
the 256 MB snapshot LRU, or Chromium's network cache.

Avoiding that peak requires an architectural replacement for the official
synchronous Emscripten filesystem—such as a proven lazy native backend or a
worker-hosted runtime—not a safe local copy removal. Do not clear IDBFS or
patch the official glue speculatively: `Gw.dat` is persistent client state and
removing it can turn memory pressure into repeated reconstruction and snapshot
I/O.

Closing the single game window is an application quit. The close event is
converted to `app.quit()` before the renderer is destroyed, cleanup closes
sockets and background work, diagnostics flush their final lifecycle events,
and the process exits with status zero. Main-to-renderer events are dropped
once either the window or its `webContents` is destroyed. Renderer recovery is
reserved for unexpected loss while the application is not quitting.

## Rendering and input

The client creates a WebGL context on an `OffscreenCanvas`. The EGL import
patch presents each successful swap through `transferToImageBitmap()` and the
visible canvas’s `bitmaprenderer`. The client remains the only canvas-size
owner; the host supplies the selected render scale through Emscripten’s device
pixel ratio import and mirrors client-requested sizes to the offscreen buffer.

A second import patch memoizes asynchronous shader-compile completion. The
client uses `KHR_parallel_shader_compile` and polls
`glGetProgramiv(program, COMPLETION_STATUS_KHR)` in a loop; Chromium cannot
answer that from its client-side cache, so every poll flushes the command
buffer and waits on the GPU process. A recon session measured 36,713 polls
against roughly 250 programs in seven minutes.

Only completion is cached, and only once it reads true. False is the answer the
client is polling for a change in, so freezing it would leave the client
polling a program that never finishes; true is terminal until the next
`glLinkProgram`, which clears the entry, as does losing the WebGL context. The
cache tracks a program only while the host has seen it created and not deleted,
so a recycled name starts cold and a name from before install is never
recorded. Every other query passes through untouched, including
`GL_VALIDATE_STATUS` — evaluated against current GL state rather than the
program — and the link-derived pnames, which the client was measured asking
exactly once per program. A missing import disables the whole patch rather than
half of it, and the `gl.programQuery*` counters prove it is engaged against the
downloaded client.

The renderer also supplies focus, OSK fields, trusted-interaction audio resume,
fullscreen, touch translation, trackpad-wheel normalization, and right-drag
pointer lock. `input.js` owns the canvas input listeners and accepts validated
touch settings from the settings owner; it does not persist settings itself. One
held-input registry releases keys, buttons, and touches when focus or native UI
consumes an input release. Pointer lock uses a virtual cursor and recycles a
held drag at canvas edges so camera rotation does not stall.

The client identifies a key by `KeyboardEvent.key`, so its held-key state is
character state, not physical state. macOS makes Option a text modifier, which
rewrites that character for as long as Option is held: `W` arrives as `∑` on a
US layout, and as a bound character on others — a German Option+L is `@`, which
the client reads as the `2` key. A press and its release therefore disagree
whenever Option is held across only one of them, and the key the client believes
is down never comes up. The input host reads the OS layout map, restates the
event with the unmodified character of `event.code`, and stops the rewritten
original so the client sees exactly one event per physical transition. Text
fields are restated too, because the client relays their key events to the
canvas; only propagation is stopped, so the field still types the composed
character. Command is different — macOS withholds the release entirely — and
that stays handled by releasing every non-modifier key when Command comes up.

## Diagnostics

Every event uses an integer monotonic microsecond timestamp, sequence number,
process/subsystem name, level, typed scalar fields, and optional
`traceId`/`spanId`/`parentSpanId`. Seven-sample renderer/main clock
synchronization chooses the lowest-round-trip sample and repeats after
visibility changes and every five minutes.

The shared timeline starts at process launch and records Electron ready,
renderer load, WASM instantiation begin/end, streaming fallback, runtime ready,
first submitted frame, startup complete, and the official client build id.

Level 0 is always active:

- bounded 2,048-event memory ring;
- five rolling 5 MB JSONL files;
- renderer aggregation every two seconds, never per-frame IPC;
- fixed-bucket frame, swap, snapshot, socket-bridge, and input latency
  distributions, merged without reducing them to averages;
- event-loop and process samples;
- cache/disk/network/protocol spans;
- GPU, power, thermal, lifecycle, crash, and context-loss signals;
- window focus, minimize, hide, and resize/move brackets, plus a per-batch
  renderer `focused` flag.

Window state is load-bearing for stall attribution. An unfocused, occluded, or
mid-resize window stops being composited, which stops `requestAnimationFrame`
with no CPU spent in any process — indistinguishable from a real freeze unless
it is recorded. `document.hidden` reports none of that on macOS, so the main
process records the transitions itself; it stays responsive while the renderer
is frozen, which makes its timestamps the ones to line up against `frames.bin`.

GPU process feature status is sampled at export, not at Electron ready: the GPU
process does not exist when the recorder starts, and Chromium's
pre-initialization answer reads as software rendering on a machine that is in
fact running ANGLE on Metal. Sampling late also means that if the GPU process
has died, “disabled” is the truth rather than an artefact.

At launch the diagnostics directory keeps only `session-*.jsonl`; everything
else is removed, including Chromium's `.<bundle-id>.XXXXXX` atomic-write
temporaries, which a prefix-matching sweep could never reach.

Level 1 adds fixed-width per-frame records. The renderer batches them; the main
process writes `frames.bin` asynchronously with a 128 MB ceiling. Level 2 adds
an argument-filtered Chromium trace with selected supported categories, a
256 MB buffer, an 80% stop threshold, and a 120-second time limit.
The trace is deleted at quit and by the launch sweep, deliberately not after an
export: the recorded capture level stays at 2 for the rest of the session, so
discarding it there would make a second export declare Level 2 with no trace and
fail its own validation. Its size is recorded as `capture.traceBytes`. If a
trace is ever lost, drop the broad `blink` category before reducing the buffer.
A Level 2 capture whose manifest declares no `chromium-trace.json` fails
validation instead of looking complete.

Record Level 2 for fifteen to thirty seconds and stop immediately after the
hitch. The buffer fills in roughly half a minute of heavy activity, and a trace
that stops short of the export leaves the stalls after it unattributed.

During Level 2 only, fixed-name `gw.frame.submit` and `gw.snapshot.resolve`
User Timing marks place frame and snapshot boundaries directly on Chromium's
trace clock. They carry no arguments and are cleared from the renderer's
Performance Timeline immediately after emission. Under an active trace each
mark costs about 114 µs — roughly 1.3% of a capture, and the third hottest leaf
in it. That cost is `performance.mark` emitting an argument-filtered trace
event; `performance.clearMarks` was measured at 0.3 µs and is not the lever.
It is one more reason Level 2 locates causes but cannot establish gains.
The existing main-to-renderer capture command path also owns a noninteractive
recording indicator, elapsed timer, and problem-marker acknowledgement; it
does not add a preload capability.

`.gwdiag` is a ZIP with:

```text
manifest.json
report.json
summary.json
capture-summary.json         optional, selected Level 1/2 window only
events.jsonl
previous-events.jsonl        optional, latest abnormally ended session
frames.bin                   optional
environment.json
settings-redacted.json
chromium-trace.json        optional
```

`events.jsonl` is assembled from the complete retained session files rather
than the smaller live memory ring. Manifest metadata states whether session
start is still retained and gives exact event and capture sequence bounds.
`report.json` is the compact triage entry point: startup stage, error/warning
counts, last structured error, capture state, and key performance percentiles.
The immediately previous retained session is included as
`previous-events.jsonl` when it lacks `quit.cleanupCompleted` or contains a
fatal main exception, cleanup failure, or unexpected renderer loss. Cleanup
can complete after a fatal error, so outcome and cleanup state are evaluated
separately. Clean previous sessions are not duplicated.

Renderer console text remains renderer-local and bounded. Only allow-listed
failure names and non-text eight-hex fingerprints cross IPC. This makes
repeated failures correlatable without exporting exception text, account data,
chat, paths, request contents, or packet contents.
The recorder normalizes every event name to a dot-separated identifier, so all
producers share one searchable vocabulary.
Event-loop delay uses reset five-second windows at 5 ms resolution. When
`frames.bin` exists, the tools calculate exact visible-only frame percentiles,
FPS, and stalls from its fixed-width records.

`socket.rendererSettle` measures how long the renderer takes to settle a send
promise, so it reports *renderer* stalls, not network latency: a frozen renderer
cannot run the continuation. `socket.writeCallback` is the main-side write, and
subtracting the two is what separates TCP backpressure from a renderer stall.

### What the export actually guarantees

The export is `formatVersion` 2 and its protection has three tiers, one per
kind of text in it. The manifest's `redaction` object states which tier
covered what, as counts rather than as a verdict; the earlier literal
`redaction: "passed"` claimed a check that could not fail, because it asked an
idempotent redactor whether its own output was a fixed point.

**`events.jsonl` is certified against a closed schema.** Every event the main
process records is a member of the discriminated union in
`src/main/diagnostics/schema.ts`, and every field of every member is a number,
a boolean, a member of a declared string enum, or a branded 64-hex digest.
A field typed `string` fails `tsc` inside the schema file itself, so free text
is not redacted out of recorded events — it cannot be written in the first
place. Producers pass a `DiagnosticEvent` to `logEvent`, so a failure records
an `ErrorCode` from the closed catalogue in `src/shared/errors.ts` where it
used to record `error.message`; a foreign error's own `code` is an open set we
do not control and collapses to `unknown` rather than widening ours.
Before anything is written, `inspectEventLog` in
`src/main/diagnostics/detector.ts` walks the assembled log and matches each
declared record against that schema field by field — exactly the declared
fields, each accepted by the guard for its declared type. A record that does
not match throws and no export is produced at all. `redaction.records` counts
every record walked and `redaction.schemaChecked` the subset the schema
declares and the detector matched. The detector imports neither the recorder
nor the pattern scanner, which is what makes it evidence: a checker built from
the redactor's own patterns can only ever agree with the redactor.

**What the schema has not absorbed yet is counted, not hidden.** Spans still
take open `DiagnosticFields`, and milestones and counters still call `log()`,
so some records carry strings. `redaction.openFields` is how many string
values the export contains outside the closed schema, and **it is not zero**
in a real export. It is a raw count of undeclared string values, not a count
of leaks: what dominates it is span fields, because `Span.end` still takes
open `DiagnosticFields` — `status` on `dns.resolve` and `update.clientUpdate`,
`route` and `method` on `proxy.request`, `priority` on `snapshot.read`, which
is unsuppressed for the whole of a Level 1 capture — plus the `status` on each
renderer socket-send record. Those are closed vocabularies that simply have no
schema entry yet, so a four-figure `openFields` in a capture is mostly the
literal `"ok"` repeated. The privacy-relevant contributor is
`security.navigationBlocked` / `security.redirectBlocked` in `window.ts`,
which publish a full `url`; they fire only when a navigation is actually
blocked, so an ordinary session contributes none. Every one of these values
gets the recorder's key-name drop and the pattern scan, which is weaker than
the schema. The number reaches zero when the schema covers spans and those two
events; until then it is in the manifest so a reader can see the residue
instead of being told it does not exist.

**The trace and the un-schema'd documents are pattern-scanned.**
`chromium-trace.json`, `environment.json`, `summary.json`, `report.json`,
`settings-redacted.json`, `capture-summary.json` and `manifest.json` carry
leaves from OS and Chromium APIs, and `previous-events.jsonl` was written by
whichever build ran last — for anyone upgrading from the alpha, a build whose
events still had `message` fields, which is why the previous session is
scanned and never certified. `src/main/diagnostics/text-scan.ts` is the only
tool that applies to text we did not author: it replaces the home directory,
bearer tokens, quoted and unquoted values under a sensitive-key vocabulary,
`file:` URLs, query-string values, email addresses, and absolute paths —
including a path at index 0, which the previous positive lookbehind required a
delimiter to see. A Level 2 trace reaches a quarter of a gigabyte, so it is
scanned in chunks cut immediately after a comma: no rule can match across one
— every value class excludes it, which the unit test proves by scanning each
corpus document at every split point — and the carry is raw input rather than
the scanner's own output, so a value straddling a cut is scanned whole rather
than half-redacted and half copied. There is one exception, and it is the
price of that comma: after a megabyte with no comma in it the scanner flushes
anyway rather than buffer without bound, and a value straddling *that* cut is
half-redacted with its remainder written out verbatim. A comma is the only
character no rule can match across, so there is nothing safer to fall back to.
`redaction.traceBytesScanned` records how much went through it. This tier is a
vocabulary, not a proof: it misses anything it has no pattern for, it does not
match a sensitive value that contains a comma itself (a serialized JSON blob
under an `accountInfo` key stays as it is), and it over-redacts benign keys
that contain a sensitive word — the safe direction. Numeric values under those
keys are left alone so the trace stays valid JSON for
`pnpm diagnostics:attribute-stalls`.

Some things are excluded by construction rather than by any of the three
tiers. Renderer console text and exception text never cross IPC; only
allow-listed failure names and non-text fingerprints do. Chromium net bodies,
HTTP headers, account request bodies, and TCP payloads are never recorded, so
they are not in the export to be removed. Crash dumps are never included;
Crashpad is local-only and retains at most three dumps.

`pnpm diagnostics:validate` re-runs the detector over the `events.jsonl` it
extracted and refuses to agree with a manifest whose counts it cannot
reproduce, so a forged or stale manifest fails rather than being read back at
face value. Format 1 exports — what the public alpha produced — keep one
explicit legacy read path: they require `histograms.json`, and `"passed"` is
still the only verdict they can offer, because nothing inside one of them can
reproduce more.

### Reading a capture

The comparison tool warns about architecture, OS, app version, GPU renderer,
render scale, canvas size, capture level, visibility, same-session and
overlapping-window differences. Deep traces are labeled profiler-contaminated
and should locate a bottleneck, not provide the final before/after number.

`pnpm diagnostics:attribute-stalls <capture.gwdiag> [threshold-ms]` requires a
Level 2 capture made by a build with the trace markers above. It finds
consecutive submitted-frame marks beyond the threshold, counts snapshot
resolutions inside each interval, reconstructs V8 CPU-profiler stacks, and
reports CPU categories, hot leaves, hot complete stacks, and the longest
overlapping renderer-thread trace events. Captures without the markers fail
report the incompatibility instead of attempting cross-clock timestamp
inference.

`pnpm diagnostics:attribute-frames <capture.gwdiag> [threshold-ms]` is its
Level 1 counterpart, and Level 1 is the level that can establish gains. It joins
visible-frame gaps from `frames.bin` to the main-process events within a second
and a half either side — the main process keeps running while the renderer is
frozen, so its timestamps are the reliable side of the join. Each stall is
attributed to composition loss when the window changed state, to the main
process when its event loop actually blocked, and otherwise to the renderer.
Captures recorded before window-state tracking say so rather than claiming the
window was steady.

## Verification boundaries

### Claims and the tests that prove them

Every statement this project makes in public — the website, `README.md`, the
in-app copy — is a claim someone can hold us to. Each one gets a row here and
each row names something that executes.

**The rule: a public claim with no row does not ship, and a row whose proof
reads _none_ is a claim to narrow or delete, not a claim to explain.** The
two that read _none_ today are recorded rather than quietly kept.

| Claim | Where it is made | What executes to prove it |
| --- | --- | --- |
| "It does not send game input or act on the player's behalf" | website FAQ | `tests/release/toolbox-default-cursor-and-gates.test.mjs` — *automation is the one tier a shipped build cannot reach*: the automation constant stays `!app.isPackaged`-gated, and main reaches it only through `toolboxEnabledFor` |
| The official artifact is preserved; the module the session runs is a derived copy | website FAQ, `docs/user-guide.md` | `tests/unit/template-save-compat.test.ts` — *never writes into the caller's input, Buffer or not*, *leaves unknown future client builds canonical*; `tests/unit/derived-wasm-cache.test.ts` — *publishes nothing when the output misses the pinned hash* |
| Game files come directly from ArenaNet and are verified before use | website FAQ, `README.md` | `tests/unit/manifest.test.ts`, `tests/unit/chunk-store.test.ts` (verify-on-read, unlink-and-refetch), `tests/unit/published-client.test.ts`; `tests/integration/updater.test.mjs` for publication, corruption repair and rollback |
| No telemetry, credentials, account identifiers, or game traffic are uploaded | website features list and FAQ | `tests/unit/no-game-traffic-is-uploaded.test.ts` — the test named for the claim: *refuses every destination that is not a public ArenaNet-shaped address* (loopback, private ranges, this project's own host, every port outside 6112/80/443), and *exports a socket's lifetime with no trace of what it carried*; `tests/unit/allowlists.test.ts` and `tests/unit/proxy-routes.test.ts` for the boundaries underneath it |
| A `.gwdiag` never contains credentials, account identifiers, packet contents, or crash dumps | website FAQ, `docs/user-guide.md` | `tests/unit/diagnostic-schema-rejects-free-text.test.ts`, `tests/unit/export-detector-rejects-undeclared-event-fields.test.ts`, `tests/unit/socket-events-carry-no-error-text.test.ts`, `tests/unit/trace-scanner-catches-the-adversarial-corpus.test.ts`. Read *What the export actually guarantees* above for which tier covers which file |
| The app makes no network request the player did not ask for | settings copy, `docs/user-guide.md` | `tests/unit/settings.test.ts` — *exposes the documented defaults* (`autoCheckUpdates: false`); `tests/unit/release-notice.test.ts` and `tests/unit/update-action.test.ts` for the check itself |
| The game's own cursor is on by default, is switchable off, and no artwork ships or is downloaded | settings copy, `docs/user-guide.md` | `tests/release/toolbox-default-cursor-and-gates.test.mjs` — *the cursor ships on, and a player who switches it off stays off*; `tests/electron/toolbox-cursor.spec.mjs` for what Chromium computes from a published cursor region; `tests/policy/forbidden-artifacts.test.mjs` for what is tracked |
| Releases are ad-hoc signed and the shipped fuses hold | website FAQ | `tests/packaged-smoke.mjs` (`codesign --verify --deep --strict`, the nine fuse states), `tests/policy/fuses.test.mjs` |
| Render scale changes the real backing resolution | website, settings copy | `tests/electron/live.spec.mjs` (opt-in live smoke) — the drawing buffer changes with the setting; `tests/electron/settings.spec.mjs` for the resolutions shown beside each scale |
| "Up to 60 FPS", "tuned for Apple Silicon" | website capability facts | **none.** No test asserts a frame rate, and `tests/packaged-smoke.mjs` does not assert the packaged binary's architecture |
| "The client's available graphics settings, plus selectable render scale" | website capability facts | Narrowed in P3.22 from "every in-game quality option, fully available", which was wrong — the official WebGL client may offer only `None` for antialiasing. `tests/website-smoke.mjs` executes the served page and fails if it promises every quality option again; the render-scale half is the row above |
| "Up to 4K" | website capability facts | **none.** Render scale is proved; a 4K backing resolution on a specific display is not |

Unit tests cover manifest/range parsing, allowlists, settings, atomic files,
cache coalescing, hash validation, insufficient-disk rejection, interrupted
full-download resume, smoothed rates, native task-state derivation, and
diagnostics payloads. Integration tests exercise artifact publication,
corruption repair, rollback, and bounded unresponsive requests against local
fixtures. Playwright launches the real Electron shell and asserts the protocol
origin, sandboxed preload surface, absence of Node globals, actionable startup
and download failures, renderer crash recovery, settings presentation,
clock/metrics availability, and capture lifecycle.

The opt-in live smoke exercises the current production client from a fresh
profile: JSPI must initialize, hardware acceleration must be active, snapshot
reads must complete, render scaling must change the real drawing buffer, and a
frame must be submitted. A weekly macOS GitHub Actions canary runs this same
test and records the client fingerprint and renderer in the workflow summary.
Failures do not rewrite or hook ArenaNet binaries; they identify a host/client
compatibility change for investigation. The canary does not prove:

- a real account completes login;
- ANGLE/Metal renders the real client correctly on every advertised Mac;

Those are explicit live release gates, not assumptions hidden behind unit
tests.

Toolbox development uses the layered, cached-safe workflow in
`docs/toolbox-development.md`. Unknown client hashes always use the official
WASM unchanged, and a live Toolbox run cannot update the client unless update
permission is explicit.

The dependency audit has one explicit exception for
`GHSA-mh99-v99m-4gvg`: the latest Electron Forge and Nuxt toolchains still
reach `brace-expansion` 1.x and 2.x through packaging-only glob libraries, and
upstream published the memory-bound fix only for the API-incompatible 5.x
line. The compatible 5.x edge is pinned to 5.0.8. No game, renderer, preload,
main-process runtime, or packaged dependency accepts these development glob
patterns. A release invariant forbids production dependencies in either
workspace package while the exception exists, preventing it from masking a
shipped vulnerable edge. Remove the exception as soon as the upstream parents
adopt patched compatible dependencies.
