# AGENTS.md

Context for humans and agents working on this repository. Each document owns
one thing, and the others link to it rather than restating it:

| Document                    | Owns                                                    |
| --------------------------- | ------------------------------------------------------- |
| `docs/process-model.md`     | processes, boundaries, rendering and input, secrets      |
| `docs/content-pipeline.md`  | client artifacts, chunk store, download modes, updater   |
| `docs/wasm-host.md`         | the `Module` surface and client certification            |
| `docs/diagnostics.md`       | the recorder, the export, and the claims that are proved |
| `docs/user-guide.md`        | current user-facing behaviour                            |
| `internal/upstream/`        | the investigation record, wrong hypotheses included      |
| `PRODUCT.md`                | who this is for, the first feature, and the non-goals    |
| `README.md`, `AGENTS.md`, `docs/README.md` | the way in; they link, they do not restate |

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

Every module under `src/` opens with a comment stating what it owns and what it
refuses to own; `tests/policy/source-module-headers.test.ts` fails a build that
is missing one. Comments elsewhere state the constraint the code cannot show,
never what the next line does. Configuration that decides behaviour — the
Electron fuses, the strictness flags, a workflow's reason to exist — carries the
reason on the line it governs.

An investigation that cost a wrong turn is recorded the same way: one round per
hypothesis, what was built on it, the measurement that killed it, and the lesson
it leaves. `internal/upstream/investigation-template.md` holds that shape and
`internal/upstream/investigation-log.md` is the worked example. The next reader
is meant to inherit the dead ends rather than walk back into them.

## Layout

| Path                      | Ownership                                                     |
| ------------------------- | ------------------------------------------------------------- |
| `src/main/main.ts`        | composition root, ArenaNet client update, app state           |
| `src/main/core/`          | chunks, manifest, DNS, sockets, settings                      |
| `src/main/certification/` | the official -> template-save -> Enhancement chain: certified tables, both transforms, the isolated proof, and the Enhancement switches |
| `certificates/`           | the reviewed ArenaNet client-generation heartbeat used by scheduled recertification |
| `src/main/protocol.ts`    | secure `gw://app` routing and snapshot ranges                 |
| `src/main/ipc.ts`         | validated native capability handlers                          |
| `src/main/diagnostics.ts` | the diagnostics subsystem's one entry point                   |
| `src/main/diagnostics/`   | flight recorder, capture, samplers, schema, detector, export  |
| `src/preload/preload.body.cjs` | frozen sandbox-compatible capability bridge; its channel constants are spliced in by `scripts/generate-preload.ts` |
| `src/renderer/`           | loading/settings UI, `Module` host, graphics, diagnostics     |
| `src/shared/`             | canonical contracts and boundary validators                   |
| `src/tools/certification.ts` | the one certification command line: `doctor`, `recertify`, `template`, `transform`, `double-click` |
| `src/tools/diagnostics/`  | diagnostics ZIP validation, summary, comparison               |
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
- That `chdir(MOUNT)` is why anything reaching the mount *after* startup
  addresses it absolutely. `src/renderer/filesystem.ts` spells the template
  directories mount-relative because it runs before the chdir;
  `src/renderer/template-store.ts` spells the same two `/app:/Templates/…`
  because it runs after, and the relative form would resolve to
  `/app:/app:/Templates/…`. Every read finds nothing, the pane concludes the
  game is not running, and no fake filesystem catches it — a fake treats a path
  as an opaque key. Two tests hold this: the directories must agree across the
  two modules, and the store's must be absolute.
- Build templates import to the type root only. The client's scan enumerates
  `Templates/<type>/*.txt` and never descends, so a template written into a
  subfolder is saved, appears in an export, and is never listed in game —
  defect 8 in `internal/upstream/upstream-defects.md`. A folder name survives
  as part of the template name instead.
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
  `ARENANET_REQUEST_CEILING` in `src/shared/contracts.ts` is the one
  declaration all three schedulers import, and
  `tests/unit/the-download-schedulers-share-one-ceiling.test.ts` refuses a
  second. A renderer module may import a `src/shared` *value*, but only from
  the named allowlist `RENDERER_SHARED_MODULES` in `src/main/protocol.ts`,
  which is what serves `build/shared` under `gw://app/shared/`. A value import
  of anything else 404s at runtime, and neither the type checker, the linter
  nor the unit tests catch it.
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
  `docs/process-model.md` owns the reasoning; `tests/electron/steam-acquire.spec.ts`
  pins the presentation.
- Persistent secrets are available only to the provisioned `release`,
  `preview`, and `development` distribution channels. Their distinct bundle
  IDs give them mutually isolated Data Protection Keychain groups. The marker
  is configuration, not authorization; the host bundle ID, application
  identifier entitlement, and provisioning profile are the authorization.
  Unpackaged development and ordinary/ad-hoc packages use the volatile
  in-memory implementation and lose secrets at quit; there is no file,
  mock-Keychain, or `safeStorage` fallback. Only Release deletes exactly the
  retired `credentials.bin` and `steam-session.bin`, never other profile data;
  Preview and Development preserve them. The
  cookie-encryption fuse is disabled so Chromium cannot create its separate
  Safe Storage Keychain item. All builds clear browser cookies at startup and
  quit.
- Forge accepts one `GW_PACKAGE_INTENT`: `local`, `preview-handoff`, `release`,
  or `development`. Do not recreate independent channel/signing flags; the
  closed intent is what makes unsupported package states unrepresentable.
- Runtime authorization comes from compiled certification tables or the
  isolated local structural verifier. There is no remote certification
  authority. Newly measured Enhancement facts ship in a signed application
  release; when certification refuses, verified official ArenaNet bytes remain
  playable and optional Tools degrade independently.
- The app makes no network request the user was not plainly told about.
  `autoCheckUpdates` (default `true`, declared as one pre-checked line at first
  run and in Settings → Updates) performs one release check at launch, then at
  most one every six hours while the app stays open — never while a game
  connection is open — and governs **every** automatic check without
  exception, including the one on an unrecognised client build; switched off,
  a launch reaches github.com zero times, forever. `src/main/app-updater.ts` is the only
  caller of the releases API and the single owner of application discovery,
  release validation, download, ready, and install state. Only an official
  package carrying the release marker may reach Squirrel.Mac. A release-identity stable
  version receives stable releases only; a release-identity prerelease may
  advance to a later eligible prerelease or stable. The separately signed
  Preview tester app cannot use AppUpdater. A ready update waits for an explicit
  or ordinary restart. ArenaNet client updates remain separate and automatic.
  `docs/content-pipeline.md` owns the mechanism and `docs/user-guide.md` owns
  what the player is told.

## Diagnostics and privacy

There is one canonical main-process flight recorder and one diagnostics ZIP.
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
promise more. `docs/diagnostics.md` states which tier covers which file.

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
pnpm tools:test:e2e
```

`pnpm test:policy` holds the repository invariants that need no build: import
boundaries, lint coverage, action pinning, fuses, font licensing, forbidden
artifacts, and documentation links.

`pnpm test:unit` is deterministic: it neither reads an installed Guild Wars
client nor produces a non-gating coverage artifact. Real client bytes belong to
`GW_CLIENT_WASM=/absolute/path/Gw.jspi.wasm pnpm test:client-artifact`, which is
run deliberately during client certification rather than opportunistically on
one developer's machine and skipped in CI.

`pnpm verify:runtime` builds once and runs the source, browser, native and
Electron gates against that output. `pnpm verify` packages that exact build and
runs the packaged smoke; it never recompiles between runtime and artifact
proof. Pull requests run the complete form. A release runs the runtime form and
lets its signed candidate own the one package smoke. The website is not part of
either: `apps/website` has its own path-filtered workflow, and
`pnpm test:website` runs that suite locally.

Electron and integration tests need permission to launch a local app and bind
loopback fixtures. Test launches set `GW_BACKGROUND_LAUNCH=1` so the window
appears without stealing keyboard focus; the few specs that assert on real OS
focus opt out and say why. The production-network smoke is explicitly opt-in:

```bash
pnpm build && GW_LIVE_SMOKE=1 pnpm test:electron
```

When an ArenaNet client update lands, a build is in one of three states and
`src/main/certification/client-certification.ts` is the only thing that decides which. Known
hashes use the shipped tables. An unknown hash is checked by the bounded
isolated process in `src/main/certification/local-client-verifier-host.ts`; only an exact
structural proof may supply locally derived records. The template proof hashes
the complete affected caller bodies after normalising only the selected call
indices; the Enhancement proof requires every certified static address in the same
complete code-reference contexts. Any other change serves the untouched
official module. The
`client.buildCertification` gauge in a diagnostics export names it —
`certified`, `template-only` (templates save, enhancement tools cannot load), or
`uncertified` — and `wasm.templateSaveCompatible` is the older boolean
derived from that same answer. `pnpm certification template` re-derives the
template build entry with the same production locator, and `--write` puts a
derived entry into the authoring table so a patch-day branch and a developer's
paste produce the same text. It never writes `ENHANCEMENT_BUILDS`: those layout
words are client-memory addresses no structural anchor re-derives.
`internal/upstream/recertify.md` owns investigation when the local proof
refuses.

`.github/workflows/client-recertification.yml` runs that derivation without
being asked. Every quarter hour it fetches one patch manifest and compares the
published JSPI code generation against `certificates/certified-client.json`;
matching, it exits in about a second, and a scheduled run that cannot fetch
fails loudly, which is the heartbeat. On a change it downloads the code
artifacts — never `Gw.snapshot` — runs the same certification command line, and
pushes a branch with a pull request and a tracking issue, or an issue alone when
the layout stopped being derivable. It holds no secret, uploads evidence and
never client bytes, and its branch is worth nothing until the pull request's
`pnpm verify` gate passes on it. The recorded generation carries no authority;
it decides only whether that job runs.

The scheduled `client-recertification.yml` workflow and the local verifier are
the patch-day owners. There is no remote certificate publication path. Changes
to compiled Enhancement facts ship through the normal signed application
release, while an unknown official client remains the fallback.

For enhancement work, begin with `pnpm certification doctor`, use the offline layers in
`docs/enhancement-development.md`, and finish with one scoped `enhancements:live`
scenario. Live enhancement runs are cached-only unless `--allow-update` is
explicit; do not bypass that guard or use a temporary Electron profile.

Certified Core (native cursor and template support) remains active whenever its
exact build proof passes. GWonMac Tools Beta is optional and off by default; its
first enable may restart to select the commands derivative, but individual tool
toggles are live afterward. The existing `ToolsHost` mounts with a null command
port when an unknown official client has no certified companion manifest, so
Build and Team authoring remains available without importing Enhancement code.
`tests/packaged-enhancement-runtime.ts` owns that normal packaged route; a
manually mounted renderer test is not sufficient. Optional observers and
commands must be inactive in PvP, guild halls, and unknown regions. Team Apply
is an explicit PvE-outpost configuration action: include the player, confirm
every step from observed state, and expose no generic opcode command.
Unsupported team fields are deleted from the released model rather than stored
and ignored.

Before finishing, check for a second source of truth, retained old paths,
unnecessary structure, harder debugging, broken architecture decisions, and
missing failure-path coverage.

## Conduct

ArenaNet production infrastructure is shared by every installation. Keep the
honest user agent, exponential backoff, hash verification, and eight-request
ceiling. Never load-test live services. Use offline fixtures for automated
tests and one deliberate live confirmation only when needed.
