# Toolbox development runbook

This is the working procedure for extending the Electron/WASM Toolbox. The
certified build manifest in `src/main/core/toolbox-builds.ts` is the only
runtime source of build-local addresses, signatures, and table slots.

## The short loop

Use the cheapest layer that can prove the change:

```text
transform/unit test
  -> synthetic kernel memory
  -> deterministic presentation prototype
  -> offline Electron
  -> one bounded live scenario
```

Most feature work should finish its first four layers without contacting
ArenaNet. A live run certifies semantics; it is not the primary debugger.

```bash
pnpm toolbox:doctor
pnpm check
pnpm build && pnpm test:integration
```

For real CSS/layout feedback without a game or network session:

```bash
pnpm toolbox:visual -- target
pnpm toolbox:visual -- map
```

This opens a standalone developer-only prototype at Retina 2×, writes one
screenshot under `test-results/toolbox-visual/`, and closes Chromium. Its
markup and CSS live under `scripts/toolbox-visual/`; they are not production
navigation or packaged renderer assets.

`toolbox:doctor` is local-only. It checks the existing profile, published
client, exact WASM hash, transformed cache, saved-login presence, the profile's
`nativeCursor` setting, and complete snapshot filename presence. It verifies executable artifacts, but labels
snapshot chunks as presence-only because it does not hash their contents. It
never starts Electron or contacts ArenaNet.

## Live scenarios

Production-network work remains deliberate:

```bash
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario boot
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario target
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario movement
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario reload
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario map-transition
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario performance
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario cursor-capture
```

`cursor-capture` is human-assisted. It prints eight prompts (arrow, hover, salvage,
identify, drag, world map) and records only typed transitions at 20 Hz, bounded to
192 changes. It pairs the observed scalars with the renderer's published cursor
state, so one run shows both what the game committed and what reached Chromium.

Each scenario declares a tier, and the tier decides how the app is launched.
An **automation** scenario is one that acts on the player's behalf; it gets
`GW_TOOLBOX_AUTOMATION=1`, trusted Playwright input, and the parent-process
command channel. An **observation** scenario — `cursor-capture` today — gets
none of the three: it is launched exactly as a player's app is, with no IPC
channel at all and a scenario context holding only page evaluation, the typed
`--observe` sampler, and a clock. The Toolbox installs for it because the
profile's `nativeCursor` setting is on, so the run is refused up front with
`native-cursor-disabled` when it is off, and it asks the operator to bring the
client to a playable character rather than pressing Enter itself. The tier the
run used is the `tier` field of the printed result.

The default is cached-only. Main skips the client updater, and the chunk store
is physically unable to fetch a missing chunk. `--allow-update` is the explicit
escape hatch for a deliberate ArenaNet client update. `--leave-open` keeps a
successful run visible. Failures and timeouts always leave Electron open and
write a screenshot plus bounded logs under `test-results/toolbox-live/`.

The harness launches Electron directly with the normal Guild Wars profile,
verifies the effective user-data directory in main before startup, connects to
the random loopback DevTools endpoint, and observes structured renderer state.
It never launches through Playwright's temporary Electron profile.
Its parent-process IPC channel exists only for an automation-tier run and can
only start and stop Level 1 diagnostics when the explicit Toolbox automation
environment is active; capture mutation is not exposed to the sandboxed
renderer.
`scripts/toolbox-live.mjs` owns process launch, CDP connection, bounded failure
output, common acceptance, and shutdown. Each registry entry in
`scripts/toolbox-live/scenarios.mjs` owns its action and semantic validation;
the paired Level 1 benchmark lives in
`scripts/toolbox-live/performance.mjs`. Add behavior to the narrow owner rather
than growing another general automation framework.

Gameplay automation uses trusted Playwright input. Saved-login confirmation
uses Enter, target acquisition uses the normal nearest-ally key with a bounded
party-row fallback, and movement uses the standard two-button forward gesture.
Do not change account controls to make a scenario pass.

`map-transition` owns one certified, bidirectional map 146/148 portal route.
It steers in short segments using renderer-local player coordinates and stops
on the first field-cleared transition state. It proves that no stale map,
player, or target fields survive loading, then requires the exact destination
map. Other maps fail closed; this is not a general navigation system.

`performance` compares two arms with a Level 1 capture and exact
animation-frame samples per phase. Both arms run the **already transformed**
game module — `transformed-dispatcher-off` holds its hook slot at zero, so the
game calls its original tick and the kernel never runs, and
`transformed-observer-on` lets the kernel write snapshots for the renderer to
read. So the delta is the incremental kernel/snapshot-observer cost, not the
Toolbox's total cost against ArenaNet's untransformed module: that third arm is
not reachable from a session that can measure these two, because automation
forces the Toolbox on and the module is chosen in the main process before the
renderer exists. The arms are named for what they run so the number is not read
as something wider than it is. It reports p50, p95, p99, maximum frame time,
long-frame counts, renderer task/script/layout time, JavaScript heap use, and
hook calls.

Each arm is measured **twice, in a mirrored order** (off, on, on, off), with the
same warm-up and the same measured window in every phase, so a drift over the
run falls equally on both arms instead of on whichever went second. An arm's
percentiles are the mean of its two phases' percentiles rather than a percentile
over their pooled samples — pooling would put the arm at whichever phase's level
that percentile lands in, and the mirror would cancel nothing. The order that
ran is part of the result, and the gate refuses a result whose order is not
mirrored.

Absolute heap size is the one reading that cannot mirror: it is neither a rate
to mean nor a delta to sum, and an arm assigned one of its two phases' readings
would be reporting the heap at that phase's position in the run. It is therefore
reported **per phase**, beside the phase number that says when it was taken, and
is not comparable between arms. The arm-level heap number is
`metrics.jsHeapDeltaKiB`, which is a delta and does sum across both phases.

Its numbers — phase duration, the sample floor per arm, the tail-percentile
regression limit, and the absolute p95 movement — live with the benchmark that
enforces them, in the `performance` entry of
`scripts/toolbox-live/scenarios.mjs`. They are deliberately not repeated here:
a budget written in two places ends up enforced by one and quoted from the
other. What belongs here is why the rule has that shape. A regression must be
corroborated by *both* tail percentiles, so normal outpost variance or a single
0.1 ms-quantized scheduling boundary is not reported as a Toolbox regression,
while the absolute p95 limit still catches a real shift that a percentage would
flatter. The result also requires zero hook ticks in the dispatcher-off arm and
a full run of hooked ticks in the other, so a disconnected benchmark cannot
pass. Task and heap values are diagnostic rather than gates, because garbage
collection and unrelated game work can move them between phases.

The schedule and the arithmetic are in `scripts/toolbox-live/benchmark.mjs`,
which imports nothing, so
`tests/policy/the-benchmark-measures-each-arm-in-both-orders.test.mjs` executes
them against a drifting session double without a build or a game.

The renderer lifecycle surface derives from existing state:

```text
launcher.*
runtime.instantiating
client.frontend
game.loading
game.outpost
game.explorable
toolbox.unsupported
```

`client.frontend` intentionally covers saved-login confirmation and character
selection until a certified internal screen discriminator is found. The
harness sends at most three Enter presses at bounded intervals and stops as
soon as a valid game snapshot appears. It does not inspect or report account
fields. An unexpected credential, two-factor, legal, or captcha prompt remains
a human boundary. Screenshots are a failure diagnostic, not the normal control
loop.

Each successful scenario prints one compact JSON record with preflight state,
lifecycle transitions, login input count, hook cadence, snapshot counters,
map/player/target state, DOM writes, renderer p95, host/process memory,
browser-storage use, EGL presentation, snapshot/socket timing, startup
milestones, errors, and shutdown.

## Deterministic feature workflow

For every new field or widget:

1. State the user-visible behavior and the invariant that proves it.
2. Find candidates statically or with a bounded typed observation.
3. Add the exact-build layout value only after live evidence.
4. Add synthetic kernel cases for valid, loading, missing, corrupt, and
   non-finite state.
5. Extend or version the snapshot ABI.
6. Render the developer presentation fixture without adding production DOM.
7. Run one scenario that changes the value in the real game.
8. Record the remaining semantic coverage gap in this document.

Do not add direct renderer pointer chains, a parallel JavaScript probe, generic
memory writes, arbitrary function calls, or raw packet export.
The ordered layout field list in `toolbox-builds.ts` generates the transform
payload, so a new field must not introduce a renderer-side order table.

## Scoped observations

The live scenario runner can compare at most 16 explicitly typed scalar
addresses before and after its action:

```bash
GW_LIVE_SMOKE=1 pnpm toolbox:live -- \
  --scenario target \
  --observe u32:0x5a388c,u32:0x5a3888
```

Allowed types are `u8`, `u16`, `u32`, `i32`, and `f32`. There is no string,
byte-range, pointer-walk, packet, or memory-dump mode. Observations stay in the
renderer and the compact before/after values return over the local DevTools
connection. Candidate observations are research evidence, never runtime truth.

Use controlled differentials:

```text
party target A -> party target B
stationary -> bounded movement -> stationary
target visible -> loading with no target fields -> new map
skill ready -> activated -> recharged
effect absent -> present -> removed
```

## Cursor pipeline

The cursor is the first shipped Toolbox feature, so the Toolbox path is no
longer developer-only. `toolbox-policy.ts` has two gates and nothing else:
`TOOLBOX_AUTOMATION_ENABLED` (non-packaged, `GW_TOOLBOX_AUTOMATION=1`) and the
player's `nativeCursor` setting, which is on by default. Either one enables
the transform in main and sets the matching field in the renderer init payload
(`toolboxAutomation` or `nativeCursor`) that lets `harness.js` import
`toolbox.js`. Both are read once per launch, because the choice decides which
WASM main is served. When you develop against automation you are exercising the
same code path a player gets, so treat a regression there as user-facing.

The web client kept ArenaNet's Win32 cursor structure and stubbed only its final
step: `GlDev` decodes the active cursor into fixed buffers, then calls
`EmscriptenWindow::ChangeCursorIcon`, whose body is empty. The finished bitmap is
therefore always present and unused, and the kernel only has to read it.

Facts that cost real effort to establish. Do not re-derive them:

- The colour buffer is **BGRA**, proven live by matching three fingerprint pixels
  against known art. The kernel publishes canonical RGBA.
- The A8 mask buffer is redundant: it agreed with the colour buffer's own alpha in
  198 of 198 live samples. Do not read it.
- `s_activeArt` is **not** a stable identity. One session showed 21 distinct art
  pointers for 9 distinct cursors, so the change key is a hash of the pixels.
- The in-engine software cursor is dead in this build: a read-only caps word keeps
  `s_swCursorModel` null. The kernel treats a non-null value as unsupported rather
  than competing with it.
- The game's DXT decoder rounds differently from offline extraction, so certify
  cursor pixels within a per-channel tolerance, never by exact hash.

Presentation is constrained by Chromium, not by taste. Custom cursors above
**32 CSS px** are dropped whenever the cursor rect leaves the visual viewport, so
the authoring grid is fixed at 32 and there is no size option. Retina crispness
requires an `image-set` 2x candidate; a plain 32x32 image is handed to macOS at
scale 1 and upscaled. Cursor images are fetched as images, so `img-src` governs
them and `blob:` is unavailable. A trailing keyword is mandatory.

## Client recertification

Inspect an official candidate:

```bash
pnpm toolbox:recertify -- path/to/Gw.jspi.wasm
```

Pass the official module. The tool applies the template-save transform first
when that build is known, because main does the same, and reports both the
official hash and the derived hash it actually inspected.

The compact report includes the hash, WASM validity, known-build status,
semantic main-loop export index and signature, table shape, and first empty
slots. An unknown hash is only a candidate. Certification still requires:

- semantic main-loop cadence and lifecycle proof;
- original called exactly once;
- table-slot emptiness at transform and runtime;
- every layout invariant under positive and negative live changes;
- loading, reload, target clearing, and clean shutdown;
- a new exact-hash manifest entry and tests.

Unknown builds continue serving the official client unchanged.

The two transforms are chained, not alternatives. Both rewrite the same official
module, so neither output contains the other's fix; main prepares the
template-save client first and layers the Toolbox transform on top of it.
`TOOLBOX_BUILDS[].sha256` is therefore a template-save **output** hash, pinned by
a unit test, and recertification order is fixed: certify the template-save build
first, then certify the Toolbox transform against its output.

The template-save transform only appends functions, so the main-loop index, the
free table slot and every layout address stay those of the official build.

An opted-in launch that cannot produce a Toolbox module still returns the
template-save client, so an uncertified build costs the cursor and nothing else.

## ABI evolution

Keep the core snapshot small. Do not turn it into a speculative global game
model. Add a bounded region only when its first feature requires it:

```text
core snapshot       lifecycle, map, player, target
cursor snapshot     one 32x32 bitmap, hotspot, generation
party snapshot      fixed-capacity party entries
agent snapshot      filtered bounded agents
skill/effect state  bounded domain collections
event ring          only for state a tick snapshot can miss
command queue       only after a typed command is approved
```

Every region needs magic, ABI version, byte size, sequence, count/capacity, and
explicit overflow/invalid flags. Derived output must be rebuildable from the
official WASM and the canonical build manifest.

Commands must be named domain operations with typed arguments, game-thread
execution, loading/map preconditions, rate limits, cancellation, and explicit
failure results. Never expose `writeMemory`, `callFunction`, or `sendPacket`.

## Port readiness register

`Observed` is not `Ready`. It means live evidence exists for the cases in the
evidence column and for no others: the domain's remaining values — the rest of
an agent-type union, a second instance type, a cursor the run never hovered —
are accepted by the decoder without having been seen. A domain leaves
`Observed` when its next proof lands, not when its foundation feels finished,
and until then nothing published from it may carry a semantic name that live
evidence has not certified.

| Domain | Foundation | Live evidence | Next proof |
| --- | --- | --- | --- |
| Hook lifecycle | Observed | continuous tick, reload, clean shutdown | one live map transition |
| Map/player | Observed | live identity, 201-unit movement delta | one live map transition |
| Target identity/distance | Observed | target ID 1 -> 12, loading invalidation offline | hostile/item/gadget and live map invalidation |
| Cursor | Observed | 79 publishes, 8 bitmaps, 25 hide/show, zero rejected | identify and dragged-item bitmaps |
| Cursor presentation | Shipped, opt-in | offline Electron + `cursor-capture` | opted-in play on a fresh certified build |
| Party | Not modeled | none | locate bounded roster |
| Skills/recharge | Not modeled | none | locate skill context |
| Effects/conditions | Not modeled | none | locate bounded effect collection |
| Nearby agents | Partial array knowledge | player/target only | filtered collection ABI |
| Inventory/equipment | Not modeled | none | lifecycle and string decoding |
| Events/combat | No event channel | none | prove snapshot insufficiency first |
| Game commands | Read-only by design | none | one harmless typed target command |
| Packet-derived state | No packet hook | none | identify dispatch boundary |
| Extension modules | Intentionally deferred | none | extract after repeated modules |

Native DLL injection, GWCA pointers, Direct3D/ImGui rendering, and the Windows
plugin ABI are replacement work, not compatibility targets.

## Completion bar for a feature

A Toolbox feature is ready when:

- the exact-build evidence is canonical and tested;
- invalid/loading state cannot publish stale values;
- the automation observer stays below the renderer-time budget in
  `scripts/toolbox-live/acceptance.mjs`;
- no raw pointer, packet, or memory slice crosses Electron IPC;
- cached startup does no transformation or network work;
- one bounded scenario proves the real semantic change;
- shutdown has no trap, rejection, unknown socket, or orphan process;
- the unsupported-build path remains fully playable.
