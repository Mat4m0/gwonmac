# WASM host and client certification

This document explains how `gwonmac` hosts the official Guild Wars WebAssembly
client. It also explains how the app enables build-specific repairs and tools.

Audience: contributors who change the Emscripten host, persistent game files,
client transforms, companion kernel, or certification workflow.

This document owns the stable architecture and failure rules. Code and tests
own exact hashes, function indices, table slots, addresses, message IDs, ABI
sizes, and time limits.

## Module contract

The official JavaScript glue reads one global `Module` object. Declare it with
`var` because the generated glue declares it again.

The host selects the official JSPI WebAssembly file through `locateFile`.
`gw://app` streams the selected module from disk. This permits streaming
compilation without first copying the complete file into main-process memory.

Each protocol request reads one immutable `ActiveClient`. The request cannot
mix a JS file, WASM file, snapshot store, or compatibility result from another
generation.

Production does not use Asyncify as a fallback.

Awaited image, DNS, saved-login, Steam, advertisement, age, and shop operations
always return promises. The preload exposes only the required capability. The
main process keeps validation and native ownership. Steam is the only federated
provider that the host advertises. Narrow unavailable advertisement and shop
objects satisfy two defective client absence checks.

## Persistent game filesystem

The renderer initializes one Emscripten IDBFS mount before the official client
enters `main()`.

The initialization performs these steps:

1. Mount IDBFS under the app-owned `gw://app` origin.
2. Restore existing data.
3. Create the Skills and Equipment template directories.
4. Set the working directory to the mount.
5. Persist the directory invariant.
6. Release the Emscripten run dependency.

Startup stops if restore or initial persistence fails. The app must not continue
with temporary memory while telling the player that files are persistent.

The host normalizes Windows path separators at the Emscripten file-operation
boundary. Paths must remain relative and must not contain traversal.

The mount stores Guild Wars preferences, build templates, screenshots, and chat
logs. The app has no arbitrary native-file bridge.

**Reset Saved Files** records a restart request. The next startup clears only
the owned IDBFS origin before it mounts. This action does not clear ArenaNet
chunks, application settings, or Keychain items.

The official client restores a large `Gw.dat` file into this synchronous
filesystem. Do not remove it or bypass IDBFS to reduce a memory chart. Measure a
proven filesystem replacement with [Diagnostics and performance](diagnostics.md).

## Derived client chain

The downloaded official module is always canonical. The app can create
rebuildable derived modules:

```text
verified official module
  -> certified file-compatibility transform
  -> optional certified Core and Tools transform
  -> selected module for this session
```

The app never edits the official artifact in place. A cache entry is not proof.
Reuse requires the bytes, metadata, capability profile, and shipped expected
hash to agree.

The two transforms use different input hashes. The second transform consumes
the first transform's output. They are not alternatives.

## File-compatibility transform

The official web client leaves required file operations incomplete. Without a
repair, template directories cannot be created or listed. Rename and delete can
also fail.

The deterministic transform connects only the affected call sites to bounded
IDBFS operations. It preserves the original routines for other callers.

The transform validates each complete changed caller. A change to control flow,
flags, path handling, or an unrelated call makes the proof refuse.

For every selected hash, one isolated utility process re-reads and verifies the
artifact. It writes no profile state. Known hashes take the same structural
path as unknown hashes.

A crash, timeout, changed file, malformed result, ambiguous match, unexpected
layout, or transform error means no proof. The app then serves the verified
official module.

The costly defect and recertification evidence is in `internal/upstream/`. Read
that archive before changing the transform.

## Effective feature status

Main reports the effective served status for file saving, native double-click,
cursor, Target, Party, Team Apply, Travel, Xunlai, aliases, and 4 GB mode. Each
optional feature is `available`, `off`, or `unavailable`; unavailable features
also say whether a Guild Wars update or a preparation failure caused the
refusal. The renderer never reconstructs these answers from settings, hashes,
or another feature.

The verifier returns independent feature facts. The runtime selects the largest
proved subset, removes Team Apply when Party is absent, and removes aliases when
both Travel and Xunlai are absent. It retries from the clean post-template
module after a feature-local failure. A common hook or final integrity failure
disables the dependent features while preserving independent proofs.

The renderer verifies the instantiated module's exact capability manifest.
Launch intent is not runtime proof.

## Certification authority

The isolated local semantic verifier is the sole runtime authority for file
compatibility, Core, and Tools capabilities. Compiled exact-build facts are
regression expectations only. Every requested capability is proved from the
selected official bytes and bound to their hash and the verifier ABI.

There is no remote certificate feed. A CI result, cache file, diagnostics file,
or GitHub issue cannot grant runtime authority.

An equivalent ArenaNet rebuild therefore needs no source change or application
release. A semantic change disables only the affected capability and its
explicit dependants. The official ArenaNet client remains playable.

[ArenaNet client compatibility](arenanet-compatibility.md) owns the proof rules,
feature refusal boundaries, retained evidence, and patch-day procedure.

## Required compatibility and optional Tools

Required compatibility has two certification stages. The file-compatibility
transform restores persistent template operations. Certified Core adds the
Guild Wars cursor and native double-click. These behaviors have no player
switch when their proof passes.

Optional Tools are off by default. The master **Enable optional Tools Beta**
setting selects a commands-capable derived module on the next start. The first
enable therefore requires a restart.

After that restart, these choices update during the session:

- **Apply teams in Guild Wars** controls only the fixed Team Apply operations.
  The local Tools panel and saved Build/Team library remain available whenever
  the master Tools setting is on.
- **Target distance and range** controls the shipped Test readout and its target
  observation.

Disabled optional observers stop their domain reads. Core cursor observation
stays active. A small map-policy projection remains active so the app can remove
optional behavior in PvP, guild halls, transitions, and unknown regions.

If live integration is unavailable, the host can still mount the saved-library
part of Tools. Players can edit, import, and export builds and teams. Live party
observation, storage opening, and Apply remain unavailable. This host-only
surface does not become certification authority.

## Companion architecture

The Core and Tools transform installs one fixed dispatcher. It preserves each
game-owned original and calls that original exactly once before optional
observation.

One dependency-free Rust `no_std` side module reads bounded game memory. It has
no game-function imports. It cannot call back into Guild Wars from an observer.

The renderer allocates one bounded private block for the companion's data and
stack. A separate private table satisfies the side-module ABI. The companion
does not consume an existing game table entry for its own table.

The build verifies the kernel's ABI, imports, exports, private memory, lack of a
start function, and reproducible output. The renderer checks its hash before
compilation.

The companion publishes fixed-size typed snapshots. A sequence lock rejects
torn reads. Snapshots contain scalar values and no pointers. No per-frame memory
view crosses preload or IPC. Domain modules own decoding and presentation;
`certified-companion-installation.ts` owns only installation and teardown.

The snapshot publishes Xunlai access as a tri-state value. `true` means the
snapshot confirmed PvE, a non-guild-hall outpost, the current player's matching
record, and a clear access-denied flag. `false` means a fresh observation
confirmed an ineligible region, map, or player record. `null` means the proof is
missing, loading, contradictory, or stale. The storage gate uses this game
snapshot directly. A storage-only profile allocates no party observer or party
buffers, so a missing or broken roster cannot enable or disable storage.

Do not add a generic hook registry, plugin loader, raw memory API, arbitrary
function call, shared-memory packet bus, or second game model.

## Command boundary

Team Apply, Travel, Xunlai, and chat aliases are separate certified
capabilities. Travel and Xunlai share a private bounded game-thread mailbox and
drain implementation, but each has its own proof, setting, manifest status, and
runtime gate. Chat aliases are effective only when at least one of those local
actions proves, and parser generation includes only commands backed by proved
actions. The profile exports no generic opcode, packet, dispatcher, or address
surface.

The same named storage action backs the Tools button and Command-Shift-C. It
queues a fixed `{ agent: 0, type: 0, data: 3 }` DataWindow payload, then calls
the certified client DataWindow handler at the existing game-thread drain. It
does not send that payload to ArenaNet. The action is enabled only with its
separate Tools setting and a fresh snapshot that proves the current player is
in a supported PvE outpost and can access storage. Every snapshot update
resynchronizes the action, so loading, character, account, and map transitions
revoke stale access immediately.

The player-record access proof is an optional, all-or-nothing feature
certificate. If it is absent, its six configuration words are zero and the
kernel can publish only `null` for Xunlai. A separately proved Travel dispatcher
remains usable; no party-state fallback is allowed.

Travel accepts only four bounded scalar values: map, region, language, and
district. The exact `/tp` command sets one named, one-shot palette toggle that
the renderer takes and clears. Search text, aliases, destinations, and numbered
shortcuts stay in the host-owned Vue interface. At the certified frame drain,
the transform writes the four words to its installer-owned payload. It then
calls the exact client Travel dispatcher with `kTravel`. It cannot dispatch
another client UI message.

Team Apply requires enabled Tools and Apply teams in Guild Wars, a proved Team
Apply capability, a positively classified PvE outpost, fresh party state, and
an explicit player action.

The runner checks policy before each command and while it confirms results. A
map transition or policy change stops the operation. A refusal is an explicit
result. It is not inferred from a command builder's return value.

The companion remains read-only. Command construction and confirmation stay in
their named domains.

## Patch-day flow

The scheduled workflow detects ArenaNet code changes, runs the isolated
per-feature verifier, and retains signed machine-readable evidence. It never
uploads ArenaNet client bytes and cannot grant runtime authority. Equivalent
rebuilds require no source PR; a refusal opens a tracking issue naming the exact
failed invariant.

Follow the complete [patch-day playbook](arenanet-compatibility.md#patch-day-playbook).

## Failure and teardown

Installation validates the manifest, exports, table, kernel ABI, and allocation
ranges. It enables dispatch last.

Teardown uses the reverse safety order:

1. Disable dispatch.
2. Stop observers and UI.
3. Clear the callback only when its identity matches.
4. Free owned regions.
5. Drop references.

Failure falls back to the strongest proven earlier stage. A Tools failure uses
the file-compatible module. A complete certification failure uses the official
module.

Use [Enhancement development](enhancement-development.md) for change and
recertification procedures.
