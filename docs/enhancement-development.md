# Enhancement development runbook

This is the working procedure for extending the Electron/WASM Enhancement. The
certified build manifest in `src/main/certification/enhancement-builds.ts` is the only
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
pnpm certification doctor
pnpm check
pnpm build && pnpm test:integration
```

For real CSS/layout feedback without a game or network session:

```bash
pnpm enhancements:visual -- target
pnpm enhancements:visual -- map
```

This opens a standalone developer-only prototype at Retina 2×, writes one
screenshot under `test-results/enhancements-visual/`, and closes Chromium. Its
markup and CSS live under `scripts/enhancements-visual/`; they are not production
navigation or packaged renderer assets.

`certification doctor` is local-only. It checks the existing profile, published
client, exact WASM hash, transformed cache, the profile's `nativeCursor`
setting, and complete snapshot filename presence. It does not
inspect saved login: command-line tooling is outside the signed app's Data
Protection Keychain boundary. It verifies executable artifacts, but labels
snapshot chunks as presence-only because it does not hash their contents. It
never starts Electron or contacts ArenaNet.

## Live scenarios

Production-network work remains deliberate:

```bash
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario boot
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario target
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario target-readout
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario movement
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario reload
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario map-transition
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario performance
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario cursor-capture
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario toolbox-foundation
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario toolbox-hero-panel
```

`cursor-capture` is human-assisted. It prints eight prompts (arrow, hover, salvage,
identify, drag, world map) and records only the bounded cursor projection at
20 Hz, capped at 192 changes. No game-memory address or pixel payload is
accepted or persisted.

`target-readout` is the one deliberate production-client confirmation for the
player-facing target feature. Enable **Target distance and range** in Settings,
accept the restart, then run exactly:

```bash
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario target-readout
```

The doctor refuses the run with `target-readout-disabled` when the saved
selection is off. The scenario acquires one bounded target, then requires one
visible `#enhancement-target` element and the rendered line to match the target
snapshot. Do not run another live scenario for that release decision.

Each scenario declares a tier, and the tier decides how the app is launched.
An **automation** scenario is one that acts on the player's behalf; it gets
`GW_ENHANCEMENT_AUTOMATION=1`, trusted Playwright input, and the parent-process
command channel. An **observation** scenario — `cursor-capture` today — gets
none of the three: it is launched exactly as a player's app is, with no IPC
channel at all and a scenario context holding only one fixed cursor-projection
read and a clock. The fixed cursor-observer program exposes no
target snapshot and selects the cursor without changing the saved setting. It
asks the operator to bring the client to a playable character rather than
pressing Enter itself. The tier the run used is the `tier` field of the printed
result.

The default is cached-only. Main skips the client updater, and the chunk store
is physically unable to fetch a missing chunk. `--allow-update` is the explicit
escape hatch for a deliberate ArenaNet client update. `--leave-open` keeps a
successful run visible. Failures and timeouts always leave Electron open and
write bounded logs under `test-results/enhancements-live/`. They also write a
screenshot except for every `toolbox-foundation` program run: its typed scalar
evidence needs no pixels, so retaining game content would add no proof.

The harness launches Electron directly with the normal Guild Wars profile,
verifies the effective user-data directory in main before startup, connects to
the random loopback DevTools endpoint, and observes structured renderer state.
It never launches through Playwright's temporary Electron profile.
Its parent-process IPC channel exists only for an automation-tier run and can
only start and stop Level 1 diagnostics when the explicit Enhancement automation
environment is active; capture mutation is not exposed to the sandboxed
renderer.
`scripts/enhancements-live.ts` owns process launch, CDP connection, bounded failure
output, common acceptance, and shutdown. Each registry entry in
`scripts/enhancements-live/scenarios.ts` owns its action and semantic validation;
the paired Level 1 benchmark lives in
`scripts/enhancements-live/performance.ts`. Add behavior to the narrow owner rather
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
Enhancement's total cost against ArenaNet's untransformed module: that third arm is
not reachable from a session that can measure these two, because automation
forces the Enhancement on and the module is chosen in the main process before the
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
`scripts/enhancements-live/scenarios.ts`. They are deliberately not repeated here:
a budget written in two places ends up enforced by one and quoted from the
other. What belongs here is why the rule has that shape. A regression must be
corroborated by *both* tail percentiles, so normal outpost variance or a single
0.1 ms-quantized scheduling boundary is not reported as a Enhancement regression,
while the absolute p95 limit still catches a real shift that a percentage would
flatter. The result also requires zero hook ticks in the dispatcher-off arm and
a full run of hooked ticks in the other, so a disconnected benchmark cannot
pass. Task and heap values are diagnostic rather than gates, because garbage
collection and unrelated game work can move them between phases.

The schedule and the arithmetic are in `scripts/enhancements-live/benchmark.ts`,
which imports nothing, so
`tests/policy/the-benchmark-measures-each-arm-in-both-orders.test.ts` executes
them against a drifting session double without a build or a game.

The renderer lifecycle surface derives from existing state:

```text
launcher.*
runtime.instantiating
client.frontend
game.loading
game.outpost
game.explorable
enhancement.unsupported
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
The ordered layout field list in `enhancement-builds.ts` generates the transform
payload, so a new field must not introduce a renderer-side order table.

## Bounded live evidence

The finished live harness accepts no game-memory address. It records only the
typed scalar projections a scenario owns. Cursor capture persists generation,
pixel hash, visibility, validity, and CSS length; the Toolbox proof persists
only counts, hero identity, panel state, and pass/fail evidence. Candidate
address probing belongs in disposable local research, not this runtime or its
failure reports.

## Cursor pipeline

The Enhancement path is no longer developer-only. Its one canonical user tool
is `nativeCursor` (on by default), carried to the renderer as one
`EnhancementSelection`; the target readout retired from user settings and runs
only through the `target-observer` developer program. Main combines that selection with
one fixed unpackaged developer program, derives the exact capability plan once,
and fingerprints that plan into the derivative. Automation permission is a
separate input boundary and selects no hook or feature. The harness does not
trust launch intent as the answer: it imports `enhancements.js` only when the
actual instantiated module also
carries `enhancement_manifest`, so a requested but uncertified build executes no
Enhancement renderer code.

The kernel receives independent cursor, target-observation, and Toolbox bits.
A disabled cursor performs no cursor collection; cursor-observer mode does not
enable the target scan; Toolbox uses only its game/party fields and allocates no
target snapshot. The target-observer program is the one developer path that
explicitly enables map/player/target collection. Every developer program is
refused in packaged builds. Settings are read once per launch because the
kernel configuration cannot change while the game is running.

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
pnpm certification recertify
```

Pass the official module. The tool selects either its exact template-save
record or the same structurally derived record main accepts for a new
template-compatible build, then applies that transform first. It reports both
the official hash and the derived hash it actually inspected. If neither proof
can select a template-save record, it exits without inspecting the raw official
module as an Enhancement candidate.

The compact report includes the hash, WASM validity, known-build status,
semantic main-loop export index and signature, table shape, first empty slots,
and a nested `structuralEvidence` report. That nested report is deterministic,
review-only evidence: each tick, player-chat/UI, and cursor result is
`candidate`, `ambiguous`, or `unavailable`, and none of those values can create
a launch certificate. `bundleVerified` remains true only when an existing
exact-hash tick/cursor/UI certificate reproduces all four source-pinned
derivatives: cursor, target, cursor plus target, and cursor plus Toolbox. The
report includes those derived hashes. Cache metadata cannot certify different
bytes, and an omitted profile hash fails closed. An unknown hash is only a
candidate and never inherits the retired common-address relocation.

On the current build 38,797 post-template module, the review locator recovers
tick `#446` and the player-chat/UI dispatcher `#6842`, but reports cursor
`unavailable`. That is useful evidence, not a recertification failure: the
minimal cursor locator accepts only two direct producer calls, while the known
cursor `#2469` is related to active table slot 922 and its recovered producers
reach it indirectly. Do not weaken the locator until that indirect relationship
has its own structural proof. The existing exact certificate may still make
`bundleVerified` true.
Certification still requires:

- semantic main-loop cadence and lifecycle proof;
- original called exactly once;
- table-slot emptiness at transform and runtime;
- every layout invariant under positive and negative live changes;
- loading, reload, target clearing, and clean shutdown;
- a new exact-hash manifest entry and tests.

Unknown builds continue serving the official client unchanged.

The two transforms are chained, not alternatives. Both rewrite the same official
module, so neither output contains the other's fix; main prepares the
template-save client first and layers the Enhancement transform on top of it.
`ENHANCEMENT_BUILDS[].sha256` is therefore a template-save **output** hash, pinned by
a unit test, and recertification order is fixed: certify the template-save build
first, then certify the Enhancement transform against its output.

The template-save transform only appends functions, so the main-loop index, the
free table slot and every layout address stay those of the official build.

An opted-in launch that cannot produce a Enhancement module still returns the
template-save client, so an uncertified build costs the cursor and nothing else.

## ABI evolution

Keep the core snapshot small. Do not turn it into a speculative global game
model. Add a bounded region only when its first feature requires it:

```text
core snapshot       lifecycle, map, player, target
cursor snapshot     one 32x32 bitmap, hotspot, generation
toolbox snapshot    chat/cursor counters, first hero, observed panel state
party snapshot      fixed-capacity party entries
agent snapshot      filtered bounded agents
skill/effect state  bounded domain collections
event ring          only for state a tick snapshot can miss
command gateway     absent until an exact game-owned safe point is certified
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
| Hook lifecycle | Observed | tick plus cursor/UI nested paths offline, reload, clean shutdown | one live three-entry run |
| Map/player | Observed | live identity, 201-unit movement delta | one live map transition |
| Target identity/distance | Observed | target ID 1 -> 12, loading invalidation offline | hostile/item/gadget and live map invalidation |
| Cursor | Observed | 79 publishes, 8 bitmaps, 25 hide/show, zero rejected | identify and dragged-item bitmaps |
| Cursor presentation | Shipped, default-on | offline Electron + `cursor-capture` | play on a fresh certified build |
| Target readout | Shipped, opt-in | decoder/readout unit suite | one live selected-target run |
| Party | Partial | bounded owned HeroID/AgentID offline | live first-owned-hero identity |
| Skills/recharge | Not modeled | none | locate skill context |
| Effects/conditions | Not modeled | none | locate bounded effect collection |
| Nearby agents | Partial array knowledge | player/target only | filtered collection ABI |
| Inventory/equipment | Not modeled | none | lifecycle and string decoding |
| Player chat event | Partial | exact dispatcher, scalar counter | bounded live message/map/reload run |
| Events/combat | Fixed dispatch, no generic ring | none | prove another event is needed |
| Game commands | Not safe | tick-time and arbitrary-UI dispatch both trapped live | certify one game-owned gateway before restoring a command |
| Packet-derived state | No packet hook | none | identify dispatch boundary |
| Extension modules | Intentionally deferred | none | extract after repeated modules |

Native DLL injection, GWCA pointers, Direct3D/ImGui rendering, and the Windows
plugin ABI are replacement work, not compatibility targets.

## Completion bar for a feature

A Enhancement feature is ready when:

- the exact-build evidence is canonical and tested;
- invalid/loading state cannot publish stale values;
- the automation observer stays below the renderer-time budget in
  `scripts/enhancements-live/acceptance.ts`;
- no raw pointer, packet, or memory slice crosses Electron IPC;
- cached startup does no transformation or network work;
- one bounded scenario proves the real semantic change;
- shutdown has no trap, rejection, unknown socket, or orphan process;
- the unsupported-build path remains fully playable.
