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
client, exact WASM hash, transformed cache, saved-login presence, and complete
snapshot filename presence. It verifies executable artifacts, but labels
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

The default is cached-only. Main skips the client updater, and the chunk store
is physically unable to fetch a missing chunk. `--allow-update` is the explicit
escape hatch for a deliberate ArenaNet client update. `--leave-open` keeps a
successful run visible. Failures and timeouts always leave Electron open and
write a screenshot plus bounded logs under `test-results/toolbox-live/`.

The harness launches Electron directly with the normal Guild Wars profile,
verifies the effective user-data directory in main before startup, connects to
the random loopback DevTools endpoint, and observes structured renderer state.
It never launches through Playwright's temporary Electron profile.
Its parent-process IPC channel can only start and stop Level 1 diagnostics when
the explicit Toolbox automation environment is active; capture mutation is not
exposed to the sandboxed renderer.
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

`performance` takes two Level 1 captures and exact animation-frame samples:
60 seconds with the hook slot disabled, then 60 seconds with the hook enabled.
It reports p50, p95, p99, maximum frame time, long-frame counts, renderer
task/script/layout time, JavaScript heap use, and hook calls. It requires at
least 2,500 frames per phase and fails when both p95 and p99 regress by more
than 2%, when p95 moves by more than 1 ms, or on a torn snapshot. Requiring
corroboration from both tail percentiles avoids treating normal outpost
variance or a single 0.1 ms-quantized scheduling boundary as a Toolbox
regression.
The baseline isolates the incremental companion/snapshot-observer cost; it still
uses the already transformed game module and its disabled dispatcher branch.
The result also requires zero hook ticks in baseline and at least 2,500 hooked
ticks, so a disconnected benchmark cannot pass. Task and heap values are
diagnostic rather than gates because garbage collection and unrelated game
work can move them between phases.

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

Inspect an official candidate without transforming it:

```bash
pnpm toolbox:recertify -- path/to/Gw.jspi.wasm
```

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

| Domain | Foundation | Live evidence | Next proof |
| --- | --- | --- | --- |
| Hook lifecycle | Ready | continuous tick, reload, clean shutdown | one live map transition |
| Map/player | Ready | live identity, 201-unit movement delta | one live map transition |
| Target identity/distance | Ready | target ID 1 -> 12, loading invalidation offline | hostile/item/gadget and live map invalidation |
| Cursor | Ready | 79 publishes, 8 bitmaps, 25 hide/show, zero rejected | identify and dragged-item bitmaps |
| Presentation prototype | Developer-only | deterministic fixture | future product decision |
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
- the automation observer stays below its renderer-time budget;
- no raw pointer, packet, or memory slice crosses Electron IPC;
- cached startup does no transformation or network work;
- one bounded scenario proves the real semantic change;
- shutdown has no trap, rejection, unknown socket, or orphan process;
- the unsupported-build path remains fully playable.
