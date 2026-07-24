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
| `src/main/main.ts`        | composition root and application state                            |
| `src/main/core/`          | updater, cache, DNS, sockets, credentials, settings, window state |
| `src/main/protocol.ts`    | `gw://app` routing and range responses                            |
| `src/main/ipc.ts`         | validated native capability handlers                              |
| `src/main/diagnostics.ts` | bounded flight recorder, captures, export                         |
| `src/preload/preload.cjs` | self-contained sandbox-compatible bridge                          |
| `src/renderer/`           | launcher, `Module` host, input, graphics, diagnostics             |
| `src/shared/`             | contracts, validation types, progress, errors                     |
| `src/tools/diagnostics/`  | `.gwdiag` validator, summary, comparison                          |
| `tools/`, `gwkey.py`      | developer-only binary analysis                                    |

The preload is deliberately self-contained CommonJS. Electron’s sandboxed
preload loader does not execute a local ESM dependency graph. Release tests
therefore assert that its channel list exactly matches the canonical shared
contract.

## Game update and snapshot cache

The main process downloads only:

```text
Gw.jspi.js
Gw.jspi.wasm
version.json
```

Existing artifacts are verified chunk-by-chunk against the current manifest;
equal file length is not treated as proof of equality. New artifacts are built
in a part file, synced, and renamed only after every content hash passes.
The published local manifest retains the executable artifacts' sizes and chunk
hashes, so offline fallback is independently verifiable. A changed client is
kept as a candidate beside one verified previous generation until its first
presented frame. Failure before that signal durably rejects that exact client
fingerprint for the current host version and restores the previous generation.
Invalid or legacy-unverifiable state is never promoted into the rollback slot.

`Gw.snapshot` is never assembled for on-demand mode. `ChunkStore` maps each
range onto 256 KB chunks, coalesces concurrent requests by content hash,
verifies downloaded bytes, and publishes chunks atomically. Its in-memory
residency set is initialized with one directory scan and updated on
publication. Snapshot requests never rescan every hash on disk.

The renderer keeps a disposable 256 MB LRU of chunk bytes. The main-process
content store is canonical. `image.fileSize` stays synchronous because the
snapshot metadata is obtained before the Emscripten glue is appended.

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
`Gw.jspi.wasm`. Asyncify is not a production fallback.

Before `Gw.jspi.js` is appended, the renderer resolves the single
`dataStrategy` setting against native cache residency. `null` owns the
first-run choice, `quick` releases boot immediately, and incomplete `full`
owns the foreground downloader. The game, audio context, sockets, and WebGL
runtime cannot start behind the launcher. Cache residency—not a saved progress
counter—is the download truth. Full Game additionally runs the bounded
content-hash verification pass at startup even when every expected filename is
resident; corruption cannot bypass the repair path.

Awaited host calls always return promises:

```text
image.cacheAsync
dns.resolve
secureStorage.getCredentials/storeCredentials/clearCredentials
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
login from software running as the same user. An unreadable pre-cutover
Keychain-backed ciphertext is deleted once and the game prompts again.
Browser cookies are cleared at startup and quit. Persistent IDBFS client
preferences and the dedicated saved-login file remain intact.
No federated provider is advertised, allowing the client’s username/password
flow to own the UI. The app has no independent update feed;
application replacements are manual, while the ArenaNet client updater remains
automatic. Commerce, ads, browser, and event services remain inert capability
stubs where the desktop client does not need the mobile integration.

The renderer owns one persistent game filesystem initialization before the
official client enters `main()`. It mounts and restores Emscripten IDBFS at
`app:`, creates `Templates/Skills` and `Templates/Equipment`, changes the
working directory to that mount, and persists the directory invariant before
releasing the run dependency. This keeps the client's relative build-template,
screenshot, chat-log, and preference writes in one durable origin. A restore
or initial persist failure stops startup instead of silently running against
ephemeral memory. At the Emscripten lookup boundary, Windows-style backslashes
used by the official template code are normalized to POSIX separators.

After native confirmation, the recovery action records a restart request.
Startup clears only IndexedDB for the owned `gw://app` session before a
renderer can mount IDBFS, then removes the request. It cannot clear the
separate native chunk cache or encrypted credential file. There is no native
arbitrary-file bridge and no production WASM rewrite.

The native socket manager owns all TCP handles. It permits only public-unicast
destinations and ports `6112`, `80`, and `443`, limits handles and queued bytes
per renderer, and closes an owner’s sockets on reload, renderer loss, or quit.
DNS accepts only approved ArenaNet/Guild Wars suffixes and retains the raw DNS
fallback needed for the `0.0.1.2` datacenter sentinel.

Game socket payloads are views into WebAssembly memory. The renderer copies
each outbound view into a compact `Uint8Array` before crossing
`contextBridge`; otherwise Electron can serialize the view’s entire backing
memory for a packet only a few bytes long. Main still owns validation,
backpressure, ordering, and the TCP write. Diagnostics reconcile logical,
source-backing, compact, IPC-backing, and written byte counts without recording
packet contents.

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

The renderer also supplies focus, OSK fields, trusted-interaction audio resume,
fullscreen, touch translation, trackpad-wheel normalization, and right-drag
pointer lock. One held-input registry releases keys, buttons, and touches when
focus or native UI consumes an input release. Pointer lock uses a virtual
cursor and recycles a held drag at canvas edges so camera rotation does not
stall.

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
- GPU, power, thermal, lifecycle, crash, and context-loss signals.

Level 1 adds fixed-width per-frame records. The renderer batches them; the main
process writes `frames.bin` asynchronously with a 128 MB ceiling. Level 2 adds
an argument-filtered Chromium trace with selected supported categories, a 256
MB buffer, an 80% stop threshold, and a 120-second time limit.
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
histograms.json
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

Exports fail closed on credential-shaped content. Chromium net bodies, HTTP
headers, account request bodies, TCP payloads, and crash dumps are never
included. Crashpad is local-only and retains at most three dumps.

The comparison tool warns about architecture, OS, app version, GPU renderer,
render scale, canvas size, capture level, visibility, same-session and
overlapping-window differences. Deep traces are labeled profiler-contaminated
and should locate a bottleneck, not provide the final before/after number.

## Verification boundaries

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
