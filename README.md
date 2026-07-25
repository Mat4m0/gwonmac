# Guild Wars for macOS

Play ArenaNet's official Guild Wars client natively on your Mac — no Windows
install, no Wine, no compatibility layer to configure.

[Download](https://github.com/Mat4m0/gwonmac/releases) ·
[Install guide](docs/user-guide.md) ·
[Verify a release](docs/release-verification.md) ·
[Discord](https://discord.gg/Z9ft52RBD3) ·
[Report a bug](https://github.com/Mat4m0/gwonmac/issues/new?template=bug-report.yml) ·
[Support development](https://ko-fi.com/mat4m0)

This is an independent interoperability project. It is **not** affiliated with
or endorsed by ArenaNet or NCSoft, and it ships **no game binaries** — the app
downloads ArenaNet's official WebAssembly client and game data directly from
ArenaNet, verifies it, and hosts it in a sandboxed Chromium process.

## Install

**You need:** an Apple Silicon Mac, and a Guild Wars account. This app does not
create accounts or bypass the login — if you don't own the game yet, buy it
from the [official store](https://store.guildwars.com/en-us).

1. **Download** the latest release and unzip it. Safari unzips automatically;
   otherwise double-click the `.zip`.
2. **Move** `Guild Wars.app` into your Applications folder.
3. **Open it once.** macOS blocks it and offers only _Move to Bin_ and _Done_ —
   click **Done**.
4. **Allow it:** System Settings → Privacy & Security → scroll down → **Open
   Anyway** next to the blocked-app notice.
5. **Confirm.** The warning appears once more, now with an _Open Anyway_ button.
   The app opens and stays trusted from then on.

Releases are ad-hoc signed but not notarized by Apple, which is why macOS asks.
The project deliberately does not require a paid Apple Developer membership.
Every release includes SHA-256 checksums, an SPDX SBOM, and GitHub build
attestations; see [Verify a release](docs/release-verification.md).

## How it works

On first launch the app asks how you want game data downloaded, and waits for your choice.
The two modes are:

| Mode                            | What happens                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| **Quick Start** _(recommended)_ | Playable in about a minute. Areas download the first time you visit them.                   |
| **Full Game**                   | Downloads everything first (~4 GB). The game starts only when you choose _Play Guild Wars_. |

You can switch modes later in Settings → Game Data, pause and resume a full download, or start playing
mid-download with _Play Now Instead_.

## Privacy and data

- **No telemetry is ever uploaded.** Diagnostics are written locally and only
  leave your machine if you attach a `.gwdiag` file to a bug report yourself.
- Passwords, account identifiers, cookies, request bodies, and game packet
  payloads are never recorded.
- Guild Wars' own **Remember Password** writes one encrypted, owner-only local
  file. It is _not_ macOS Keychain: ad-hoc builds use Chromium's local mock
  encryption, so software running as your macOS user could recover it. Leave
  Remember Password off if that tradeoff isn't acceptable.
- The app checks the GitHub releases feed once per launch and shows a link when
  a newer version exists. It never downloads or installs anything by itself,
  and development builds skip the check entirely.

Report security-sensitive findings privately — see [SECURITY.md](SECURITY.md).

## Development

**Requirements:** macOS on Apple Silicon · Node.js 20.19+ · pnpm 11

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The first online run fetches the small JSPI client artifacts.

| Command                                                                  | Purpose                                     |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| `pnpm dev`                                                               | Build and launch the app via Electron Forge |
| `pnpm package`                                                           | Build a local `.app` under `out/`           |
| `pnpm make`                                                              | Build the distributable `.zip`              |
| `pnpm typecheck` / `pnpm lint`                                           | Static checks                               |
| `pnpm test:unit` / `test:integration` / `test:electron` / `test:release` | Test suites                                 |
| `pnpm verify`                                                            | The complete local gate                     |

`pnpm test:electron` launches a real macOS application process, so it needs
permission to open GUI applications. The networked smoke test is opt-in:

```bash
GW_LIVE_SMOKE=1 pnpm test:electron
```

### Repository layout

This is a pnpm workspace: the Electron app lives at the root, the download site
under `apps/`.

| Path            | Contents                                                          |
| --------------- | ----------------------------------------------------------------- |
| `src/main/`     | Main process: updater, cache, sockets, IPC, windows, diagnostics  |
| `src/preload/`  | Sandboxed CommonJS preload — the entire native bridge surface     |
| `src/renderer/` | Launcher chrome, settings, and the game host harness              |
| `src/shared/`   | Contracts shared by main, preload, renderer, and the website      |
| `apps/website/` | The download site (Nuxt 4 + Tailwind), deployed separately        |
| `docs/`         | User guide, internals, performance notes                          |
| `tests/`        | Unit, integration, Electron acceptance, and release-policy suites |
| `tools/`        | Developer-only reverse-engineering helpers                        |

`src/shared/contracts.ts` is the single source of truth for IPC channels,
settings, and every project link — the launcher and website both import it.

Releases are cut from `main` by manual dispatch of the macOS workflow. The
workflow verifies one ad-hoc signed package, generates checksums and an SPDX
SBOM, attests that exact ZIP, and publishes those same tested files.

## Diagnostics

The app keeps a bounded, local-only Level 0 flight recorder: synchronized
process → renderer → WASM → runtime → first-frame timings and the official
client build id, rAF and submitted-frame aggregates, presentation cost,
snapshot/cache/network/disk timing, input-to-next-submit latency, CPU and
memory, event-loop delay, GPU/JSPI/power/thermal/suspend/crash state, and
socket lifetimes.

Use **View → Start Performance Capture** for per-frame Level 1 data or **View →
Start Chromium Trace** for a short Level 2 trace; both stop after 120 seconds
and offer export. Press **Cmd+Shift+M** when a visible problem occurs — the
marker records only its timestamp. **Help → Report a Problem…** produces one
redacted `.gwdiag` file and opens the bug form.

Inspect captures without launching the app:

```bash
pnpm diagnostics:validate capture.gwdiag
pnpm diagnostics:summarize capture.gwdiag
pnpm diagnostics:compare before.gwdiag after.gwdiag
```

Performance claims should compare alternating sets of packaged-build runs, not
a single profiler-contaminated trace.

## Local data

Everything lives under `~/Library/Application Support/Guild Wars`:

- Cached game chunks and client artifacts — reproducible, safe to delete via
  Settings → Game Data → _Clear game data_.
- Window size, position, and display mode in an owner-only
  `window-state.json`; missing monitors fall back to a centered window.
- Saved login, encrypted in an owner-only `credentials.bin`, reachable only
  through the narrow credential IPC methods.
- At most five 5 MB diagnostics files and three crash dumps. Dumps are never
  exported.

Browser cookies are cleared at startup and quit. Clearing game data never
touches your login or settings; resetting launcher settings never deletes
downloaded data.

## Documentation

- [User guide](docs/user-guide.md) — first launch, download modes, settings,
  local data, bug reports
- [Internals](docs/internals.md) — process model, security boundaries,
  updater/cache design, renderer host surface, diagnostics format
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) ·
  [Product brief](PRODUCT.md) · [Port plan](port-plan.md)

## Credits

This project is a fork of
**[gwdevhub/gw_in_browser](https://github.com/gwdevhub/gw_in_browser)** and
would not exist without it. That work established the approach this app is
built on: hosting ArenaNet's official WebAssembly client outside the browser
and supplying the platform surface it expects. The upstream git history is
preserved in this repository.

Upstream authors:

- **[Marc (henderkes)](https://github.com/henderkes)** — original author;
  wrote the foundational _"Guild Wars in the browser"_ work this fork descends
  from.
- **[Jon (3vcloud)](https://github.com/3vcloud)** — [gwdevhub](https://github.com/gwdevhub)
  maintainer and contributor.
- **[GWToolbox](https://gwtoolbox.com)** — contributed the macOS launch
  wrapper that this app's native host grew out of.

Upstream is licensed GPL-3.0, and so is this fork. If you find this project
useful, the credit belongs upstream first.

Also with thanks to:

- **[Snapshot Henchman](https://bloogum.net/guildwars/)** — loading-screen
  photography.
- **QualiType** — the QT Friz Quad typeface, released under the SIL Open Font
  License 1.1.
- **ArenaNet** — for the game, and for keeping the Guild Wars client alive and
  publicly downloadable more than twenty years on.

## Legal

Guild Wars and all associated game content are © 2005–2026 ArenaNet, Inc. All
rights reserved. NCsoft, the interlocking NC logo, ArenaNet, Arena.net, Guild
Wars and associated logos and designs are trademarks or registered trademarks
of NCsoft Corporation.

Loading-screen photography is by
[Snapshot Henchman](https://bloogum.net/guildwars/). The loading-screen typeface
is QT Friz Quad, © 1992 QualiType, distributed under the SIL Open Font License
1.1; its license ships with the font.

Source code is GPL-3.0-only — see [LICENSE](LICENSE). Unless an asset carries
its own license, Guild Wars imagery, screenshots, loading artwork, cursor
artwork, the application icon, and derived favicons are fan-project visual
material, are not relicensed under GPL-3.0, and all underlying rights remain
with their respective owners.
