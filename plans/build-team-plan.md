# Team builds and build authoring on the certified foundation

Status: plan, 2026-08-06. Extends
[the Toolbox architecture ledger](research-tool-architecture.md); it does not
supersede or relax anything in it.

## Decision

Build authoring and team management land as a Vue panel mounted **inside** the
existing Toolbox overlay, on the certified enhancement path already on `main`.

The work splits into two tracks that run independently:

| Track | Delivers | Depends on a new game capability |
| --- | --- | --- |
| **A — the panel** | Library, authoring, teams, templates, design system, settings | No |
| **B — the command** | The certified write path that makes *Apply team* real | Yes |

**Track A must not wait for Track B, and Track B must never be shortened to
unblock Track A.** Track A ships a panel whose *Apply team* control is visibly
unavailable with a stated reason. Track B, if and only if it passes the ledger's
admission gate, turns that control on. If no natural gateway can be proved, the
panel stays useful and honest: builds and teams are authored, saved, and written
as game templates, and the player loads them.

This is the same separation the ledger already requires — observation and
control are distinct, and control is admitted per command, never as a bus.

## Why *Apply team* is not simply implemented

The obvious route is closed by evidence, not by caution. The certified
`uiDispatcher` (`#6842`) is an excellent observation boundary and a **rejected**
command gateway:

| Experiment | Result | Status |
| --- | --- | --- |
| Call the UI dispatcher from the main-loop hook | `s_propContext` assertion | **Rejected** |
| Save/install a guessed context, send after a later UI event | Visible delay; `TextParser::IsParam` abort | **Rejected** |
| Reuse statically empty table slot 0 | Live `function signature mismatch` | **Rejected** |
| Link the side module at fixed memory `0x100000` | Writes to unreserved game memory | **Rejected** |

Static tracing explains why: main loop `#446` clears `PropContext`, so being on a
tick supplies no valid UI context; the chain `#6842 -> #6535 -> #6507 ->
call_indirect` proves dynamic dispatch and reentrancy potential; "the next UI
event" can be inside a text-parser producer; and one guessed global cannot
recreate caller-specific parser data, JSPI altitude, reentrancy state, or object
lifetime.

The companion kernel is therefore observe-only today, by design:
`src/companion-kernel/toolbox.rs` states that the only address it writes is the
host region validated by `companion_init`.

## What already exists — do not rebuild it

| Asset | Where | Role in this plan |
| --- | --- | --- |
| Toolbox overlay | `src/renderer/toolbox-foundation.ts` | The input/focus/cursor **boundary**. The Vue panel is its content. |
| Certified enhancement pipeline | `src/main/certification/*`, `src/companion-kernel/*` | How any capability is admitted. |
| Capability model | `ENHANCEMENT_PROGRAMS`, `ENHANCEMENT_CAPABILITY_PROFILES` | Where the panel's gating belongs. There is no new `teamManagement` enhancement flag. |
| Template engine | PR #109 (`feat/build-template-import-export`) | The proven write-to-game route. |
| Builds domain | `src/shared/builds/*` on `vue-tools-consolidated` | The model, validation, and plan resolution. |
| Vue workspace | `apps/tools/*` on `vue-tools-consolidated` | The panel itself. |
| UI token system | `src/shared/ui/tokens.css`, `components.css` | One source of truth for colour, shared by harness and panel. |
| Trace tooling | `scripts/wasm-trace-spike.ts`, `tools/wasmscan.py` | Track B's discovery instrument. |

`toolbox-foundation.ts` says of itself that there is "deliberately no widget
registry, plugin surface or layout engine behind it — a second tool can
introduce one when it exists and needs it." This panel is that second tool. It
introduces the UI layer; it does not touch the boundary.

## Track A — the panel

Each stage is a reviewable commit series that leaves the tree green.

### A1 — land the template engine

Rebase PR #109 onto current `main` and reduce it to its engine.

- **Keep**: `src/renderer/template-format.ts` (pure text rules),
  `template-store.ts` (the IDBFS mount, absolute paths),
  `src/main/template-export.ts`, the channels `gw:templates:export` and
  `gw:clipboard:readText`, the hostile-corpus escape test, and the recorded
  client defects.
- **Drop**: `src/renderer/template-pane.ts` and its Settings-pane DOM. The panel
  replaces that surface in A5.

Three client behaviours discovered live must survive the reduction, because no
fake `FS` can rediscover them: the client caches its template scan and shows
nothing until *Refresh List*; the scan never descends into a subfolder; and
`filesystem.ts` chdirs into the mount, so later callers must address it
absolutely.

Acceptance: `pnpm check` passes; the import-escape and template-format suites
pass unchanged; no Settings pane ships.

### A2 — the builds domain and the workspace

Bring across, unchanged where possible:

- `src/shared/builds/*` — eight modules, none of which exist on `main`.
- `apps/tools/*` — the Vue workspace, 21 vitest cases.
- Workspace wiring: `package.json`, `tsconfig`, `eslint.config.js`,
  `scripts/build.mjs`.

Nothing on `main` is modified, so there is no merge to resolve. The panel runs
standalone through `apps/tools/src/standalone.ts` and `pnpm tools:dev`, against
fixtures, with no Electron involvement.

Acceptance: `pnpm tools:test` 21/21; `pnpm --filter @gwonmac/tools-ui typecheck`
clean; the panel is clickable in a browser.

### A3 — the UI token system

Bring `src/shared/ui/tokens.css` and `components.css` across and re-point both
consumers at them.

This is the one stage that is a genuine merge rather than a port: both sides
rewrote the same stylesheets.

| File | This work | `main` since the fork |
| --- | --- | --- |
| `src/renderer/harness.css` | +237 / −286 | +105 / −35 |
| `src/renderer/index.html` | +146 / −45 | +102 / −70 |
| `src/renderer/settings.ts` | +75 / −0 | +97 / −64 |
| `src/renderer/loading.css` | −3 | +144 / −77 |

Resolve by hand, stage by stage, keeping `main`'s newer harness behaviour and
this work's token indirection.

Acceptance: `tests/unit/the-ui-system-has-one-place-to-change-a-colour.test.ts`
passes; `pnpm ui:sweep` produces no unreviewed visual change; `docs/ui-gallery.html`
renders.

### A4 — appearance settings

Bring `src/renderer/appearance.ts` and the `uiTheme`, `uiDensity`,
`uiPanelOpacity`, `uiBorderWidth`, `uiRadius` settings across on top of A3.

These are additions to `AppSettings` and `DEFAULT_SETTINGS`. Re-express them
against `main`'s current shapes rather than merging them textually — `main`
rewrote `contracts.ts` by +377/−35 since the fork.

Acceptance: `tests/unit/appearance.test.ts` and `settings.test.ts` pass; the
Electron settings spec passes; a theme change is visible in both the harness and
the panel from one token edit.

### A5 — mount the panel in the Toolbox

Replace the overlay's three placeholder rows with the Vue app.

- The overlay keeps ownership of the boundary: the toggle chord, the event
  stops, pointer-lock release, cursor mirroring, drag, focus transfer, teardown.
- The panel mounts into the existing `panel` element and receives
  `ToolboxState` as props. It asks the game for nothing.
- Gating is the existing `toolbox` capability. No new enhancement flag is added.
- Persistence is the build library through its IPC channels, re-expressed
  through `main`'s canonical channel registry so the generated preload and the
  `EVENT_CHANNELS` invariant both hold.
- *Apply team* renders **disabled**, with the reason stated in the UI: the write
  capability is not certified. Templates are the working route.

Acceptance: the panel opens on the chord over a running client; every click
outside its chrome still reaches the game; `tests/electron/input-toolbox.spec.ts`
passes unchanged; teardown leaves no listener and no held input.

## Track B — the certified command

Track B exists to answer one question: **is there a natural game-owned execution
boundary that can drain one typed team-apply intent?**

Reference research has now largely answered it, and the answer changes the
odds. Three findings, each from a shipping implementation:

**1. The rejected route was the wrong route, not the only route.** GWToolbox++
never uses a UI dispatcher as a command gateway. Its hero-build load defers
every action onto a queue drained from a game-thread callback hooked on the
engine frame API (`p:\code\engine\frame\frapi.cpp`, `!s_bufferBits` +0x5f) —
not the render path and not UI dispatch. Its per-hero sequence is a state
machine: `AddHero` → poll until the hero appears in *both* `PartyInfo::heroes`
and `WorldContext::hero_flags` → `LoadSkillTemplate(agent_id, code)` →
8× `SetHeroSkillDisabled` → show/hide hero panel → `SetHeroBehavior`. Outpost
only, kick-all first, bounded by timeouts.

**2. `PropContext` is solvable, and the ledger's objection was precise.** It
rejected *guessing* a context. GWCAjs — which targets this same Wasm client —
installs a **structurally validated** context root into the slot `PropGet`
reads, runs the call, and restores the previous value in `finally`. The root is
rediscovered per load by pointer-relationship anchors, never a constant, and
only calls whose decompiled body reaches `PropGet` are wrapped.

**3. Target selection matters more than scheduling.** GWCAjs deliberately calls
low-level packet builders rather than the high-level wrappers, because the
wrappers "enter an incompatible asyncify/prologue path" — which this client has,
being JSPI. It also records that calling the lowest sender is *not* sufficient
on its own: `MsgSendLeave` returned normally without leaving the party, because
the real button also ran two further calls.

Against that, the existing work is further along than it looks. The eight
dispatch functions are already certified for build 38,797 — hero add `6883`,
kick `6884`, difficulty `6885`, secondary profession `6914`, attributes `6870`,
skillbar `6940`, behaviour `6875`, skill toggle `6878` — chosen as context-free
dispatchers rather than veneers. The kernel state machine already matches
GWToolbox++'s shape. What failed was the execution point and the fabricated
context, and both now have an evidenced alternative.

This does not lower the admission bar. Every requirement below still applies,
and a live promotion still comes last. It means the honest expectation is a
command that can be certified, not a research track likely to end in Rejected.

Two portability facts constrain any of it: function indices are **not** portable
across builds — GWCAjs records cluster-local deltas of −2/−6/−7/−9 between
adjacent builds and a real fault from reusing stale ones — and its runtime gate
therefore refuses to patch unless the build id, section counts, and *every*
patched function's Wasm type index match the manifest. Whatever we build
inherits that fail-closed rule.

The ledger's target shape is already drawn, and this work adopts it verbatim:

```text
Chromium control
      |
      v
typed, bounded scalar intent
      |
      v
one outstanding typed intent slot
      |
      v
certified natural game-owned command drain
      |
      v
exact domain function with validated preconditions
      |
      v
normal game event marks state dirty
      |
      v
snapshot confirms the result
```

`TeamApplyPlan` in `src/shared/builds/team-apply.ts` is already that typed,
bounded intent: professions, attributes, eight skill ids, behaviour, and
disabled slots per member — no pointers, no packets, no raw memory. It arrives
from A2 needing no redesign.

### B0 — discovery

Answer ledger open question 2, which is exactly this domain: *which exact events
cover a complete player and hero build change, especially template application
and attributes?*

Instrument with the trace tooling this work already carries —
`scripts/wasm-trace-spike.ts`, the breakpoint observer, and `tools/wasmscan.py`
— against build 38,797. Record every candidate at its evidence grade. Nothing is
promoted on a signature match alone.

Acceptance: a written candidate list with grades, or a recorded finding that no
candidate reaches **Candidate** grade.

### B1 — the gateway

Answer ledger open question 3, now with two candidate shapes rather than none:

- **The frame-API drain.** Locate this client's Wasm equivalent of the engine
  frame-API function GWToolbox++ hooks, and drain one intent there. This is the
  natural game-owned execution point the ledger asked for.
- **The validated context wrapper.** For calls that reach `PropGet`, install a
  structurally validated context root around the call and restore it after, as
  GWCAjs does — validated by pointer-relationship anchors, never a constant, and
  never fabricated.

Both must be proved against build 38,797 specifically. Neither is inherited from
the reference implementations as a certificate; only the method is.

**If no natural gateway is proved, Track B stops and is recorded as Rejected.**
That remains a successful outcome.

### B2 — the intent slot

Only after B1. Add to the kernel:

- `FEATURE_TOOLBOX_APPLY` alongside the existing three feature bits.
- A host→kernel command region mirroring `ToolboxSnapshot`: one outstanding
  typed intent, sequence-guarded, drained at the certified boundary, never in an
  arbitrary observer.
- Busy, cancellation, and rate behaviour; completion or rejection observable
  only through normal game state.

The original observer dispatch stays independent and runs exactly once.

### B3 — certification

Each capability combination is a distinct certified identity. Adding a write
capability adds `outputSha256` entries, config words, and a capability profile,
and moves `ENHANCEMENT_TRANSFORM_ABI` and the companion ABI.

Every one of the ledger's ten admission requirements must pass before any live
run: exact function identity and full Wasm type; certified execution point and
call altitude; the gateway owning its own context and reentrancy rule; loading,
map, ownership, lifetime and argument preconditions; fixed typed arguments;
one-outstanding-intent and rate behaviour; observable completion; independent
observer dispatch; malformed and stale fixture rejection without calling the
game; and one command at a time in a bounded live promotion.

### B4 — bounded live promotion

One command, one scenario, one build. Hero panel visibility is explicitly not
automatically the first candidate; the first candidate is whichever command B1
actually proved.

Acceptance: typed request, exact context, precondition rejection,
normal-event confirmation, no arbitrary call or memory surface, and
disable-first teardown.

## Second sources of truth to remove

This work carries duplicates of things that now exist better elsewhere. Each is
a deletion, not a migration:

| Delete | Because |
| --- | --- |
| `src/renderer/build-projection.ts`, `src/renderer/tools-host.ts` | An older, weaker template writer. A1's `template-store.ts` is the proven one. |
| The `teamManagement` entry in `ENHANCEMENTS` | The `toolbox` capability already gates this panel. Two flags for one thing. |
| `apps/tools` demo `applyTeam` stub | It returns `completedChanges: 0` after a timer. Until B4 the control is disabled, not faked. |
| `template-pane.ts` from PR #109 | Its surface becomes the panel in A5. |

## Verification

`pnpm check` is the inner loop for every stage: typecheck, lint, markdown links,
unit and policy tests, plus `pnpm tools:test`. A3 additionally needs
`pnpm ui:sweep`; A5 needs `pnpm test:electron`. Track B runs no live scenario
until B3 passes in full.

## Risks

- **A3 is the merge risk.** Two rewrites of the same stylesheets; budget review
  time and check it visually, not only by test.
- **Track B may still return nothing.** Reference research moved this from
  likely to unlikely, but every finding is about a different binary — a Win32
  client and a different Wasm build. Nothing transfers as a certificate. The
  plan is still built so a Rejected outcome costs Track A nothing.
- **Cross-build portability is unproven.** One official module is archived
  locally. Any certified command inherits the ledger's standing caveat that a
  single build cannot demonstrate relocation recovery.
- **Scope drift from A5 into B.** The panel will look ready for a working Apply
  button long before one is certified. The disabled control states its reason so
  the gap is visible rather than tempting.
