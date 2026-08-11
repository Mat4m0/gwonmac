# Guild Wars Reforged

Play ArenaNet's official Guild Wars Reforged client natively on your Mac — no
Windows install, Wine, or compatibility layer to configure.

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

1. **Download** the latest `.dmg` release and open it.
2. **Move** `Guild Wars Reforged.app` into the Applications folder.
3. **Open** the app from Applications.

Releases are signed with Developer ID and notarized by Apple. Every release
also includes SHA-256 checksums, an SPDX SBOM, and GitHub build attestations;
see [Verify a release](docs/release-verification.md).

Releases are numbered by date — `2026.7.1` is a July 2026 build — which says
how recent a release is and nothing about which game client build it certifies:
[Release numbering](docs/release-verification.md#release-numbering).

## How it works

On first launch the app asks how you want game data downloaded, and waits for your choice.
The two modes are:

| Mode                            | What happens                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| **Quick Start** _(recommended)_ | Starts after the required files are ready. Areas download the first time you visit them.     |
| **Full Game**                   | Downloads all game data first. The game starts only when you choose _Play Guild Wars_.       |

You can switch modes later in Settings → Game Data, pause and resume a full download, or start playing
mid-download with _Play Now Instead_.

## Privacy and data

- **The Mac app never uploads telemetry.** Diagnostics are written locally and
  only leave your machine if you attach the exported `.zip` file to a bug report
  yourself.
- Passwords, account identifiers, cookies, request bodies, and game packet
  payloads are never recorded.
- Guild Wars' own **Remember Password** stores one opaque item in Apple's Data
  Protection Keychain in provisioned Release, Preview, and signed Development
  builds. Each channel is isolated. Source and ad-hoc builds keep saved login
  only in memory for that process.
- **Updates check on a declared schedule, or not at all.** The app checks
  GitHub at launch and about every six hours while it stays open — a default
  declared at first run that one checkbox turns off. Switched off, it asks
  GitHub only when you press **Check for Updates**. A downloaded update is
  offered as a restart and otherwise installs on the next restart. See
  [Updates](docs/user-guide.md#updates).

Report security-sensitive findings privately — see [SECURITY.md](SECURITY.md).

## Development

**Requirements:** macOS on Apple Silicon · Xcode Command Line Tools ·
Node.js 22.19+ · pnpm 11 · [Rust](https://rustup.rs) (via rustup)

```bash
xcode-select --install
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
```

The Xcode Command Line Tools and Playwright Chromium install are one-time setup
steps. `pnpm check` is the fast source/unit/policy loop and does not need
Chromium. `pnpm verify` includes browser and Electron acceptance tests, so it
does need Chromium and permission to launch GUI applications; it does not need
an ArenaNet account or a pre-existing client cache.

Rust is a build prerequisite, not an optional extra: every entry point runs
`pnpm build`, which compiles `src/companion-kernel/lib.rs` to WebAssembly with
`rustc`. `rust-toolchain.toml` pins the compiler version, the components the
build needs, and the `wasm32-unknown-unknown` target, so rustup installs them
on the first build. Continuous integration installs that same pin rather than
using the runner image's own toolchain.

The first online run fetches the small JSPI client artifacts.

Ordinary `pnpm dev` deliberately forgets saved login when the process exits.
For persistent developer-only login, register the `.dev` App ID, install its
Apple Development identity, keep its device-authorized profile outside this
repository, then run:

```bash
export APPLE_DEVELOPMENT_PROFILE=/absolute/path/gwonmac-dev.provisionprofile
export APPLE_DEVELOPMENT_IDENTITY=0123456789ABCDEF0123456789ABCDEF01234567
pnpm dev:signed
```

Use the 40-character identity fingerprint printed by
`security find-identity -v -p codesigning`. The Dev app shares settings,
templates, diagnostics, and game downloads with Release, but not credentials.
Because those channels intentionally share one profile, quit Release or
Preview before starting a signed Dev session.

On a clean macOS test account with no saved Dev login, `pnpm test:signed-dev`
packages the same provisioned app and proves both ArenaNet and Steam secrets
survive relaunch, moving the app, and a replacement signature. It refuses to
overwrite an existing Dev login.

| Command                                                                  | Purpose                                     |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| `pnpm dev`                                                               | Build and launch the app via Electron Forge |
| `pnpm dev:signed`                                                        | Package and launch the provisioned Dev app  |
| `pnpm test:signed-dev`                                                   | Test provisioned Dev Keychain continuity    |
| `pnpm package`                                                           | Build a local `.app` under `out/`           |
| `pnpm make`                                                              | Build a local ad-hoc `.zip`                  |
| `pnpm typecheck` / `pnpm lint`                                           | Static checks                               |
| `pnpm check`                                                             | Fast inner loop: static checks and policy   |
| `pnpm test:unit` / `test:integration` / `test:electron` / `test:release` | Deterministic test suites                  |
| `GW_CLIENT_WASM=/path pnpm test:client-artifact`                        | Certify one real installed client artifact |
| `pnpm test:website`                                                      | The `apps/website` suite                    |
| `pnpm verify`                                                            | The complete local gate                     |

`pnpm test:electron` launches a real macOS application process, so it needs
permission to open GUI applications. Those launches run in the background and
do not take keyboard focus. The deterministic local suites do not contact
ArenaNet. The networked smoke test is opt-in:

```bash
pnpm build && GW_LIVE_SMOKE=1 pnpm test:electron
```

### Repository layout

This is a pnpm workspace: the Electron app lives at the root, the download site
under `apps/`.

| Path            | Contents                                                          |
| --------------- | ----------------------------------------------------------------- |
| `src/main/`     | Main process: client updater, cache, sockets, IPC, windows, diagnostics |
| `src/preload/`  | Sandboxed CommonJS preload — the entire native bridge surface     |
| `src/renderer/` | Launcher chrome, settings, and the game host harness              |
| `src/shared/`   | Contracts shared by main, preload, renderer, and the website      |
| `apps/website/` | The download site (Nuxt 4 + Tailwind), deployed separately        |
| `docs/`         | User guide, technical documents, performance record               |
| `tests/`        | Unit, integration, Electron acceptance, and release-policy suites |
| `tools/`        | Developer-only reverse-engineering helpers                        |

`src/shared/contracts.ts` is the single source of truth for IPC channels,
settings, and every project link — the launcher and website both import it.

Releases are cut from `main` by manual dispatch of the macOS workflow. The
approval-gated workflow signs with Developer ID, notarizes and staples the app
and DMG, generates the updater feed, checksums and SPDX SBOM, attests the exact
DMG and ZIP, and publishes only after re-verifying the complete draft.

The GitHub `release` environment must require a maintainer approval and contain
these secrets:

- `APPLE_DEVELOPER_ID_P12`: base64 of the exported Developer ID Application
  G2 certificate and private key;
- `APPLE_DEVELOPER_ID_PASSWORD`: the export password;
- `APPLE_DEVELOPER_ID_PROFILE`: base64 of the Developer ID distribution
  provisioning profile for `io.github.mat4m0.gwonmac`;
- `APPLE_API_KEY_P8`: base64 of the App Store Connect API key;
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, and `APPLE_TEAM_ID`: their Apple
  identifiers.

On macOS, `base64 -i DeveloperID.p12 | pbcopy`,
`base64 -i gwonmac.provisionprofile | pbcopy`, and
`base64 -i AuthKey_KEYID.p8 | pbcopy` produce the three encoded secret values.
Keep the originals outside the repository and remove unneeded local export
copies after the GitHub secrets have been set.

### Test snapshots

Every verified push to `main` publishes a temporary
[`snapshot-*` prerelease](https://github.com/Mat4m0/gwonmac/releases) for
players who want to test the newest changes. A maintainer can publish the same
kind of snapshot from another repository branch with the **Tester build**
workflow. Snapshots are unsupported, never offered by the website or in-app
release check, and are bounded: only the newest three remain, while every
snapshot except the newest expires after fourteen days.

Pull requests keep their packaged app as a GitHub Actions artifact for three
days. Those artifacts require a signed-in GitHub account; snapshot prereleases
use ordinary public download links. Report results with the
[preview feedback form](https://github.com/Mat4m0/gwonmac/issues/new?template=preview-feedback.yml);
diagnostics remain local unless you explicitly attach the exported file.

## Diagnostics

The app keeps a bounded, local-only flight recorder — startup and frame
timings, cache/network/disk cost, memory, GPU and power state, socket
lifetimes — and **Help → Report a Problem…** turns it into one redacted
diagnostics `.zip` that only leaves your machine if you attach it yourself.
[Report a problem](docs/user-guide.md#report-a-problem) covers which capture to
record for which symptom; [Diagnostics](docs/diagnostics.md) covers the
format and exactly what the redaction does and does not guarantee.

Inspect captures without launching the app:

```bash
pnpm diagnostics:validate capture.zip
pnpm diagnostics:summarize capture.zip
pnpm diagnostics:compare before.zip after.zip
```

Performance claims should compare alternating sets of packaged-build runs, not
a single profiler-contaminated trace.

## Local data

Profile data lives under `~/Library/Application Support/Guild Wars`:

- Cached game chunks and client artifacts — reproducible, safe to delete via
  Settings → Game Data → _Clear game data_.
- Window size, position, and display mode in an owner-only
  `window-state.json`; missing monitors fall back to a centered window.
- At most five 5 MB diagnostics files.

Saved ArenaNet and Steam login are the exception: provisioned Release, Preview,
and Development apps keep them in two fixed, device-only Data Protection
Keychain items per channel, reachable only through the narrow credential IPC
methods.

The game proxy drops cookies in both directions, and browser cookies are also
cleared at startup and quit. Clearing game data never
touches your login or settings; resetting launcher settings never deletes
downloaded data.

## Documentation

Each document owns one thing; this page links rather than repeating them.

- [User guide](docs/user-guide.md) — everything the app does from a player's
  seat: first launch, download modes, settings, updates, local data, bug
  reports
- [Technical documentation](docs/README.md) — how it does it: the process
  model and its boundaries, the content pipeline and both updaters, the WASM
  host and client certification, diagnostics, and which claims are proved by
  which test
- [Verify a release](docs/release-verification.md) — checksums, attestations,
  and what a version number means
- [Product brief](PRODUCT.md) — who this is for, what ships next, and what this
  project will not do
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)

## Credits

This project is a fork of
**[gwdevhub/gw_in_browser](https://github.com/gwdevhub/gw_in_browser)** and
would not exist without it. That work established the approach this app is
built on: hosting ArenaNet's official WebAssembly client outside the browser
and supplying the platform surface it expects. The upstream git history is
preserved in this repository.

Upstream authors:

- **[Marc Henderkes (dub_le)](https://github.com/henderkes)** — original
  author of gw_in_browser; wrote the foundational _"Guild Wars in the browser"_
  work this fork descends from, and the research that established how the
  official WASM client can be hosted outside the browser at all.
- **[Jon (3vcloud)](https://github.com/3vcloud)** — [gwdevhub](https://github.com/gwdevhub)
  maintainer and contributor; shared the proof of concept this project started
  from.
- **[GWToolbox++](https://gwtoolbox.com)** — contributed the macOS launch
  wrapper that this app's native host grew out of.

Upstream is licensed GPL-3.0, and so is this fork. If you find this project
useful, the credit belongs upstream first.

Also with thanks to:

- **QualiType** — the QT Friz Quad typeface, released under the SIL Open Font
  License 1.1.
- **ArenaNet** — for the game, and for keeping the Guild Wars client alive and
  publicly downloadable more than twenty years on.
- **[gwnative](https://github.com/jean-humann/gwnative)** — an independent
  native Rust host with the same goal, reached by a different route. Ideas and
  fixes travel both ways; several here came out of that exchange. It also
  identified the official Reforged App Store artwork and prepared the macOS
  icon adopted here.

## Legal

© ArenaNet LLC. All rights reserved. NCSOFT, ArenaNet, Guild Wars, Guild Wars
2, GW2, Heart of Thorns, Path of Fire, End of Dragons, Secrets of the Obscure,
Janthir Wilds, Visions of Eternity, and all associated logos, designs, and
composite marks are trademarks or registered trademarks of NCSOFT Corporation.
All other trademarks are the property of their respective owners.

`assets/AppIcon.png` is the 1024 × 1024 Guild Wars Reforged application
artwork published by ArenaNet on the official
[Apple App Store listing](https://apps.apple.com/app/guild-wars-reforged/id820613069).
The committed macOS icon was prepared by
[gwnative](https://github.com/jean-humann/gwnative) from that artwork. The
artwork and Guild Wars marks remain the property of their respective owners.

The loading-screen video and logo were published by ArenaNet on the official
[Guild Wars Reforged website](https://guildwars.com/en/). The loading-screen
typeface is QT Friz Quad, © 1992 QualiType, distributed under the SIL Open Font
License 1.1; its license ships with the font.

No cursor artwork ships with this application. The game cursor — on by default,
switchable off under Settings → Controls — reads the bitmap the player's own
installed client has already decoded, and never redistributes it.

Source code is GPL-3.0-only — see [LICENSE](LICENSE). Unless an asset carries
its own license, Guild Wars imagery, screenshots, loading artwork, the official
application-icon artwork, and derived favicons are not relicensed under
GPL-3.0, and all underlying rights remain with their respective owners.
