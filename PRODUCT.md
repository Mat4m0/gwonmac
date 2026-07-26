# Product brief

One page. What this is, who it is for, what ships next, and what we refuse to
do. Behaviour is documented elsewhere — [`README.md`](README.md) for the
overview, [`docs/user-guide.md`](docs/user-guide.md) for what the app does,
[`docs/internals.md`](docs/internals.md) for how. This file is only for
decisions.

## What this is

A sandboxed macOS host for ArenaNet's official Guild Wars WebAssembly client.
It downloads the official client from ArenaNet, verifies it, supplies the
platform services the client asks for, and stays out of the way. It ships no
game binaries and modifies nothing ArenaNet publishes: where the client is
broken on this platform, the app derives a separate patched copy, verifies it
by hash, and falls back to the untouched official module the moment anything
about that fails.

## Who it is for

**Guild Wars players on a Mac.** Today that means people who want the official
client without Windows, Wine, or a browser tab, and who are willing to click
through Gatekeeper once for an ad-hoc signed build.

**The first Toolbox user is a returning player who used GWToolbox on Windows.**
They are not asking for a plugin platform. They are asking for the handful of
readouts the game itself never showed them, and they notice their absence
within an hour of playing. Everything about the Toolbox foundation — the exact
build certification, the read-only snapshot, the fail-closed transform — exists
to serve that person without making them trust us with their account.

## The first feature

**A target distance and range readout.** With a target selected, show how far
away it is and which range band it falls in — the number players use to pull
safely, to check they are inside casting range, and to judge aggro.

It is first because it is the smallest thing that is genuinely useful and
because the evidence for it already exists: the certified snapshot publishes
target identity, position, distance, and semantic range, and a live run has
already confirmed those values against a real target. It needs a decoder and a
small piece of UI, not a new ABI.

It ships read-only, through the pipeline that exists — manifest, transform,
kernel, snapshot, decoder, UI — with no plugin system, no event bus, and no
command framework. Values the client's semantics do not yet certify are shown
as raw or unknown rather than guessed at. If a second feature does not
naturally reuse what this one builds, that is information about the design, not
a reason to generalise in advance.

## Non-goals

These are refusals, not a backlog.

- **No Windows or Linux build.** This is a macOS project.
- **No modification of ArenaNet's client.** The downloaded artifact stays
  canonical and is never redistributed.
- **No automation, ever.** The app sends no game input and takes no action on a
  player's behalf. The automation tier used for development cannot be reached
  by a packaged build at all, and that is a gate in code, not a promise.
- **No account features.** No bots, no macros, no multiboxing help, no trading
  tools, nothing that touches an account beyond the client's own login.
- **No telemetry.** Nothing about a session leaves the machine unless the
  player attaches a diagnostics file to a bug report themselves.
- **No plugin ABI, and no port of the Windows one.** Native injection, GWCA
  pointers, Direct3D/ImGui rendering, and DLL plugins are replacement work, not
  compatibility targets.
- **No disk-usage promise.** The full download is about 4 GB and stays until
  the player clears it; the app does not silently evict game data to stay under
  a cap. If that promise is ever made, the eviction policy has to be built
  first.
- **No update that installs itself.** Replacing the app is manual, and the app
  checks for a newer release only when asked.

## Claims we stand behind

The public statements we are willing to be held to are exactly the ones with a
test behind them. [`docs/internals.md`](docs/internals.md#verification-boundaries)
maps each claim to something that executes, and the rule there is the product
rule: **a public claim with no row does not ship, and a row whose proof reads
_none_ is a claim to narrow or delete, not a claim to explain.**

Two capability claims on the website — "up to 60 FPS, tuned for Apple Silicon"
and "up to 4K" — currently have no proof. They are either narrowed to what the
render-scale and packaging tests actually establish, or dropped. The measured
frame-rate record lives in
[`docs/performance-electron.md`](docs/performance-electron.md) and is evidence
from specific machines, not a promise to a buyer.

Three claims matter more than the rest, and each one costs something we could
otherwise have: the official artifact is preserved, no game traffic or account
data is uploaded, and nothing acts on a player's behalf. Any feature that would
weaken one of those is a feature this project does not ship.
