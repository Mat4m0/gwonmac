# GWonMac Tools on the Electron/WASM client

Certification baseline: official Guild Wars WASM build 38,771, SHA-256
`b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483`.

## Relationship to GWToolbox++

GWonMac Tools is independently developed and maintained as part of GWonMac. It
is not GWToolbox++, and the GWToolbox++ developers are not responsible for it.
GWToolbox++ cannot be injected or recompiled unchanged: it is a 32-bit Windows
DLL coupled to Win32, Direct3D 9, MinHook, native GWCA, and native plugin DLLs.
The Electron client instead implements selected feature behavior with a small
renderer-local companion WASM. Main continues to own only native platform
capabilities.

The first developer-only foundation is operational:

```text
official exact-hash WASM
  -> one-function deterministic transform
  -> freestanding no_std companion WASM
  -> versioned seqlock snapshot
  -> structured Map/Player and Target Info state
```

Unknown hashes serve the official client unchanged and do not activate
enhancement. Official and transformed client binaries are never committed.
A session with every tool off runs none of this path and presents no enhancement UI.
The cursor and target readout are selected independently: the cursor is on by
default, while the readout is off. Only the selected tool is collected and
presented; `docs/internals.md` owns the pipeline and `docs/user-guide.md` owns
what the player is told.

## Certified build 38,771

| Invariant | Certified value |
| --- | --- |
| Browser-driven game loop | exported function `EmscriptenExeThreadMainLoop`, index 446 |
| Hook signature | `(i32) -> void` |
| Hook table slot | existing null slot 0, encoded as global value 1 |
| Context root | `0x5a0e20` |
| Agent array | `0x5a4d98` |
| Manual target agent ID | `0x5a388c` |
| Automatic target agent ID | `0x5a3888` |
| Live map proof | map 133 / Outpost |
| Live target proof | Living agent, stable ID/position/distance/range |

The archived GWCA `FrApi.cpp` / `!s_bufferBits` anchor resolves to function
6656, but live certification rejected it as a tick hook: it ran once during
startup. Its direct caller chain leads into the client startup/download path.
The semantic exported main-loop function is both narrower and more stable.

## Production transform

`src/main/core/enhancement-builds.ts` is the one source of build-local truth.
`enhancement-transform.ts` verifies the exact hash, signature, table limits, and
empty slot before cloning only the selected function. It adds:

- a relocated original function export;
- one mutable hook-slot global;
- one manifest custom section consumed by the renderer.

The official file remains untouched. `client-module.ts` owns the complete
official → template-save → optional enhancement chain. It consumes the exact build
records selected during certification and atomically caches each derived
module by its input hash, transform ABI, and build-manifest fingerprint. A
corrupt or stale cache is rebuilt; an enhancement failure falls back to the verified
template-save module. The transformer remains a deterministic byte-to-byte
operation. The manifest's canonical ordered layout fields generate the
embedded layout words consumed by the renderer, avoiding a second ABI ordering
table.

The earlier all-functions dispatcher and table-growth experiments were removed.
Build 38,771 already has one unused table slot, so no table rewrite is needed.

## Companion and snapshot

`src/companion-kernel/lib.rs` is dependency-free Rust `no_std`, compiled to
`wasm32-unknown-unknown`. It imports game memory and the relocated original
loop function. Runtime installation:

1. allocates the config and 64-byte snapshot through the game's `malloc`;
2. instantiates the companion against the exported game memory;
3. verifies table slot 0 is still null;
4. installs the companion callback;
5. enables the dispatcher last.

The callback calls the original exactly once before collecting state. Every
pointer, range, array, map, agent ID, type, and coordinate is validated.
Loading or invalid state publishes flags with zeroed optional fields.

Snapshot ABI v1 contains magic/version/size, an odd/even sequence lock, status
flags, tick count, map/instance, player ID/position, and target
ID/type/position/distance/range. The renderer accepts only two identical even
sequence reads. No raw pointer, memory view, packet, or per-frame state crosses
Electron IPC.

## Live acceptance

`GW_LIVE_SMOKE=1 pnpm enhancements:live` launches Electron directly—not through a
temporary Playwright profile—and the app blocks updater work unless its
effective user-data directory exactly matches the existing Guild Wars profile.
It uses milestone/DOM state, captures an image only on failure, and never closes
the app after a timeout or failed probe.

The certified run proved:

- exact build activation and continuous hook execution;
- Map/Player state and movement-sensitive coordinates;
- Target Info for a Living party target;
- corrected Euclidean distance and semantic range;
- no renderer errors or per-frame IPC;
- clean application shutdown.

## Port boundaries and next order

Do not port the injector, native launcher, Win32 input hooks, Direct3D backend,
native updater/crash dumps, or DLL plugin ABI. Use the Electron lifecycle,
renderer overlay, diagnostics, and an eventual explicit renderer/WASM plugin
contract only after core features justify it.

Next feature work should remain read-only: enrich validated agent snapshots,
then port one high-value widget at a time. Add events only where polling the
already-produced snapshot cannot meet a feature, and introduce game commands
individually with explicit preconditions and failure tests.

## Analysis tools

```bash
python3 tools/wasmscan.py Gw.jspi.wasm "!s_context"
python3 tools/gensyms.py Gw.jspi.wasm build/
python3 tools/gwca_anchor_probe.py path/to/GWCA/Source Gw.jspi.wasm
pnpm enhancements:transform -- Gw.jspi.wasm build/Gw.enhancement.wasm
```

The repeatable development loop, live safety gates, scoped observations,
recertification procedure, and feature readiness register are defined in
[`enhancement-development.md`](enhancement-development.md).
