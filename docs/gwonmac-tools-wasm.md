# GWonMac Tools on the Electron/Wasm client

GWonMac Tools is independently developed. GWToolbox++ and GWCA are research
references; their Win32 hooks, Direct3D renderer, DLL loader, scanners, and C++
object graph are not compiled or vendored here.

The maintained shape is one deterministic game transform and one dependency-free
Rust `no_std` companion:

```text
exact post-template Guild Wars module
  -> clone tick, cursor, and UI-dispatch originals
  -> three original-first, optional post-observer wrappers
  -> one fixed (i32 x 6) dispatcher in appended table slot 4683
  -> one position-independent Rust side module with no game-function imports
  -> bounded game-memory reads only
  -> one allocator-owned 64 KiB block for Rust data and stack
  -> bounded typed snapshots
  -> Chromium cursor and developer proof UI
```

There is no generic hook registry, plugin loader, shared-memory packet ABI, or
second C++ engine.

## Source ownership

The companion is one Wasm instance, but it is not one source-code monolith:

| Module | Owns |
| --- | --- |
| `abi.rs` | fixed feature bits, layout words, snapshot structs, and size assertions |
| `memory.rs` | overflow-checked, bounds-checked volatile reads from game memory |
| `cursor.rs` | cursor dirty state, bitmap validation, conversion, and publication |
| `toolbox.rs` | bounded chat and party-summary observation |
| `party.rs` | player/hero builds, difficulty, and party publication |
| `lib.rs` | map policy, target collection, dispatch, and exported ABI |

Renderer ownership is similarly split. `enhancement-manifest.ts` validates the
derived module's fixed evidence, `companion-observer.ts` projects stable
snapshots, and `enhancements.ts` owns only transactional installation. Adding a
domain must not add its decoder, presentation, and command policy to that
installer.

## Exact build 38,797

The certificate consumes post-template SHA-256
`9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094`.

| Boundary | Exact evidence |
| --- | --- |
| Tick | function 446, `(i32) -> void` |
| Cursor event | function 2469, `(i32 x 5) -> void`, existing table slot 922 |
| UI dispatcher | function 6842, `(i32, i32, i32) -> void` |
| Shared callback | dedicated appended table slot 4683 |
| Player chat | `ChCliApi` function 8947, three `0x10000082` sites calling 6842 |
| Neighbor messages | functions 8942/8945 emit `0x1000007f`/`0x10000080` to 6842 |
| Party dirty set | Hero agent/data `0x10000038`, `0x10000039`; map loaded/context/start/change `0x1000008c`, `0x10000098`, `0x100000c2`, `0x10000111`; party add/remove hero/player `0x1000011e`, `0x1000011f`, `0x10000124`, `0x10000126` |

The static addresses and relative structure fields live only in
`src/main/certification/enhancement-builds.ts`. Message IDs are build-local too. The
transform serializes the ordered memory fields, three direct observer IDs, and
the ten dirty IDs into one `configWords` array; Rust contains no unversioned
copy. The dirty set covers hero-data readiness, every certified map-context
lifecycle boundary, and party membership mutation. Other calls through the
central dispatcher do not cause a party traversal; the 120-tick reconciliation
remains the bounded recovery path for a missed signal.

## Dispatch and original-call rule

The transform appends a common `(i32 x 6) -> void` type and clones the three
exact functions. Every replacement wrapper calls its game-owned clone first,
whether the hook is enabled or not. Only after that call returns does an enabled
wrapper notify Rust, padding unused arguments with zero. All three clones
remain private. The companion imports no game function and therefore cannot
re-enter Guild Wars from a callback.

Rust selects the branch by a fixed kind:

- tick: collect enabled state after the game tick;
- cursor: mark the cursor dirty after the game cursor event;
- UI: observe only certified scalar message IDs after the game dispatch.

Post-work does not run if an original traps. Normal game execution never enters
the side module and then re-enters a game clone, eliminating that cross-instance
call altitude from the client path.

The companion imports game memory because cursor and party state live there,
but its own memory is not allowed to land at linker-default addresses. It is a
position-independent side module: the renderer allocates one 64 KiB block with
the game's allocator and supplies that block as the module's data base and
stack. Its required table is a separate empty table. The binary verifier pins
the `dylink.0` requirement, absence of a start function, and proves that
instantiation leaves the former fixed `0x100000` game region byte-for-byte
unchanged.

## Three examples

The native cursor is the production example. The cursor callback is the dirty
signal, so the 4 KiB bitmap is hashed only after a game cursor event. Ticks do
only a show-count check when clean. After a trusted click, Chromium asks Guild
Wars for one zero-distance hit-test refresh only when the click produced no
cursor callback; this makes modes such as salvage visible without requiring
physical pointer movement.

The developer chat example observes the real player-chat event after its game
original. It saturating-increments one scalar. It never dereferences, stores,
logs, or publishes the pointer-shaped message arguments, so it counts local
server echoes as well as other players and does not claim sender identity.

The party observer validates the exact player agent and owned-hero roster, then
publishes only bounded scalar build state. The retired hero-panel visibility
experiment and its proof remain in `internal/archive/hero-panel`; production
does not observe or expose that state.

The developer surface is a same-renderer Chromium overlay, not an injected game
frame or a second Electron window. It is a non-modal palette: the overlay root
never intercepts the pointer, so the game keeps owning every click that is not
on Tools chrome, and the open panel floats beside play instead of blocking it.
Keyboard focus follows the intent to type, not the click. Opening exits pointer
lock but takes nothing else: the game keeps the keyboard, so a held movement key
keeps acting and the player can press more of them with the overlay open.
Operating a control — a button, a checkbox — does not take focus either; only
clicking into a text field does, which is the one gesture that means "I want to
type here". Keyboard and pointer events inside the overlay stop at its boundary,
and a release for a press the canvas received is replayed there, so a press the
game received can never stay stuck. Escape while typing returns the keyboard to
the game rather than closing anything; with the game focused it belongs to Guild
Wars. The overlay draws no window of its own — the tool it hosts brings and
drags its own — and the Control+Shift+Space chord, Command+B and the View menu
toggle it from anywhere. Moving focus between the
canvas and this one overlay is internal, so it does not run the client's
canvas-blur audio mute. A real application blur still follows the normal
input-release and audio behavior.

## Installation and failure behavior

The renderer validates the one manifest, game exports, table identity, kernel
import surface, kernel ABI, kernel-owned sizes, and pairwise-disjoint allocation
ranges. It zeroes the private runtime block, instantiates Rust, creates
consumers, installs slot 4683, publishes the runtime, and enables the global
last. Teardown reverses safety order: disable,
stop observers and UI, clear slot 4683 only by callback identity, free regions,
drop references.

Unknown builds start from the verified official artifact. A separate
template-save-compatible copy may be shape-recertified locally, but Enhancement
is exact-build only until a future
verifier independently recovers every hook and address. A common relocation
alone is not enough evidence for that decision. When Tools was selected, the
renderer still mounts the same native-library host with no observation or
command port. This preserves Build and Team authoring without loading the
companion kernel or granting the official module any optional capability.

This fail-closed behavior is the last safety net, not the desired update
experience. ArenaNet update continuity needs three operational layers:

1. a scheduled detector notices a new official build within the quarter hour and
   preserves only bounded structural evidence —
   `.github/workflows/client-recertification.yml`, described in
   [`wasm-host.md`](wasm-host.md);
2. the recertifier derives hook and layout candidates from semantic anchors and
   runs the complete offline transform/kernel suite;
3. a bounded live confirmation promotes the new exact certificate in an app
   update.

The official client remains playable throughout. Automatic relocation is safe
only for fields independently recovered by their own anchors; accepting one
shared address delta for the entire tool bundle would turn update continuity
into silent memory corruption.

## Apply boundary

The commands derivative contains only the fixed builders certified for team
configuration; there is no generic opcode or address courier. The renderer
requires the master Beta opt-in, Team Management enabled, a positively
classified PvE region, and a fresh outpost party before any command. The runner
applies and confirms difficulty first, then the player's secondary/bar/ranks,
then roster and hero builds. It rechecks policy before every send and during
every confirmation. PvP, guild halls, unknown regions, and map transitions
remove the optional UI and observer access while Core remains active.

Normal/Hard uses the exact opcode 155 builder. Hard Mode remains Beta until the
external unlocked-account matrix is recorded; a failed server-side eligibility
check is reported as a refusal, never inferred from the builder's return value.
Disabled hero-skill automation is not a released team field because no setter
met the same certification standard.

## Verification commands

```bash
pnpm enhancements:kernel:verify
pnpm certification recertify
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario toolbox-foundation
```

The kernel verifier checks its exact imports/exports, single imported game
memory with no exported memory/table, ABI sizes and arities, and byte-for-byte
reproducibility. The recertifier
reports `bundleVerified: true` only when the exact certificate passes the full
production transform.

The broader workflow and live safety rules are in
[`enhancement-development.md`](enhancement-development.md).
