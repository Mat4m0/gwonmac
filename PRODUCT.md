# Product brief

This document defines the product scope. The [user guide](docs/user-guide.md)
defines player behavior. The [technical docs](docs/README.md) define the
implementation boundaries.

## Product

gwonmac is a sandboxed macOS host for ArenaNet's official Guild Wars
WebAssembly client. It downloads and verifies the official client. It supplies
the macOS platform services that the client needs. It does not include game
binaries.

When the official client needs a macOS repair, gwonmac creates a separate
derived copy. It verifies the exact output before use. If verification fails,
gwonmac uses the untouched official client.

## Users

The primary user is a Guild Wars player with an Apple Silicon Mac. The user
wants the official game without Windows, Wine, or a browser tab.

Some returning players also want a small set of familiar tools. They do not
need a plugin platform.

Some players use more than one Guild Wars account. Every installation has at
least one account profile. A player can add more profiles at any time and open
each in an independently controlled game window.

## Product promise

- Keep the official game playable after an unknown ArenaNet update.
- Make ArenaNet patch-day certification fast and safe.
- Let optional Tools fail without blocking the game.
- Keep host-owned Builds and Teams available without live Tools.
- Give players clear Stable and Beta application-update behavior.
- Keep local data and diagnostics under the player's control.
- Let players use local legacy TexMod UI texture packs without running mod code.
- Adopt existing player data as the first profile without copying, moving, or
  deleting it.
- Keep the project understandable for one new contributor.

## Tools

Required template compatibility and Core cursor support run when their exact
client proofs permit them. Optional **gwonmac Tools Beta** is off by default.
Every player-facing tool has its own switch beneath that master opt-in. Turning
the master off disables all tool surfaces, shortcuts, and chat aliases without
deleting saved tool data or preferences. If Tools were prepared for the current
launch, Settings then offers a restart to unload their code completely.

A Core launch does not import, evaluate, instantiate, subscribe, or expose
optional Tools implementation. It uses the Core preload and retains only the
required cursor, input, play-region, pre-game relog, and ordinary Settings
behavior. A Tools launch prepares one optional runtime; individual tool switches
then control behavior immediately. Packaged Tools files and shared setting names
may exist on disk in Core mode, but they are not part of the running module graph.

Tools provides Build and Team authoring, party capture, team-code exchange,
read-only Trade Chat discovery, Target Distance, local Xunlai storage opening,
and explicit Team Apply. Trade Chat is an independent surface with public
Kamadan and Pre-Searing feeds; players still publish listings in Guild Wars.
Its Trader prices view shows observed Kamadan NPC trader quotes and bounded
price history for materials, runes, and dyes; it does not estimate player-market
prices or execute trades.
Players may locally save an exact offer or follow a character to highlight
their listings; this never sends or automates game chat.
Storage
has its own opt-in and can be opened from Tools, with its customizable
Command-Shift-C default shortcut, or by
typing `/chest` or `/xunlai` in supported PvE outposts. Team Apply is a bounded
configuration action. It checks fresh game state after each step.

Build and Team authoring belongs to the host. When Tools Beta and Build Library
are enabled, an unknown client can keep host authoring while live integration
refuses. Live observations, storage opening, and Team Apply require exact
client capabilities.

**Tools Beta** describes feature maturity. It is not the application Beta
update track.

## Application updates

Stable is the default track. Beta also accepts beta and release-candidate
builds. Both tracks use the same release app identity, profile, Keychain, and
updater. Alpha is never public.

The Preview app is a separate tester build. It cannot update itself.

The app never performs an automatic downgrade. Every public beta and release
candidate must preserve the latest Stable version's durable data contract.
See [Release verification](docs/release-verification.md).

## Texture packs

Players can import legacy 32-bit TexMod `.tpf` interface packs and select one
global appearance for newly opened game windows. Import is inactive by default,
Official textures are always available, and an open window keeps the immutable
generation it started with. gwonmac stores an exact private source copy and a
rebuildable compiled generation. Packs replace matching textures only; they
cannot run code or access game state. The complete contract and limits live in
[Texture packs](docs/texture-packs.md).

## Non-goals

- No Windows or Linux version.
- No redistribution of ArenaNet game binaries.
- No autonomous gameplay.
- No bots, macros, input broadcasting, synchronized control, automated trading,
  listing publication, trade execution, pricing manipulation, inventory
  automation, or chat automation.
- No cloned application installations or duplicated ArenaNet game downloads
  for additional account profiles.
- No generic memory, packet, command, or plugin API.
- No port of the Windows plugin ABI.
- No general mod loader, executable TPF content, texture stacking, or pack editor.
- No gwonmac telemetry from the Mac app.
- No silent eviction policy or fixed disk-usage promise.
- No forced mid-session restart.
- No compatibility layer that keeps an obsolete internal design alive.

The app can replay one bounded pointer hit-test after a trusted click if Guild
Wars produced no cursor event. It cannot originate a click. Team Apply acts
only after an explicit player command. These actions do not permit autonomous
play.

After an explicit Reload command, the app may send one Return after saved login
is restored and one only while the certified native Play control is visible.
It sends a third Return only while the certified native reconnect dialog is
visible. If Guild Wars has started loading the selected character, no third
input is sent. This is bounded session restoration: it expires after 30
seconds, cannot change the selected character, cannot repeat a step, and loses
automatic pre-game input when the exact client build is not certified.

## Evidence standard

Consequential privacy, data, release, update, and performance claims need
executable evidence. [Diagnostics](docs/diagnostics.md) maps these claims to
their proof boundary.

Do not defend an unsupported promise with more prose. Narrow it or delete it.
Historical measurements belong in `internal/`, not in current product claims.

Three rules take priority:

1. Preserve the official ArenaNet artifact.
2. Do not upload account data, game traffic, or diagnostics to a gwonmac
   service.
3. Do not choose or trigger gameplay for the player.
