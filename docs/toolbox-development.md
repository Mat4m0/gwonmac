# Toolbox development runbook

This is the working procedure for extending the Electron/WASM Toolbox. The
certified build manifest in `src/main/core/toolbox-builds.ts` is the only
runtime source of build-local addresses, signatures, and table slots.

## The short loop

Use the cheapest layer that can prove the change:

```text
transform/unit test
  -> synthetic kernel memory
  -> deterministic overlay fixture
  -> offline Electron
  -> one bounded live scenario
```

Most feature work should finish its first four layers without contacting
ArenaNet. A live run certifies semantics; it is not the primary debugger.

```bash
pnpm toolbox:doctor
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
```

For real CSS/layout feedback without a game or network session:

```bash
pnpm toolbox:visual -- target
pnpm toolbox:visual -- map
```

This launches an offline temporary profile, renders the real overlay markup and
CSS from a deterministic state, writes one screenshot under
`test-results/toolbox-visual/`, closes Electron, and removes the profile.

`toolbox:doctor` is local-only. It checks the existing profile, published
client, exact WASM hash, transformed cache, saved-login presence, and complete
snapshot residency. It never starts Electron or contacts ArenaNet.

## Live scenarios

Production-network work remains deliberate:

```bash
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario boot
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario target
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario movement
GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario reload
```

The default is cached-only. Main skips the client updater, and the chunk store
is physically unable to fetch a missing chunk. `--allow-update` is the explicit
escape hatch for a deliberate ArenaNet client update. `--leave-open` keeps a
successful run visible. Failures and timeouts always leave Electron open and
write a screenshot plus bounded logs under `test-results/toolbox-live/`.

The harness launches Electron directly with the normal Guild Wars profile,
verifies the effective user-data directory in main before startup, connects to
the random loopback DevTools endpoint, and observes structured renderer state.
It never launches through Playwright's temporary Electron profile.

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
map/player/target state, DOM writes, renderer p95, errors, and shutdown.

## Deterministic feature workflow

For every new field or widget:

1. State the user-visible behavior and the invariant that proves it.
2. Find candidates statically or with a bounded typed observation.
3. Add the exact-build layout value only after live evidence.
4. Add synthetic kernel cases for valid, loading, missing, corrupt, and
   non-finite state.
5. Extend or version the snapshot ABI.
6. Render a fixture and prove an identical sequence performs zero DOM writes.
7. Run one scenario that changes the value in the real game.
8. Record the remaining semantic coverage gap in this document.

Do not add direct renderer pointer chains, a parallel JavaScript probe, generic
memory writes, arbitrary function calls, or raw packet export.

## Scoped observations

The live scenario runner can compare at most 16 explicitly typed scalar
addresses before and after its action:

```bash
GW_LIVE_SMOKE=1 pnpm toolbox:live -- \
  --scenario target \
  --observe u32:0x5a1664,f32:0x123456
```

Allowed types are `u8`, `u16`, `u32`, `i32`, and `f32`. There is no string,
byte-range, pointer-walk, packet, or memory-dump mode. Observations stay in the
renderer and the compact before/after values return over the local DevTools
connection. Candidate observations are research evidence, never runtime truth.

Use controlled differentials:

```text
no target -> target -> clear target
stationary -> bounded movement -> stationary
outpost -> loading -> explorable
skill ready -> activated -> recharged
effect absent -> present -> removed
```

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
| Hook lifecycle | Ready | continuous tick, reload, clean shutdown | map transition |
| Map/player | Ready | live identity, coordinates, movement | live map transition |
| Target identity/distance | Ready | Living target | hostile/item/gadget/clear |
| Overlay presentation | Ready | real canvas integration | deterministic visual QA |
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
- the renderer performs no redundant work for an unchanged sequence;
- no raw pointer, packet, or memory slice crosses Electron IPC;
- cached startup does no transformation or network work;
- one bounded scenario proves the real semantic change;
- shutdown has no trap, rejection, unknown socket, or orphan process;
- the unsupported-build path remains fully playable.
