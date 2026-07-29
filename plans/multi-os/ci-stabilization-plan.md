# Native CI stabilization and test architecture plan

Status: implemented; same-SHA cross-target soak in progress
Baseline: `feat/windows-linux-support` at `70f901d`, 2026-07-29
Scope: native Windows, Linux, and macOS verification
Owners: implementation agent plus reviewing maintainer

Implementation checkpoint: the retry-free stable selection now contains 61
non-live tests, the fault selection contains exactly one real renderer crash,
and the live selection contains one explicit opt-in smoke. Five client-runtime
coordination invariants and the removed native timing branches now run under
controlled Node clocks/collaborators. The complete stable suite and three fresh
fault invocations pass locally on macOS; Windows and Linux confidence remains a
CI result, not a local claim.

The hard cutovers are complete:

- one bounded owner covers ordinary Electron fixtures, direct application
  launches, raw lifecycle children, closes, and profile cleanup;
- stable and fault runs emit separate closed 0600 summaries, and CI derives one
  bounded failure manifest and job summary without copying error text;
- the stable suite has no `maxFailures` truncation, no retries, and no real
  renderer crash;
- Chromium sandbox, fail-closed generic Linux credentials, and the dedicated
  GNOME Secret Service qualification are separate proofs;
- CI builds once, makes once, tests the unpacked output of that make, and
  compares the shipped payload's `app.asar` byte-for-byte;
- native dependency audit has one owner, and JavaScript actions use current
  Node-24-backed full-SHA pins;
- successful and failed artifacts are run-attempt qualified.

The only unfinished acceptance item in this document is the external soak:
the unchanged pushed commit must pass Windows, macOS, generic Linux, and Linux
keyring CI repeatedly. A platform-specific failure discovered there reopens
the owning work packet; it does not justify retries or relaxed assertions.

This document is the focused recovery plan for the native verification work in
the broader [multi-OS delivery plan](plan.md). The product contract remains the
[multi-OS specification](spec.md); this document does not weaken its sandbox,
credential, privacy, packaging, or platform requirements.

## 1. Executive decision

The CI is not failing because one timeout is too short. It has exposed several
different defects that were being reported through one weak Electron harness:

1. real portability defects and macOS-only assumptions;
2. invalid platform expectations in tests;
3. incomplete ownership of Electron processes, windows, servers, and profiles;
4. wall-clock, compositor, memory, and scheduling observations treated as
   correctness assertions;
5. destructive Chromium crash primitives mixed into an 89-test stable suite;
6. insufficient failure evidence, causing an owning failure and its teardown
   cascade to look like many independent failures.

The history proves many invalid contracts and at least two product defects. It
does not contain enough repeated executions of the same SHA to quantify the
flake rate. Retries and longer global timeouts would hide rather than measure
that distinction.

The durable system is:

- one process-owning Electron fixture used by every spec;
- a retry-free, deterministic stable Electron suite;
- exactly one real renderer-crash recovery smoke in a separate invocation;
- business logic and timing branches tested below Electron;
- platform capability tests that assert the real platform policy;
- structured, privacy-safe failure evidence from the test harness;
- one build and one Forge make whose unpacked package and final artifact are
  both tested;
- a release gate that cannot pass by skipping missing prerequisites.

Two proof defects are release-blocking and must be fixed before another Linux
green result is treated as valid:

- Playwright 1.61.1 defaults `chromiumSandbox` to `false`, so the current Linux
  fixture silently adds `--no-sandbox`. The existing sandbox test checks
  `BrowserWindow` preferences and can pass while Chromium's global sandbox is
  disabled.
- CI runs `pnpm package`, tests that unpacked application, and then runs
  `pnpm make`, which cleans and rebuilds it. The final archive or installer is
  therefore not made from the exact unpacked package that passed
  `test:packaged`.

No Windows, Linux, or macOS preview produced by this pipeline should be
described as fully verified until the applicable gaps are closed.

## 2. Ground truth at the checkpoint

### 2.1 Latest complete run

The latest useful run is
[30466947093](https://github.com/Mat4m0/gwonmac/actions/runs/30466947093)
at head `70f901d`.

| Target | Job | Result | Last meaningful result |
| --- | --- | --- | --- |
| Static | `90627075119` | Pass | Type, lint, links, policy, and dependency gates pass |
| Windows x64 | `90627378267` | Pass | The 89-test suite completes with 87 passed and 2 skipped; packaging through upload passes |
| macOS arm64 | `90627378317` | Pass | The 89-test suite completes with 88 passed and 1 skipped; the complete native job passes |
| Linux x64 | [`90627378309`](https://github.com/Mat4m0/gwonmac/actions/runs/30466947093/job/90627378309) | Fail | First failure is Electron test 23, after 21 applicable passes |

The current Linux owner is:

```text
tests/electron/diagnostics.spec.ts
diagnostics › a command to a renderer whose process is gone settles instead of waiting
```

It times out after 60 seconds inside one opaque main-process evaluation that
creates and destroys three hidden windows. Although its command races use
nominal 5 s, 5 s, and 7 s bounds, two waits for `render-process-gone` and a
`BrowserWindow.loadURL()` wait are unbounded. The evidence cannot tell whether
the missing transition is crash-event delivery, command settlement, window
load/destruction, evaluation return, application exit, or fixture teardown.

The uploaded Linux failure artifact
[`8730071076`](https://github.com/Mat4m0/gwonmac/actions/runs/30466947093/artifacts/8730071076)
is 536 bytes and contains only the test title, source location, and outer
timeout. It has no lifecycle stage, process state, exit status, renderer-gone
reason, screenshot, trace, or shutdown outcome.

### 2.2 Run history

There were 22 PR-package runs during this bring-up. Eighteen ended as cancelled
because a newer push superseded them, although several cancelled runs had
already produced useful failures. Cancellation is correct for obsolete
commits, but pushing every small fix immediately truncated further evidence
collection and spent three native runners repeatedly.

Representative failures:

| Run | Owning evidence | Classification | Disposition |
| --- | --- | --- | --- |
| [`30454038175`](https://github.com/Mat4m0/gwonmac/actions/runs/30454038175) | Windows path splitting, POSIX modes, child URL launch, unlocked-move negative race | Invalid platform assumptions and a nondeterministic negative test | Rewritten or deleted |
| [`30454394243`](https://github.com/Mat4m0/gwonmac/actions/runs/30454394243) | Windows and UNC paths survived diagnostic redaction | Real privacy defect | Fixed by `68f43dd` |
| [`30454757632`](https://github.com/Mat4m0/gwonmac/actions/runs/30454757632) | Exact native coordinates, `ditto`, mock Keychain, menu assumptions, Linux keyring and crash cascades | Mixed platform assumptions; missing non-mac Settings menu was a real product gap | Mostly fixed; provider and crash architecture remain |
| [`30456614853`](https://github.com/Mat4m0/gwonmac/actions/runs/30456614853) | ASAR path API, macOS socket p95, Steam teardown | Test API, runner timing, and lifecycle defects | Timing threshold removed; lifecycle work remains |
| [`30457220013`](https://github.com/Mat4m0/gwonmac/actions/runs/30457220013) through [`30461845643`](https://github.com/Mat4m0/gwonmac/actions/runs/30461845643) | Lost Electron execution contexts, worker teardown timeouts, Windows profile `EBUSY` | Harness lifecycle and evaluation teardown failures | Partial bounded shutdown added; hard cutover still needed |
| [`30462409640`](https://github.com/Mat4m0/gwonmac/actions/runs/30462409640) | Linux crash/teardown failures repeated for about 19 minutes | Retry commit `a978311` multiplied a destructive first failure | Blanket retry was removed |
| [`30464827429`](https://github.com/Mat4m0/gwonmac/actions/runs/30464827429) | Linux raw child exited `SIGTRAP` with stdio hidden; macOS socket p95 exceeded | Sandbox-helper cause is a strong source-backed inference, not a fact exposed by that log; p95 is a hosted-runner timing assertion | Temporary `--no-sandbox` workaround is not acceptable; threshold removed |
| [`30465467666`](https://github.com/Mat4m0/gwonmac/actions/runs/30465467666) | Linux credential persistence unavailable; macOS exact bounds did not converge | Product policy misunderstood and requested state confused with effective state | Bounds fixed; provider tests remain |
| [`30466054569`](https://github.com/Mat4m0/gwonmac/actions/runs/30466054569) | Xvfb reported zero graphics frames; Windows unlocked-move race did not fail | Compositor timing and inherently nondeterministic negative proof | Replaced or deleted |
| [`30466497694`](https://github.com/Mat4m0/gwonmac/actions/runs/30466497694) | Real renderer crash did not produce deterministic candidate rollback | Destructive primitive used to test handler semantics | Handler is now synthetic; real fault proof must be isolated |
| [`30466947093`](https://github.com/Mat4m0/gwonmac/actions/runs/30466947093) | Gone-renderer diagnostics command hangs | Opaque native lifecycle boundary | Current first repair target |

The run history proves that CI has found real value:

- it found incomplete Windows/UNC diagnostic redaction;
- it found the missing Settings command on Windows and Linux;
- it found multiple incorrect cross-platform test assumptions;
- it exposed lifecycle ownership that local macOS runs had not exercised.

The conclusion is not to weaken native CI. It is to make every native test
prove only the boundary that requires a native process.

## 3. Failure classification and flake definition

A test is flaky only when the same commit, target, configuration, and
controlled inputs alternate between pass and fail without a product-relevant
external cause.

Use five separate classifications:

| Classification | Meaning | Examples from this bring-up |
| --- | --- | --- |
| Product defect | The product violates an intended invariant | Windows/UNC privacy redaction; missing non-mac Settings command |
| Invalid or non-portable test contract | The assertion does not represent the cross-platform product requirement; it may itself pass consistently or alternate | Exact POSIX mode on Windows, exact native coordinate, Linux persistence with no keyring |
| Nondeterministic harness or test | The same SHA can plausibly alternate because the proof depends on scheduler load, compositor timing, shared renderer death, or incomplete ownership | Socket p95, Xvfb frame count, execution-context loss, renderer-crash automation race |
| Downstream teardown cascade | A consequence of an earlier owning failure, not a second independent product result | Worker teardown timeout and profile `EBUSY` after a half-dead application |
| Infrastructure or cancellation | Workflow state outside the product assertion | A newer commit cancelling an obsolete matrix |

A test can be flaky and still be useless product evidence. For example, a
shared-runner latency threshold or renderer-crash automation race may alternate
on the same SHA, but making it stable would not make it the correct acceptance
contract. Conversely, a consistently failing macOS assumption on Linux is an
invalid test, not proof of a flaky product.

A required build silently becoming skipped is a vacuous gate defect. A missing
Linux keyring is an expected input to the fail-closed policy. Neither result
should be counted as a product flake.

The gate must preserve the first owning failure and classify downstream
cleanup separately. A rerun that happens to pass is diagnostic evidence, not
acceptance.

## 4. Existing foundations to keep

The current design already has several strong decisions:

- `release-targets.json` is the single source for the native matrix.
- Runner families are explicit: macOS 15, Windows 2022, and Ubuntu 24.04.
- `strategy.fail-fast: false` preserves evidence from every operating system.
- One Playwright worker avoids cross-test process contention.
- Linux uses Xvfb/X11, as required by the product specification.
- The list reporter and temporary `maxFailures: 1` preserve the earliest
  failing test instead of printing a long teardown cascade. Named local stages
  are still required to identify the owning transition within that test.
- Fixture shutdown is now bounded as graceful close, `SIGTERM`, then `SIGKILL`.
- Package inventory, fuses, resources, signatures, final artifacts, manifests,
  checksums, and SBOM checks are substantive.
- The live ArenaNet smoke is opt-in and stays outside the offline PR gate.
- The application already has one closed, privacy-certified diagnostic
  recorder. A generic production logging system is neither needed nor allowed.

The plan extends these foundations; it does not replace Playwright or invent a
second native-test stack.

## 5. Critical proof corrections

### 5.1 Prove the real Linux Chromium sandbox

The lockfile currently resolves Playwright and `playwright-core` 1.61.1. Its
Electron launcher inserts `--no-sandbox` on Linux unless
`chromiumSandbox: true` is passed. `tests/electron/app.spec.ts` also adds the
flag to its raw child launches.

Electron documents that `--no-sandbox` disables Chromium's sandbox for every
process. A renderer can still have no Node environment when
`webPreferences.sandbox` is true, which is why the existing test produces a
false sense of security.

Required hard cutover:

1. remove every explicit `--no-sandbox`;
2. set `chromiumSandbox: true` in the one canonical Playwright launcher;
3. route raw lifecycle probes through a sandbox-capable launcher;
4. assert `app.commandLine.hasSwitch("no-sandbox") === false`;
5. positively prove the game renderer is sandboxed through a Linux-capable
   signal such as the renderer/preload `process.sandboxed` value;
6. retain the existing `sandbox`, `contextIsolation`, frozen bridge, CSP, and
   permission assertions.

Electron's `ProcessMetric.sandboxed` field is available only on macOS and
Windows. On Linux, `undefined` is neither success nor failure and must not be
coerced into either. The Phase 1 experiment must find the smallest closed
way for the existing offline test surface to observe renderer
`process.sandboxed`, without adding a public production bridge capability. Any
test-only report is a boolean with policy coverage preventing production
exposure.

Ubuntu 24.04 can restrict unprivileged user namespaces through AppArmor. The
implementation must first test the runner's actual mechanism:

- prefer a trusted, preinstalled sandbox mechanism compatible with the pinned
  Electron binary; or
- configure an explicit user-namespace/AppArmor policy in trusted workflow
  setup.

Do not `chown root` and setuid a sandbox helper copied from an untrusted PR
checkout. The setup experiment is successful only when development, raw
lifecycle, unpacked-package, and installed/extracted payload launches all start
with the sandbox enabled. Ubuntu AppArmor rules can be executable-path
specific, so success on one path is not proof for the others.

### 5.2 Test the exact package that becomes the artifact

The current job performs:

```text
pnpm build
pnpm package       # builds, cleans out/, packages
pnpm test:packaged
pnpm make          # builds again, cleans out/, packages again
pnpm test:artifact
```

The tested unpacked application is deleted before the final artifact is made.
It also spends time building three times.

The target topology is:

```text
install
build once
unit + integration + stable Electron + isolated fault + release tests
clean out/ and run Forge make once from that prepared build
test the unpacked application produced by that make
verify its signature and packaged inventory
install or extract the final artifact and launch that exact payload offline
generate SBOM, manifest, and checksums
upload only the verified files
```

One `make:prepared` script owns output cleanup plus Forge make. Define the
self-contained developer command as `pnpm build && pnpm make:prepared`; CI and
`pnpm verify` build once and then call that same prepared command. Do not retain
separate CI-only packaging logic.

The final artifact smoke must:

- install the Windows Squirrel artifact and launch its installed executable;
- extract the macOS archive and launch the extracted `.app`;
- extract or install the Linux artifact and launch the contained executable;
- force offline shell mode for every launch;
- assert target identity, clean startup, one visible window, and clean exit;
- compare the tested unpacked application and shipped payload inventories or
  hashes where platform metadata permits;
- verify that the manifest checksum is the uploaded artifact's checksum.

### 5.3 Prevent vacuous green runs

Thirteen Electron specs skip themselves when `build/main/main.js` is absent.
Two raw-process tests also skip when the Electron executable is absent. A
missing build can therefore turn most of the required suite into skips.

Replace those guards with one fatal preflight in the canonical Playwright
configuration or fixture. It must validate:

- compiled main entry;
- renderer entry and generated preload;
- expected Electron executable;
- any required offline fixture assets.

`test.skip` remains valid only when a behavior is intentionally not applicable
to a platform or an opt-in live capability is disabled. Missing required input
is always a failure.

### 5.4 Make credential tests platform-truthful

Generic Ubuntu CI has no inspected, unlocked supported keyring. The product
contract is to refuse persistence in that environment, not to fall back to
plaintext.

Split the proof:

- native provider tests assert the real target policy:
  - Windows: encrypted OS-backed persistence works;
  - macOS ad-hoc preview: the documented current credential mechanism works
    without adding a Keychain claim;
  - Linux without a supported unlocked keyring: persistence is unavailable
    and the UI is truthful;
- Steam handler tests inject a deterministic provider through the existing
  `registerSteamIpcHandlers` seam;
- generic Linux profile Electron coverage uses the real provider and asserts
  persistence refusal while preserving partition/IDB isolation;
- lower-layer `CredentialsStore` and profile-path tests use a fake provider
  without adding a test-only application runtime path;
- a dedicated Linux credential job must prove D-Bus plus a specifically
  supported keyring before the product advertises saved login there.

Do not install a keyring in the generic Linux job merely to make shared tests
green. That would stop testing the required no-keyring policy. The full
`registerIpcHandlers` currently constructs the native provider internally. Do
not add a `GW_TEST_*` provider override. If provider construction is moved to
the production composition root, do it as a real dependency simplification,
not a parallel test path.

## 6. Test ownership model

Every invariant gets one lowest sufficient owner.

| Layer | Owns | Must not own |
| --- | --- | --- |
| Unit | State transitions, validation, error mapping, timer/deadline behavior, concurrency and token-generation invariants | Real windows, real OS storage, renderer processes |
| Integration | Atomic files, path semantics, local sockets, profile directories, patch fixtures, injected main-process collaborators | Pixel layout, context bridge, OS focus |
| Stable Electron | `BrowserWindow`, Chromium rendering, preload/IPC boundary, sandbox, native input/focus, actual platform provider policy, process/window lifecycle | Pure timers, parser branches, private-class mutation, hosted-runner performance |
| Isolated fault | One real renderer process death and full recovery chain | Consumer-specific handler permutations |
| Packaged | Exact unpacked application, ASAR, fuses, resources, signature, one offline launch | A second copy of the full development suite |
| Artifact | Exact installer/archive metadata, install/extract, checksum/provenance, one shipped-binary offline launch | A separately rebuilt package |
| Live opt-in | One deliberate production-client compatibility observation | Default CI, retries, load or soak |

An Electron test is justified only when at least one required assertion needs:

- a real Electron process or `BrowserWindow`;
- actual Chromium layout, input, focus, pointer lock, or process sandboxing;
- the frozen context bridge or main/renderer IPC boundary;
- a native menu, dialog, session, safe storage, or lifecycle behavior;
- the packaged or installed executable.

If Electron is only being used to import compiled modules, mutate private
fields, run a timer, or carry a fake event, move the invariant down.

### 6.1 Determinism rules

All new and migrated tests follow these rules:

- register the event listener or barrier before triggering the action;
- wait for a named observable state, never an arbitrary settling sleep;
- use Playwright retrying assertions for renderer state;
- use an injected clock or Playwright Clock when elapsed time is the domain
  behavior;
- use an outer watchdog only to fail a hang, never to assert performance;
- assert effective native state after convergence, not the exact requested
  coordinate or scheduling result;
- keep runner-performance claims in Level 1 diagnostic captures, not PR E2E;
- never make real production network requests in automated native tests;
- give every app process, raw child, server, and profile one harness owner that
  can close it after a test timeout. Windows and sessions created inside the
  application remain owned by that application.

## 7. Full Electron portfolio decision

The baseline suite had 89 tests across 15 files, about 6,692 lines, and roughly
94 Electron launches on Windows and Linux. Applying the ownership rule is
forecast to leave approximately 40–50 stable native tests, one isolated fault
test, and one opt-in live test. That range is never an implementation target:
retain any test whose unique invariant genuinely needs Chromium or an OS
boundary.

| Spec | Current | Decision | Required final proof |
| --- | ---: | --- | --- |
| `a-launch-reaches-github-only-when-asked.spec.ts` | 1 | Keep | Prove zero default requests and one opted-in path. Freeze the display clock or assert canonical request/settings state rather than an exact relative-time phrase. |
| `app.spec.ts` | 8 | Keep native lifecycle; trim duplicates | Keep second instance, startup failure/lock release, red-X cleanup, effective window state, platform-truthful credentials, and macOS legacy migration. Keep exact socket bytes/compaction but delete process-memory and pacing claims. Merge data-strategy launch ownership with launcher coverage. Route every launch and close through the fixture. |
| `client-compatibility.spec.ts` | 3 | Split | Keep real Chromium notice/footer layout. Keep deterministic candidate rollback handler wiring. Extend the existing `tests/unit/graphics.test.ts` for first-frame/bitmap-close presentation and delete GL-cache and socket duplication, which already have lower-layer owners. |
| `client-runtime-concurrency.spec.ts` | 5 | Move all | Preserve abort, shutdown join, stale token, and exact promotion invariants in unit/integration tests using deferred promises and fake time. Electron is currently only a module carrier. |
| `diagnostics.spec.ts` | 9 | Keep boundary proofs, move handler branches, isolate fault | Keep one capture/trace marker lifecycle, OAuth redaction, rejected-IPC attribution, one native export/privacy smoke, and input release around the save panel if it remains a native dialog seam. Move trace ownership, stop failure, and renderer-command timeout semantics to injected tests. Put the sole real crash in the isolated fault suite. |
| `enhancement-cursor.spec.ts` | 2 | Keep one | Keep Chromium cursor/image-set/pixel presentation. Merge saved opt-in/init payload with an existing renderer-init contract. |
| `enhancement-runtime.spec.ts` | 1 | Move/delete wrapper | Move settings and module-selection proof to unit/integration. The test currently launches Electron only to read init state and then runs the module logic in Node. |
| `input.spec.ts` | 12 | Retain trusted Chromium semantics; extract only pure state | Keep native Option/Alt mapping, real focus/pointer-lock, `isTrusted`, touch construction, held-key release, same-task ordering, and the smallest useful Chromium shell/OSK/canvas coverage. Use Playwright Clock or observable events for 30–450 ms waits. Extract only small pure wheel/tap/delta helpers when that simplifies production code; do not create an `input-core` abstraction merely to reduce launch count. |
| `launcher.spec.ts` | 5 | Keep two or three end-to-end paths | Keep full-data verification through IPC and clear-before-remount/relaunch ordering. Move or merge pure prompt/error/recovery rendering into renderer or application-state tests. Replace global IPC timing with explicit barriers. |
| `live.spec.ts` | 1 | Keep opt-in | Run only with explicit live consent, cached safeguards, and never upload a Playwright trace containing production traffic. |
| `profiles.spec.ts` | 2 | Keep or merge lifecycle | Real partition/IndexedDB isolation and manager restoration are native-value proofs. The test currently titled as trace redaction does not inspect trace bytes, so do not count it as redaction evidence; merge its manager-restoration seam or add a genuinely scanned export only if it owns a unique invariant. Under no-keyring Linux, assert persistence refusal; test supported provider behavior separately. |
| `sandbox.spec.ts` | 4 | Keep critical boundary; merge init permutations | Keep frozen bridge, CSP/permission policy, and real process sandbox proof. Merge automation/template init-flag launches into one lower-level or boundary contract. Replace fixed sleeps with navigation or polling. |
| `settings.spec.ts` | 7 | Keep representative native/UI seams | Keep native menu command, restart transaction, accessibility/focus, and at most one failed-save IPC seam. Move duplicate presentation/default/reset-failure branches to renderer or application-runtime tests. |
| `steam-acquire.spec.ts` | 13 | Keep actual window/session security; move parsing and timers | Keep representative success redirect, cancellation, origin/popup/download denial, modal parenting, unreachable page, and ephemeral-cookie isolation. Move wrong-state/no-token parsing to existing OAuth unit tests and cleanup rejection/hang timers to fake-time tests. Replace the real crash with a deterministic event. |
| `steam-login.spec.ts` | 16 | Reduce to about four native seams | Keep advertised/silent behavior, one explicit bridge/IPC token-shape path, one provider store/clear boundary, and diagnostics privacy. Existing Steam session and OAuth unit tests own singleflight, expiry, replay, poisoned storeback, clear-final, wrong provider, and parser branches. Inject a deterministic provider through the existing Steam handler registration seam rather than requiring a real Linux keyring. |

### 7.1 Proofs to delete in their current form

The following tests or assertions are useless as native release evidence. Their
underlying product invariants are either already owned elsewhere or must be
moved:

- the already deleted test requiring an unlocked atomic move race to fail;
- absolute p95 socket latency on shared hosted runners;
- process-memory delta when exact payload counters already prove WASM view
  compaction;
- a Steam cleanup duration constrained to 4.5–10 seconds;
- duplicate GL-cache and socket work inside client compatibility;
- all five Electron wrappers around client runtime concurrency;
- the Electron wrapper around enhancement runtime selection;
- repeated native OAuth parser and Steam session-state branches;
- exact POSIX modes on Windows, exact native coordinates, and requested bounds
  before convergence;
- Xvfb frame counts as a functional graphics correctness gate;
- real renderer crashes inside diagnostics, Steam, or compatibility consumer
  tests;
- per-file missing-build skips.

This does not make privacy, sandbox, packaging, crash recovery, credentials, or
profile isolation optional. Those are among the most important tests to keep.

## 8. One owned Electron harness

### 8.1 Hard-cutover fixture

Extend the existing fixture into one Playwright custom fixture and move every
spec to it in the same workstream. Do not keep manual and automatic ownership
paths side by side.

The fixture must:

- create each ephemeral user-data directory;
- launch with the canonical environment, executable, and
  `chromiumSandbox: true`;
- register every Electron application and raw child before returning it;
- support explicit close and relaunch without losing ownership of the old
  process handle;
- register local servers and connections for bounded teardown;
- automatically close every remaining resource even when the test body times
  out before `finally`;
- record whether shutdown was graceful, terminated, killed, or failed;
- wait for process exit before deleting the profile;
- fail a green test if it required TERM/KILL or left an owned resource alive;
- preserve the cleanup outcome as failure evidence when the test was already
  red.

No ordinary spec may call an unbounded `app.close()`, launch Electron directly,
or leave a lifecycle probe's stdout/stderr pipes undrained. Raw probes may
ignore stdin, but stdout/stderr must be consumed continuously into a bounded
ring that emits only an allow-listed, sanitized classification.

Teardown uses one shared budget, not 10 s + 5 s + 5 s for every registered
resource in sequence:

1. request graceful close for all owned applications and servers in parallel;
2. after one shared 10-second deadline, terminate every remaining process and
   force-close remaining fixture connections;
3. after one shared 5-second deadline, kill every remaining process;
4. after one final shared 5-second deadline, fail with the surviving PIDs;
5. verify known renderer/helper PIDs are gone, then delete exited profiles in
   parallel.

Give the automatic fixture teardown an explicit timeout above that shared
budget, initially 30 seconds. Windows and sessions created within the main
process are owned by application exit; do not invent a generic registry for
every `BrowserWindow` or Electron `Session`.

The 10 s, 5 s, and 5 s values are safety ceilings, not performance assertions.
Unit-test the parallel transition helper with fake process handles so all
exit/listener races are covered without launching Electron.

### 8.2 Named local deadlines

Every potentially hanging boundary gets a name and a deadline shorter than the
60-second outer test timeout:

- prerequisite preflight;
- Electron launch;
- first window and DOM ready;
- IPC command sent;
- native event observed;
- command response received;
- window close requested and destroyed;
- application close requested;
- process exit;
- profile deletion;
- server close.

On failure, the error must say the last completed stage and the missing stage.
The outer timeout remains a final safety net rather than the primary
diagnostic.

### 8.3 Failure evidence

Add evidence to the test harness, not a generic production logger.

For an unexpected result, produce a closed, bounded bundle under
`test-results`:

- a machine-readable result summary containing no raw assertion values;
- test title, project, attempt, duration, OS/architecture, Node, Electron, and
  Playwright versions;
- repository-relative source location and an allow-listed error category or
  non-text fingerprint;
- the named fixture lifecycle timeline;
- owned process PID, parent PID when known, exit code/signal, and shutdown mode;
- window count plus destroyed/crashed/sandboxed flags;
- `render-process-gone` reason and exit code where applicable;
- fixture-server request counts and allow-listed route names, never bodies or
  headers;
- the closed `diagnosticSummary()` result or equivalent certified summary,
  never a raw diagnostic tail.

Trace, screenshot, and HTML evidence are not blanket defaults. They may be
enabled for an explicitly allow-listed offline, secret-free test or focused
reproduction only when:

- the screen contains no profile label or credential-like input;
- the test is not Steam, live, credential, profile-label, or privacy coverage;
- the artifact is discarded on pass;
- custom Electron context tracing is proven to cover the intended interval;
- the result passes the same evidence scanner and size limits as the default
  bundle.

Evidence must never include:

- real credentials, tokens, account identifiers, profile labels, cookies, or
  browser storage;
- request/response bodies or headers;
- production URLs from the live smoke;
- a whole user-data directory;
- arbitrary renderer console output;
- unsanitized command lines or host/user/profile filesystem paths;
  repository-relative test source locations are allowed;
- a raw `.gwdiag` captured from a real user profile.

CI Electron tests use only ephemeral synthetic data. The live suite neither
records nor uploads Playwright traces.

Initial executable bounds:

- each structured JSON file: at most 256 KiB;
- each optional screenshot: at most 2 MiB;
- each optional trace: at most 20 MiB;
- complete compressed target failure bundle: at most 50 MiB.

Add adversarial tests that seed token-shaped text, redirect fragments, cookies,
profile labels, home/temp/user-data paths, and oversized evidence. The
collector must reject or redact them before upload and fail closed when a bound
is exceeded.

### 8.4 Reporter and timeout policy

During harness migration:

- `workers: 1`;
- `retries: 0`;
- list reporter plus the closed structured result reporter;
- `forbidOnly: true` in CI;
- `maxFailures: 1` temporarily, while a first failure can still poison
  teardown.

After every resource has bounded ownership and the destructive test is
isolated:

- keep `workers: 1`;
- keep PR retries at zero;
- remove `maxFailures: 1` so independent failures are all reported;
- keep the destructive invocation fail-fast because it has exactly one test;
- use `--repeat-each` in the scheduled stability lane to measure flake rate.

A future diagnostic retry is acceptable only if it also sets
`failOnFlakyTests: true`, preserves both attempts, and leaves the required check
red after fail-then-pass. It is not needed for this plan and should not be
introduced without evidence that it improves diagnosis.

Do not use Playwright's GitHub annotation reporter for this matrix; Playwright
warns that matrix annotations multiply and obscure the file view.

## 9. Fault containment

The stable Electron suite must contain zero calls to
`forcefullyCrashRenderer()`.

Create one tagged fault test and run it in a fresh Playwright invocation after
the stable suite:

1. launch a fresh offline application through the canonical fixture;
2. close unrelated windows or prove no other `WebContents` shares the target
   renderer OS process ID;
3. subscribe to the real `render-process-gone` event before the action;
4. crash the target renderer;
5. record the exact reason, assert it belongs to Electron's closed non-clean
   reason set, and assert the old renderer process is gone;
6. assert the application's real recovery path creates a different renderer OS
   PID, positively proves that renderer sandboxed, and reaches its ready
   contract;
7. assert the application still exits cleanly;
8. end the invocation; run no later stable test in that process.

All consumer behavior—candidate rollback, renderer-command settlement, Steam
window failure, diagnostic attribution—uses deterministic event emitters and
injected `WebContents` state. Test titles must distinguish “handles a
renderer-gone event” from “recovers from a real renderer process crash.”

Electron warns that force-crashing a `WebContents` may also crash other
`WebContents` sharing the renderer. Isolation is therefore part of the
invariant, not only a convenience.

Use separate commands backed by the same configuration, for example:

```text
test:electron:stable  -> grep-invert the @fault tag
test:electron:fault   -> run only the @fault tag
test:electron         -> stable, then fault as two Playwright invocations
```

Do not create a second fixture or a divergent Playwright configuration for the
fault test. Give stable and fault invocations separate output and report
directories so the second invocation cannot clear the first one's evidence,
then aggregate their closed summaries.

Add a policy test for complete partitioning:

- exactly one tracked call to `forcefullyCrashRenderer`, in the tagged fault
  spec;
- stable selection excludes that test;
- fault selection includes exactly that test;
- stable plus fault covers every non-live Electron test exactly once;
- the opt-in live test is the only test outside that union.

## 10. CI topology

Keep one reusable native workflow and one canonical target matrix.

### 10.1 Static job

Run once on Linux:

- dependency review when requested;
- install with the frozen lockfile;
- dependency audit;
- matrix resolution;
- typecheck;
- lint;
- link check;
- policy tests.

Do not repeat `pnpm audit` in all three native jobs.

### 10.2 Native matrix job

Run on every canonical target with `fail-fast: false`:

1. install trusted target prerequisites;
2. assert runner and target identity;
3. build once;
4. run unit tests and integration tests on the native filesystem/runtime;
5. run the stable Electron invocation;
6. run the isolated fault invocation;
7. run release tests;
8. run Forge make once from the prepared build;
9. run packaged tests against the unpacked output from that make;
10. verify macOS signature or the target's equivalent package assertions;
11. run the final artifact install/extract and offline launch smoke;
12. prepare the preview artifact;
13. generate SBOM, manifest, and checksums from that tested payload;
14. upload only after every proof passes.

Keep the 60-minute job timeout during migration. Reduce it to approximately 30
minutes only after soak data shows adequate headroom.

### 10.3 Linux keyring qualification

The generic Linux matrix target owns the no-keyring or forced-`basic_text`
failure policy. Add the second credential job required by the specification:

- start an isolated D-Bus session and one explicitly supported keyring;
- unlock it with synthetic CI-only material;
- prove Electron reports the expected secure backend;
- prove save, relaunch, load, clear, and locked/unavailable outcomes;
- prove no plaintext fallback and no credential material in evidence;
- reuse the same credential-provider implementation and tests rather than
  creating a second provider path.

Keep this job narrowly scoped to credential qualification. It does not rerun
the entire Electron portfolio. It checks out the exact same SHA and may build
that commit once independently; byte identity with the artifact-producing
matrix build is not part of the credential assertion. If a build handoff is
later justified, it must be checksum-verified rather than assumed.

### 10.4 Failure handling

Give every meaningful native step an ID. Before upload, run one evidence
collector under `failure() && !cancelled()` that always creates a bounded,
sanitized `failure-manifest.json` containing target, SHA, run attempt, named
step outcomes, earliest failed step/test, and any existing closed test
summaries. This makes early install/build, Electron, release, make, packaged,
signature, artifact, and provenance failures all produce evidence.

Upload one aggregate native failure bundle after that collector:

- include `${{ github.run_id }}` and `${{ github.run_attempt }}` in artifact
  identity;
- include target ID;
- set `if-no-files-found: error` because the collector guarantees the manifest;
- retain failure evidence for seven days;
- keep short-lived preview retention controlled by the caller.

Attempt-qualify successful preview artifact names too. Update every downstream
download and release consumer atomically; immutable upload-artifact names must
not collide when GitHub reruns the same run with a higher
`github.run_attempt`.

Write a concise `$GITHUB_STEP_SUMMARY` with:

- target and exact commit;
- passed, failed, skipped, and flaky counts;
- earliest failed step/test and last completed lifecycle stage;
- whether fixture teardown escalated;
- package/artifact identity and checksum when successful;
- failure artifact name when unsuccessful.

Give the failure upload step an ID and use its `artifact-url` output in a later
summary step if a clickable link is desired. Do not construct an artifact URL
by hand.

Update full-SHA pins for checkout, setup-node, upload-artifact, pnpm setup, and
other JavaScript actions to current Node-24-backed revisions in a dedicated
maintenance commit. Keep SHA pinning; do not switch to floating tags.

### 10.5 Developer-loop policy

Keep concurrency cancellation for superseded commits. Change the working
practice:

- complete and locally verify one coherent atomic work packet;
- push the packet once;
- let its matrix reach a useful terminal result before pushing the next packet,
  unless the commit is known wrong;
- diagnose the first owning failure, not every downstream teardown message.

If target-only iteration remains too slow, add an optional
`workflow_dispatch` target filter to the existing reusable workflow and derive
it from the same canonical matrix. Do not create a second Linux-only
verification workflow.

## 11. Phased implementation

Each work packet ends with a focused commit. A moved invariant and deletion of
its obsolete Electron copy belong in the same commit; do not retain dual proof
paths.

### Phase 0 — Preserve the checkpoint

Work:

- commit this plan alone;
- preserve the current run/job/artifact links;
- keep unrelated `.worktrees/` and any in-progress test fix out of the plan
  commit;
- stop describing the current Linux sandbox test as a valid sandbox proof.

Acceptance:

- the plan is linked from the broader multi-OS plan;
- Markdown links pass;
- the working-tree diff shows only intended files per commit.

Suggested commit:

```text
docs(ci): define native stabilization and test architecture
```

### Phase 1 — Restore trustworthy Linux and current test semantics

#### WP-1.1 — Linux sandbox experiment and hard cutover

Files:

- `tests/electron/fixtures.mts`
- `tests/electron/app.spec.ts`
- `tests/electron/sandbox.spec.ts`
- `.github/workflows/native-verify.yml`
- relevant policy tests and multi-OS evidence

Work:

- determine the safe Ubuntu 24.04 sandbox mechanism;
- set `chromiumSandbox: true`;
- delete raw `--no-sandbox`;
- make every raw lifecycle probe use the safe launch path;
- add negative switch and positive process-sandbox assertions;
- extend policy coverage so a test launcher cannot reintroduce the flag.

Acceptance:

- stable and raw-child Electron launches work under Xvfb;
- no Electron command line contains `--no-sandbox`;
- a Linux-capable positive signal proves the real game renderer sandboxed;
- missing Linux `ProcessMetric.sandboxed` is not interpreted as either result;
- development, raw-child, unpacked-package, and shipped-payload paths use the
  sandbox;
- no root-owned executable is created from PR checkout content.

Suggested commit:

```text
test(linux): prove the real Chromium sandbox
```

#### WP-1.2 — Make prerequisites fatal

Work:

- add one preflight;
- delete per-spec build and executable skips;
- add a policy or unit test for the preflight.

Acceptance:

- temporarily removing the compiled main entry produces one immediate,
  actionable failure and zero “green by skip” result;
- platform and live opt-in skips remain explicit.

Suggested commit:

```text
test(electron): fail fast when build prerequisites are missing
```

#### WP-1.3 — Fix the current gone-renderer owner

Work:

- test pending, already-gone, and timeout command semantics below Electron with
  injected `WebContents` state and controlled timers;
- retain at most one small Electron handler-wiring assertion;
- remove the three-window opaque evaluation;
- remove or bound both unbounded `render-process-gone` waits and the
  `BrowserWindow.loadURL()` wait;
- give each native boundary a named deadline.

Acceptance:

- the focused test passes 20 repetitions with retries off on Linux;
- no real renderer is crashed;
- a deliberate missing event identifies its named stage before the outer
  timeout.

Suggested commit:

```text
test(diagnostics): make gone-renderer settlement deterministic
```

#### WP-1.4 — Correct provider expectations before the next Linux failure

Work:

- make profile and app credential assertions platform-truthful;
- inject a deterministic provider through the existing Steam handler seam;
- keep generic Linux profile E2E on the real fail-closed provider;
- use fake providers only in lower-layer store/path tests;
- keep real provider policy in dedicated native coverage;
- remove assumptions that Linux generic CI can persist.

Acceptance:

- no-keyring Linux explicitly passes by refusing persistence;
- the dedicated D-Bus/keyring job proves the supported secure backend;
- Steam orchestration tests do not depend on a host keyring;
- Windows persistence and the current macOS preview posture remain covered;
- no plaintext fallback is added.

Suggested commit:

```text
test(credentials): separate native policy from account orchestration
```

### Phase 2 — One owner and useful failure evidence

#### WP-2.1 — Custom owned fixture

Work:

- extend Playwright's `test` with one test-scoped Electron owner;
- hard-cutover all ordinary launches and relaunches;
- register applications, servers, raw children, and profiles;
- close each teardown phase in parallel under one shared budget;
- drain raw-child output continuously into a bounded classification ring;
- unit-test graceful, TERM, KILL, listener-race, shared-budget, and parallel
  deletion behavior;
- fail green tests that need escalated teardown.

Acceptance:

- a test interrupted before its `finally` leaves no owned Electron process;
- the next test starts with a clean profile and lock;
- no ordinary spec contains direct unbounded launch or close code;
- fixture teardown has an explicit timeout above the shared escalation budget;
- known renderer/helper PIDs are gone before profile deletion;
- a normal green run reports only graceful teardown.

Suggested commits:

```text
test(electron): own every application lifecycle
test(electron): route raw lifecycle probes through the owner
```

#### WP-2.2 — Structured evidence

Work:

- add named lifecycle stages and bounded attachments;
- enable list plus a closed, sanitized machine-readable summary;
- use only `diagnosticSummary()` by default;
- allow trace/screenshot/HTML only for explicitly safe offline tests;
- add adversarial secret/path/size tests for the evidence collector;
- add an always-run failure-manifest collector before upload;
- add the job summary and attempt-qualified failure and preview artifact names;
- give stable and fault invocations separate result directories and aggregate
  their summaries.

Acceptance:

- an intentional assertion failure names the test, source, and safe category;
- an intentional fixture timeout names the last completed lifecycle stage and
  shutdown outcome;
- an intentional app exit records exit code or signal;
- the artifact is non-empty, within numeric size bounds, and contains none of
  the forbidden data classes;
- an Electron, packaged, or artifact failure all reach the same evidence step.

Suggested commits:

```text
test(electron): attach bounded lifecycle failure evidence
ci(native): preserve actionable target failure reports
```

### Phase 3 — Isolate faults and remove timing pseudo-proofs

#### WP-3.1 — One real crash

Work:

- replace diagnostics and Steam real-crash consumers with deterministic event
  tests;
- create one `@fault` full recovery smoke;
- split stable and fault package commands into separate invocations;
- verify renderer process isolation before crashing it;
- add a policy test proving stable, fault, and live form a complete partition.

Acceptance:

- stable suite contains zero `forcefullyCrashRenderer` calls;
- fault suite contains exactly one;
- the one crash call is tagged and located only in the fault spec;
- fault failure cannot poison a later stable test;
- the crash reason is a member of Electron's non-clean set rather than one
  hard-coded platform value;
- recovery uses a new renderer OS PID and positively proves its sandbox;
- synthetic handler tests never claim real process-crash proof;
- fault smoke passes three fresh invocations per target with retries off.

Suggested commit:

```text
test(electron): isolate the real renderer crash invariant
```

#### WP-3.2 — Delete wall-clock and scheduler assertions

Work:

- remove socket p95 and process-memory duplication;
- move Steam cleanup bounds and runtime coordination to fake-time tests;
- replace sleeps with events, polling, or controlled clocks;
- keep only generous hang watchdogs at native boundaries.

Acceptance:

- no stable Electron assertion uses elapsed wall time as a performance gate;
- every remaining `waitForTimeout` has a documented domain reason or is
  deleted;
- lower-layer timer tests pass 50 repetitions without real waiting.

Suggested commit:

```text
test: replace native timing observations with deterministic contracts
```

### Phase 4 — Move each invariant to its lowest owner

Execute in small hard-cutover commits:

1. client runtime concurrency;
2. compatibility graphics/socket split;
3. enhancement runtime and cursor init;
4. input timing review, retaining trusted Chromium semantics and extracting
   only small pure helpers that simplify production code;
5. launcher and settings presentation/error branches;
6. Steam OAuth acquisition parser/timer branches;
7. Steam session/storeback/expiry branches.

For every packet:

- write the lower-layer invariant test first in the same working change;
- run it with controlled collaborators or time;
- delete the obsolete Electron assertion before committing;
- retain one representative native boundary proof when justified;
- update the portfolio table in this document with the resulting count and
  final owner.

Acceptance:

- no Electron test uses Electron solely to load a module;
- no business branch is proved both in unit and native tests without a written
  boundary reason;
- no removed invariant loses coverage;
- stable suite duration and launch count fall materially without becoming an
  acceptance target themselves;
- each moved concurrency/timer group passes 50 repetitions;
- each retained native spec passes 20 repetitions on the target that previously
  failed.

Suggested commits:

```text
test(runtime): move generation invariants below Electron
test(renderer): separate graphics presentation from native compatibility
test(input): replace waits without abstracting Chromium semantics
test(settings): keep only native settings seams
test(steam): move OAuth and session branches below Electron
```

### Phase 5 — Build once and verify the exact artifact

#### WP-5.1 — Packaging hard cutover

Work:

- add one underlying prepared-build Forge command;
- define `pnpm make` only as `pnpm build && pnpm make:prepared`;
- make CI and `pnpm verify` build once, then call that same `make:prepared`;
- remove the separate `pnpm package` from native CI and `pnpm verify`;
- make once;
- test the unpacked output after make;
- make signature, SBOM, manifest, checksum, and upload consume that output.

Acceptance:

- logs show one build and one Forge make;
- `test:packaged` names the unpacked path created by that make;
- no later step deletes or rebuilds it;
- local `pnpm make` remains self-contained and delegates to the same
  implementation;
- local `pnpm verify` follows the same ordering as CI.

Suggested commit:

```text
build: test one exact package and artifact chain
```

#### WP-5.2 — Shipped-payload smoke

Work:

- retain the existing Windows install and macOS/Linux extraction checks;
- extend that smoke to launch every installed or extracted target payload
  offline;
- compare expected inventory/provenance with the tested unpacked application;
- ensure cleanup is reversible and bounded.

Acceptance:

- Windows installed executable, extracted macOS app, and extracted/installed
  Linux executable each start offline and exit cleanly;
- the uploaded artifact hash matches the manifest;
- no production request occurs during any smoke.

Suggested commit:

```text
test(release): launch the exact shipped payload on every target
```

### Phase 6 — CI maintenance and confidence soak

#### WP-6.1 — Action/runtime maintenance

Work:

- update every JavaScript action to a current Node-24-backed full SHA;
- update policy tests and comments;
- remove repeated native dependency audit;
- retain target matrix and `fail-fast: false`.

Acceptance:

- no Node 20 action deprecation warning remains;
- action pin policy passes;
- dependency audit still runs once and blocks the workflow.

Suggested commit:

```text
ci: refresh pinned actions for Node 24
```

#### WP-6.2 — Soak

Run at one unchanged commit with retries disabled:

- affected lower-layer concurrency/timer tests: 50 repetitions;
- every previously failing native spec: 20 repetitions on its affected target;
- complete stable Electron suite: five consecutive invocations per target;
- isolated real-crash fault: three consecutive invocations per target;
- complete native build/package/artifact matrix: three consecutive runs.

Pass criteria:

- zero failed or flaky outcomes;
- zero worker teardown timeouts;
- zero orphaned owned processes;
- zero TERM/KILL escalations on green runs;
- zero build-prerequisite skips;
- non-empty evidence for a controlled failure probe;
- three full matrices pass on the same SHA without rerun-to-green.

After the soak, remove temporary `maxFailures: 1` and repeat one complete
matrix to prove independent failures can be collected without teardown
cascades.

#### WP-6.3 — Ongoing flake measurement

Add a bounded scheduled stability run for the small set of process lifecycle,
profile, Steam-window, and fault tests only after the suite has passed the
initial soak.

Policy:

- report pass/fail counts by target and exact commit;
- use `--repeat-each`, not retry-to-green;
- create an issue for a confirmed flake with owner, reproduction, and expiry;
- quarantine only if it is non-security-critical and the issue is linked;
- never quarantine sandbox, privacy, credentials, crash recovery, profile
  isolation, package, or artifact invariants;
- remove or repair an expired quarantine—never silently renew it.

Suggested commit:

```text
ci: measure native stability without retry-to-green
```

## 12. Verification commands

The exact scripts may gain `stable`, `fault`, and `make:prepared` names during
the phases above. The final local gate is:

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm check:links
pnpm test:unit
pnpm test:integration
pnpm test:electron:stable
pnpm test:electron:fault
pnpm test:policy
pnpm test:release
pnpm make:prepared
pnpm test:packaged
pnpm test:artifact
```

On Linux, the two Electron commands and any packaged/artifact launch use the
trusted sandbox setup under Xvfb:

```bash
xvfb-run --auto-servernum pnpm test:electron:stable
xvfb-run --auto-servernum pnpm test:electron:fault
```

Focused stability uses Playwright's native repetition:

```bash
pnpm exec playwright test \
  --config=tests/electron/playwright.config.ts \
  tests/electron/diagnostics.spec.ts \
  --repeat-each=20 \
  --retries=0
```

Do not run the live client during automated soak. A single explicit live smoke
remains a separate release observation.

## 13. Definition of done

This stabilization plan is complete only when all statements are true:

- Linux development, raw-child, unpacked-package, and shipped-payload launches
  run with Chromium's real sandbox enabled.
- The sandbox proof checks both configuration and a Linux-capable positive
  renderer signal; a missing macOS/Windows-only metric is never treated as
  proof.
- Missing required build output fails centrally and cannot become a skipped
  green suite.
- Every Electron process and local fixture resource has one bounded owner.
- Stable Electron tests contain no real renderer crash.
- Exactly one isolated test proves real crash event delivery and recovery.
- A policy test proves stable, fault, and live selections cover the portfolio
  exactly once.
- No native correctness assertion depends on shared-runner speed, exact native
  coordinates, or an unlocked race losing.
- Generic Linux CI truthfully proves no-keyring refusal.
- A dedicated Linux credential job proves the supported D-Bus/keyring mode.
- Steam handler tests use their existing deterministic provider seam; no
  test-only credential runtime path exists.
- Every retained Electron test needs a real native/Chromium boundary.
- Failure artifacts identify the last completed lifecycle stage and teardown
  outcome without leaking forbidden data.
- Every failed native step creates a bounded failure manifest, even when
  Playwright never ran.
- PR CI remains retry-free.
- CI builds once, makes once, tests that exact unpacked application, and
  launches the exact installed or extracted artifact.
- Windows, macOS, and Linux each pass the soak gates at one unchanged commit.
- The broader [Phase 2 gate](plan.md#phase-2-gate) is checked only after this
  evidence exists.

## 14. Rejected shortcuts

Do not:

- raise global timeouts to make a hang less visible;
- add blanket retries that turn red into green;
- add `--no-sandbox`;
- create a root-owned setuid executable from PR checkout content;
- add a generic production logging API;
- upload profiles, credentials, browser storage, arbitrary console output, or
  production traces;
- install a Linux keyring merely to avoid testing fail-closed behavior;
- keep old and new test paths side by side after an invariant moves;
- switch test frameworks without evidence that Playwright itself is the owner;
- split 89 tests into a large job matrix before simplifying them;
- claim Xvfb proves Wayland, GPU-driver performance, or every desktop keyring;
- call a synthetic event a real crash proof;
- hard-code one renderer crash reason before all three targets prove it;
- call a rebuilt artifact the package that was tested;
- accept a manual rerun as proof that a flake is fixed.

## 15. Authoritative references

- [Playwright Electron API and `chromiumSandbox`](https://playwright.dev/docs/api/class-electron)
- [Playwright Electron application lifecycle](https://playwright.dev/docs/api/class-electronapplication)
- [Playwright fixtures](https://playwright.dev/docs/test-fixtures)
- [Playwright timeout guidance](https://playwright.dev/docs/test-timeouts)
- [Playwright retry classification](https://playwright.dev/docs/test-retries)
- [Playwright reporters](https://playwright.dev/docs/test-reporters)
- [Playwright tracing](https://playwright.dev/docs/trace-viewer)
- [Playwright Clock](https://playwright.dev/docs/clock)
- [Playwright CI guidance](https://playwright.dev/docs/ci)
- [Electron process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron `WebContents` and renderer crash warning](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron testing on headless CI](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)
- [Chromium AppArmor and user-namespace restrictions](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)
- [GitHub workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
- [GitHub job summaries](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands-for-github-actions)
- [GitHub matrix failure behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)
- [GitHub run-attempt variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
- [GitHub upload-artifact behavior](https://github.com/actions/upload-artifact)
