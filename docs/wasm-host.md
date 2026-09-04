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

## Controller prompt texture

The optional PlayStation prompt style is a renderer-owned presentation change.
It wraps only the official client's Emscripten `glTexImage2D` and full-atlas
`glTexSubImage2D` imports. It does not patch WebGL prototypes, edit `Gw.dat`, or
alter the verified client artifacts.

The replacement requires the certified WebGL content checksum for Guild Wars'
256×512 RGBA controller atlas. The surrounding client SHA, width, and height
are not proof. The older native TexMod/uMod checksum is not accepted at runtime.
A content mismatch, malformed heap range, unsupported upload, or missing import
passes the original call through unchanged. During a match, the host temporarily
places the app-owned pixels at the existing WASM pointer, calls the synchronous
upload, and restores the client bytes in `finally`.

A level-zero redefinition, partial or compressed update, texture deletion, or
WebGL context reset withdraws the remembered match. This prevents a reused or
changed texture from inheriting stale replacement state. Exact measurements and
the recertification procedure are preserved in
`internal/upstream/controller-prompt-atlas.md`.

The replacement atlas is one removable static PNG composed from Kenney's CC0
Input Prompts. Its byte hash and dimensions are pinned by policy tests, and its
provenance is recorded in `THIRD-PARTY-NOTICES.md`. The saved setting has one
source of truth; removing this feature later also removes the asset, wrapper,
UI choice, and setting. The ordinary settings reader then ignores the retired
key.

This is not a Tools or Enhancement capability. It reads no game state, sends
no command, and has no PvE/PvP policy. It is a launch-time renderer preference,
like render scale. An ArenaNet rebuild that retains the certified atlas content
keeps the setting working without an application release. An unknown atlas hash
passes through unchanged. Supporting changed atlas content requires reviewing
the new texture and adding its exact checksum; it never requires weakening the
matcher or changing the Enhancement contract.

In an unpackaged development build, `gwVirtualGamepad` can expose Guild Wars'
real gamepad UI without hardware. Run `gwVirtualGamepad.activateUi()` in the
game window's DevTools console. Buttons 0–3 are Cross, Circle, Square, and
Triangle. The helper preserves physical controllers, exists only when the
preload marks the launch as development, and restores `navigator.getGamepads`
on unload. Button methods send normal gamepad state to the official client, so
use them only in a safe test area.

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

Optional Tools are off by default. The master **Enable Tools Beta**
setting selects a commands-capable derived module on the next start. The first
enable therefore requires a restart. Every tool also has an individual switch.
The master setting must remain on for any tool surface, shortcut, or alias.

The persisted `gwonmacTools` value is desired state. The launch-time
`enhancementSelection.tools` value is the authoritative statement of what this
process loaded. Core selects a Core preload, registers no tool IPC, constructs
no optional store or network service, and reaches optional renderer and main
implementation only through uncalled dynamic imports. Shared validation,
settings fields, labels, disabled menu entries, and fixed companion ABI metadata
remain Core metadata. Tools implementation bytes may remain in the package.

Turning the master off during a Tools-capable launch immediately removes tool
surfaces, shortcuts, aliases, observers, commands, file access, and Trade
network activity. It does not restart the game. The difference between saved
state and launch selection is the pending-unload state shown in Settings. A
restart selects the Core preload and module graph; re-enabling before that
restart reactivates the already-loaded Tools runtime and clears the notice.

After that restart, these choices update during the session:

- **Build Library** controls the host-owned build and team surface, its
  Command-B shortcut, and the fixed Apply Team operations available in
  supported PvE outposts.
- **Trade Chat** controls the read-only Trade surface, Command-K, and `/trade`.
- **Travel** controls the palette, Command-T, and `/tp`.
- **Xunlai Storage** controls the named storage action, Command-Shift-C,
  `/chest`, and `/xunlai`.
- **Target distance and range** controls the shipped Test readout and its target
  observation.
- **Skill Key Labels** controls renderer-owned labels over the certified
  skill-slot rectangles. Saved bindings remain when the tool is off. The
  companion publishes geometry, not bindings, and the renderer never turns a
  label into game input.
- **Skill Cooldowns** controls the display of observed recharge numbers. Its
  saved colour remains when the tool is off.

Disabled optional observers stop their domain reads. Core cursor observation
stays active. A small map-policy projection follows GWToolbox++'s PvP map flag.
PvP outposts and guild halls close Tools and Xunlai storage. Stricter live
features also withdraw during transitions and unknown regions.

If live integration is unavailable while Tools Beta and Build Library remain
enabled, the host can still mount the saved-library part of Tools. Players can
edit, import, and export builds and teams. Live party observation, storage
opening, and Apply remain unavailable. This host-only surface does not become
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

The snapshot publishes Xunlai access as a tri-state value. `true` means the
snapshot confirmed PvE, a non-guild-hall outpost, the current player's matching
record, and a clear access-denied flag. `false` means a fresh observation
confirmed an ineligible region, map, or player record. `null` means the proof is
missing, loading, contradictory, or stale. The storage gate uses this game
snapshot directly. A storage-only profile allocates no party observer or party
buffers, so a missing or broken roster cannot enable or disable storage.

Do not add a generic hook registry, plugin loader, raw memory API, arbitrary
function call, shared-memory packet bus, or second game model.

Quick Travel friend search uses a separately certified stage after
Enhancements. It preserves the preceding module if its proof refuses. The
companion follows the proved login request, queue, callback, and invalidation
sequence before it reads the native friend table. It publishes only a
session-local key, presence, reported map ID, alias, and current character name.
The snapshot exists only while the Travel palette is open in a supported
region. It is cleared before logout, disconnect, login, and feature withdrawal.

A friend row can authorize only the map ID shown by the ordinary reviewed
Travel catalogue. The existing context, unlock, and dispatch checks run again
when the player selects it. Matching friends remain visible when they are
offline, their map is unknown, or their destination is locked or outside the
current travel context; the row is disabled and explains why. Friend data is
never persisted.

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

Travel accepts only one reviewed map ID from the renderer. The exact `/tp`
command sets one named, one-shot palette toggle that the renderer takes and
clears. Search text, aliases, destinations, and numbered shortcuts stay
in the host-owned Vue interface. The play-region snapshot publishes a closed
Pre-Searing or world Travel context from the certified `AreaInfo` region. It
also publishes a fixed 28-word map-unlock bitset only after the certified
`WorldContext` array is read completely; unknown evidence stays unknown instead
of looking like every map is locked. The host combines both facts before it
offers or queues a destination. Pre-Searing characters can use only the six
reviewed Pre-Searing outposts, and world characters cannot return across the
Searing boundary. At the certified frame drain, the transform rechecks the
reviewed map list and live unlock bit, then invokes the independently proved
client helper that resolves the player's current region and language, validates
those values, and writes the four-word Travel payload with district Any. It then
calls the
exact client Travel dispatcher with `kTravel`. An unknown or locked map,
unreadable unlock array, unresolved live context, or changed helper stops only
Travel without dispatching another client UI message.

Guild Hall travel is a separate named action inside Travel. It does not treat a
Guild Hall layout map ID as an ordinary destination. The companion publishes
only whether the current character has a nonzero Guild Hall key and whether
the current `AreaInfo` record has the Guild Hall flag. The 16-byte key stays
inside the game module.

At the game-thread drain, the action calls the certified current-area type
reader. Type `4` sends `kLeaveGuildHall` with no payload. Every other
supported ready area re-reads the current guild key, checks its pointer and four
words, copies it into the private Travel payload, and sends `kGuildHall`.
Changed or missing Guild Hall evidence removes only this action. Ordinary map
Travel remains available.

The Tools host owns one Travel attempt: `idle`, `queued`, or `loading`. A
three-second start deadline and a separate thirty-second arrival deadline both
return it to `idle`; disconnect, corrupt snapshot, and other non-loading states
also end a loading attempt. The Vue component renders this state but does not
interpret the game protocol or own its timers.

Recent destinations are independent of attempt state. The host records every
changed ready map that belongs to the reviewed direct-travel catalogue,
including arrivals outside the palette. Main serializes at most ten unique map
IDs per character in atomic `travel-history.json`. The companion hashes the
official 128-bit character UUID before publication; raw UUIDs and names never
cross the boundary or reach disk. The palette excludes the current map and any
positively locked destination. History cannot authorize travel.

Shortcut slots remain in `settings.json` using the district-bearing shape the
published Stable understands. The current runtime projects those records to
map IDs and ignores their old district values. Synonyms live in
`travel-preferences.json`, a Travel-owned atomic document that Stable v2026.8.9
reads as an exact four-field shape. The current runtime projects only
synonyms, atomically clears withdrawn history on first load, and writes disabled,
empty compatibility placeholders so rollback remains safe.

Main exposes one composed Travel preference snapshot to every renderer. A save
includes the snapshot the renderer edited. Main refuses the save if another
window changed either durable owner first. One accepted save can change
shortcut slots or the Travel-owned document, never both. Main also serializes
ordinary `settings.json` writes with Travel writes, so a settings change cannot
replace a concurrent shortcut change.

The confirmed settings reset uses the same Main owner and lock. It resets
`settings.json` first, including shortcut slots, then resets the Travel-owned
document. A definite settings failure stops before the Travel write. A later
Travel failure returns a partial result and keeps the completed settings reset;
running the reset again safely finishes it. Window-position cleanup is a
separate best-effort action and cannot change that result.

Team Apply requires enabled Tools and Build Library, a proved Team Apply
capability, a positively classified PvE outpost, fresh party state,
and an explicit player action.

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
