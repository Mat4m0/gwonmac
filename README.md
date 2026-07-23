# Guild Wars for macOS

An Electron host for ArenaNet’s official Guild Wars WebAssembly
client. The application downloads the JSPI client directly from ArenaNet,
streams the game snapshot through a native content-addressed cache, exposes the
small platform surface the client expects, and renders it in a sandboxed
Chromium process.

This is an independent interoperability project. It is not affiliated with or
endorsed by ArenaNet or NCSoft, and it contains no game binaries.

## Current status

The Python/browser runtime has been retired. Electron is the only production
path.

- The JSPI client updater, virtual snapshot, native TCP/DNS bridge, HTTPS proxy,
  settings, encrypted saved login, input, audio, fullscreen, and
  OffscreenCanvas presentation paths are implemented.
- The offline Electron acceptance suite verifies the custom protocol,
  sandboxed preload, narrow native bridge, and diagnostics capture lifecycle.
- Guild Wars' own **Remember Password** flow stores one encrypted, owner-only
  local file. Credentials are never logged, exported, or placed in macOS
  Keychain.
- On July 23, 2026, the opt-in live smoke test downloaded the current ArenaNet
  client, initialized JSPI with hardware acceleration, read the real snapshot,
  and submitted a frame on Apple Silicon. Account login and broader Mac/GPU
  coverage remain alpha validation targets.
- The first public prerelease is versioned `0.0.1-alpha.1`. Alpha builds are
  ad-hoc signed until Apple signing credentials are configured. macOS may
  require a manual first-open confirmation, but login never invokes Keychain.
  Developer ID signing remains an optional future distribution improvement.

Each GitHub release contains one Apple Silicon ZIP, its SHA-256 checksum, and
GitHub provenance attestations. Alpha versions are explicitly marked as
prereleases and are never selected as a stable “latest” release.

## Development

Requirements:

- macOS on Apple Silicon
- Node.js 20.19 or newer
- pnpm 11

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The first online run fetches the small JSPI client artifacts. Game data is
downloaded in 256 KB content-addressed chunks as the client asks for it.
The one-time launcher choice selects Quick Start or Full Game before the
official game client runs. Full Game remains in the launcher until the verified
download completes or the user explicitly chooses Play Now. The same strategy
can be changed in Settings for the next launch.
Concurrency remains capped at eight to avoid unnecessary load on ArenaNet’s
production CDN.

See the [user guide](docs/user-guide.md) for the ad-hoc macOS first-open flow,
Quick Start, downloading or pausing the full game, settings, updates, local
data, and bug reports.

Build a local `.app`:

```bash
pnpm package
```

Forge writes the application under `out/`. Create the distributable ZIP with:

```bash
pnpm make
```

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm test:release
pnpm test:website
pnpm package
```

`pnpm verify` runs the complete local gate. The Electron test launches a real
macOS application process, so it needs permission to open GUI applications.
The networked smoke test is intentionally opt-in:

```bash
GW_LIVE_SMOKE=1 pnpm test:electron
```

## Diagnostics

The app records a bounded, local-only Level 0 flight recorder:

- synchronized process → renderer → WASM → runtime → first-frame timings and
  the official client build id;
- renderer rAF and submitted-frame aggregates;
- swap and ImageBitmap presentation cost;
- snapshot/cache/network/disk timing;
- input-to-next-submit timing;
- main and Chromium process CPU/memory;
- main event-loop delay;
- GPU, JSPI, power, thermal, suspend, and crash state;
- socket counts, byte counts, lifetimes, and close reasons.

No telemetry is uploaded. Passwords, account identifiers, authorization,
cookies, request bodies, and game packet payloads are never recorded.

Use **View → Start Performance Capture** for bounded per-frame Level 1 data, or
**View → Start Chromium Trace** for a short Level 2 trace. Captures stop after
120 seconds and then offer export. Press **Cmd+Shift+M** when a visible
performance problem occurs; the marker records only its timestamp. Choose
**Help → Report a Problem…** for the guided path. It creates one `.gwdiag`
file containing a machine-readable health report, the complete retained
current-session log, and—when the previous run ended abnormally—the retained
tail of that run.

Inspect captures without opening the application:

```bash
pnpm diagnostics:validate capture.gwdiag
pnpm diagnostics:summarize capture.gwdiag
pnpm diagnostics:compare before.gwdiag after.gwdiag
```

Published performance claims should use alternating sets of comparable
packaged-build runs, not a single profiler-contaminated trace.

Report ordinary bugs through the
[GitHub bug form](https://github.com/Mat4m0/gwonmac/issues/new?template=bug-report.yml)
and attach the single `.gwdiag` file. Report security-sensitive findings
privately as described in [SECURITY.md](SECURITY.md).

## Local data

Electron stores settings, cached chunks, downloaded client artifacts, and
rolling diagnostics under its macOS user-data directory
(normally `~/Library/Application Support/Guild Wars`).

- Cached game chunks and client artifacts are reproducible.
- Window size, position, and normal/maximized/fullscreen mode are restored from
  an owner-only `window-state.json`. Missing monitors fall back safely to a
  centered primary-display window.
- Saved login is encrypted in an owner-only `credentials.bin` file and crosses
  only the narrow credential IPC methods required by the game host.
- Chromium uses its local mock profile key in ad-hoc macOS builds to avoid
  recurring Safe Storage dialogs. This is intentionally weaker than macOS
  Keychain protection: software running as the same macOS user may be able to
  recover the saved login. Browser cookies are cleared at startup and quit.
- Diagnostics retain at most five 5 MB JSONL files.
- At most three crash dumps are retained locally and they are never exported.
- The host application itself does not contact an update feed. Install a newer
  source or release build manually; the ArenaNet game client still updates
  automatically from ArenaNet.

## Architecture

See [docs/internals.md](docs/internals.md) for the process model, security
boundaries, updater/cache design, renderer host surface, and diagnostics
format. [port-plan.md](port-plan.md) is the port specification and acceptance
checklist.

Developer-only reverse-engineering tools remain under `tools/`; `gwkey.py`
extracts a rotated public client key from an APK if ArenaNet changes it.

## Legal

Guild Wars and all associated game content are © 2005–2026 ArenaNet, Inc. All
rights reserved. NCsoft, the interlocking NC logo, ArenaNet, Arena.net, Guild
Wars and associated logos and designs are trademarks or registered trademarks
of NCsoft Corporation.

Loading-screen photography is by
[Snapshot Henchman](https://bloogum.net/guildwars/).

The loading-screen typeface is QT Friz Quad, © 1992 QualiType, distributed
under the SIL Open Font License 1.1. Its license is included with the font.

The GPL-3.0 license covers the project source code. Unless an asset carries an
explicit license of its own, Guild Wars imagery, screenshots, loading artwork,
the application icon, and derived favicons are fan-project visual material and
are not relicensed under GPL-3.0. All underlying rights remain with their
respective owners.

Source code is GPL-3.0-only. See [LICENSE](LICENSE).
