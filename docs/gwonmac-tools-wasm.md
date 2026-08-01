# GWonMac Tools on the Electron/Wasm client

GWonMac Tools is independently developed. GWToolbox++ and GWCA are research
references; their Win32 hooks, Direct3D renderer, DLL loader, scanners, and C++
object graph are not compiled or vendored here.

The maintained shape is one deterministic game transform and one dependency-free
Rust `no_std` companion:

```text
exact post-template Guild Wars module
  -> clone tick, cursor, and UI-dispatch originals
  -> three disabled-direct / enabled-indirect wrappers
  -> one fixed (i32 x 6) dispatcher in table slot 0
  -> one Rust kernel over the game's existing memory
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
| `toolbox.rs` | developer chat/hero state and the typed hero-panel command |
| `lib.rs` | original-call ordering, world collection, dispatch, and exported ABI |

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
| Shared callback | sole empty fixed table slot 0 |
| Player chat | `ChCliApi` function 8947, three `0x10000082` sites calling 6842 |
| Neighbor messages | functions 8942/8945 emit `0x1000007f`/`0x10000080` to 6842 |
| Hero panel | Hide `0x100001a3`, Show `0x100001a4`, argument is current owned HeroID |

The static addresses and relative structure fields live only in
`src/main/core/enhancement-builds.ts`. Message IDs are build-local too. The
transform serializes the ordered memory fields and those three IDs into one
`configWords` array; Rust contains no unversioned copy.

## Dispatch and original-call rule

The transform appends a common `(i32 x 6) -> void` type, clones the three exact
functions, replaces their bodies, and exports the clones. With the hook global
at zero, each wrapper calls its clone directly once. With the hook enabled, it
calls only the Rust dispatcher and pads unused arguments with zero.

Rust selects the branch by a fixed kind:

- tick: call the tick clone, then collect enabled state and execute one queued
  typed command;
- cursor: call the cursor clone, then mark the cursor dirty;
- UI: call the UI clone, then observe only certified scalar message IDs.

Post-work does not run if an original traps. No mutable Rust borrow is held
across an imported game call, so synchronous nested dispatch cannot alias
kernel state.

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
hero owned by the current player, and publishes only HeroID/AgentID/count.
Chromium can enqueue Show or Hide through one boolean export. The next game tick
revalidates the roster and calls the relocated UI original with the certified
message and HeroID. Chromium never calls a game function directly.

The developer snapshot is fixed at 64 bytes and contains only the two counters,
first-hero scalar state, panel state, and command request/result numbers.

## Installation and failure behavior

The renderer validates the one manifest, game exports, table identity, kernel
import surface, kernel ABI, and kernel-owned sizes. It allocates through the
game, instantiates Rust, creates consumers, installs slot 0, publishes the
runtime, and enables the global last. Teardown reverses safety order: disable,
stop observers and UI, clear slot 0 only by callback identity, free regions,
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
