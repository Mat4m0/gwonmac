# Game content and ArenaNet updates

This document explains how `gwonmac` gets and stores official Guild Wars data.

Audience: contributors who change ArenaNet downloads, client generations,
snapshot ranges, download progress, or recovery.

This document owns the game-data flow. It does not own updates to the `gwonmac`
application. [Verify a release](release-verification.md) owns application
release operations.

## Two independent update systems

`gwonmac` has two update sources:

| Update | Source | Runtime owner | Player choice |
| --- | --- | --- | --- |
| Guild Wars client and game data | ArenaNet patch service | `ClientRuntime` and `PatchClient` | Quick Start or Full Game |
| `gwonmac` application | Published GitHub releases | `AppUpdater` | Stable or Beta, automatic or manual checks |

These systems do not authorize each other. An ArenaNet update cannot install a
new `gwonmac` release. A `gwonmac` release cannot make an unknown ArenaNet
client build certified.

## ArenaNet data flow

```text
ArenaNet manifest
  -> bounded parse and topology validation
  -> hash-verified executable artifacts
  -> content-addressed snapshot chunks
  -> staged client generation
  -> ClientRuntime activation
  -> immutable ActiveClient
  -> gw://app responses
```

`PatchClient` downloads and verifies data. `ClientRuntime` decides when that
data can become active. `ActiveClient` binds one generation to its artifacts,
chunk store, selected WASM module, and compatibility result.

Only `ClientRuntime` can publish the ready state that the renderer uses.

## Executable artifacts

The app prepares the official JSPI JavaScript, JSPI WebAssembly, and version
metadata. It does not modify the downloaded files in place.

The remote manifest has limits for bytes, entries, names, directories, parent
relationships, and chunk references. Required artifact names must be unique.

The app verifies existing artifacts against the current chunk hashes. File
length alone is not proof. The app builds new files in temporary paths. It
syncs and renames them only after every hash passes.

The local published manifest retains enough artifact information for an
offline integrity check.

## Candidate health and rollback

A changed executable client starts as a candidate. The app keeps one verified
previous generation while it evaluates that candidate.

The candidate becomes healthy only after the same renderer session proves both
of these events:

1. The client presents a frame.
2. The client opens a game TCP connection.

A login-screen frame alone is not sufficient.

Before the renderer loads the client, it captures the exact generation and
fingerprint. It returns that token with the health proof. `ClientRuntime`
rechecks the token under the generation lock before it removes rollback state.
A stale renderer cannot confirm a newer generation.

An ordinary shutdown before both events leaves the candidate pending. The next
launch serves the same verified candidate again; closing the launcher is not
evidence that the game client failed.

If the renderer crashes while the candidate is being served, `ClientRuntime`
rejects that exact client fingerprint for the current host version. It restores
the verified previous generation when one exists. An explicit player retry
clears only that rejection record and gives the exact candidate one fresh
attempt; downloaded chunks and user data are unchanged.

Invalid or legacy state that cannot be verified never becomes rollback state.

## Cancellation and concurrent work

One generation lock protects directory moves for update, confirmation, and
rollback. Full-game chunk download does not hold this lock.

Renderer-crash recovery cancels an active client preparation before it waits
for the generation lock. Fetch and assembly work observe the cancellation
signal and discard their stage.

An atomic directory swap that has already started completes under the lock.
Recovery can then roll it back as one operation. This rule avoids a half-moved
generation.

`ClientRuntime` keeps the chunk store for a full download beside that download's
promise. A generation change must not stop or redirect work by reading a newer
active store by mistake.

## Snapshot chunk store

The ArenaNet snapshot remains chunked in Quick Start mode. The app does not
assemble one full snapshot file for on-demand use.

`ChunkStore` maps a requested range to content-addressed chunks. It coalesces
concurrent requests for the same hash. It verifies bytes before atomic
publication.

The main-process chunk store is canonical. The renderer has a bounded,
disposable byte cache for active play. Chromium responses use `no-store` so its
network cache does not become a second copy of the game-data store.

## Original interface font

Guild Wars stores its interface lettering as bitmap strikes, not as a standard
font file. GWonMac reads two hand-tuned basic-Latin strikes from the active
local game: the 24-pixel body face (archive file 123027) and the finer 52-pixel
display face (archive file 123028). It validates and decompresses only those
bounded streams, then converts their 94 printable ASCII glyphs to separate
TrueType families in memory. The shared Guild Wars interface theme loads them
from `gw://app/game-font.ttf` and `gw://app/game-font-display.ttf`.

The local archive remains the source of truth. GWonMac does not commit, cache,
package, or redistribute the game glyphs or the converted font. If the file is
missing or ArenaNet changes its format, the request fails closed and the theme
uses its existing Palatino-compatible serif fallback. Characters outside basic
ASCII also use that fallback.

### Font calibration

Run `pnpm font:calibrate` after changing the body converter. Add
`-- --role display --text "Primary Quests"` to calibrate the display face. The
command reads the selected bounded strike from the local installed game,
renders threshold candidates through Chromium at its native physical size, and
writes reference, rendered, difference, and numeric-error results under `/tmp`.

The original grayscale strike is the reference; a screenshot is not. Generated
reports are disposable local evidence and must not be committed because they
contain ArenaNet glyph pixels. The converter's default contour threshold is the
best measured candidate from this loop, while a final visual check still guards
against a metric rewarding an obviously poor shape.

At startup, the native store scans chunk residency once. It updates the
in-memory residency set after publication. A range request does not rescan the
chunk directory.

Demand reads take priority over prefetch. The scheduler keeps capacity for a
cold demand read while a full download is active.

## Download limits and progress

The app uses a fixed maximum of eight concurrent ArenaNet requests. This limit
protects both the client and the public patch service.

Each request has a time limit and bounded retry policy. A compressed response
cannot expand beyond its expected chunk length.

The main process owns download execution, progress, Dock feedback, and the
power assertion. The renderer does not create a second download state.

Cache residency is the download truth. A saved counter is not download proof.
Progress, transfer rate, and estimated time come from the native operation.

## Quick Start and Full Game

The `dataStrategy` setting records intent:

- `null` means the player has not made the first-run choice;
- `quick` starts after the required data is ready and fetches areas on demand;
- `full` prepares all missing snapshot chunks before normal start, unless the
  player explicitly chooses to play while it downloads.

The renderer resolves this intent against native cache residency before it
starts the official client. Guild Wars networking, audio, and graphics do not
start behind the first-run choice.

Full Game verifies the content hashes at startup. It does this even when all
expected chunk names are present. Corrupt data re-enters the repair path.

Pausing or leaving Full Game stops speculative work. It does not remove
verified chunks. A later run resumes from verified residency.

## Offline behavior

A cached launch can use a verified published client and resident snapshot
chunks. Missing data still requires ArenaNet.

When client preparation cannot reach ArenaNet, `ClientRuntime` restores the
previous verified client when possible. If no verified client exists, the
launcher shows a retry action.

Corrupt cached chunks are removed and fetched again. Insufficient disk space
stops work before more data is requested. The player can free space and resume.

## Application update boundary

`AppUpdater` checks published `gwonmac` releases only when the signed Release
identity permits it. Stable accepts final releases. Beta also accepts beta and
release-candidate versions. Alpha versions are never public update candidates.

Changing the update track or automatic-check setting does not start a request.
A launch check, due background check, or manual **Check for Updates** action
uses the saved choice.

Application update behavior for players is in [Updates](user-guide.md#updates).
Signing and publication behavior is in [Verify a release](release-verification.md).
