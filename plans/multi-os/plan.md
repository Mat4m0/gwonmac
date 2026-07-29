# Multi-OS and profile-management implementation plan

Status: proposed; no phase in this file is current product behaviour
Specification: [spec.md](spec.md)
Repository rules: [AGENTS.md](../../AGENTS.md)
Prepared: 2026-07-29

## 1. How to use this plan

This plan is ordered by risk, not by demo appeal. A phase is complete only when
its exit gate passes. Do not start a dependent phase because the UI from the
previous phase looks finished.

For every work packet:

1. Read the specification sections and repository files named by the packet.
2. Confirm the acceptance IDs and failure paths before changing code.
3. Keep one source of truth and hard-cut over from the old path.
4. Add or update tests in the same change.
5. Run the packet checks, then the phase gate.
6. Record native/manual evidence under `plans/multi-os/evidence/`; never commit
   credentials, game binaries, `.gwdiag` reports, private traffic, or user
   paths.
7. Delete superseded code and temporary experiments before marking the packet
   complete.

Checkboxes are an execution ledger. An AI agent may mark a box only after the
named evidence exists. A developer reviewing agent work should be able to
re-run the command or follow the evidence note without reconstructing the
agent's reasoning.

## 2. Programme gates and dependencies

```text
Phase 0  decisions, feasibility, native baselines
   │
   ├── Phase 1  portable single-window foundation
   │      └── Phase 2  native preview packages and CI
   │             └── Phase 3  platform credential contract
   │
   └── Phase 4  main-process ownership refactor
          └── Phase 5  isolated profiles + sequential manager
                 └── Phase 6  two simultaneous games (conditional)

Phase 2 + Phase 3 ──► Phase 7 Windows signed release
Phase 2 + Phase 3 ──► Phase 8 Linux supported release
Phase 3 + Apple identity ──► Phase 9 notarized macOS + Keychain

Phases 6–9 ──► Phase 10 unified release surface and maintenance handoff
```

Phase 6 is absent from production unless both of these external gates pass:

- current written ArenaNet clarification permits the proposed independent
  Guild Wars 1 simultaneous-client behaviour; and
- the IDBFS/performance qualification meets the specification budgets.

There is no dormant simultaneous-launch feature flag if either gate fails.
Sequential profile management remains a valid completed product.

## 3. Decisions already specified

| Decision | Chosen direction |
| --- | --- |
| OS process model | One Electron main process; keep the single-instance lock |
| Initial public targets | macOS 15 arm64 ZIP, Windows 11 x64 Squirrel, Ubuntu 24.04 x64 `.deb` |
| Profiles | Directory-backed metadata; no database/index |
| Runtime sharing | One client generation, chunk store, socket manager, recorder, and settings store |
| Browser storage | One explicit persistent Electron session path per profile |
| Account entry | Official game login only; manager stores labels, not account fields |
| First profile release | Sequential, one live game globally |
| First simultaneous release | At most two live game windows, one per profile |
| Input | Never broadcast; one focused window only |
| macOS preview credentials | Mock keychain with explicit weaker-protection notice |
| macOS production credentials | Hard cutover to real Keychain after Developer ID signing |
| Windows credentials | User-scoped DPAPI through Electron safe storage |
| Linux credentials | Secure inspected backend only; refuse `basic_text` |
| Application updates | Manual replacement; no auto-installer |
| Linux formats | `.deb` only in the initial supported release |
| Mutable IDBFS sharing | Forbidden |

External decisions/inputs still required:

| Input | Blocks | Owner action |
| --- | --- | --- |
| Written ArenaNet GW1 simultaneous-client clarification | Phase 6 production merge | Product owner contacts ArenaNet and records the answer without account-private correspondence |
| Minimum two-client hardware class | Phase 0 performance gate | Adopt the measured minimum; recommended starting qualification is 16 GB RAM |
| Archive-codec dependency selection | Phase 1 diagnostics work | Approve the bounded dependency record from WP-0.4 |
| Windows publisher identity/provider | Phase 7 | Complete identity/cost/region review |
| Apple Developer ID credentials | Phase 9 | Enrol and provision trusted release secrets |

## 4. Verification layers

Use the existing layers rather than building a second test system:

| Layer | Purpose |
| --- | --- |
| `pnpm check` | Typecheck, lint, links, unit, and policy inner loop |
| `pnpm build && pnpm test:integration` | Real filesystem/network-loopback ownership and failure behaviour |
| `pnpm build && pnpm test:electron` | Real sandbox, renderer, input, session, and lifecycle behaviour |
| `pnpm test:release` | Source/release contracts and artifact-set logic |
| `pnpm package && pnpm test:packaged` | Final executable, ASAR, fuses, startup, and native metadata |
| `pnpm verify` | Complete native gate |
| Level 1 captures | Performance proof |
| Level 2 traces | Cause-finding only |
| Native hardware checklist | Signing, focus, GPU, audio, installer, and OS integration |

Future shared tests must run on all three native runners. An OS-specific test
uses an explicit platform guard and has a corresponding matrix row; it is not
quietly skipped everywhere except the author's machine.

## 5. Phase 0 — decisions, feasibility, and baselines

Relative effort: 2–4 engineer-weeks
Code shipped: none; throwaway probes stay outside production imports

### Objective

Remove product contradictions, prove the riskiest assumptions, and establish
the evidence against which later refactors are judged.

### WP-0.1 — product and support hard cutover

Specification: sections 2, 3, and 18
Acceptance: MOS-P01

- [x] Rewrite [PRODUCT.md](../../PRODUCT.md) so Windows/Linux and named
  profiles are goals, sequential switching is allowed, simultaneous play is
  conditional, and automation remains permanently excluded.
- [x] Update the overview/non-goal wording in [README.md](../../README.md) and
  the load-bearing constraints in [AGENTS.md](../../AGENTS.md).
- [x] Add proposed user claims and proof rows to
  [docs/internals.md](../../docs/internals.md); mark unimplemented claims as
  non-public rather than “proof: none.”
- [x] Record the exact initial support matrix and primary package per OS.
- [x] Record that the Windows WASM build is an alternative, not a
  faster-than-DirectX claim.
- [x] Add the permanent no-input-broadcast/no-DLL-injection product language.

Verification:

```bash
pnpm check:links
pnpm test:policy
```

### WP-0.2 — IDBFS and `Gw.dat` feasibility

Specification: sections 9, 13, and 15
Acceptance: evidence prerequisite for MOS-M01 and MOS-F02

- [ ] Add an offline-only experiment that starts isolated sessions A, B, and C
  against synthetic protocol data. It must not contact ArenaNet.
- [ ] Inventory files under the current IDBFS and classify each as
  reconstructable, user-authored, or unknown. Do not log file contents or
  user paths.
- [ ] Measure disk growth, restore time, peak/steady process RSS, close time,
  and write amplification for each session.
- [ ] Kill one renderer during auto-persistence and verify that other session
  stores remain readable.
- [ ] Measure how much of a clean isolated profile's `Gw.dat` is satisfied by
  resident native chunks and whether any remaining request is only the normal
  result of the user's launcher choice.
- [ ] Measure Chromium cache on/off for cold and warm startup. Do not commit a
  cache choice before the result.
- [ ] Write `plans/multi-os/evidence/idbfs-feasibility.md` with machine,
  Electron/client fingerprints, exact procedures, results, and the
  proceed/block decision. Do not include absolute paths.
- [ ] Delete the experiment if it exposes production capabilities; retain only
  a bounded test harness that will guard the selected design.

Exit criteria:

- Separate profile sessions show no cross-profile data.
- User-owned migration roots are closed and named.
- Sequential disk/startup cost is accepted and documented.
- The two-window decision is explicitly pass or blocked.

### WP-0.3 — credential-provider probes

Specification: section 10
Acceptance: evidence prerequisite for MOS-C01 and MOS-C02

- [ ] On the pinned Electron version, exercise macOS mock keychain, macOS real
  Keychain in a signed local probe if identity exists, Windows DPAPI, Linux
  Secret Service/KWallet, locked keyring, missing keyring, and forced
  `basic_text`.
- [ ] Confirm the exact async safe-storage error and key-rotation behaviour;
  do not implement against documentation fields the runtime does not expose.
- [ ] Prove that Linux `getSelectedStorageBackend()` provides the fail-closed
  decision required by the specification.
- [ ] Write
  `plans/multi-os/evidence/credential-provider-matrix.md` with only provider
  names, states, Electron/OS versions, and pass/fail results.
- [ ] Fix the provider choice in a decision row before WP-3.1 begins.

### WP-0.4 — portability dependency decisions

Specification: sections 11 and 14
Acceptance: design prerequisite for MOS-X02 and MOS-B01

- [ ] Evaluate maintained streaming ZIP codecs for licence compatibility,
  entry/size bounds, ZIP64 behaviour, no or minimal transitive dependencies,
  ESM support, maintenance history, and packaged size.
- [ ] Prefer one direct dependency over a home-grown archive implementation.
  If all candidates fail, document why a closed ZIP subset is safer.
- [ ] Test Node atomic rename, directory fsync, destination replacement, locked
  destination, Unicode/long paths, and antivirus-like transient sharing errors
  on all three OSes.
- [ ] Verify Squirrel and Debian makers accept the canonical release version
  and filename rules.
- [ ] Write `plans/multi-os/evidence/portability-decisions.md` naming the
  selected archive approach and exact atomic-file platform contract.

### WP-0.5 — performance baseline

Specification: section 13
Acceptance: baseline for MOS-F01 and MOS-F02

- [ ] Capture five clean Level 1 runs for every specification baseline
  scenario on each release-blocking hardware class available now.
- [ ] Preserve mirrored order and current client/app fingerprints.
- [ ] Record manager-idle as a synthetic lightweight-page target before a
  manager exists; this sets its resource ceiling.
- [ ] Add results to [docs/performance-electron.md](../../docs/performance-electron.md)
  using its existing evidence conventions.
- [ ] Choose and record the minimum supported two-client hardware. If no
  available machine meets the budgets, mark Phase 6 blocked.

### Phase 0 gate

- [ ] All five work packets are complete.
- [ ] `pnpm check` passes.
- [ ] The product documents no longer contradict the approved direction.
- [ ] IDBFS, archive, atomic-file, credentials, and performance have written
  decisions.
- [ ] No probe or private evidence is imported by a packaged build.

Do not continue if the team is still debating whether profiles or the target
OSes are product goals.

## 6. Phase 1 — portable single-window foundation

Relative effort: 3–5 engineer-weeks
Public behaviour: unchanged single-profile macOS preview

### Objective

Remove accidental macOS assumptions while keeping exactly one game window and
the current storage layout. This phase reduces variance before packaging or
profiles are added.

### WP-1.1 — trusted platform contract

Specification: sections 4.3 and 12
Acceptance: supports MOS-S01

Primary files:

- [src/shared/contracts.ts](../../src/shared/contracts.ts)
- [src/main/window.ts](../../src/main/window.ts)
- [src/preload/preload.body.cjs](../../src/preload/preload.body.cjs)
- [src/renderer/input.ts](../../src/renderer/input.ts)
- [src/renderer/loading.ts](../../src/renderer/loading.ts)
- [src/renderer/platform-capabilities.ts](../../src/renderer/platform-capabilities.ts)

Tasks:

- [x] Add and validate `DesktopPlatform` in the canonical renderer-init
  contract.
- [x] Pass it through the existing additional-argument/preload path and freeze
  it.
- [x] Gate only the proven macOS input repairs; preserve common input code.
- [x] Replace unconditional “macOS” runtime wording with closed
  platform-specific copy.
- [x] Add unit tests for invalid init values and per-platform unavailable
  capability wording.
- [x] Add Electron input cases for Windows/Linux semantics on their native
  jobs; keep mac-specific cases explicit.

Do not use user-agent parsing or a renderer-supplied platform.

### WP-1.2 — portable packaged-layout test helper

Specification: section 14.2
Acceptance: prerequisite for MOS-B01

Primary files:

- [tests/packaged-smoke.ts](../../tests/packaged-smoke.ts)
- [tests/packaged-enhancement-runtime.ts](../../tests/packaged-enhancement-runtime.ts)
- [tests/electron/fixtures.mts](../../tests/electron/fixtures.mts)

Tasks:

- [x] Add one test/build-only resolver for Electron development executable and
  packaged executable/resources/ASAR locations.
- [x] Replace hard-coded `.app` paths in Electron fixtures and enhancement
  tooling.
- [x] Add a platform-native child termination helper; assert outcomes rather
  than a POSIX signal name.
- [x] Separate shared package assertions from macOS metadata/signature
  assertions.
- [x] Delete every package-path copy superseded by the helper.

### WP-1.3 — portable atomic documents

Specification: section 14.1
Acceptance: supports MOS-C02 and MOS-M01

- [x] Implement the Phase 0 atomic-file contract without changing the public
  `writeAtomic` semantics.
- [x] Keep same-directory exclusive partial creation, file sync, close, and
  atomic replace.
- [x] Apply mode and directory fsync only where they are meaningful and tested.
- [x] Add bounded Windows retries only for the approved transient error codes.
- [x] Replace POSIX-signal assumptions in crash tests with a
  platform-native force-termination barrier.
- [x] Add native fault tests proving the old or new complete value always
  survives.

### WP-1.4 — portable `.gwdiag`

Specification: section 11
Acceptance: MOS-X02

- [x] Add the approved archive codec and its licence/notice/package-inventory
  treatment.
- [x] Implement direct bounded `writeDiagnosticZip` and `readDiagnosticZip`
  functions; do not add a generic archive service.
- [x] Replace every production/tool/test `ditto` call.
- [x] Preserve staging, privacy detection, `schemaChecked === records`, final
  atomic rename, and owner-only POSIX mode.
- [x] Add adversarial archives for traversal, absolute path, duplicate entry,
  link, bomb-sized metadata, unknown file, unsupported compression, truncation,
  and CRC/data failure.
- [x] Validate a golden report with an independent native extractor on macOS,
  Windows, and Linux.
- [x] Confirm production writer and test validator are not the same code path.

### WP-1.5 — remaining platform-neutral cleanup

- [x] Replace Finder/Command-only menu wording with `CmdOrCtrl` or explicit
  native branches.
- [x] Make common path tests use `path.join`; retain a literal test that pins
  the existing macOS legacy layout for migration.
- [x] Prove DNS fallback on Windows rather than assuming `/etc/resolv.conf`.
- [x] Treat unavailable thermal/power APIs as closed capability states.
- [x] Keep issue-template platform fields unchanged until corresponding
  targets exist; do not advertise an unbuilt package.

### Phase 1 gate

Run on macOS:

```bash
pnpm check
pnpm build
pnpm test:integration
pnpm test:electron
pnpm test:release
pnpm package
pnpm test:packaged
```

Exit:

- [ ] The existing macOS product behaves the same.
- [ ] No production `ditto` call or hard-coded Electron `.app` development
  path remains.
- [ ] Mac-only behaviour has a named platform branch and a native test.
- [ ] No generic platform-service layer or second settings source was added.

## 7. Phase 2 — native preview packaging and CI

Relative effort: 3–5 engineer-weeks
Public behaviour: single-profile previews; no new public support claim yet

### Objective

Produce short-lived, natively tested artifacts on all three OSes and prove the
packaged security/runtime boundary before publishing them.

### WP-2.1 — canonical release targets

Specification: section 16
Acceptance: MOS-B01

- [ ] Add `release-targets.json` with the exact target/format set from the
  specification.
- [ ] Add one TypeScript parser/validator used by Forge/build/release tests and
  website asset selection.
- [ ] Make the CI setup job emit its matrix from that document.
- [ ] Reject duplicate target IDs, filenames, and ambiguous asset matches.
- [ ] Keep `package.json` as the sole application-version source.
- [ ] Add platform version derivation tests for macOS, Squirrel, and Debian
  without copying version regexes.

### WP-2.2 — Forge makers, icons, and Squirrel startup

Primary files:

- [forge.config.ts](../../forge.config.ts)
- [package.json](../../package.json)
- [assets](../../assets)

Tasks:

- [ ] Add the approved Forge makers for Squirrel.Windows and Debian.
- [ ] Keep ZIP as the macOS public artifact; use a Windows ZIP only as an
  internal preview diagnostic if a test requires it.
- [ ] Add properly licensed/generated `.ico` and Linux PNG assets derived from
  the project's existing artwork.
- [ ] Add required Debian metadata, desktop entry, categories, executable
  permissions, and dependencies.
- [ ] Handle Squirrel install/update/uninstall/obsolete startup arguments in
  one direct early function before normal composition; add argument tests.
- [ ] Do not add `autoUpdater`.
- [ ] Preserve exact ASAR inventory and font licence resources on every target.

### WP-2.3 — fuses on every final executable

Specification: section 14.3
Acceptance: MOS-S01

- [ ] Replace the Darwin-only fuse hook with one central Forge fuse
  configuration that receives the target platform.
- [ ] Apply the specified fuse set before signing.
- [ ] Reset ad-hoc signatures only where the Forge/Electron contract requires
  it.
- [ ] Read and assert actual fuse bytes from macOS, Windows, and Linux packaged
  executables.
- [ ] Assert ASAR integrity only on platforms where Electron enforces it.
- [ ] Delete the obsolete Darwin-only hook and source-literal-only proof.

### WP-2.4 — native verification workflow

Primary files:

- [.github/workflows/macos-verify.yml](../../.github/workflows/macos-verify.yml)
- [.github/workflows/release.yml](../../.github/workflows/release.yml)

Tasks:

- [ ] Replace the reusable macOS-only verifier with a native matrix workflow.
- [ ] Run shared static work once and native build/unit/integration/Electron/
  package/packaged tests on every OS.
- [ ] Use Xvfb/X11 with a working Electron sandbox on Linux. Never add
  `--no-sandbox`.
- [ ] Assert the runner's actual platform/architecture before naming an
  artifact.
- [ ] Keep Playwright workers at one.
- [ ] Upload only short-lived tested preview artifacts and non-sensitive test
  evidence.
- [ ] Extend `pnpm verify` to run Forge `make` and a new final-artifact smoke
  after the existing unpacked-package smoke. The final-artifact smoke extracts
  the macOS ZIP/DEB without privilege and installs Squirrel in a disposable
  Windows user profile; clean-machine DEB installation remains a native
  release qualification.
- [ ] Update PR, main-snapshot, tester, and release callers in the same hard
  cutover; delete the old one-target workflow.

### WP-2.5 — artifact manifests and immutable handoff

- [ ] Generate the versioned artifact manifest defined in the specification.
- [ ] Include source commit, Electron version, target, format, filename, hash,
  signing posture, and CI run URL.
- [ ] Verify the manifest against the actual artifact, not Forge intent.
- [ ] Generalise SBOM/checksum generation without shell-specific hash commands
  where a Node implementation is simpler.
- [ ] Make the assembler require the exact configured public set and one
  version/commit.
- [ ] Preserve the current least-privilege publisher: no checkout, install,
  build, or signing after handoff.

### Phase 2 gate

On every native OS:

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm verify
```

Additional native proof:

- [ ] Install/unpack the final artifact into a path with spaces and non-ASCII
  text.
- [ ] Launch main → protocol → preload → renderer → diagnostics offline.
- [ ] Verify version, identity, icons, licences, ASAR inventory, and fuse bytes.
- [ ] Close it and prove no process remains.
- [ ] Confirm the artifact and manifest hash handed off are exact.

Unsigned/ad-hoc artifacts remain previews. Do not update public support wording
yet.

## 8. Phase 3 — platform credential contract

Relative effort: 2–4 engineer-weeks
Public behaviour: accurate per-OS Remember Login posture, still one profile

### Objective

Make credential state versioned, asynchronous at the application boundary,
provider-aware, and failure-safe before multiplying credential files.

### WP-3.1 — versioned promise-based store

Specification: section 10.1
Acceptance: MOS-C02

Primary files:

- [src/main/core/credentials.ts](../../src/main/core/credentials.ts)
- [src/shared/contracts.ts](../../src/shared/contracts.ts)
- [tests/unit/credentials.test.ts](../../tests/unit/credentials.test.ts)

Tasks:

- [ ] Introduce the exact credential envelope and one parser.
- [ ] Change store operations to the closed promise-based read contract.
- [ ] Preserve the awaited game-facing `Module.secureStorage` contract.
- [ ] Implement atomic key-rotation rewrite from returned plaintext.
- [ ] Preserve prior ciphertext for provider unavailable, decrypt failure,
  invalid replacement, write failure, or wrong provider.
- [ ] Read current raw mock ciphertext once and rewrite it only after successful
  decryption.
- [ ] Add size bounds before base64 allocation/decryption.

### WP-3.2 — OS provider policy

Specification: sections 10.2 and 10.3
Acceptance: MOS-C01

- [ ] macOS preview: retain `use-mock-keychain` before ready and assert it at
  runtime/package policy.
- [ ] Windows: use async safe storage/DPAPI and document its user boundary
  accurately.
- [ ] Linux: wrap the inspected synchronous backend in the promise API and
  refuse `basic_text`, unknown-before-ready, or unavailable state.
- [ ] Render closed “Remember Login unavailable” behaviour without showing
  provider error text.
- [ ] Never place credentials in browser storage, logs, diagnostics, crash
  reports, command lines, profile metadata, or manager state.

### WP-3.3 — native credential matrix

- [ ] Save → restart → load → forget on each final package.
- [ ] Wrong OS user cannot decrypt where the OS contract promises that.
- [ ] Locked/temporarily unavailable provider preserves ciphertext.
- [ ] Corrupt envelope and corrupt ciphertext are distinct closed failures.
- [ ] Linux secure keyring works; missing/`basic_text` disables persistence.
- [ ] Windows copy to another OS user fails; same-user limitation is documented
  rather than overclaimed.
- [ ] macOS preview UI says it is not Keychain-backed.
- [ ] Detector/policy tests reject secret vocabulary or account fields in every
  new persistence/diagnostics schema.

### Phase 3 gate

```bash
pnpm check
pnpm build
pnpm test:integration
pnpm test:electron
pnpm package
pnpm test:packaged
```

- [ ] Native credential matrix passes on all preview artifacts.
- [ ] No read failure deletes ciphertext.
- [ ] Current macOS preview users retain or explicitly re-enter saved login
  according to the tested envelope migration.

## 9. Phase 4 — main-process ownership refactor

Relative effort: 3–5 engineer-weeks
Public behaviour: still exactly one game window and legacy default profile

### Objective

Remove singleton window assumptions and arbitrary targeting before introducing
a second window. This phase changes ownership, not product multiplicity.

### WP-4.1 — `AppRuntime` composition

Specification: sections 4 and 8
Acceptance: MOS-A01 and MOS-D01

- [ ] Create one explicit `AppRuntime` owner for client, chunks, sockets,
  settings, diagnostics, progress, and window registry.
- [ ] Pass concrete dependencies; do not add a container/service locator.
- [ ] Keep one `ClientRuntime` and one global scheduler.
- [ ] Move boot/shutdown ordering from scattered module globals into direct
  lifecycle methods.
- [ ] Prove `dispose()` is idempotent and waits for current settings/window/
  recorder writes.

### WP-4.2 — `WindowRegistry`

Specification: section 6.2
Acceptance: MOS-A02 and MOS-R02

- [ ] Add exact object+ID registry ownership and closed sender contexts.
- [ ] Register the current one game window as a game role without fabricating a
  profile ID. Phase 5 adds the final profile binding when `ProfileStore`
  becomes canonical.
- [ ] Remove record/resource ownership on reload, crash, and destruction.
- [ ] Replace `getMainWindow()` authorization and
  `BrowserWindow.getAllWindows()[0]` behaviour.
- [ ] Make progress broadcast iterate explicit eligible registry records.
- [ ] Add stale ID/object reuse, destroyed sender, wrong role, wrong frame, and
  wrong URL tests.

### WP-4.3 — explicit commands, menu, and diagnostics target

Specification: sections 6 and 11
Acceptance: MOS-X01

- [ ] Delete `canonicalRendererWindow()` and require an explicit target.
- [ ] Make menu handlers resolve the focused/owned record at click time.
- [ ] Make renderer recovery state per registry record.
- [ ] Maintain renderer clocks by `WebContents`.
- [ ] Target diagnostics at one explicit slot; terminate cleanly if it dies.
- [ ] Replace tests that depend on window array order with exact Page/window
  ownership.

### WP-4.4 — session installer

Specification: section 6.1
Acceptance: MOS-S01

- [ ] Extract one direct session-hardening/protocol installation function.
- [ ] Apply permission, navigation, CSP, user-agent, download, and `gw`
  protocol rules once to the current session.
- [ ] Make repeat installation a detected programming error, not silently
  stacked handlers.
- [ ] Prove pointer-lock permission is tied to the exact registered game
  window.

### WP-4.5 — single-window lifecycle preservation

- [ ] Keep current red-X/quitting behaviour in this phase.
- [ ] Preserve renderer recovery, window-state restore, power blocker,
  settings, update policy, and clean socket close.
- [ ] Extend the GitHub-zero-request test through the new registry/runtime.
- [ ] Delete old singleton state after all callers use the new owners.

### Phase 4 gate

```bash
pnpm verify
```

- [ ] All existing one-window behaviour passes on the three native preview
  packages.
- [ ] Source search finds no arbitrary first-window targeting.
- [ ] Composition tests prove one shared client/cache/socket/recorder.
- [ ] No public profile manager exists yet.

## 10. Phase 5 — isolated profiles and sequential manager

Relative effort: 5–8 engineer-weeks
Public behaviour: named profiles, exactly one live game at a time

### Objective

Add account-friendly management without simultaneous play. This phase proves
profile persistence, migration, role separation, and isolated sessions while
keeping runtime concurrency simple.

### WP-5.1 — split paths and directory-backed `ProfileStore`

Specification: section 5
Acceptance: MOS-R01, MOS-R02, and MOS-D01

- [ ] Replace `GamePaths` with disjoint `AppPaths`/`ProfilePaths` and migrate
  every caller in one cutover.
- [ ] Keep the existing `game/` and chunk paths byte-for-byte stable.
- [ ] Add branded `ProfileId`, random generation, parser, and path containment.
- [ ] Implement scan/create/rename/list/deferred-trash without a database or
  index.
- [ ] Validate the exact `profile.json` schema and canonical label rules.
- [ ] Stage/publish creation atomically and clean only recognised incomplete
  stages.
- [ ] Make delete write the closed `trash-on-start` marker and request restart;
  process marked roots with `shell.trashItem` before any profile session is
  created. Preserve the profile/marker on failure and never recursively
  delete.
- [ ] Test traversal, separators, absolute paths, reserved Windows names,
  Unicode normalisation/control/bidi, long labels, duplicate labels, and
  hostile HTML-like display text.
- [ ] Prove profile operations cannot return or delete an app-global path.

### WP-5.2 — typed one-time migration

Specification: section 15
Acceptance: MOS-M01

- [ ] Add a migration journal whose states correspond only to durable steps.
- [ ] Create the first generated `Default` profile.
- [ ] Move root credential/window documents with atomic, idempotent operations.
- [ ] Add a dedicated legacy renderer that can read only the closed
  user-authored IDBFS roots from WP-0.2.
- [ ] Transfer bounded chunks under main-controlled sequencing; the renderer
  supplies no destination/profile ID.
- [ ] Import into the new profile session and hash/round-trip every file.
- [ ] Write the typed recoverable backup, then clear only the legacy origin
  through Electron's session API.
- [ ] Start without copying `Gw.dat`; reuse shared resident chunks and the
  user's normal `dataStrategy` through the ordinary launcher path, with no
  migration-specific network request.
- [ ] Inject failure after every journal step and prove resume yields one
  complete profile and one canonical shared cache.
- [ ] Exclude migration channels/code from production reach after the
  migration-complete state; schedule deletion after one stable release.

Do not copy Chromium storage directories and do not leave a special
default-session profile path.

### WP-5.3 — profile sessions

Specification: sections 6.1 and 9
Acceptance: MOS-R01 and MOS-S01

- [ ] Create `session.fromPath(profilePaths.browser, chosenOptions)` only in
  main.
- [ ] Install the game protocol/security/permission policy on each new session.
- [ ] Bind one game window and one credential store to its registered profile.
- [ ] Make cookie/cache/IndexedDB reset operate on the selected stopped
  profile's session only.
- [ ] Keep global native cache reset separately confirmed and unavailable
  while a game is running.
- [ ] Add A/B IndexedDB/IDBFS sentinel and credential isolation tests across
  packaged relaunch.

### WP-5.4 — control window and role-specific IPC

Specification: sections 7 and 12
Acceptance: MOS-A02 and MOS-R01

- [ ] Add a lightweight packaged control page that never imports game modules.
- [ ] Add label-only profile creation and the exact v1 actions: Add, Rename,
  Launch/Focus, Close, Forget Saved Login, Move to Trash.
- [ ] Sort by canonical label; do not add ordering/groups/tags.
- [ ] Derive stopped/starting/running/closing status from the registry.
- [ ] Add role-specific frozen preload namespaces and main authorization.
- [ ] Ensure control IPC can select a profile for lifecycle actions but can
  never read credential plaintext or invoke game sockets.
- [ ] Ensure game IPC never accepts a profile ID.
- [ ] Keep game titles generic and labels out of diagnostics.

### WP-5.5 — sequential lifecycle

Specification: section 6.3
Acceptance: MOS-U01

- [ ] Enforce at most one live game globally.
- [ ] A Launch on another profile asks to close/flush the current game before
  starting the selected one.
- [ ] Game close flushes its IDBFS/session and closes its sockets without
  corrupting the manager.
- [ ] Control close with a game visible leaves that visible game running.
- [ ] Last visible window close exits with no background process.
- [ ] Second OS invocation focuses/recreates the control window.
- [ ] Official client clean exit closes its own game window.
- [ ] Add crash/reload/failure tests for every transition without persisting a
  runtime state machine.

### WP-5.6 — profile diagnostics/privacy

- [ ] Add ephemeral window slots and per-window clocks.
- [ ] Keep profile IDs/labels out of the closed schema.
- [ ] Require the control window to be destroyed before Level 2 tracing starts
  and recreate it after capture on request; refuse capture if it cannot close.
- [ ] Refuse or stop a capture whose target closes.
- [ ] Prove a corrupt profile A cannot prevent diagnostics or profile B from
  opening.

### Phase 5 gate

On all native preview packages:

```bash
pnpm verify
```

Manual/native scenarios:

- [ ] Migrate a synthetic legacy profile with fault injection.
- [ ] Create A/B, save distinct synthetic credentials, write distinct IDBFS
  sentinels, switch repeatedly, and relaunch.
- [ ] Prove no cross-profile credential, browser, window, or socket state.
- [ ] Prove native chunks are not copied and total disk use matches the Phase 0
  model.
- [ ] Prove manager idle stays within its recorded resource budget.
- [ ] Prove `autoCheckUpdates=false` reaches GitHub zero times across manager
  and profile launches.

Sequential profiles may be released here even if Phase 6 is blocked.

## 11. Phase 6 — two simultaneous game windows

Relative effort: 4–7 engineer-weeks after the gate
Public behaviour: two independent profiles at once
Preconditions: written ArenaNet clarification and WP-0.2/WP-0.5 pass

### Objective

Permit two independently focused game renderers without duplicating global
client/update infrastructure, broadcasting input, or splitting client
generations.

### WP-6.1 — client-generation launch gate

Specification: section 8.2
Acceptance: MOS-D02

- [ ] Defer client update/activation while any game is live.
- [ ] Permit only one qualification window for an unconfirmed candidate.
- [ ] Unlock the second launch only after existing health evidence promotes the
  generation.
- [ ] Defer retry/rollback operations that could split live renderers.
- [ ] Allow stable-generation full download through the one existing global
  scheduler.
- [ ] Test update arrival, candidate failure, renderer crash, retry, and close
  during every gate state.

Do not introduce per-window client generations.

### WP-6.2 — concurrent registry and lifecycle

Specification: sections 6.2 and 6.3
Acceptance: MOS-R02 and MOS-U01

- [ ] Replace the sequential global limit with the specified maximum of two.
- [ ] Keep one window per profile; duplicate launch focuses.
- [ ] Close/crash A without closing B or the control window.
- [ ] Quit All confirms once, flushes both deterministically, closes sockets,
  and exits.
- [ ] Reconcile the one power-save blocker directly from canonical download
  state and registry game-window count; do not add an independent counter.
- [ ] Resolve application-menu commands against the focused window at action
  time.
- [ ] Refuse profile delete/reset while its session is live.

### WP-6.3 — shared cache and socket concurrency

Specification: section 8
Acceptance: MOS-A01 and MOS-D01

- [ ] Run concurrent range requests from A/B and prove one same-hash
  acquisition.
- [ ] Prove the global ArenaNet maximum remains eight across both renderers.
- [ ] Preserve demand-over-prefetch priority across owners.
- [ ] Prove close/crash A calls only `closeAll(A)` and B continues over
  loopback sockets.
- [ ] Prove second warm launch performs no update request and no duplicate
  native chunk fetch.
- [ ] Gate global cache clearing until both game windows close.

### WP-6.4 — input non-broadcast evidence

Specification: sections 2.3 and 12.5
Acceptance: MOS-S02

- [ ] Policy test rejects production imports of global input hooks, robot
  libraries, arbitrary automation, and `webContents.sendInputEvent`.
- [ ] Packaged preload inventory exposes no input-send capability.
- [ ] Electron page-target tests prove commands do not cross windows.
- [ ] On each native OS, focus A and use physical keyboard/mouse input while an
  instrumented B receives none; repeat with focus reversed.
- [ ] Record only counts/pass-fail and hardware/OS versions, not key text or
  account data.

Playwright `page.keyboard` alone is not evidence of OS focus routing.

### WP-6.5 — multi-window diagnostics

Specification: section 11
Acceptance: MOS-X01

- [ ] Select an explicit target slot from manager/menu.
- [ ] Accept frame metrics only from that target and maintain per-renderer
  clock offsets.
- [ ] Include aggregate shared-process evidence without merging frame series.
- [ ] Start capture on A, close/crash A, and prove it never falls through to B.
- [ ] Require other games closed/idle for a performance-certification label.

### WP-6.6 — performance qualification

Specification: section 13
Acceptance: MOS-F01 and MOS-F02

- [ ] Re-run five clean single-window candidate arms and meet the existing
  regression gate.
- [ ] Run two-client foreground/background permutations on every
  release-blocking hardware class.
- [ ] Run the two-window 60-minute soak and clean shutdown.
- [ ] Record peak/steady memory, IDBFS disk cost, frame percentiles, startup,
  cache coalescing, socket timing, and duplicate request counts.
- [ ] Document the minimum supported/recommended memory without claiming an
  untested client count.
- [ ] If any blocking budget fails, remove/withhold simultaneous-launch code
  from production and open a separately specified measured optimization.

### Phase 6 gate

- [ ] Written policy evidence is recorded and current.
- [ ] `pnpm verify` passes on every native OS.
- [ ] Two-profile packaged isolation and lifecycle smoke passes.
- [ ] Real physical-input non-broadcast test passes on every OS.
- [ ] MOS-F01 and MOS-F02 performance evidence passes.
- [ ] No dormant third-window configuration exists.

## 12. Phase 7 — Windows signed general availability

Relative effort: 2–4 engineer-weeks plus publisher enrolment
Preconditions: Phases 2 and 3; Phase 6 is optional

### Objective

Turn the Windows x64 preview into a supportable, signed, per-user product.

### Work

- [ ] Select Microsoft Artifact Signing if eligibility/region/cost fit;
  otherwise use a reputable OV provider. Record the stable publisher subject.
- [ ] RFC 3161 timestamp the installer, uninstaller, main executable, crash
  handler, and every helper executable.
- [ ] Verify every PE file with `Get-AuthenticodeSignature`, expected publisher
  identity, and trusted timestamp.
- [ ] Install/uninstall as a standard user and exercise Squirrel install,
  update, uninstall, obsolete, and first-run paths.
- [ ] Upgrade from the previous tested package and preserve settings, profiles,
  DPAPI credentials, IDBFS, and native cache.
- [ ] Test Mark-of-the-Web/SmartScreen and Smart App Control on clean Windows
  11. Record observed prompts without promising their absence.
- [ ] Test integrated and discrete GPU, high/fractional DPI, snapping,
  fullscreen, pointer lock, audio-device changes, sleep/resume, and
  multi-monitor recovery.
- [ ] Copy ciphertext to a second Windows account and prove it cannot decrypt.
- [ ] Update Windows install/user/release docs and issue template with exact
  signed-publisher and data-retention language.
- [ ] Run the final signed installer through packaged smoke before hashing and
  handoff.

### Exit

- [ ] MOS-B01, MOS-B02, MOS-C01, MOS-S01, MOS-U01, and MOS-F01 pass for the
  final signed installer.
- [ ] Website may mark Windows 11 x64 supported.
- [ ] Release notes say early SmartScreen reputation prompts remain possible.

## 13. Phase 8 — Linux supported release

Relative effort: 2–4 engineer-weeks
Preconditions: Phases 2 and 3; Phase 6 is optional

### Objective

Support one narrow, honest Linux baseline before adding formats or
distributions.

### Work

- [ ] Install/remove the final `.deb` on a clean Ubuntu 24.04 x64 system and
  validate dependencies, executable permissions, desktop entry, icon, and
  application ID.
- [ ] Run GNOME Wayland release qualification with Secret Service unlocked,
  locked, temporarily unavailable, and absent.
- [ ] Run KDE Wayland with KWallet and X11 compatibility qualification.
- [ ] Prove `basic_text` and no-keyring modes disable Remember Login without
  deleting ciphertext.
- [ ] Test native Wayland focus, compositor-controlled position, fractional
  scaling, pointer lock, keyboard compose/AltGr, WebGL, audio, raw TCP,
  sleep/resume, and clean close.
- [ ] Keep the Electron sandbox enabled in package and CI.
- [ ] Verify checksum, SBOM, provenance, and artifact manifest.
- [ ] Document exact Ubuntu baseline and best-effort compatibility; do not
  claim AppImage, Flatpak, repository signing, or universal Linux support.
- [ ] Run one scoped live ArenaNet confirmation, never a production load test.

### Exit

- [ ] MOS-B01, MOS-B02, MOS-C01, MOS-S01, MOS-U01, and MOS-F01 pass for the
  final `.deb`.
- [ ] Website may mark Ubuntu 24.04 x64 supported.
- [ ] Other distributions remain clearly unsupported/best effort.

## 14. Phase 9 — notarized macOS and real Keychain

Relative effort: 2–4 engineer-weeks plus Apple enrolment/review
Preconditions: Phase 3 and stable Apple Developer ID

### Objective

Replace the current ad-hoc/mock-keychain preview posture in one production
identity cutover.

### Work

- [ ] Configure stable Developer ID Application identity, existing bundle ID,
  Hardened Runtime, secure timestamp, and minimal Electron entitlements.
- [ ] Sign every helper/framework/executable in the correct order.
- [ ] Submit with `notarytool`, inspect the returned log, staple, and validate
  the ticket.
- [ ] Remove `use-mock-keychain` from the signed build and make the package
  policy fail if it reappears.
- [ ] Detect preview credential envelopes, preserve them, and request one
  re-entry/save under Keychain; do not ship a dual-provider migration.
- [ ] Save/restart/load/forget with Keychain unlocked, locked, denied, and
  temporarily unavailable.
- [ ] Upgrade between two builds signed by the same identity and prove
  credentials remain decryptable.
- [ ] Test `codesign --verify --deep --strict`, `spctl --assess --type execute`,
  and stapler validation.
- [ ] Download/quarantine the final artifact and launch it on a clean supported
  Mac.
- [ ] Launch the actual WASM/WebGL client under Hardened Runtime.
- [ ] Replace preview Gatekeeper/mock-keychain instructions across app,
  website, release notes, and tests in the same hard cutover.

### Exit

- [ ] MOS-B02 and MOS-C01 pass with expected Team ID and real Keychain.
- [ ] The published ZIP contains the notarized/stapled exact tested `.app`.
- [ ] No current public documentation describes the retired ad-hoc flow as
  current behaviour.

## 15. Phase 10 — unified release surface and maintenance handoff

Relative effort: 1–3 engineer-weeks
Preconditions: at least one production-qualified target; all advertised
targets meet their own gates

### WP-10.1 — website and public downloads

- [ ] Consume canonical release targets in website asset selection.
- [ ] Add explicit OS/architecture selection; detection is recommendation
  only.
- [ ] Never link an unavailable or unmatched release asset.
- [ ] Publish OS-specific install, upgrade, uninstall, credential, signing,
  diagnostics, and known-limit sections.
- [ ] Explain the Windows native-client tradeoff and avoid performance claims
  without evidence.
- [ ] Explain exact profile IDBFS disk cost and the shared-native-cache limit.
- [ ] Update website smoke tests for incomplete uploads, prereleases, duplicate
  assets, wrong architecture, and every supported target.

### WP-10.2 — release assembler

- [ ] Require exactly the currently public target set.
- [ ] Verify all artifact hashes/manifests and one source commit/version.
- [ ] Attest each final artifact and SBOM.
- [ ] Publish without checkout or rebuild.
- [ ] Generate release notes with signing posture per artifact rather than one
  macOS paragraph.
- [ ] Keep application update checks manual/opt-in.

### WP-10.3 — support and issue intake

- [ ] Issue templates collect OS version, architecture, package format, GPU,
  display protocol on Linux, and credential-backend state without collecting
  account identifiers.
- [ ] Diagnostics instructions remain local/export-by-user.
- [ ] Add per-platform known-issues pages only when there is a real issue;
  avoid empty support matrices.

### WP-10.4 — steady-state maintenance

- [ ] Add an Electron-major upgrade checklist: dependency audit, build all
  native targets, actual fuses, packaged smoke, credentials, WASM first frame,
  GPU/input/audio, and release-note security review.
- [ ] Schedule twice-yearly OS baseline review.
- [ ] Track signing-certificate expiry and renewal without committing secrets
  or thumbprints that are intended to rotate.
- [ ] Remove the profile migration code after its one-release compatibility
  window and update tests/docs in the same change.
- [ ] Review performance evidence before changing caches, workers,
  background-throttling, or filesystem architecture.
- [ ] Require one owner/native environment before adding any deferred
  architecture or package format.

### Final programme gate

- [ ] Every public claim in [docs/internals.md](../../docs/internals.md) maps to
  an executable or named real-hardware proof.
- [ ] Every public download is an exact tested, hashed, manifested, attested
  artifact.
- [ ] `pnpm verify` passes on each native target.
- [ ] No second source of profile/client/settings truth remains.
- [ ] No old singleton, default-session profile, `ditto`, mock-keychain
  production, or superseded release workflow remains.
- [ ] No packaged input broadcast, automation, DLL/plugin injection, or
  credential editor exists.

## 16. Test inventory to create or refactor

This is a routing map, not a requirement to create one file per bullet.

### Unit

- release-target parser and version/filename uniqueness;
- platform init and copy;
- packaged-layout resolution;
- atomic replacement platform outcomes;
- portable archive adversarial cases;
- credential envelope/provider/key rotation;
- profile ID/label/path containment;
- profile create/rename/trash recovery;
- AppPaths/ProfilePaths non-overlap;
- window registry object/ID/role lifecycle;
- sender capability matrix;
- client-generation launch gate;
- explicit diagnostic target and per-renderer clock;
- migration journal idempotence;
- no profile label/ID in diagnostic schemas.

### Integration

- two socket owners and cross-owner rejection;
- two concurrent same-hash/range readers, one acquisition, global ceiling eight;
- profile A/B credential corruption isolation;
- profile session clear/delete leaves B and shared cache intact;
- migration failure after every durable step;
- native atomic-file locked-destination/crash behaviour;
- portable report creation and independent extraction.

### Electron

- manager create/rename/launch/focus/close/forget/trash;
- exact Page/BrowserWindow targeting with no array-order assumptions;
- profile A/B IndexedDB/IDBFS and credential sentinels across relaunch;
- protocol/CSP/sandbox/permission policy on every profile session;
- duplicate profile launch focuses one window;
- candidate generation allows one qualification window only;
- close/crash A leaves B usable;
- selected capture never retargets after A dies;
- manager/game lifecycle and zero-window quit;
- multiple windows still make zero GitHub requests when opt-in is off;
- platform input/focus/pointer-lock/fullscreen/scaling cases.

### Packaged

- shared ASAR inventory/closure, licences, version, startup, diagnostics, and
  actual fuses on every OS;
- OS-specific metadata/signature/desktop entry/installer checks;
- sequential A/B profile relaunch;
- conditional two-window smoke;
- credential provider posture;
- clean process exit;
- exact artifact manifest/hash.

### Policy/release

- no input-sending APIs/global hooks/robot dependencies;
- no manager credential fields;
- no arbitrary plugin/DLL loading;
- profile labels/IDs excluded from diagnostics;
- one release-target source;
- action pinning and least-privilege release handoff;
- public target set must be complete before publication;
- mock keychain required for preview and forbidden for Developer ID build.

## 17. Risk register

| Risk | Early signal | Required response |
| --- | --- | --- |
| Per-profile IDBFS duplicates too much disk/RSS | WP-0.2 exceeds budgets | Ship sequential profiles only or stop profiles; specify a separate native/lazy filesystem project |
| Concurrent client generations diverge | Candidate/update tests expose split state | Keep update-before-games gate; never add per-window generations |
| Linux stores with weak fallback | Backend is `basic_text`/unknown | Disable Remember Login and retain session-only login |
| macOS preview ciphertext fails after signing | Provider envelope mismatch | Preserve file, require one re-entry, overwrite under Keychain |
| Windows remains unfamiliar to SmartScreen | Clean VM displays warning | Verify signature/publisher/hash, explain reputation; never disable SmartScreen |
| Native matrix is falsely green | Tests use host assumptions or skip | Assert platform/arch, install final artifact, read actual fuses/signatures |
| Profile migration loses user files | Inventory has unknown/user-owned paths | Expand closed typed export or block cutover; never copy Chromium databases |
| Profile label leaks through trace/title | Trace can start while the labelled control renderer exists | Keep game titles generic; destroy control before Level 2 trace; block capture if that fails |
| Wayland refuses position/focus | Native compositor test differs | Restore supported state only; do not force XWayland |
| Main/window/IPC modules grow into condition trees | Review sees repeated role/platform branches | Extract direct role owner, delete old path; do not add generic adapters |
| Two-window input is accidentally mirrored | Structural/physical focus proof fails | Block Phase 6 and remove production simultaneous launch |
| Signing modifies tested bytes | Hash changes after test | Correct pipeline order; retest final signed/notarized artifact |

## 18. AI-agent work-packet protocol

An implementation agent receives one bounded packet, not an entire phase.
Use this prompt shape:

```text
Implement WP-X.Y from plans/multi-os/plan.md.

Read AGENTS.md, plans/multi-os/spec.md sections <n>, and the packet's primary
files completely. Acceptance IDs: <IDs>.

Keep behaviour outside the packet unchanged. Do not add compatibility paths,
generic adapters, new sources of truth, runtime flags, or dependencies unless
the packet explicitly authorises them. Delete the superseded path after the
new path passes.

Add the failure-path tests named by the packet. Run:
<exact packet commands>

Return:
1. outcome,
2. files changed,
3. acceptance evidence,
4. commands/results,
5. remaining blocker or "none".
```

Rules for agent coordination:

- Parallel agents may research different OSes or run disjoint native tests.
- Two agents must not edit the same ownership boundary in parallel.
- The primary agent reads all repository/skill instructions itself and owns
  final integration.
- An agent may not silently weaken a budget or public claim to make a test
  pass.
- An unexpected architecture requirement stops the packet and is recorded as
  a decision request; it does not justify a compatibility layer.
- A change involving signing secrets runs only in a trusted release context.
- A change that reaches ArenaNet production uses one deliberate smoke only;
  automated tests use offline fixtures.

## 19. Review checklist for every phase

- [ ] Did this delete the superseded path?
- [ ] Is there exactly one owner for each important concept?
- [ ] Is derived state rebuildable and tested?
- [ ] Does main, rather than preload/renderer orchestration, own native
  invariants?
- [ ] Can a renderer select another profile or resource owner?
- [ ] Are credentials/account identifiers absent from logs, diagnostics,
  browser manager storage, commands, and metadata?
- [ ] Does automatic release checking still make zero requests when disabled?
- [ ] Is ArenaNet concurrency still globally capped at eight?
- [ ] Does a final artifact prove its actual fuses, signature posture, version,
  ASAR contents, and clean launch/quit?
- [ ] Did native failure paths run on the OS where they matter?
- [ ] Is performance evidence Level 1 and compared on the same machine?
- [ ] Did the change add a platform/package/profile option without a real
  acceptance criterion?
- [ ] Is this the simplest correct system the team can maintain?
