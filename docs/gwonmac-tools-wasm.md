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
| `toolbox.rs` | developer chat and read-only hero/panel state |
| `lib.rs` | world collection, post-original dispatch, and exported ABI |

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
| Hero panel | Hide `0x100001a3`, Show `0x100001a4`, argument is current owned HeroID |
| Party dirty set | Hero agent/data `0x10000038`, `0x10000039`; map loaded/context/start/change `0x1000008c`, `0x10000098`, `0x100000c2`, `0x10000111`; party add/remove hero/player `0x1000011e`, `0x1000011f`, `0x10000124`, `0x10000126` |

The static addresses and relative structure fields live only in
`src/main/core/enhancement-builds.ts`. Message IDs are build-local too. The
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

The developer hero example validates the live party array, selects the first
hero owned by the current player, and publishes only HeroID/AgentID/count. It
also observes certified Show/Hide messages emitted by normal game actions. It
deliberately has no Show/Hide command: live experiments proved that calling the
UI dispatcher after a tick lacks `PropContext`, while consuming an arbitrary
later UI event can re-enter a still-active text-parser producer. The companion
never calls a game function or writes the game's PropContext slot.

The developer snapshot ABI 2 is fixed at 64 bytes and contains only the two
counters, first-hero scalar state, and observed panel state.

The developer surface is a same-renderer Chromium overlay, not an injected game
frame or a second Electron window. It is a non-modal palette: the overlay root
never intercepts the pointer, so the game keeps owning every click that is not
on Tools chrome, and the open panel floats beside play instead of blocking it.
Keyboard focus follows the click — opening exits pointer lock, keyboard and
pointer events inside the panel stop at the overlay boundary, and clicking the
canvas hands keyboard input straight back to the game while the panel stays
open. Held game input carries across the transfer: a movement key held while
clicking into the panel keeps acting, and the input host replays its eventual
release at the canvas, so a press the game received can never stay stuck. The panel drags by its titlebar and keeps its
position for the session. Escape closes it only while it has focus; Close and
the Control+Shift+Space chord work from anywhere. Moving focus between the
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

Unknown builds run the official client unchanged. Template save may be
shape-recertified locally, but Enhancement is exact-build only until a future
verifier independently recovers every hook and address. A common relocation
alone is not enough evidence for that decision.

This fail-closed behavior is the last safety net, not the desired update
experience. ArenaNet update continuity needs three operational layers:

1. a scheduled canary detects a new official hash before or immediately after
   rollout and preserves only bounded structural evidence;
2. the recertifier derives hook and layout candidates from semantic anchors and
   runs the complete offline transform/kernel suite;
3. a bounded live confirmation promotes the new exact certificate in an app
   update.

The official client remains playable throughout. Automatic relocation is safe
only for fields independently recovered by their own anchors; accepting one
shared address delta for the entire tool bundle would turn update continuity
into silent memory corruption.

## Commands

```bash
pnpm enhancements:kernel:verify
pnpm enhancements:recertify
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario toolbox-foundation
```

The kernel verifier checks its exact imports/exports, single imported game
memory with no exported memory/table, ABI sizes and arities, and byte-for-byte
reproducibility. The recertifier
reports `bundleVerified: true` only when the exact certificate passes the full
production transform.

The broader workflow and live safety rules are in
[`enhancement-development.md`](enhancement-development.md).
