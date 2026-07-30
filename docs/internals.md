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
  default-on exact-build Enhancement foundation
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
| `src/preload/preload.body.cjs` | sandbox-compatible bridge; `scripts/generate-preload.ts` splices the canonical constants above it |
| `src/renderer/`           | launcher, `Module` host, input, graphics, diagnostics             |
| `src/companion-kernel/`     | freestanding read-only game-state companion WASM                  |
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
cannot discard the rollback generation. Before loading the game glue, the
renderer captures the active candidate's generation and fingerprint. It returns
that exact token only after observing both signals; main revalidates the active
generation and marker under the generation lock before deleting rollback state.
A stale renderer therefore cannot confirm a replacement generation. Failure
before both signals durably rejects that exact client fingerprint for the
current host version and restores the previous generation.
Renderer-crash recovery aborts an in-flight manifest/chunk preparation before
waiting for the generation lock. Retries and assembly observe that signal and
discard the stage; once the short verified-directory swap begins, it finishes
atomically and recovery rolls the published candidate back under the same lock.
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
appended. Adjacent demand chunks already queued in the same renderer turn share
one bounded range request and are split back into compact cache entries; the
eight-request ceiling continues to count chunks, not HTTP requests. A
multi-chunk `image.cacheAsync` queues its whole range so the same scheduler can
use all eight slots while demand retains priority over queued prefetch.

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

## This app's own release check

Replacing the application is manual and always has been. What is new is that
the app no longer asks GitHub anything on its own initiative.

`src/main/release-notice.ts` is the only code that contacts
`api.github.com/repos/<repo>/releases?per_page=100`, and it has exactly three
callers: the manual **Check for Updates** action, the same action mounted on the
client-compatibility notice, and one launch-time check that runs only while
`AppSettings.autoCheckUpdates` is on. The bounded list is necessary because
GitHub's `releases/latest` endpoint excludes prereleases; stable installs ignore
prereleases, while an install already on a prerelease channel may see a newer
one. Both GitHub's prerelease flag and SemVer prerelease syntax are honoured;
drafts and malformed tags are ignored. The setting defaults to `false` and
governs every automatic request without exception, the compatibility path
included, so a default launch reaches github.com zero times. There is no
per-launch poll and no background timer.

`checkForNewerRelease(currentVersion)` takes the running version as an argument
instead of calling `app.getVersion()`, so main keeps the single Electron
binding and the module is executable in a unit test. It aborts after five
seconds, coalesces concurrent callers onto one request, and caches every result
for ten minutes. That includes offline, timeout, server, and unreadable
responses: the manual button is a refresh action, not a way to spend an
unbounded request budget by clicking repeatedly.

The result is three states and never two: `update-available`, `up-to-date`, or
`unknown` carrying a reason from a closed vocabulary (`rate-limited`,
`offline`, `timeout`, `server`, `unreadable`, `unsupported-build`). Both a
parse failure and a network failure are `unknown`; reporting either as
"up to date" is the class of quiet lie this path exists to remove, so no
boolean or tri-state "update status" is exported and each reason has its own
sentence in `src/renderer/update-action.ts`. Every result carries `checkedAt`,
the completion time of the check attempt (including an unsupported local
version that made no request). The renderer persists it as
`lastUpdateCheckAt` and renders it as "Last checked". The launcher and the
settings dialog mount the same controller, so the two surfaces cannot
disagree.

No attacker-controlled string crosses IPC. The response's URL is discarded
rather than carried: the renderer can only open the closed `ExternalLinkKind`
vocabulary, so the releases page is opened by name, and `latestVersion` is
re-rendered by `formatReleaseVersion` from the parsed version instead of
echoing the tag. Parsing, comparison, and the channel policy — a prerelease is
only ever offered to an install already running a prerelease — are
`src/shared/release.ts`, which is also where the website's resolver points for
the rule it implements against GitHub's own `prerelease` flag.
`docs/user-guide.md` owns what the player is told; the numbering itself is
[Release numbering](release-verification.md#release-numbering).

## WASM host

`Module` must be declared with `var`; the generated glue redeclares it.
`Gw.jspi.js` asks for `Gw.wasm`, so `locateFile` explicitly selects
`Gw.jspi.wasm`. The protocol reads one immutable `ActiveClient` per request;
its chunk store, snapshot metadata, artifact directory, and selected WASM can
never come from different client generations. Full-file protocol responses stream from disk, allowing
`WebAssembly.instantiateStreaming` to compile without first retaining the
whole module in main-process memory. Cached Enhancement validation also streams
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
login.getAuthToken
adProvider.showInterstitial
ageSignals.check
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
Steam is advertised as a federated provider; Apple and Google are not. The
client probes each one while it builds its login screen, and answering yes for
Steam is what makes it render a Steam button beside the unchanged ArenaNet
email/password form. Properly guarded browser, analytics, and age-signal
namespaces remain absent. The two namespaces with defective absence guards
(`adProvider` and `shop`) are narrow plain objects whose unavailable operations
reject with the promise shapes expected by the client.

### Steam login

The Steam credential is a **Steam OAuth2 access token**. There is no ArenaNet
token-issuance endpoint: the official client (Guild Wars Reforged, a Capacitor
app using Ionic Auth Connect) runs a standard OAuth2 implicit flow against
Steam, and the token Steam returns is handed straight to the game client, which
base64-encodes it into `<PasswordToken>` for `webgate/users/login.xml`. The
account service validates it there and maps it to the linked Guild Wars account.
`<LoginName>` on that request is the client's local profile index — `1` — not
the SteamID, which the account service derives itself and returns as
`<steamid>@steam`. The token is long-lived (the flow grants a year), portable
across devices, and replayed on every login until it expires.

So `login.getAuthToken` has two paths and no others. A silent launch-time probe
may replay a stored token. An explicit request discards a readable stored token
that already failed to get the player past the login screen and runs fresh
acquisition. `src/main/core/steam-oauth.ts` holds the flow as
configuration plus pure functions (authorize-URL construction, a fail-closed
origin allowlist, redirect matching, `state` verification, token extraction), so
all of it is unit-testable and the whole flow can be pointed at a local fixture
server offline.

Acquisition opens a `BrowserWindow` the main process owns and tears down. It has
its own in-memory session partition shared with nothing, no preload and no Node,
deny-by-default permission and download handlers, no popups and no webviews, and
top-level navigation confined to the derived allowlist. Subframes and resources
are not described by that navigation guarantee: Steam may embed third-party
content, and Chromium governs it with the sandbox, origin isolation, disabled
Node/preload, denied permissions, and popup/download denial. A subframe cannot
complete the top-level redirect event. That redirect is intercepted *before it
is fetched* — so the return URL is never requested and needs no proxy allowlist
entry — and its exact HTTPS host, port, and path plus its `state` nonce are
validated in one parser. The partition is cleared and the window destroyed
however sign-in ends: success, refusal, or cancellation. Cleanup has a fixed
deadline, after which destroying the unique in-memory partition remains the
final bound. The window is hidden the moment an attempt settles so cleanup
cannot present a blank page as a black application window.

**The window is a modal child, and the origin is not visible in it.** `modal` is
load-bearing: `src/main/window.ts` restores the game window to fullscreen, and a
plain parented child is promoted into that fullscreen space and sized to the whole
display, so sign-in fills the screen instead of appearing as a contained sheet.
`tests/electron/steam-acquire.spec.ts` pins the modal, parented, requested-width
presentation for that reason.

The cost is that a macOS sheet draws no title bar, so the live origin
`showOrigin()` writes — and the `page-title-updated` `preventDefault` that stops
the page renaming it — are **not visible in the configuration that ships**. Both
are kept because a parentless window (no game window yet) is an ordinary titled
window where they do apply, but the player cannot verify the origin by eye during
a normal sign-in. This is accepted rather than solved: what constrains the window
is the top-level allowlist plus the sandbox controls, not the player's
inspection.
`docs/user-guide.md` says so plainly instead of asking them to check a title bar
that is not there.

The token persists in `steam-session.bin` as `{ token, expiry }`, under the same
`EncryptedJsonStore` mechanism as `credentials.bin` — `safeStorage` encryption,
atomic write, mode `0600` — with its own validator, so the credential store's
shape rule is untouched. It is the token's only persistent home; **no
environment variable seeds it in any build**. Silent resolution returns a
stored unexpired token or nothing; explicit resolution reacquires. An expired
token is discarded;
an unreadable one is treated as absent but deliberately kept, because encryption
can be momentarily unavailable and deleting on that would throw away a
credential that still works. Neither failure fails the launch — both return the
player to the client's own login screen. The client's `storeAccountData`
storeback refreshes the stored expiry only when the value matches the token
already held, since which value it actually passes back has never been isolated
and persisting a session-resume token in place of the link token would overwrite
a working credential. Sign-out clears the local copy only; the account link is
managed on ArenaNet's surfaces.

Diagnostics for all of this are outcomes: token requested (`vended` / `absent` /
`acquired`), sign-in opened, sign-in blocked (`navigation` / `popup` /
`download` / `webview`), sign-in result (`success` / `cancelled` / `failed` /
`state-mismatch` / `no-token`), and the storeback outcome. The closed schema has
no field that could carry a Steam identifier, a token, or an expiry.

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
file content, does not cross IPC, and is not included in `.gwdiag` exports.
Normal launches retain the original imports unchanged.

`internal/upstream/` holds the full record: the defect report written for
ArenaNet, the client internals we had to recover, the bridge contract, the
re-certification procedure for a new client build, and the investigation log.
Read it before changing anything below.

Every index and offset the transform carries belongs to one exact client build.
The shape locator is production code under `src/main/core`; both the launcher
and `pnpm template:recertify` call that one implementation. It re-derives
indices from body bytes, resolved signatures, caller-set intersections, and
exact call-site offsets, and refuses rather than guessing when a locator finds
the wrong number of candidates. The command remains the maintainer surface for
investigating a refusal and for re-measuring semantics; the launcher accepts
only the narrower case where the already-understood structures are equivalent.

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
and expected hash. That process re-reads and re-hashes the file, proves the
template structures above, and checks that Enhancement's exported loop,
signature, empty table slot, and initialized-data topology are unchanged. It
may relocate only the eight known static addresses by one common aligned
delta; every relative object offset stays exact.

The utility process has a five-second deadline and writes no profile state.
Only main publishes its checksum-protected, owner-only exact-hash answer to
`game/local-client-verification.json`; its verifier ABI and baseline
fingerprint make every code or baseline change invalidate the cache. A crash,
timeout, changed file, malformed answer, ambiguous locator, unexpected data
layout, or transform failure is no proof. The launcher then serves the
untouched official module and starts the game normally. The derived caches are
rebuildable from the official artifact and old compatibility generations are
deleted when the selected client changes.

After native confirmation, the recovery action records a restart request.
Startup clears only IndexedDB for the owned `gw://app` session before a
renderer can mount IDBFS, then removes the request. It cannot clear the
separate native chunk cache or encrypted credential file. There is no native
arbitrary-file bridge.

### Which of three states a client build is in

The two transforms are chained but keyed by **different** hashes: template-save
by the official build's hash, Enhancement by the hash of what the template-save
transform produces. Certification can therefore succeed at step one and fail at
step two — templates saved, cursors gone — which is the normal intermediate
during a recertification, because the transform that breaks saving is fixed
before the one that draws a pointer.

`src/main/client-certification.ts` composes the shipped lookups or one local
proof into the same answer: `uncertified`, `template-only`, or `certified`. It
is the single owner, and every consumer asks it rather than composing the chain
again — the launcher notice, the settings status, the diagnostics gauges, the
weekly canary, and `pnpm enhancements:doctor`. A certified build whose
template-save transform throws is published as `uncertified`, because it is
degraded exactly that far.

`ClientRuntime` publishes the state once per activated client as
`client.buildCertification` in a `.gwdiag`, and the older
`wasm.templateSaveCompatible` boolean is derived from the same object rather
than computed separately, so the two cannot disagree. The renderer reads the
state over `gw:client:session` together with the client hash and whether this
session actually prepared the Enhancement module. The renderer combines those
facts with the canonical per-tool selection; the effective bit keeps a
certified build whose transform failed from being reported as available.
`src/renderer/client-compatibility-notice.ts` turns them into the sentences
both surfaces show.

### Enhancement instrumentation

The official `Gw.jspi.wasm` remains canonical. A session with the Enhancement
switched off applies only the certified template-save compatibility transform
described above: it does no Enhancement transform, fetches no kernel, installs no
Enhancement hook, starts no snapshot observer, and contains no Enhancement UI.

The two shipped tools are independent. `nativeCursor` defaults to **true** and
reads only Guild Wars' cursor state. `targetReadout` defaults to **false** and
owns the only added overlay, `src/renderer/enhancement-readout.ts`: a fixed line at
the top centre of the game view showing the selected target's distance in game
units and range band. It is the last stage of the read-only pipeline — manifest
→ transform/kernel → snapshot → decoder → here — and writes nothing back. It
renders nothing without a selected target, on a loading screen, after a torn
read, or on an unsupported build. It is `pointer-events: none` and
`aria-live="off"`.

`ENHANCEMENTS` and `EnhancementSelection` live in the shared contracts. There is
no stored or transported master switch: `enhancement-policy.ts` derives whether
main should prepare the transformed module from whether any tool is selected,
plus the development-only automation gate. Main snapshots the per-tool record
once at startup and sends that one record in `RendererInit`; the generated
preload iterates the canonical tool list rather than copying its names.
Automation remains unreachable from a packaged build whatever the environment
says, which keeps "does not send game input or act on the player's behalf" a
mechanically testable claim.

A running session cannot honour a tool change because the kernel feature flags
are fixed at initialization, so the write and restart are one action:
`settingsSet` asks `enhancementSelectionChanged` whether the patch alters a tool,
confirms before saving, and relaunches immediately. Both launcher and Settings
re-render from main's returned settings, so a declined restart cannot leave a
checkbox claiming something the session is not doing.

The harness uses request and effective state without conflating them. A tool
selection or development automation requests Enhancement, while the
`enhancement_manifest` on the actual instantiated WebAssembly module proves that
this launch received a certified transform. Only when both are true does it
import `enhancements.js`. A requested but uncertified launch therefore imports no
Enhancement module and fetches no kernel. The kernel receives one bit per tool;
disabled tools perform no per-tick collection. Development automation may force
the core observation snapshot for live scenarios, but it neither selects a
player-facing surface nor couples the two tools in packaged builds.

After publication, certification matches the official hash to the exact
template-save record and then matches that record's output hash to the exact
Enhancement record. Those records may be shipped or locally proven; downstream
code has no second path. `client-module.ts` consumes them directly and owns the
official → template-save → optional Enhancement chain, cache reuse, stale-cache
discard, and atomic publication. Disabled and unsupported stages delete their
cache. An Enhancement transform failure serves the verified template-save
module; an uncertified build serves the official module, so the game stays
playable and the cursor falls back to the plain macOS pointer.

`enhancement-transform.ts` is the pure byte transform. The manifest's ordered
layout fields generate the embedded `layoutWords`; the renderer does not
maintain a second field-order list.

Build 38,771 hooks the exported `EmscriptenExeThreadMainLoop` at function index
446. It uses the stock table's null slot 0; the mutable global stores
`slot + 1`, preserving zero as disabled. No table growth or all-functions
instrumentation remains.

After runtime initialization in an enabled, manifested session, the renderer
dynamically loads the Enhancement runtime, allocates its enabled bounded regions
through the game's allocator, instantiates the dependency-free
`wasm32-unknown-unknown` companion against the exported memory, installs its
callback, and enables the dispatcher last. The callback calls the relocated
original exactly once, then collects cursor state and map/player/target state
only for their enabled feature bits.

Snapshot ABI v1 uses a named 68-byte `repr(C)` Layout and 64-byte Snapshot,
compile-time size assertions, checked pointer arithmetic, and an odd/even
sequence lock. It contains no pointers. When target observation is enabled, the
snapshot observer reads at most once per animation frame and rejects unknown
flags, invalid IDs/types/bands, and non-finite values. It publishes structured
`gwCompanionState`; only the separately selected readout renders that state. The
cursor consumer is installed and polled only when `nativeCursor` is selected,
and reaches production DOM only as an inline `cursor` on the game canvas;
losing the cursor clears that value and nothing else. No memory view or
per-frame call crosses preload or IPC.

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
falls sharply after the pages become reclaimable. This is not Enhancement state,
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

The process acquires Electron's single-instance lock before it reads or sweeps
profile-owned files. A second launch exits and asks the primary process to
restore, show, and focus its existing window. That lock is what makes startup
cleanup of atomic-write temporary files safe: another live app process cannot
still own a foreign-PID temporary file in the same profile.

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
pointer lock. `input.ts` owns the canvas input listeners and accepts validated
touch settings from the settings owner; it does not persist settings itself. One
held-input registry releases keys, buttons, and touches when focus or native UI
consumes an input release. Pointer lock uses a virtual cursor and recycles a
held drag so camera rotation does not stall.

That recycle is rare by construction. The client keeps integrating mouse moves
whose coordinates fall outside the canvas, so a held right-drag is free to roam
sixteen canvases before the host releases the button, re-anchors at center, and
presses again — several camera revolutions apart at any window size. Stopping at
the canvas edge instead, as the host first did, made the recycle rate inversely
proportional to the window: a 941px canvas recycled on about every third mouse
move against every twenty-fifth on an 1866px one. Both halves of that cost the
smaller window: the released button interrupts the client's drag, and until the
leftover delta was spent in the same task rather than the next animation frame,
each recycle also froze the camera for a frame.

That roam runs outward only. The client integrates a move whose coordinates sit
past the far edge of the canvas, but ignores one whose client coordinates are
negative, and resumes only once they come back — so the near side of the budget
is bounded by the window edge rather than by the sixteen canvases. Without that
bound a canvas flush against the window, which is how the game canvas is laid
out, spent half a canvas of leftward travel inside the window and the remaining
sixteen in a range the client discards: rotating right ran indefinitely while
rotating left froze after one flick and stayed frozen, because the re-anchor
that would have restored it sits sixteen canvases beyond where a hand ever
drags. Bounded at the window edge, the near side recycles about every half
canvas of travel — far more often than the far side, and the cost of keeping
every coordinate in the range the client accepts.

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
`traceId`/`spanId`. Seven-sample renderer/main clock
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
The closed schema owns every dot-separated event name, so all producers share
one searchable vocabulary and no generic string logging route exists.
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
a boolean, a member of a declared string enum, or a branded fixed-format value
such as a digest, renderer fingerprint, or application version. A field typed
`string` fails `tsc` inside the schema file itself, so free text
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
every record walked and `redaction.schemaChecked` every record the schema
matched; the two counts must be equal. Undeclared event names, wrong
subsystem/level ownership, missing fields, extra fields, and out-of-vocabulary
values all stop the export. DNS, update, snapshot, and proxy spans are four
closed typed families with normalized start/end fields. Renderer milestones
and renderer-originated failures are also schema members. Blocked-navigation
events record the closed security decision but never copy the rejected URL.
The detector imports neither the recorder nor the pattern scanner, which is
what makes it evidence: a checker built from the redactor's own patterns can
only ever agree with the redactor.

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
delimiter to see. Quoted values under a sensitive key are consumed as complete
JSON strings, including commas, escaped quotes and escaped backslashes, and are
replaced without making the trace invalid.

A Level 2 trace reaches a quarter of a gigabyte, so it is scanned as a stream.
The scanner tracks JSON string and escape state and cuts only after a comma
outside a string. Its carry is raw input rather than already-redacted output,
so a value straddling an input chunk is scanned once and in full. If the trace
provides no structural comma before the one-megabyte carry limit, export fails
closed and its staging output is removed; it never flushes an unscannable
suffix. The unit test compares streaming and whole-document results at every
split point in the adversarial corpus and exercises that fail-closed bound.
`redaction.traceBytesScanned` records how much went through the scanner.

This tier is still a vocabulary, not a proof: it can miss a value for which it
has no pattern, and it over-redacts benign keys containing a sensitive stem —
the safe direction. Numeric values under those keys are left alone so the trace
stays valid JSON for `pnpm diagnostics:attribute-stalls`.

Some things are excluded by construction rather than by any of the three
tiers. Renderer console text and exception text never cross IPC; only
allow-listed failure names and non-text fingerprints do. Chromium net bodies,
HTTP headers, account request bodies, and TCP payloads are never recorded, so
they are not in the export to be removed. The application does not start
Crashpad or collect crash dumps.

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
| "It does not send game input or act on the player's behalf" | website FAQ | `tests/release/packaged-enhancement-surface.test.ts` — *automation is the one tier a packaged build cannot reach*: it loads the compiled `build/main/enhancement-policy.js` in a child process with `app.isPackaged` forced true and reads `ENHANCEMENT_AUTOMATION_ENABLED` as `false` for every value of `GW_ENHANCEMENT_AUTOMATION`, leaving `enhancementsEnabledFor` and the player's explicit per-tool selection as the only way in |
| The official artifact is preserved; the module the session runs is a derived copy | website FAQ, `docs/user-guide.md` | `tests/unit/template-save-compat.test.ts` — *never writes into the caller's input, Buffer or not*, *leaves unknown future client builds canonical*; `tests/unit/derived-wasm-cache.test.ts` — *publishes nothing when the output misses the pinned hash* |
| Game files come directly from ArenaNet and are verified before use | website FAQ, `README.md` | `tests/unit/manifest.test.ts`, `tests/unit/chunk-store.test.ts` (verify-on-read, unlink-and-refetch), `tests/unit/published-client.test.ts`; `tests/integration/updater.test.ts` for publication, corruption repair and rollback |
| No telemetry, credentials, account identifiers, or game traffic are uploaded | website features list and FAQ | `tests/unit/no-game-traffic-is-uploaded.test.ts` — the test named for the claim: *refuses every destination that is not a public ArenaNet-shaped address* (loopback, private ranges, this project's own host, every port outside 6112/80/443), and *exports a socket's lifetime with no trace of what it carried*; `tests/unit/allowlists.test.ts` and `tests/unit/proxy-routes.test.ts` for the boundaries underneath it |
| A `.gwdiag` never contains credentials, account identifiers, packet contents, or crash dumps | website FAQ, `docs/user-guide.md` | `tests/unit/diagnostic-schema-rejects-free-text.test.ts`, `tests/unit/export-detector-rejects-undeclared-event-fields.test.ts`, `tests/unit/socket-events-carry-no-error-text.test.ts`, `tests/unit/trace-scanner-catches-the-adversarial-corpus.test.ts`. Read *What the export actually guarantees* above for which tier covers which file |
| The app makes no network request the player did not ask for | settings copy, `docs/user-guide.md` | `tests/electron/a-launch-reaches-github-only-when-asked.spec.ts` — the row's proof: it wraps the main process's `fetch` and counts **zero** api.github.com requests across a launch with the defaults, then exactly one across a launch with the box ticked. The three unit tests underneath it prove constituents, not the claim: `tests/unit/settings.test.ts` that the default is `false`, `tests/unit/release-notice.test.ts` and `tests/unit/update-action.test.ts` that the check itself behaves |
| The game's own cursor is on by default, is switchable off, and no artwork ships or is downloaded | settings copy, `docs/user-guide.md` | `tests/release/packaged-enhancement-surface.test.ts` — *the cursor ships on, and a player who switches it off stays off*; `tests/electron/enhancement-cursor.spec.ts` for what Chromium computes from a published cursor region; `tests/policy/forbidden-artifacts.test.ts` for what is tracked |
| Releases are ad-hoc signed and the shipped fuses hold | website FAQ | `tests/packaged-smoke.ts` (`codesign --verify --deep --strict`, the nine fuse states), `tests/policy/fuses.test.ts` |
| Render scale changes the real backing resolution | website, settings copy | `tests/electron/live.spec.ts` (opt-in live smoke) — the drawing buffer changes with the setting; `tests/electron/settings.spec.ts` for the resolutions shown beside each scale |
| "Up to 60 FPS", "tuned for Apple Silicon" | website capability facts | **none.** No test asserts a frame rate, and `tests/packaged-smoke.ts` does not assert the packaged binary's architecture |
| "The client's available graphics settings, plus selectable render scale" | website capability facts | Narrowed in P3.22 from "every in-game quality option, fully available", which was wrong — the official WebGL client may offer only `None` for antialiasing. `tests/website-smoke.ts` executes the served page and fails if it promises every quality option again; the render-scale half is the row above |
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
reads must complete, the host filesystem must serve the client's template
operations across a relaunch, render scaling must change the real drawing
buffer, and a frame must be submitted. Each block is a named step, so a red
canary names the claim that broke. It also requires that the build ArenaNet is
currently serving is one this app has **certified**: `template-only` fails too,
because templates still saving with the cursors gone is a shipped regression,
not a pass. The module's sha256 is printed above every assertion, since a red
canary is exactly when someone needs that hash to recertify.

A weekly macOS GitHub Actions canary runs this same test and records the client
fingerprint and renderer in the workflow summary. GitHub disables scheduled
workflows in quiet repositories, so a release build refuses to start when the
canary last ran more than fourteen days ago or has never run: a green release
gate behind a canary that stopped running proves nothing. Failures do not
rewrite or hook ArenaNet binaries; they identify a host/client compatibility
change for investigation. The canary does not prove:

- a real account completes login;
- ANGLE/Metal renders the real client correctly on every advertised Mac;
- that the Enhancement transform still applies cleanly to today's client. The
  profile it seeds sets `nativeCursor: false`, so the live run exercises the
  template-save transform and the certification tables but never the Enhancement
  one — a non-default path since the setting started defaulting to `true`;

Those are explicit live release gates, not assumptions hidden behind unit
tests.

Enhancement development uses the layered, cached-safe workflow in
`docs/enhancement-development.md`. Unknown client hashes always use the official
WASM unchanged, and a live Enhancement run cannot update the client unless update
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
