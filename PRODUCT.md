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
certified client module; after that, individual tool toggles are live. Optional
observers, UI, and command access are disabled in PvP, guild halls, and unknown
regions.

“Tools Beta” is a feature-maturity label, not an application update channel.
Preview remains the separately signed tester application; the planned public
Stable/Beta application track is defined in
[the accepted refactor plan](plans/full-refactor-optimization.md)
and is not shipped behavior yet.

The required product boundary is that Build and Team authoring is host-owned
while observations and Apply are exact-client capabilities. Host authoring must
remain usable when those capabilities refuse. The current production mount does
not yet prove that unknown-build path, so the focused continuity PR in the
accepted plan owns it; public documentation must not claim it before that story
passes.

## Non-goals

Refusals, not a backlog.

- **No Windows or Linux build.**
- **No modification of ArenaNet's client.** The downloaded artifact stays
  canonical and is never redistributed.
- **No autonomous gameplay automation.** The app never chooses a target, moves
  a character, uses a skill, sends chat, farms, or acts without an explicit
  player command. Team Apply is a bounded, user-initiated PvE configuration
  action and every step is confirmed before the next. After a trusted click,
  the native-cursor tool may
  replay one bounded out-and-back pointer hit-test when Guild Wars emitted no
  cursor event; it cannot originate a click or leave the pointer displaced.
- **No account features.** No bots, macros, multiboxing help, or trading tools.
- **No telemetry.** Nothing leaves the machine unless the player attaches a
  diagnostics file to a bug report themselves.
- **No plugin ABI, and no port of the Windows one.** Native injection, GWCA
  pointers, Direct3D/ImGui rendering, and DLL plugins are replacement work.
- **No disk-usage promise.** The full download is about 4 GB and stays until
  the player clears it; the app does not silently evict game data to stay under
  a cap. Making that promise means building eviction first.
- **No forced update.** Automatic checking and downloading is on by default,
  declared plainly at first run, and one checkbox turns it off for good. A
  ready update waits for the player to restart or choose **Restart to Update**.

## Claims we stand behind

Exactly the ones with a test behind them.
[`docs/diagnostics.md`](docs/diagnostics.md#verification-boundaries) maps each
public claim to something that executes, and its rule is the product rule: **a
public claim with no row does not ship, and a row whose proof reads _none_ is a
claim to narrow or delete, not a claim to explain.**

Two website capability claims — "up to 60 FPS, tuned for Apple Silicon" and
"up to 4K" — have no proof today. They get narrowed to what the render-scale
and packaging tests establish, or dropped. Measured frame rates live in
[`docs/performance-electron.md`](docs/performance-electron.md) as evidence from
specific machines, never as a promise.

Three claims cost us more than the rest, and that is the point: the official
artifact is preserved, no game traffic or account data is uploaded, and no
gameplay action is chosen or triggered on a player's behalf. A feature that
weakens one of those is a feature this project does not ship.
