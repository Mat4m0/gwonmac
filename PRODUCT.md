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

Some players use more than one Guild Wars account. They can explicitly enable
**Multiple Accounts** mode to open independently controlled accounts in
separate windows. The normal Single Account mode stays the default.

## Product promise

- Keep the official game playable after an unknown ArenaNet update.
- Make ArenaNet patch-day certification fast and safe.
- Let optional Tools fail without blocking the game.
- Keep host-owned Builds and Teams available without live Tools.
- Give players clear Stable and Beta application-update behavior.
- Keep local data and diagnostics under the player's control.
- Keep Single Account data unchanged when a player enters or leaves Multiple
  Accounts mode.
- Keep the project understandable for one new contributor.

## Tools

Required template compatibility and Core cursor support run when their exact
client proofs permit them. Optional **gwonmac Tools Beta** is off by default.

Tools provides Build and Team authoring, party capture, team-code exchange,
Target Distance, and explicit Team Apply. Team Apply is a bounded configuration
action. It is available only in supported PvE outposts. It checks fresh game
state after each step.

Build and Team authoring belongs to the host. Live observations and Team Apply
require exact client capabilities. An unknown client can therefore keep host
authoring while live integration refuses.

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

## Non-goals

- No Windows or Linux version.
- No redistribution of ArenaNet game binaries.
- No autonomous gameplay.
- No bots, macros, input broadcasting, synchronized control, or trading tools.
- No cloned application installations or duplicated ArenaNet game downloads
  for Multiple Accounts mode.
- No generic memory, packet, command, or plugin API.
- No port of the Windows plugin ABI.
- No gwonmac telemetry from the Mac app.
- No silent eviction policy or fixed disk-usage promise.
- No forced mid-session restart.
- No compatibility layer that keeps an obsolete internal design alive.

The app can replay one bounded pointer hit-test after a trusted click if Guild
Wars produced no cursor event. It cannot originate a click. Team Apply acts
only after an explicit player command. These actions do not permit autonomous
play.

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
