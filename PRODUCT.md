# Product brief

One page of decisions. Behaviour is documented elsewhere:
[`README.md`](README.md) for the overview,
[`docs/user-guide.md`](docs/user-guide.md) for what the app does,
[`docs/`](docs/README.md) for how.

## What this is

A sandboxed macOS host for ArenaNet's official Guild Wars WebAssembly client.
It downloads the official client, verifies it, supplies the platform services
the client asks for, and stays out of the way. It ships no game binaries.
Where the client is broken on this platform, the app derives a separate patched
copy, verifies it by hash, and falls back to the untouched official module the
moment anything about that fails.

## Who it is for

**Guild Wars players on a Mac** who want the official client without Windows,
Wine, or a browser tab.

**The first GWonMac Tools user is a returning player who used GWToolbox++ on
Windows.**
They are not asking for a plugin platform. They want the handful of readouts
the game itself never showed them, and they notice the absence within an hour
of playing. Exact-build certification, bounded snapshots and commands, and the
fail-closed transform serve that person without exposing a generic automation
surface.

## The first tool set

**Builds and teams.** Players can keep builds and team configurations, capture
the current player-and-hero party, exchange whole-team codes, and explicitly
Apply a saved team in a PvE outpost. Apply confirms difficulty, the player's
build, the hero roster, professions, bars, attributes, and behavior against
fresh observations. Target distance remains a clearly labelled Test tool.

Core cursor and template support are always on for a certified client. Optional
Tools are a Beta opt-in. Their first enable requires one restart to select the
best client module available for that exact ArenaNet build; after that,
individual tool toggles are live. Host-owned Build and Team authoring remains
available when client integration is unavailable. Optional observers and
commands are disabled in PvP, guild halls, and unknown regions.

“Tools Beta” is a feature-maturity label, not an application update channel.
The release application has a separate Stable/Beta update preference: Stable
is the default, while Beta opts into beta and release-candidate application
builds under the same bundle, profile, Keychain, and updater identity. Alpha is
never public. Preview remains the separately signed tester application and has
no automatic updater.

Returning to Stable is truthful rather than magical. A matching final Stable
is a normal forward update; when the latest Stable is older than the installed
Beta, the app opens the fixed Releases page for a manual signed/notarized DMG
install. It never asks the native updater to downgrade. Every public beta and
RC is release-gated on the latest Stable reading and rewriting its canonical
player data after the candidate has changed it.

The required product boundary is that Build and Team authoring is host-owned
while observations and Apply are exact-client capabilities. Host authoring
remains usable when those capabilities refuse; publishing into the game's
template list additionally requires certified template support. The packaged
unknown-build story proves the official module stays active and no companion
command surface appears.

## Non-goals

Refusals, not a backlog.

- **No Windows or Linux build.**
- **No mutation or redistribution of ArenaNet's downloaded artifact.** It stays
  canonical. Any platform repair or optional Tools transform produces a
  separate, exact-hash-verified runtime copy and fails back to canonical bytes.
- **No autonomous gameplay automation.** The app never chooses a target, moves
  a character, uses a skill, sends chat, farms, or acts without an explicit
  player command. Team Apply is a bounded, user-initiated PvE configuration
  action and every step is confirmed before the next. After a trusted click,
  the native-cursor tool may
  replay one bounded out-and-back pointer hit-test when Guild Wars emitted no
  cursor event; it cannot originate a click or leave the pointer displaced.
- **No account features.** No bots, macros, multiboxing help, or trading tools.
- **No Mac app telemetry.** Required login and game traffic goes only to the
  selected provider and ArenaNet services. The app sends no diagnostics,
  library, account, or gameplay data to a GWonMac service; a player may attach
  a diagnostics file to a bug report themselves.
- **No plugin ABI, and no port of the Windows one.** Native injection, GWCA
  pointers, Direct3D/ImGui rendering, and DLL plugins are replacement work.
- **No disk-usage promise.** A full download stays until the player clears it;
  the app does not silently evict game data to stay under a cap. Making a fixed
  size promise means building and measuring that policy first.
- **No forced update.** Automatic checking and downloading is on by default,
  declared plainly at first run, and one checkbox turns it off for good. A
  ready update waits for the player to restart or choose **Restart to Update**.

## Claims we stand behind

Consequential privacy, data, release, update, and performance promises need
executable evidence. [`docs/diagnostics.md`](docs/diagnostics.md#verification-boundaries)
maps those public invariants to their proofs. Ordinary explanatory copy does
not need a duplicate row; an unsupported consequential promise is narrowed or
deleted rather than defended with prose.

The former website FPS and fixed-resolution promises had no proof and have
been removed. Public copy now says only what the render-scale and arm64
packaging tests establish. Measured frame rates live in
[`docs/performance-electron.md`](docs/performance-electron.md) as evidence from
specific machines, never as a promise.

Three claims cost us more than the rest, and that is the point: the official
artifact is preserved, no game traffic or account data is uploaded, and no
gameplay action is chosen or triggered on a player's behalf. A feature that
weakens one of those is a feature this project does not ship.
