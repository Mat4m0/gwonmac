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

For an unknown hash, one isolated utility process re-reads and verifies the
artifact. It writes no profile state.

A crash, timeout, changed file, malformed result, ambiguous match, unexpected
layout, or transform error means no proof. The app then serves the verified
official module.

The costly defect and recertification evidence is in `internal/upstream/`. Read
that archive before changing the transform.

## Certification states

One owner in `src/main/certification/client-certification.ts` reports one of
three states:

| State | Meaning |
| --- | --- |
| `uncertified` | The app uses the official module. Build-specific file repair and live Tools integration are unavailable. |
| `template-only` | The file-compatibility transform passed. The exact Core and Tools transform did not pass. |
| `certified` | An exact Core and Tools certificate exists after the file transform. The requested runtime transform can still fail. |

Every consumer reads this result. The launcher, Settings, diagnostics, canary,
and maintainer command must not recompute it.

The compatibility state and effective activity are separate. If a requested
runtime transform fails, the state can remain `certified` while
`enhancementActive` is false. A table entry alone is not runtime success.

The renderer verifies the instantiated module's exact capability manifest.
Launch intent is not runtime proof.

## Certification authority

Compiled certification facts and the isolated local file-compatibility verifier
are the only runtime authorities.

The local verifier can authorize only the bounded file repair that it proves.
Core and Tools hooks use exact shipped certificates until each hook and address
can be recovered from an independent semantic anchor.

There is no remote certificate feed. A CI result, cache file, diagnostics file,
or GitHub issue cannot grant runtime authority.

New Core or Tools facts require an application release. When those facts are
missing, the official ArenaNet client remains playable.

## Required compatibility and optional Tools

Required compatibility has two certification stages. The file-compatibility
transform restores persistent template operations. Certified Core adds the
Guild Wars cursor and native double-click. These behaviors have no player
switch when their proof passes.

Optional Tools are off by default. The master **Enable optional Tools Beta**
setting selects a commands-capable derived module on the next start. The first
enable therefore requires a restart.

After that restart, these choices update during the session:

- **Team management** controls party observation, the Tools panel, and the
  fixed Team Apply operations.
- **Target distance and range** controls the shipped Test readout and its target
  observation.

Disabled optional observers stop their domain reads. Core cursor observation
stays active. A small map-policy projection remains active so the app can remove
optional behavior in PvP, guild halls, transitions, and unknown regions.

If live integration is unavailable, the host can still mount the saved-library
part of Tools. Players can edit, import, and export builds and teams. Live party
observation and Apply remain unavailable. This host-only surface does not become
certification authority.

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

Do not add a generic hook registry, plugin loader, raw memory API, arbitrary
function call, shared-memory packet bus, or second game model.

## Command boundary

The commands profile contains only named, certified team operations. It does
not carry a generic opcode or address.

Team Apply requires enabled Tools and Team management, an exact commands
profile, a positively classified PvE outpost, fresh party state, and an explicit
player action.

The runner checks policy before each command and while it confirms results. A
map transition or policy change stops the operation. A refusal is an explicit
result. It is not inferred from a command builder's return value.

The companion remains read-only. Command construction and confirmation stay in
the named team domain.

## Patch-day flow

The scheduled workflow detects ArenaNet code changes. It ignores normal content
changes. For a new generation it downloads verified code artifacts, runs the
file derivation, produces bounded candidate evidence, and opens a proposal.

Automation cannot publish a runtime certificate. A maintainer reviews the
evidence, runs offline proof and the minimum live semantic checks, and ships new
exact facts in an application release.

The workflow never uploads ArenaNet client bytes. It uploads reports and source
changes only.

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
