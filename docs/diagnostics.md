# Diagnostics and performance

This document explains the local diagnostics recorder, export protections, and
performance measurement rules.

Audience: contributors who add diagnostics, investigate failures, make
performance claims, or choose verification for a change.

This document owns evidence boundaries. It does not own exact schema members,
capture budgets, benchmark thresholds, or release checks. Code and tests own
those facts.

## Diagnostic levels

The recorder has three levels:

| Level | Purpose | Cost |
| --- | --- | --- |
| 0 | Always-on operational history | Low and bounded |
| 1 | Frame timing and clean performance comparison | Higher, but suitable for measurement |
| 2 | Chromium trace and CPU attribution | Profiler-contaminated; use only to find a cause |

Level 0 uses a bounded memory ring and rolling JSONL files. Renderer metrics
cross IPC in batches. The renderer does not send one IPC message for each
frame.

Every event has a monotonic timestamp, sequence, process, subsystem, level, and
typed fields. Main and renderer clocks are synchronized with repeated bounded
sampling.

The shared startup timeline records application and renderer milestones. It
also records the official client identity used by the session.

The recorder includes window focus, visibility, minimize, and resize state.
This context is required. macOS can stop frame callbacks for an occluded or
moving window without a renderer defect.

GPU feature status is sampled when the GPU process exists. An early sample can
incorrectly describe a hardware session as software rendering.

Level 1 adds fixed-width frame records. Main writes them asynchronously under a
size limit.

Level 2 adds an argument-filtered Chromium trace. It has byte and time limits.
The recorder adds fixed-name frame and snapshot marks only while Level 2 is
active. These marks add measurable profiler cost. Level 2 can locate a cause.
It cannot prove an improvement.

For a short hitch, record Level 2 for only the reproduction window. Stop soon
after the problem. A trace that stops before the hitch cannot explain it.

In Multiple Accounts mode, a capture belongs to the registered game window
that started it for its complete lifetime. Focus changes cannot move its
status, marker, export, or completion prompt to another profile. Closing or
crashing the owner stops the capture without falling back to another game.
Automation uses the focused registered game, or the sole game when exactly one
exists; it refuses an ambiguous set of unfocused games. Renderer events,
metrics, graphics facts, frame records, completed capture evidence, and exports
are filtered to that owner. A process-local owner token retains the account's
evidence across renderer recovery without recording its profile ID. App-global
lifecycle evidence remains shared. Multiple Accounts exports omit prior-process
events because those ephemeral owners cannot be correlated safely after restart.

Level 2 is refused while more than one game window is open because Electron's
Chromium tracer is process-wide. Level 1 remains available per game window.

## Export contents

A current ZIP contains a manifest, report, summary, current events,
environment, and redacted settings. A capture can add frame records, a capture
summary, and a Chromium trace. An abnormal previous session can add its events.

`report.json` is the first triage file. It summarizes startup, structured
errors, capture state, and selected performance percentiles.

Current events come from retained session files, not only the memory ring. A
previous session appears only when it ended abnormally. Completed cleanup does
not hide an earlier fatal event.

The app does not collect crash dumps. Renderer console text remains local and
bounded.

## Privacy protections

The export uses separate protections for separate data classes.

### Closed event schema

Current structured events use the discriminated union in
`src/main/diagnostics/schema.ts`. Fields contain numbers, booleans, closed
enums, or fixed-format values.

The event API does not accept general message text. Producers use closed error
codes. Unknown foreign error values collapse to `unknown`.

Before export, an independent detector checks every event name, owner, level,
field, type, and value. An undeclared or malformed event stops the export.

### Pattern-scanned documents

Text outside the current schema passes through one scanner. It replaces known
sensitive values, including:

- home and absolute paths;
- file URLs;
- email addresses;
- query values;
- bearer tokens;
- values under sensitive key names.

Large traces stream through safe JSON boundaries. An unscannable segment stops
the export and removes the partial output.

Pattern scanning is a strong filter. It is not proof that an unknown text shape
cannot exist. The ZIP is readable. A player can inspect it before upload.

### Data excluded by construction

The recorder does not collect these values:

- passwords or saved-login values;
- Steam tokens or expiry values;
- account request bodies;
- HTTP headers and network bodies;
- game TCP payloads;
- chat text;
- texture contents;
- raw game-memory slices;
- crash dumps.

Do not add a general string log route. Add a typed outcome only when it is
needed to decide or diagnose behavior.

## Validate and read an export

Run the validator before you trust an export:

```bash
pnpm diagnostics:validate <capture.zip>
```

Start with the summary:

```bash
pnpm diagnostics:summarize <capture.zip>
```

Compare clean captures with:

```bash
pnpm diagnostics:compare <before.zip> <after.zip>
```

Use a Level 1 capture to attribute visible frame gaps to composition loss, the
main process, or the renderer:

```bash
pnpm diagnostics:attribute-frames <capture.zip> [threshold-ms]
```

Use a Level 2 capture to inspect CPU stacks and overlapping trace events:

```bash
pnpm diagnostics:attribute-stalls <capture.zip> [threshold-ms]
```

The tools warn about different hardware, operating systems, application
versions, GPU renderers, render scales, canvas sizes, visibility, capture
levels, and overlapping windows. Do not ignore these warnings.

## Live graphics investigation

Use the local graphics probe when a visual defect cannot be reproduced in an
offline fixture. It starts the normal profile and observes the renderer through
an ephemeral loopback debugging endpoint:

```bash
pnpm graphics:live
```

Play normally. Press Enter in the probe terminal to save one evidence pair.
Type `q`, then press Enter, to stop the probe and close the app cleanly. Each
pair contains a screenshot and a JSON file with the same bounded renderer
state. The JSON contains canvas dimensions, WebGL context status, WASM heap
size, texture counters, image-cache counters, program-cache counters, and the
closed diagnostic summary.

The probe stores each run in a new directory under
`test-results/graphics-live/`. It does not overwrite an earlier run. A
screenshot can contain character, account, or chat information that is visible
in the game. Inspect it before sharing it. The screenshot is separate from a
diagnostics ZIP and is never included automatically.

The probe cannot identify a Guild Wars texture, read texture pixels, read raw
game memory, or prove what a scene should look like. Use it to compare a clean
and affected session at the same location, render scale, and account count.
Do not treat one machine's clean result as proof that another GPU is healthy.

## WASM memory evidence

The renderer observes the official client's imported heap-growth boundary. It
does not change the requested size or result.

The recorder states whether the probe installed. A request records its size,
heap size before and after, closed outcome, and a short numeric WASM call chain.
Stack text does not cross IPC.

The same boundary samples bounded WebGL texture totals without content or
per-texture history. The local graphics probe can read those counters on
demand. Unknown or saturated tracking makes the known byte total a lower bound.

A failed growth request at the compiled limit proves that the official client
requested more memory than that module permits. It does not identify which
client subsystem retained the earlier allocations.

Function indices apply only to the exact captured module. The 4 GB option
records requested and effective state. An unavailable certified profile falls
back to the ordinary module with a closed reason.

## Performance measurement rule

Define the player action and measurement boundary before changing architecture.

Use this sequence:

1. Record a clean Level 1 baseline.
2. Use Level 2 only when the baseline does not identify the owner.
3. Change one causal boundary.
4. Record multiple clean Level 1 candidate runs.
5. Compare the same workload, hardware, render scale, cache state, and visible
   window state.
6. Keep failed and contaminated runs in the record.

Do not use an average alone. Inspect tail frame times, long-frame counts,
startup stages, memory, and the subsystem metric that the change targets.

Benchmark thresholds live with the code that enforces them. Do not copy a
number into this document as a second gate.

One favorable capture is not a performance result. A Level 2 trace is not an
acceptance capture. A result from one session must not be described as several
independent runs.

Do not add a cache, worker, transport, rendering backend, or concurrency change
until a clean measurement shows a repeatable boundary violation.

## Durable performance findings

These findings prevent a known defect or rejected experiment from returning.
Git history contains the original measured values.

| Finding | Required design consequence |
| --- | --- |
| A small WASM view caused Electron to retain or serialize the complete WASM backing buffer. | Copy outbound socket data to a compact byte array before `contextBridge`. Compare logical, IPC, and written bytes. |
| The official client overwrote a host-only canvas scale. | Supply render scale through the Emscripten device-pixel-ratio import. Verify the real drawing buffer. |
| Clean captures found no supported reason for a direct-canvas rewrite, WebGPU port, packet batching, or higher patch concurrency. | Require a new measured boundary before proposing one. |
| Chromium trace marks and CPU profiling affected the captured renderer. | Use Level 2 for attribution only. Use Level 1 for before-and-after proof. |
| A cooperative snapshot-completion pacer did not remove the reproduced long frame. | Do not restore pacing without new attribution for post-read work. |
| A temporary Web Audio observer found no positive scheduling gap in the measured problem. | Keep only the operational audio-resume failure event. Add audio diagnostics only for a reproduced audio defect. |
| Paired Core and Tools captures showed no accepted tail regression on the certified workload. | Re-run the paired benchmark for a new hook, observer, ABI, or rendering path. Do not generalize the old result to new work. |

## Verification levels

Use the fastest level that executes the invariant.

| Invariant | Normal proof | Higher proof only when needed |
| --- | --- | --- |
| Parser, policy, transform, decoder, or state invariant | Unit test | None |
| ArenaNet publication, corruption repair, cancellation, or rollback | Local integration fixture | Live patch-day check for the current service |
| IPC, sandbox, navigation, launcher, settings, or renderer recovery | Electron test | Packaged test when package identity or resources matter |
| Package files, fuses, generated preload, or ad-hoc package behavior | Packaged test | Signed test when Apple identity matters |
| Keychain continuity, Developer ID, notarization, updater installation | Signed release test | Maintainer-owned live release check |
| Stable and Beta profile continuity | Release-only signed Stable to candidate to Stable round-trip | Post-publication production-updater check |
| Current ArenaNet client playability and certified Core behavior | Opt-in live canary | Release canary with a real account |
| Performance improvement | Repeated clean Level 1 comparison | Level 2 attribution before the change |

Do not put signed, live-account, or production-updater checks in `pnpm run check`.
They are release or patch-day gates because local fixtures cannot prove those
external boundaries.

## Live and release boundaries

The weekly canary proves that today's official client starts, renders, reads
snapshot data, and retains required certification. It does not prove
real-account login on every supported Mac.

The release approver owns the real-account, signed-identity, and production
updater observations in [Verify a release](release-verification.md).

Enhancement changes use the bounded workflow in
[Enhancement development](enhancement-development.md). A live Enhancement run
uses cached ArenaNet data unless the operator explicitly permits a game update.
