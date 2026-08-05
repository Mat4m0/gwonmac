# Diagnostics and verification

This document owns the local flight recorder and the `.gwdiag` export — what is
recorded, what each protection tier actually guarantees, and how to read a
capture — together with the map from every public claim to the thing that
executes to prove it.

## The flight recorder

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

## What the export actually guarantees

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

## Reading a capture

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

## The memory debug panel

Help → Diagnostics → **Show Memory Debug Panel** (⌘⇧D), or the panel's own
toggle. It appears on a development build, and on any build launched with the
switch:

```
open -a "Guild Wars Reforged.app" --args --gw-debug-panel
```

Not a setting, so nothing about it persists and a player cannot reach it by
clicking. Not the performance overlay either: that one is a shipped, closed-
schema readout drawn from the main process's summary, while the heap curve is
renderer-local and these controls are destructive.

The panel reads the heap, the growth rate, the estimated time to the client's
2 GiB cap, the growth-step count, open sockets, and the uptime of the current
page load. It renders the notice and the crash overlay through the same
functions the real paths use, so a simulation shows the sentence a player would
actually read. It has no thresholds and no copy of its own, and it never writes
the watcher's escalation — the readout prints the real level beside the
simulated one so that stays visible.

Two numbers on it are estimates, and they are deliberately not the same one.
**to cap** is the panel's own arithmetic over the whole run, which is the right
figure for reading a session afterwards. **warning** is what the warning itself
concluded — measured step to step over at least ten minutes, ignoring the
startup ramp — and it is the number that explains what the player was actually
told. It reads `not measuring yet` until two growth steps ten minutes apart
have been seen, which in the open world is around twenty minutes of play.

Two simulation divergences worth knowing: a simulated crash leaves the memory
watcher running (a real abort stops it), and the overlay covers a client that is
still allocating underneath — hence **Dismiss**.

### The reload paths, and why they differ

**Answered, 2026-08-05: every path below reconnects.** Run from inside an
instance, all five put the player back where they were with progress intact,
in under thirty seconds. The question was never whether Guild Wars restores an
instance after a dropped connection — it does — but whether these reloads look
like one to its server, and none of the differences in the table turned out to
matter to it. The notice's copy states the reconnect because of this run.

The table stays because the paths still differ, and the next question about
them will be a different one. They do not differ at the TCP level — every one
ends in the same `destroy()` — but they differ in ordering, in whether the
client learns it was disconnected, and in whether anything is sent at all.

| | Path | Filesystem sync | Client sees the close | What the server sees |
| --- | --- | --- | --- | --- |
| a | Panel: sync + reload — also the notice's own Reload Now | yes, ≤1.5 s | no | FIN at navigation |
| b | View → Reload Game (⌘R) | no | **yes** — main closes first | FIN before navigation |
| c1 | Panel: orphan + reload | no | no | **nothing** — no FIN; the server must time out |
| c2 | Help → Diagnostics → Crash Renderer Process | no | no | FIN from `render-process-gone` |
| d | Panel: drop sockets, keep running | no | **yes**, and the client stays alive | FIN |
| e | Crash overlay → Retry | no | no | FIN at navigation |

If you are re-running this, take **(d) first**: it is the only one that does
not restart the client, so the re-login is fastest. **(c1)** is the only
silence, which makes it the closest imitation of a real crash — and it was the
one most likely to fail, so it passing is what generalises.

Record the uptime and socket count before each run and how long the re-login
took — otherwise a server-side timeout gets attributed to a teardown
difference. (c1) leaves orphaned handles in the main process until the app
quits, so quit after using it. (c2) recovers only once per launch.

Two limits on what that run proved: one tester on one account, and it says
nothing about a full party, a timed mission, or a loaded server. It is enough
to state the reconnect and not enough to promise it can never go wrong, which
is the line the copy tests hold.

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
| No target, movement, skill, chat, or other gameplay action is performed for the player; cursor reconciliation is one bounded post-click out-and-back hit-test | website FAQ, `PRODUCT.md`, `docs/user-guide.md` | `tests/release/packaged-enhancement-surface.test.ts` loads the compiled policy with `app.isPackaged` forced true and proves both gameplay automation and every developer program are refused; `tests/electron/enhancement-cursor.spec.ts` proves cursor reconciliation requires a trusted click, emits exactly the out-and-back pair, and becomes a no-op when the game published its normal cursor event |
| The official artifact is preserved; the module the session runs is a derived copy | website FAQ, `docs/user-guide.md` | `tests/unit/template-save-compat.test.ts` — *never writes into the caller's input, Buffer or not*, *leaves unknown future client builds canonical*; `tests/unit/derived-wasm-cache.test.ts` — *publishes nothing when the output misses the pinned hash* |
| Game files come directly from ArenaNet and are verified before use | website FAQ, `README.md` | `tests/unit/manifest.test.ts`, `tests/unit/chunk-store.test.ts` (verify-on-read, unlink-and-refetch), `tests/unit/published-client.test.ts`; `tests/integration/updater.test.ts` for publication, corruption repair and rollback |
| No telemetry, credentials, account identifiers, or game traffic are uploaded | website features list and FAQ | `tests/unit/no-game-traffic-is-uploaded.test.ts` — the test named for the claim: *refuses every destination that is not a public ArenaNet-shaped address* (loopback, private ranges, this project's own host, every port outside 6112/80/443), and *exports a socket's lifetime with no trace of what it carried*; `tests/unit/allowlists.test.ts` and `tests/unit/proxy-routes.test.ts` for the boundaries underneath it |
| A `.gwdiag` never contains credentials, account identifiers, packet contents, or crash dumps | website FAQ, `docs/user-guide.md` | `tests/unit/diagnostic-schema-rejects-free-text.test.ts`, `tests/unit/export-detector-rejects-undeclared-event-fields.test.ts`, `tests/unit/socket-events-carry-no-error-text.test.ts`, `tests/unit/trace-scanner-catches-the-adversarial-corpus.test.ts`. Read *What the export actually guarantees* above for which tier covers which file |
| With update checks switched off, the app makes no network request the player did not ask for | settings copy, `docs/user-guide.md` | `tests/electron/a-launch-checks-github-once-unless-opted-out.spec.ts` — the row's proof: it wraps the main process's `fetch` and counts exactly **one** api.github.com request across a launch with the defaults, then **zero** across a launch with the box unticked. `tests/unit/settings.test.ts`, `tests/unit/app-updater.test.ts`, and `tests/unit/update-action.test.ts` prove the constituents, including `periodicCheckDue` — every gate on the background re-check and its cadence constants |
| Automatic checks happen at launch and then at most every six hours, never while a game connection is open | settings copy, first-run line, `README.md`, `docs/user-guide.md` | `tests/unit/app-updater.test.ts` — the `periodicCheckDue` gates and the `PERIODIC_CHECK_TICK_MS`/`PERIODIC_CHECK_DUE_MS` constants; `tests/policy/source-release-pipeline.test.ts` pins that the tick in `main.ts` is wired through that one predicate |
| The game's own cursor is on by default, is switchable off, and no artwork ships or is downloaded | settings copy, `docs/user-guide.md` | `tests/release/packaged-enhancement-surface.test.ts` — *the cursor ships on, and a player who switches it off stays off*; `tests/electron/enhancement-cursor.spec.ts` for what Chromium computes from a published cursor region; `tests/policy/forbidden-artifacts.test.ts` for what is tracked |
| Releases are Developer ID signed, notarized, stapled, and the shipped fuses hold | website FAQ | `.github/workflows/release.yml` verifies the G2 fingerprint, profile identity, Team ID, timestamp, hardened runtime, exact three top-level entitlements, Gatekeeper and stapled tickets; `tests/signed-keychain-runtime.ts` proves the signed product retains a Data Protection Keychain item across relaunch, move, and a newly signed replacement; `tests/policy/source-release-pipeline.test.ts` pins that policy; `tests/packaged-smoke.ts` and `tests/policy/fuses.test.ts` verify package structure and fuses |
| Render scale changes the real backing resolution | website, settings copy | `tests/electron/live.spec.ts` (opt-in live smoke) — the drawing buffer changes with the setting; `tests/electron/settings.spec.ts` for the resolutions shown beside each scale |
| "Tuned for Apple Silicon" | website capability facts | `.github/workflows/macos-verify.yml` and `.github/workflows/release.yml` fail before building unless the package runner reports `arm64`; `tests/policy/source-release-pipeline.test.ts` pins both gates |
| "Up to 60 FPS" | website capability facts | **none.** No automated test asserts a frame rate |
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
