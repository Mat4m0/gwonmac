# Game content and updates

This document owns everything that arrives over the network: the ArenaNet
client artifacts and the rollback generation beside them, the content-addressed
chunk store behind `Gw.snapshot`, what each download mode does, and this
application's own release updater.

## The client artifacts

The main process downloads only:

```text
Gw.jspi.js
Gw.jspi.wasm
version.json
```

The remote manifest has bounded size, file and directory counts, names,
parent topology, and chunk references. Required product basenames must be
unique. Network bodies are streamed beneath call-site byte ceilings and gzip
decoding cannot exceed the manifest's exact expected chunk length.
Existing artifacts are verified chunk-by-chunk against the current manifest;
equal file length is not treated as proof of equality. New artifacts are built
in a part file, synced, and renamed only after every content hash passes.
The published local manifest retains the executable artifacts' sizes and chunk
hashes, so offline fallback is independently verifiable. A changed client is
kept as a candidate beside one verified previous generation until it has both
presented a frame and opened a game TCP connection. A login-screen frame alone
cannot discard the rollback generation. Before loading the game glue, the
renderer captures the active candidate's generation and fingerprint. It returns
that exact token only after observing both signals; main revalidates the active
generation and marker under the generation lock before deleting rollback state.
A stale renderer therefore cannot confirm a replacement generation. Failure
before both signals durably rejects that exact client fingerprint for the
current host version and restores the previous generation.
Renderer-crash recovery aborts an in-flight manifest/chunk preparation before
waiting for the generation lock. Retries and assembly observe that signal and
discard the stage; once the short verified-directory swap begins, it finishes
atomically and recovery rolls the published candidate back under the same lock.
Invalid or legacy-unverifiable state is never promoted into the rollback slot.

## The chunk store and snapshot cache

`Gw.snapshot` is never assembled for on-demand mode. `ChunkStore` maps each
range onto 256 KB chunks, coalesces concurrent requests by content hash,
verifies downloaded bytes, and publishes chunks atomically. Its in-memory
residency set is initialized with one directory scan and updated on
publication. Snapshot requests never rescan every hash on disk.

The renderer keeps a disposable 256 MB LRU of chunk bytes. The main-process
content store is canonical. Snapshot range responses are `no-store`, and
Chromium's derived network cache is cleared at startup; otherwise it duplicates
hundreds of megabytes of already-resident native chunks. This does not remove
or redownload the canonical chunk store. `image.fileSize` stays synchronous
because the snapshot metadata is obtained before the Emscripten glue is
appended. Adjacent demand chunks already queued in the same renderer turn share
one bounded range request and are split back into compact cache entries; the
eight-request ceiling continues to count chunks, not HTTP requests. A
multi-chunk `image.cacheAsync` queues its whole range so the same scheduler can
use all eight slots while demand retains priority over queued prefetch.

## Download concurrency and progress

Download concurrency is capped at eight. This is a conduct constraint as well
as a performance setting: every installation uses the public client access key
against ArenaNet’s production service. Individual patch requests have a
30-second ceiling and retain the existing bounded exponential retry policy.

Full-image progress uses one time-weighted rate average after a short warm-up;
the same value drives the displayed transfer rate and ETA. The main process
derives native task feedback from the canonical `image` progress phase: the
Dock shows determinate or indeterminate progress and
`prevent-app-suspension` remains active until the download completes, pauses,
or fails. There is no renderer-owned download or power state.

## Download modes

Before `Gw.jspi.js` is appended, the renderer resolves the single
`dataStrategy` setting against native cache residency. `null` owns the
first-run choice, `quick` releases boot immediately, and incomplete `full`
owns the foreground downloader. Main owns native download execution, canonical
progress, and power state; the renderer keeps one coalesced UI operation phase
and derives presentation from progress plus cache residency. The game, audio
context, sockets, and WebGL runtime cannot start behind the launcher. Cache
residency—not a saved progress counter—is the download truth. Full Game
additionally runs the bounded content-hash verification pass at startup even
when every expected filename is resident; corruption cannot bypass the repair
path.

## This app's own updater

`src/main/app-updater.ts` is the single update owner. It asks the bounded GitHub
release list only after a manual request or an automatic check that `main.ts`
schedules: one at launch, then a 30-minute tick that re-checks when
`periodicCheckDue` says so — the build is update-capable, `autoCheckUpdates` is
on, no game socket is open, and the recorded `lastUpdateCheckAt` is at least
six hours old. The tick-plus-due-time shape survives sleep without a resume
handler: a laptop waking past the boundary checks within half an hour. Failures
also record `lastUpdateCheckAt`, so a failing environment retries at the same
six-hour spacing. `autoCheckUpdates` defaults on and is declared plainly at
first run and in Settings; switched off, a launch reaches github.com zero
times.

That one trigger asks for two things. `main.ts` calls the updater and
`src/main/certification/certificate-feed-delivery.ts` from the same place, so
the certificate feed inherits the schedule, the deferral behind a game socket
and the consent switch instead of acquiring its own. The feed's request is two
GETs for release assets published at
`releases/latest/download/` — the same host and redirect chain the updater's own
asset requests follow, so there is no second egress destination — and the
application adds nothing to either: no body, no header, no query, no credential.
`docs/wasm-host.md` owns what arrives and what it is allowed to do.

Only a packaged macOS build whose generated `distribution-channel.json` names
`release` may update. The marker has the exact shape
`{ schema: 1, repository, channel }`; capabilities are derived from that closed
channel rather than stored as booleans. Preview, Development, malformed, and
unmarked packages fail as `updater-unavailable` before making a request. Stable
installs ignore previews. Preview installs may advance through previews or to
stable. Drafts, malformed tags, duplicate assets, unexpected download URLs,
and a `RELEASES.json` that does not name the exact release ZIP fail closed.

The main process gives the validated single-release server response to
Electron's Squirrel.Mac `autoUpdater`, which downloads the ZIP. Main has already
made the version decision; the feed is deliberately not Squirrel's static
multi-release format because its native numeric comparison cannot represent
this project's SemVer preview suffixes. It publishes one discriminated
`AppUpdateState`: `idle`, `checking`, `up-to-date`, `downloading`, `ready`, or
`failed` with a closed reason. The renderer receives no network text or URL.
A check left without a readable answer — `offline`, `timeout`, or `unreadable`,
whether the body never parsed or parsed into something that is not a releases
list — also records `appUpdate.requestFailed` naming which request lost it, the
releases list or one release's own feed, beside the same closed reason. An
error behind the fault is redacted and logged, never recorded.
`lastUpdateCheckAt` is persisted by main after a catalog check completes.

A ready update is offered nonmodally. Restart is explicit; choosing Later lets
Squirrel apply it on the next ordinary restart. The update restart uses the
same quit path as a normal quit, including a bounded renderer `FS.syncfs(false)`
before native cleanup. An active game socket requires confirmation. The first
Developer ID release is a manual DMG bootstrap because an older ad-hoc
signature cannot update into the new signing identity.
