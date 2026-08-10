# The WASM host and client certification

This document owns the surface the official client sees from JavaScript — the
`Module` contract, the awaited host calls, the persistent game filesystem — and
the certification that decides which module a session actually runs.

## The Module contract

`Module` must be declared with `var`; the generated glue redeclares it.
`Gw.jspi.js` asks for `Gw.wasm`, so `locateFile` explicitly selects
`Gw.jspi.wasm`. The protocol reads one immutable `ActiveClient` per request;
its chunk store, snapshot metadata, artifact directory, and selected WASM can
never come from different client generations. Full-file protocol responses stream from disk, allowing
`WebAssembly.instantiateStreaming` to compile without first retaining the
whole module in main-process memory. Cached Enhancement validation also streams
both hashes; the official bytes are loaded only for a cold transform. Asyncify
is not a production fallback.

Awaited host calls always return promises:

```text
image.cacheAsync
dns.resolve
secureStorage.getCredentials/storeCredentials/clearCredentials
login.getAuthToken
adProvider.showInterstitial
ageSignals.check
shop.initialize/inAppPurchase
```

`secureStorage` and `login.getAuthToken` resolve against the main process's two
persistent secrets; [Process model and boundaries](process-model.md#saved-login)
owns that boundary.

## Host namespaces the client probes

Steam is advertised as a federated provider; Apple and Google are not. The
client probes each one while it builds its login screen, and answering yes for
Steam is what makes it render a Steam button beside the unchanged ArenaNet
email/password form. Properly guarded browser, analytics, and age-signal
namespaces remain absent. The two namespaces with defective absence guards
(`adProvider` and `shop`) are narrow plain objects whose unavailable operations
reject with the promise shapes expected by the client.

## The persistent game filesystem

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

For template-save investigation only, launching an unpackaged build with
`GW_TEMPLATE_FS_TRACE=1` sets `templateFsTrace` in the renderer init payload.
Before instantiation, the renderer then wraps the official module's
`__syscall_openat`, `__syscall_ftruncate64`, `fd_read`, `fd_write`,
`fd_pwrite`, `fd_seek`, and `fd_close` imports.
The bounded console trace records only the template kind, flags, descriptor,
errno, and requested/written byte counts. It never records a filename, path, or
file content, does not cross IPC, and is not included in diagnostics exports.
Normal launches retain the original imports unchanged.

Resetting the saved Guild Wars files clears exactly this mount. After native
confirmation the action records a restart request, and startup clears only
IndexedDB for the owned `gw://app` session before a renderer can mount IDBFS,
then removes the request. It cannot clear the
separate native chunk cache or either Data Protection Keychain item. There is
no native arbitrary-file bridge.

### Official-client memory floor

The generated client mounts Emscripten IDBFS at `app:` and restores
`app:/Gw.dat` before completing initialization. On the certified profile that
file is about 919 MB, while the official WASM linear memory is about 369 MiB.
Restoring IDBFS can therefore create a short-lived RSS peak above 1 GiB in both
the browser/main and renderer processes even though steady resident memory
falls sharply after the pages become reclaimable. This is not Enhancement state,
the 256 MB snapshot LRU, or Chromium's network cache.

Avoiding that peak requires an architectural replacement for the official
synchronous Emscripten filesystem—such as a proven lazy native backend or a
worker-hosted runtime—not a safe local copy removal. Do not clear IDBFS or
patch the official glue speculatively: `Gw.dat` is persistent client state and
removing it can turn memory pressure into repeated reconstruction and snapshot
I/O.

## The template-save transform

`internal/upstream/` holds the full record: the defect report written for
ArenaNet, the client internals we had to recover, the bridge contract, the
re-certification procedure for a new client build, and the investigation log.
Read it before changing anything below.

Every index and offset the transform carries belongs to one exact client build.
The shape locator is production code under `src/main/certification`; both the launcher
and `pnpm certification template` call that one implementation. It re-derives
indices from body bytes, resolved signatures, and caller-set intersections,
then fingerprints every complete caller body the transform will modify. Only
the five selected call-index operands are normalised. A changed path
calculation, flag, branch, immediate, or unrelated call therefore refuses even
when every call remains at the old byte offset. CLI comparison, diagnostics,
and paste-ready formatting stay under `src/tools`; they are not part of the
packaged proof. The command remains the maintainer surface for investigating a
refusal and for re-measuring semantics.

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
protocol path. A hash already in the shipped tables takes the fast path. For an
unknown hash, Electron starts one utility process with only the artifact path
and expected hash. That process re-reads and re-hashes the file and may prove
the template structures above. Enhancement execution is stricter: build 38,797
proved that its static addresses do not move by one common delta, so an unknown
post-template hash is never promoted from data topology alone. Until the
multi-hook verifier can independently recover every function and address from
semantic anchors, only an exact shipped Enhancement certificate enables the
kernel.

The utility process has a five-second deadline and writes no profile state.
Every unknown exact hash starts that process again; a profile file is never
certification authority. A crash, timeout, changed file, malformed answer,
ambiguous locator, unexpected data layout, or transform failure is no proof.
The launcher then serves the untouched official module and starts the game
normally. Derived module caches remain rebuildable from the official artifact
and old compatibility generations are deleted when the selected client changes.

## Which of three states a client build is in

`src/main/certification/` is the one directory the whole chain lives in: the two
certified build tables, the two transforms, the module the launch actually
serves, the pure structural proof, the utility process it runs in, and the
developer switches over the Enhancement half. `src/main/core/` keeps only what
is not about certification and what certification depends on — the WASM section
codec and the derived-artifact cache — so the dependency runs one way and there
is no second place to look. `src/tools/certification.ts` is the one command
line over it, with `doctor`, `recertify`, `template`, `transform`, and
`double-click` subcommands; `scripts/verify-companion-kernel.mjs` stays
separate because it certifies the Rust companion kernel against the compile
recipe in `scripts/build.mjs`, not a client build.

The two transforms are chained but keyed by **different** hashes: template-save
by the official build's hash, Enhancement by the hash of what the template-save
transform produces. Certification can therefore succeed at step one and fail at
step two — templates saved, cursors gone — which is the normal intermediate
during a recertification, because the transform that breaks saving is fixed
before the one that draws a pointer.

`src/main/certification/client-certification.ts` composes the shipped lookups or one local
proof into the same answer: `uncertified`, `template-only`, or `certified`. It
is the single owner, and every consumer asks it rather than composing the chain
again — the launcher notice, the settings status, the diagnostics gauges, the
weekly canary, and `pnpm certification doctor`. A certified build whose
template-save transform throws is published as `uncertified`, because it is
degraded exactly that far.

`ClientRuntime` publishes the state once per activated client as
`client.buildCertification` in a diagnostics export, and the older
`wasm.templateSaveCompatible` boolean is derived from the same object rather
than computed separately, so the two cannot disagree. The renderer reads the
state over `gw:client:session` together with the client hash and whether this
session actually prepared the Enhancement module. The renderer combines those
facts with the canonical per-tool selection; the effective bit keeps a
certified build whose transform failed from being reported as available.
`src/renderer/client-compatibility-notice.ts` turns them into the sentences
both surfaces show.

## Noticing the patch

Everything above decides correctly on a machine that already has the new bytes.
What it does not do is tell anyone a new build exists, and a certificate nobody
starts deriving is a week of `template-only` for every player.

`.github/workflows/client-recertification.yml` is that first layer, and it is
built to be boring. A quarter-hourly job fetches one patch manifest, fingerprints
`Gw.jspi.js` and `Gw.jspi.wasm` through `fingerprintClientGeneration`, and
compares the result against `certificates/certified-client.json`. Matching, it
ends in about a second having installed nothing, compiled nothing, and
downloaded no client byte — Node runs the detector script directly, because
`pnpm <script>` would resolve this repository's whole dependency tree first and
that install, not the fetch, is what a cheap path has to exclude. A scheduled
run that cannot reach the patch service fails, and that visible failure is how a
silently dead detector is noticed.

A generation that already has a branch or an open tracking issue is treated the
same way as an unchanged one. Certifying a new build takes a person, and every
quarter hour of that latency would otherwise re-run the whole derivation and
file the proposal again; the red runs it produced would bury the heartbeat the
paragraph above depends on.

The identity is deliberately narrower than `clientFingerprint`, which also
covers `Gw.snapshot` and `version.json` because it answers a different question —
whether an *installed* generation may be rolled back to. Game content moves
constantly; folding it in here would run a full derivation every content patch to
conclude nothing changed.

On a change, a macOS job downloads the code artifacts through the same
`PatchClient` the application uses — chunk-hash verified, and `Gw.snapshot` is
never assembled — and runs `certification template --write` and
`certification recertify` against them. What it can derive it derives; what it
cannot, it reports. Then a third job pushes a branch carrying the regenerated
authoring table and the recorded generation, opens a pull request, and opens a
tracking issue either way: *auto-derived, PR ready*, or *layout changed,
investigation needed*. The issue closes itself on the first detector run that
finds the published generation recorded on `main`.

The pull request is a proposal and nothing more, and it says so out loud: GitHub
starts no workflow for a pull request opened by a run's own token, so the body
asks whoever picks it up to close and reopen it. The alternative is a personal
access token, which is a secret this workflow would then be holding for a job
whose whole point is that it cannot do anything on its own.

Three properties make this safe to leave running unattended. It holds no secret;
its only credential is the run's own `GITHUB_TOKEN` and the strongest thing it
can do is propose. It uploads evidence — reports and the candidate source
diff — and never client bytes, because this project does not redistribute
ArenaNet's binaries. And its branch certifies nothing until the pull request's
own `pnpm verify` gate passes on it, which is the same gate every other change
faces. The Enhancement table stays untouched by machine because its layout
words are client-memory addresses no structural anchor re-derives.

## Certification authority boundary

An exact client build is authorized only by compiled certification facts or by
the isolated local structural verifier. Newly measured Enhancement layouts,
messages, and commands require a signed application release because an older
application cannot independently prove them. There is no remote certification
authority.

When either optional transform refuses, the verified official ArenaNet client
remains playable. Scheduled recertification detects a changed code generation,
runs the same local proof, and opens a proposal or a named investigation; it
does not grant runtime authority by itself.

## Enhancement instrumentation

The official `Gw.jspi.wasm` remains canonical. A session with the Enhancement
switched off applies only the certified template-save compatibility transform
described above: it does no Enhancement transform, fetches no kernel, installs no
Enhancement hook, starts no snapshot observer, and contains no Enhancement UI.

The one shipped tool is `nativeCursor`: it defaults to **true** and reads only
Guild Wars' cursor state. The target readout is developer-only — reachable
through the `target-observer` program, never from user settings — and owns
`src/renderer/enhancement-readout.ts`: a fixed line at the top centre of the
game view showing the selected target's distance in game units and range band.
It is the last stage of the read-only pipeline — manifest → transform/kernel →
snapshot → decoder → here — and writes nothing back. It renders nothing without
a selected target, on a loading screen, after a torn read, or on an unsupported
build. It is `pointer-events: none` and `aria-live="off"`. Automation selects no
feature. One explicit unpackaged `toolbox-foundation` program mounts the proof in
`docs/gwonmac-tools-wasm.md`; that surface is unreachable in packaged builds.

`ENHANCEMENTS` and `EnhancementSelection` live in the shared contracts. Main
snapshots the required Core state, the stored Tools Beta master opt-in, and one
fixed developer program at startup, then derives the exact cursor,
target-observation, Toolbox, and commands capabilities with the shared canonical
function. That capability set owns the transform, manifest, config, and cache
identity. The renderer recomputes it from the same immutable launch intent and
requires an exact manifest match. Developer automation permission remains
unreachable from a packaged build and selects no capability. Packaged Team
Apply instead receives only the closed commands profile selected by the master
opt-in. A developer program replaces rather than merges with saved choices.

Those inputs resolve to the six closed profiles in
`ENHANCEMENT_CAPABILITY_PROFILES`, including the two commands-bearing Toolbox
profiles. Each exact Enhancement certificate pins every output SHA-256. Cache metadata records what
was published but is never authority: reuse requires the bytes and metadata to
match the capability-specific hash shipped in the application. A missing hash
or any other capability combination fails closed before transformation.

The first Tools opt-in changes which derived client module the renderer needs,
so that one write is paired with a confirmed restart. Once that commands-capable
module is resident, individual Target and Team toggles update the kernel's
active-observer mask live. Core cursor observation stays active; disabled
optional observers stop traversing their target or party graphs. The minimal
map-policy projection remains live to enforce PvP/guild-hall/unknown shutdown
and restore the selected tools on return to PvE.

The harness uses request and effective state without conflating them. A selected
tool or fixed developer program requests a capability, while the
`enhancement_manifest` on the instantiated WebAssembly module proves that this
launch received exactly that certified derivative. A requested but uncertified
launch imports no Enhancement module and fetches no kernel. Cursor-observer mode
publishes the selected cursor without a target scan; target-observer mode
explicitly enables map/player/target state; Toolbox uses tick and UI callbacks
without allocating the target snapshot.

After publication, certification matches the official hash to the exact
template-save record and then matches that record's output hash to the exact
Enhancement record. The template record may be shipped or locally proven; the
Enhancement record is currently exact-shipped only. Downstream code has no
second path. `client-module.ts` consumes them directly and owns the
official → template-save → optional Enhancement chain, cache reuse, stale-cache
discard, and atomic publication. Disabled and unsupported stages delete their
cache. An Enhancement transform failure serves the verified template-save
module; an uncertified build serves the official module, so the game stays
playable and the cursor falls back to the plain macOS pointer.

`enhancement-transform.ts` is the pure byte transform. The exact capability set
chooses the fixed hooks and masks every inactive layout/message word to zero;
the set is also part of the manifest and cache fingerprint. The renderer does
not maintain a second field-order list. Recertification derives and compares all
four output hashes, so adding a capability profile is an explicit certificate
change rather than a cache-metadata convention.

Build 38,797 hooks three certified functions: exported
`EmscriptenExeThreadMainLoop` at 446, the five-argument cursor publisher at
2469, and the three-argument UI dispatcher at 6842. The transform extends the
stock fixed table from 4,683 to 4,684 entries and reserves only the new terminal
slot 4,683 for one fixed `(i32 × 6) -> void` Rust dispatcher. The mutable global
stores `slot + 1`, preserving zero as disabled. Existing cursor table slot 922
continues to point to function 2469, and stock slot 0 remains untouched: live
character entry proved that its static null value is a runtime sentinel rather
than spare plugin capacity.

After runtime initialization in an enabled, manifested session, the renderer
dynamically loads the Enhancement runtime, allocates its enabled bounded regions
through the game's allocator, and reserves one further 64 KiB heap block for
the companion's own data and stack. The dependency-free
`wasm32-unknown-unknown` companion is a position-independent side module: it
imports the exported game memory for bounded reads, while injected memory-base
and stack globals confine its writes to that reserved block. A private empty
table satisfies the side-module ABI without consuming a game table entry. The
renderer then installs its callback and enables the dispatcher last. Each
dispatch branch calls its matching relocated original in the game module
exactly once before notifying the passive companion. Cursor events
mark the bitmap dirty; the next tick reads it only when dirty, while a tiny
show-count check preserves visibility changes. A trusted click that produced
no cursor callback receives one zero-distance hit-test refresh, fixing mode
changes such as salvage without moving the physical pointer. When the click's
answer is a hidden cursor — a server-validated mode change the game has not
resolved yet — the refresh asks again on the next observer frame and then
every 150 ms, following the pointer while it stays on the canvas, until art
resolves it, the pointer leaves the canvas, or 2.5 s
passes; while that same window is open, the consumer keeps the last visible
art on screen instead of `cursor: none`, so the eye sees one swap rather than
an invisible gap. Every stop lands on the pre-retry behaviour. The gap and
retry count reach diagnostics through the runtime stats surface.

The build does not publish rustc output directly. Rustc writes an unserved
candidate; the next build step validates its Wasm, absence of a start function,
exact `dylink.0` footprint, import surface, and eight-function export surface.
It also instantiates the candidate against sentinel-filled memory and permits
active-data writes only inside the declared private footprint, which must fit
one 64 KiB page. Only then does it publish the module and seal its SHA-256 into
the emitted renderer. The renderer hashes fetched bytes and compares that seal
before `WebAssembly.compile`, while the canonical kernel verifier independently
checks exact function types and reproducible rustc output.

Snapshot ABI v1 uses a named 196-byte `repr(C)` configuration and 64-byte core
`Snapshot`,
compile-time size assertions, checked pointer arithmetic, and an odd/even
sequence lock. It contains no pointers. When target observation is enabled, the
snapshot observer reads at most once per animation frame and rejects unknown
flags, invalid IDs/types/bands, and non-finite values. It publishes structured
`gwCompanionState`; only the separately selected readout renders that state. The
cursor consumer is installed and polled only when `nativeCursor` is selected,
and reaches production DOM only as an inline `cursor` on the game canvas;
losing the cursor clears that value and nothing else. No memory view or
per-frame call crosses preload or IPC. The explicit Toolbox program allocates
one 64-byte Toolbox snapshot and no core target snapshot. It carries only scalar chat count,
cursor event count, first-owned-hero identity, and observed panel state. The UI
dispatcher observes player-chat and hero-panel events without retaining either
pointer-shaped argument. Exactly ten build-certified hero-readiness, map
lifecycle, and party-membership messages mark party state dirty; unrelated
traffic through the central UI dispatcher does not schedule a traversal. The
next tick resolves only the game/party vector and at most seven owned heroes,
with one low-rate reconciliation every 120 ticks. It never scans the agent array
for Toolbox. The kernel republishes only changed scalar state, and the renderer
stores it as the companion projection only when decoded values change — the
overlay draws none of it; the tool it hosts draws its own. There is no hero
Show/Hide command: the companion has
no game-function imports and never writes the game's PropContext slot. The
thirteen observed/dirty message IDs come from the exact build certificate
through the kernel config; Rust contains no second unversioned copy.
