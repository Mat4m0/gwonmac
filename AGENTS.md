# AGENTS.md

Context for humans and agents working on this repository. Each document owns
one thing, and the others link to it rather than restating it:

| Document                 | Owns                                                  |
| ------------------------ | ----------------------------------------------------- |
| `docs/internals.md`      | current technical behaviour                           |
| `docs/user-guide.md`     | current user-facing behaviour                         |
| `internal/upstream/`     | the investigation record, wrong hypotheses included   |
| `PRODUCT.md`             | who this is for, the first feature, and the non-goals |
| `README.md`, `AGENTS.md` | the way in; they link, they do not restate            |

This file adds what an agent needs before touching the code: the constraints
that are load-bearing, the invariants that must not drift, and how to verify a
change. When it disagrees with the code, the code is right and this file is a
bug.

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
| `src/preload/preload.body.cjs` | frozen sandbox-compatible capability bridge; its channel constants are spliced in by `scripts/generate-preload.ts` |
| `src/renderer/`           | loading/settings UI, `Module` host, graphics, diagnostics     |
| `src/shared/`             | canonical contracts and boundary validators                   |
| `src/tools/diagnostics/`  | `.gwdiag` validation, summary, comparison                     |
| `tests/`                  | unit, integration, Electron, packaged, and release invariants |
| `tools/`, `gwkey.py`      | developer-only binary analysis                                |
| `internal/upstream/`      | upstream client defects, workaround, re-certification          |

## Load-bearing constraints

- `Module` must be declared with `var`; generated glue redeclares it.
- `Gw.jspi.js` asks for `Gw.wasm`; `locateFile` must select `Gw.jspi.wasm`.
- Ten host calls are awaited and must return promises:
  `image.cacheAsync`, `dns.resolve`, the three `secureStorage` methods,
  `login.getAuthToken`, `adProvider.showInterstitial`, `ageSignals.check`,
  `shop.initialize`, and `shop.inAppPurchase`. The client's wait on
  `getAuthToken` is long enough to cover a whole Steam sign-in, so that call may
  open a window and keep the client waiting on the player.
- `image.fileSize` is synchronous, so snapshot metadata loads before glue.
- Renderer `preRun` owns the single `app:` IDBFS mount. Restore it, create both
  template directories, and change into it before releasing the run dependency;
  relative game files must never fall back to ephemeral MEMFS.
- `dataStrategy` is the only launcher-intent state. The renderer resolves it
  against cache residency before appending `Gw.jspi.js`; no game audio,
  networking, WebGL, or WASM may start behind the launcher.
- Progress `phase: "ready"` means the main process has an active client, and
  only `ClientRuntime.clientReady` may publish it. `PatchClient` reports
  download progress and nothing else — its `emit` signature excludes `"ready"`.
  A premature ready lets the renderer read snapshot metadata before a client
  exists, receive size 0, and silently stream the whole game over the network.
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
  `CredentialsStore`. Official Developer ID packages persist its validated
  `{ username, password }` value in the fixed `arenaNetCredentials` Data
  Protection Keychain slot. It never enters logs, diagnostics, browser
  storage, or a profile file.
- The Steam login token is a second secret with the same guarantees and its own
  shape. `KeychainJsonStore` is the one mechanism underneath both; each secret
  supplies its own validator and error codes, so `parseCredentials` — the rule
  the credential IPC boundary runs — is never loosened for a payload it was not
  written for. The fixed `steamSession` Data Protection Keychain slot holds
  `{ token, expiry }` and is the token's sole persistent home: **no environment
  variable seeds it in any build**, and
  `tests/policy/source-saved-login-surface.test.ts` scans for one. The token
  never enters logs, diagnostics, browser storage, or a profile file.
- Steam sign-in renders in a window the main process owns, never in the game
  renderer: its own in-memory session partition destroyed with the window,
  no preload and no Node, deny-by-default permissions and downloads, and
  top-level navigation confined to a fail-closed allowlist derived from the
  OAuth config. Subframes and resources remain subject to Chromium's sandbox,
  origin isolation, disabled Node/preload, permission denial, and popup/download
  denial; they cannot complete the top-level redirect. That redirect is
  intercepted before it is fetched with its `state` nonce checked. gwonmac logs
  in an existing Steam↔Guild Wars link and never creates one.
- That window is `modal` on its parent, and must stay so: the game window can be
  restored to fullscreen, and a non-modal parented child gets promoted into that
  fullscreen space and sized to the whole display. A macOS sheet draws no title
  bar, so **the sign-in origin is not visible to the player** — the top-level
  allowlist and the sandbox controls above confine the window, not the player's
  inspection. Do not write docs or UI that tell a player to verify the origin.
  `docs/internals.md` owns the reasoning; `tests/electron/steam-acquire.spec.ts`
  pins the presentation.
- Persistent secrets are available only when a package carries the official
  release marker and Developer ID identity. Unpackaged development and
  ordinary/ad-hoc packages use the volatile in-memory implementation and lose
  secrets at quit; there is no file, mock-Keychain, or `safeStorage` fallback.
  The first hard-cutover launch deletes exactly the retired
  `credentials.bin` and `steam-session.bin`, never other profile data. The
  cookie-encryption fuse is disabled so Chromium cannot create its separate
  Safe Storage Keychain item. All builds clear browser cookies at startup and
  quit.
- The app makes no network request the user was not plainly told about.
  `autoCheckUpdates` (default `true`, declared as one pre-checked line at first
  run and in Settings → Updates) performs one release check per launch and
  governs **every** automatic check without exception, including the one on an
  unrecognised client build; switched off, a launch reaches github.com zero
  times, forever. `src/main/app-updater.ts` is the only
  caller of the releases API and the single owner of discovery, feed
  validation, download, ready, and install state. Only an official package
  carrying the release marker may reach Squirrel.Mac. Stable installs never
  receive previews; a preview may advance to stable. A ready update waits for
  an explicit or ordinary restart. ArenaNet client updates remain separate and
  automatic. `docs/internals.md` owns the mechanism and `docs/user-guide.md`
  owns what the player is told.

## Diagnostics and privacy

There is one canonical main-process flight recorder and one `.gwdiag` report.
Renderer console text is not exported. Renderer failures cross IPC only as
allow-listed names plus non-text fingerprints.
The closed schema owns every dot-separated event name, subsystem, level, field,
and field validator. There is no generic string logging API.

Never record or export credentials, account identifiers, packet contents,
request/response bodies, headers, cookies, crash dumps, or filesystem paths.
Exports are local, bounded, mode `0600`, and fail closed: an event the schema
cannot account for stops the export instead of being scrubbed on the way out.

The protection is three tiers and only the first is a proof, so say which one
you mean. `events.jsonl` is **certified**: every recorded event is a member of
the closed union in `src/main/diagnostics/schema.ts`, a `string` field there
fails `tsc`, producers record an `ErrorCode` rather than a message, and
`src/main/diagnostics/detector.ts` matches every declared record field by
field before anything is written — it imports neither the recorder nor the
scanner, which is what makes it evidence rather than agreement. What the
manifest calls `schemaChecked` is every app-authored record; it must equal
`records` or export fails. The Chromium trace and the documents whose leaves
come from OS and Chromium APIs are **pattern-scanned** by
`src/main/diagnostics/text-scan.ts`, which catches a vocabulary and cannot
promise more. `docs/internals.md` states which tier covers which file.

Level 1 captures prove performance. Level 2 Chromium traces locate causes but
are profiler-contaminated and do not establish gains.

## Game files and project assets

Do not commit downloaded game binaries, snapshots, manifests, credentials,
diagnostic exports, or private traffic. The public client access key in
`src/main/core/access-key.ts` identifies the official client, not a player;
policy tests exempt that one value and fail on any other UUID-shaped string in
a tracked file.

Loading artwork is ArenaNet material used by this interoperability project and
credited in the UI. Do not add third-party fonts or assets without an explicit
redistribution license.

The sole bundled font is the unmodified QT Friz Quad OpenType face from
QualiType. It is pinned by SHA-256 and distributed under SIL OFL 1.1 with
`COPYING-QUALITYPE` both beside the source font and in the packaged
application’s Resources directory.

## Verification

`pnpm check` is the inner loop: typecheck, lint, markdown link check, unit
tests, and policy tests. It needs no build and launches no windows.

```bash
pnpm check
```

The full gate needs a build first. Entry points (`dev`, `package`, `make`,
`enhancements:*`) build themselves; the `test:*` suites do not, so build once and
run them against that output:

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm check:links
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm test:policy
pnpm test:release
pnpm package
pnpm test:packaged
```

`pnpm test:policy` holds the repository invariants that need no build: import
boundaries, lint coverage, action pinning, fuses, font licensing, forbidden
artifacts, and documentation links.

`pnpm verify` runs that gate end to end, and CI runs it on every pull request.
The website is not part of it: `apps/website` has its own path-filtered
workflow, and `pnpm test:website` runs that suite locally.

Electron and integration tests need permission to launch a local app and bind
loopback fixtures. Test launches set `GW_BACKGROUND_LAUNCH=1` so the window
appears without stealing keyboard focus; the few specs that assert on real OS
focus opt out and say why. The production-network smoke is explicitly opt-in:

```bash
pnpm build && GW_LIVE_SMOKE=1 pnpm test:electron
```

When an ArenaNet client update lands, a build is in one of three states and
`src/main/client-certification.ts` is the only thing that decides which. Known
hashes use the shipped tables. An unknown hash is checked by the bounded
isolated process in `src/main/local-client-verifier-host.ts`; only an exact
structural proof may supply locally derived records. The template proof hashes
the complete affected caller bodies after normalising only the selected call
indices; the Enhancement proof requires all eight static addresses in the same
complete code-reference contexts. Any other change serves the untouched
official module. The
`client.buildCertification` gauge in a `.gwdiag` names it —
`certified`, `template-only` (templates save, enhancement tools cannot load), or
`uncertified` — and `wasm.templateSaveCompatible` is the older boolean
derived from that same answer. `pnpm template:recertify` re-derives the
template build entry with the same production locator.
`internal/upstream/recertify.md` owns investigation when the local proof
refuses.

For enhancement work, begin with `pnpm enhancements:doctor`, use the offline layers in
`docs/enhancement-development.md`, and finish with one scoped `enhancements:live`
scenario. Live enhancement runs are cached-only unless `--allow-update` is
explicit; do not bypass that guard or use a temporary Electron profile.

Before finishing, check for a second source of truth, retained old paths,
unnecessary structure, harder debugging, broken architecture decisions, and
missing failure-path coverage.

## Conduct

ArenaNet production infrastructure is shared by every installation. Keep the
honest user agent, exponential backoff, hash verification, and eight-request
ceiling. Never load-test live services. Use offline fixtures for automated
tests and one deliberate live confirmation only when needed.
