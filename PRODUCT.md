# Product brief

One page of decisions. Behaviour is documented elsewhere:
[`README.md`](README.md) for the overview,
[`docs/user-guide.md`](docs/user-guide.md) for what the app does,
[`docs/internals.md`](docs/internals.md) for how.

## What this is

A sandboxed desktop host for ArenaNet's official Guild Wars WebAssembly client.
The public product is currently macOS-only. Windows 11 x64 and Ubuntu 24.04 x64
are approved targets, but they become public products only after their native
package and verification gates pass. The host downloads the official client,
verifies it, supplies the platform services the client asks for, and stays out
of the way. It ships no game binaries. Where the client is broken on a
certified platform, the app derives a separate patched copy, verifies it by
hash, and falls back to the untouched official module the moment anything
about that fails.

## Who it is for

**Guild Wars players on macOS or Linux** who want the official client without
a Windows installation, Wine, or a browser tab.

**Windows players who value the same sandbox, diagnostics, and isolated
profiles across their computers.** ArenaNet's DirectX 9 client remains the
Windows compatibility and single-account performance baseline. This project
does not claim that its WebAssembly client is faster or more compatible.

**The first GWonMac Tools user is a returning player who used GWToolbox++ on
Windows.**
They are not asking for a plugin platform. They want the handful of readouts
the game itself never showed them, and they notice the absence within an hour
of playing. The exact-build certification, the read-only snapshot, and the
fail-closed transform all exist to serve that person without asking them to
trust us with their account.

## The first feature

**A target distance and range readout.** With a target selected, show how far
away it is and which range band it falls in — the number players use to pull
safely, to stay inside casting range, and to judge aggro.

It is first because it is the smallest genuinely useful thing and the evidence
already exists: the certified snapshot publishes target identity, position,
distance, and semantic range, and a live run has confirmed those values against
a real target. It needs a decoder and a small piece of UI, not a new ABI.

It ships read-only through the pipeline that exists, with no plugin system, no
event bus, and no command framework. Semantics the client has not certified are
shown raw or as unknown rather than guessed at. If a second feature does not
reuse what this one builds, that is information about the design, not a reason
to generalise in advance.

## Non-goals

Refusals, not a backlog.

- **No unproved platform support.** A target is not advertised until its final
  native artifact passes the package, credential, lifecycle, and hardware gates
  in [`plans/multi-os/spec.md`](plans/multi-os/spec.md).
- **No modification of ArenaNet's client.** The downloaded artifact stays
  canonical and is never redistributed.
- **No automation, ever.** The app sends no game input and takes no action on a
  player's behalf. The development-only automation tier cannot be reached by a
  packaged build at all — a gate in code, not a promise.
- **No credential catalog.** Named profiles may isolate browser state and the
  game's own Remember Password data, but the manager never asks for or stores
  an account email or password.
- **No input broadcasting or multibox automation.** Sequential named profiles
  are approved. At most two independently controlled game windows may ship
  only after the storage/performance gates and current written ArenaNet
  clarification for Guild Wars 1 pass. One physical input reaches one focused
  game window.
- **No telemetry.** Nothing leaves the machine unless the player attaches a
  diagnostics file to a bug report themselves.
- **No plugin ABI, and no port of the Windows one.** Native injection, GWCA
  pointers, Direct3D/ImGui rendering, and DLL plugins are replacement work.
- **No disk-usage promise.** The full download is about 4 GB and stays until
  the player clears it; the app does not silently evict game data to stay under
  a cap. Making that promise means building eviction first.
- **No update that installs itself.** Replacing the app is manual, and it
  checks for a newer release only when asked.

## Claims we stand behind

Exactly the ones with a test behind them.
[`docs/internals.md`](docs/internals.md#verification-boundaries) maps each
public claim to something that executes, and its rule is the product rule: **a
public claim with no row does not ship, and a row whose proof reads _none_ is a
claim to narrow or delete, not a claim to explain.**

Two website capability claims — "up to 60 FPS, tuned for Apple Silicon" and
"up to 4K" — have no proof today. They get narrowed to what the render-scale
and packaging tests establish, or dropped. Measured frame rates live in
[`docs/performance-electron.md`](docs/performance-electron.md) as evidence from
specific machines, never as a promise.

Three claims cost us more than the rest, and that is the point: the official
artifact is preserved, no game traffic or account data is uploaded, and nothing
acts on a player's behalf. A feature that weakens one of those is a feature
this project does not ship.
