# AGENTS.md

Context for humans and agents working on this repository. `README.md` is the
user-facing overview, `docs/user-guide.md` covers operation, and
`docs/internals.md` is the technical source of truth. `PRODUCT.md` records the
product register, users, personality, anti-references, and design principles.

## What this is

Guild Wars is an Emscripten/JSPI WebAssembly client. This repository
hosts ArenaNet’s official client in a sandboxed macOS Electron application and
supplies its platform services through a narrow `Module` object.

The retired Python/browser runtime must not return. Electron is the only
production path.

## Ownership and simplicity

Own the outcome. Prefer, in order:

```text
delete > simplify > replace > add
```

Before adding a table, cache, worker, bridge method, adapter, state machine, or
compatibility path, identify the invariant it serves and the acceptance test
that proves it is necessary. Keep one source of truth. Prefer hard cutovers in
unreleased code and remove superseded paths.

Keep domain logic out of preload/IPC transport. Main owns native invariants;
the renderer owns presentation and the game host. Add tests for invariants,
not only happy paths.

## Layout

| Path                      | Ownership                                                     |
| ------------------------- | ------------------------------------------------------------- |
| `src/main/main.ts`        | composition root, ArenaNet client update, app state           |
| `src/main/core/`          | chunks, manifest, DNS, sockets, settings                      |
| `src/main/protocol.ts`    | secure `gw://app` routing and snapshot ranges                 |
| `src/main/ipc.ts`         | validated native capability handlers                          |
| `src/main/diagnostics.ts` | bounded flight recorder, captures, export                     |
| `src/preload/preload.cjs` | frozen sandbox-compatible capability bridge                   |
| `src/renderer/`           | loading/settings UI, `Module` host, graphics, diagnostics     |
| `src/shared/`             | canonical contracts and boundary validators                   |
| `src/tools/diagnostics/`  | `.gwdiag` validation, summary, comparison                     |
| `tests/`                  | unit, integration, Electron, packaged, and release invariants |
| `tools/`, `gwkey.py`      | developer-only binary analysis                                |

## Load-bearing constraints

- `Module` must be declared with `var`; generated glue redeclares it.
- `Gw.jspi.js` asks for `Gw.wasm`; `locateFile` must select `Gw.jspi.wasm`.
- Nine host calls are awaited and must return promises:
  `image.cacheAsync`, `dns.resolve`, the three `secureStorage` methods,
  `adProvider.showInterstitial`, `ageSignals.check`, `shop.initialize`, and
  `shop.inAppPurchase`.
- `image.fileSize` is synchronous, so snapshot metadata loads before glue.
- Renderer `preRun` owns the single `app:` IDBFS mount. Restore it, create both
  template directories, and change into it before releasing the run dependency;
  relative game files must never fall back to ephemeral MEMFS.
- `dataStrategy` is the only launcher-intent state. The renderer resolves it
  against cache residency before appending `Gw.jspi.js`; no game audio,
  networking, WebGL, or WASM may start behind the launcher.
- Concurrent chunk reads share one promise per content hash.
- Renderer and native download schedulers cap ArenaNet concurrency at eight.
  Demand work outranks queued prefetch; do not raise the ceiling.
- Snapshot constants can use fixed-width, non-canonical LEB128. Analysis tools
  must decode values rather than byte-match a canonical encoding.
- `geodc.arenanetworks.com` can return the datacenter sentinel `0.0.1.2`; raw
  DNS fallback is intentional.
- Game infrastructure and web services use different allowlisted domains.
  Unknown proxy routes fail closed.
- WASM packet views must be compacted before crossing `contextBridge`.
- The main process owns TCP handles, backpressure, destination/port checks,
  owner cleanup, and final close semantics.
- Red X means a clean application quit, not a hidden headless process.
- Main owns atomic owner-only window state. Persist the last normal bounds
  beneath maximized/fullscreen mode, validate against connected display work
  areas, never restore minimized, and keep the View-menu recovery action.
- The three game-facing `secureStorage` methods use the single native
  `CredentialsStore`. Its encrypted `credentials.bin` is atomic and mode
  `0600`; credentials never enter logs, diagnostics, browser storage, or
  macOS Keychain.
- Ad-hoc macOS builds set Chromium's `use-mock-keychain` switch before ready
  and clear browser cookies at startup and quit. The switch prevents OS
  prompts but gives saved login weaker same-user protection than Keychain.
- The host app has no update-feed client. Application replacement is manual;
  ArenaNet client updates remain automatic.

## Diagnostics and privacy

There is one canonical main-process flight recorder and one `.gwdiag` report.
Renderer console text is not exported. Renderer failures cross IPC only as
allow-listed names plus non-text fingerprints.
The recorder normalizes every event name to a dot-separated identifier.

Never record or export credentials, account identifiers, packet contents,
request/response bodies, headers, cookies, crash dumps, or filesystem paths.
Exports are local, bounded, redacted, mode `0600`, and fail closed.

Level 1 captures prove performance. Level 2 Chromium traces locate causes but
are profiler-contaminated and do not establish gains.

## Game files and project assets

Do not commit downloaded game binaries, snapshots, manifests, credentials,
diagnostic exports, or private traffic. The public client access key in
`src/main/core/access-key.ts` identifies the official client, not a player;
release tests exempt only its exact value.

Loading artwork is ArenaNet material used by this interoperability project and
credited in the UI. Do not add third-party fonts or assets without an explicit
redistribution license.

The sole bundled font is the unmodified QT Friz Quad OpenType face from
QualiType. It is pinned by SHA-256 and distributed under SIL OFL 1.1 with
`COPYING-QUALITYPE` both beside the source font and in the packaged
application’s Resources directory.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm test:release
pnpm package
pnpm test:packaged
```

`pnpm verify` runs the complete local gate. Electron and integration tests need
permission to launch a local app and bind loopback fixtures. The
production-network smoke is explicitly opt-in:

```bash
GW_LIVE_SMOKE=1 pnpm test:electron
```

Before finishing, check for a second source of truth, retained old paths,
unnecessary structure, harder debugging, broken architecture decisions, and
missing failure-path coverage.

## Conduct

ArenaNet production infrastructure is shared by every installation. Keep the
honest user agent, exponential backoff, hash verification, and eight-request
ceiling. Never load-test live services. Use offline fixtures for automated
tests and one deliberate live confirmation only when needed.
