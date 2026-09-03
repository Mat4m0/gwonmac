# Plan 002: Preserve structured failure receipts across the runtime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the “STOP conditions” section occurs, stop and
> report—do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4dacdd3b..HEAD -- scripts/build.mjs src/main/certification/local-client-verifier-host.ts src/main/certification/verifier-process-lifecycle.ts src/main/client-runtime.ts src/shared/diagnostics.ts src/main/diagnostics/schema-app-update.ts src/main/diagnostics/schema-protocol-renderer.ts src/main/diagnostics/renderer.ts src/renderer/harness.ts src/renderer/diagnostics.ts src/renderer/enhancements.ts src/renderer/certified-companion-installation.ts src/renderer/certified-companion-core-installation.ts src/renderer/client-startup-phase.ts src/renderer/enhancement-installation-phase.ts scripts/enhancements-live.ts scripts/enhancements-live/result.ts tests/unit/build-receipt.test.ts tests/unit/the-companion-kernel-is-compiled-once-per-build.test.ts tests/unit/local-client-verifier-host.test.ts tests/unit/client-startup-phase.test.ts tests/unit/enhancement-installation-phase.test.ts tests/unit/enhancements-live-result.test.ts tests/unit/export-detector-rejects-undeclared-event-fields.test.ts docs/process-model.md`
> If an in-scope boundary changed, compare the “Current state” excerpts with
> the live implementation before proceeding. A changed public diagnostic
> schema or changed installer lifecycle is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 001
- **Category**: observability
- **Planned at**: commit `4dacdd3b`, 2026-08-31

## Why this matters

gwonmac usually fails closed, but several boundaries erase the cause while
doing so. An agent can see “unavailable,” “glue load failed,” or “install
failed,” but cannot tell whether the verifier timed out, returned malformed
data, the fetch failed, compilation failed, instantiation failed, the side module was
rejected, or the hook could not be installed. This plan keeps one small closed
receipt at each existing boundary. It does not add a state machine or a second
logging platform.

## Current state

- `src/main/certification/local-client-verifier-host.ts:35-179` maps verifier
  timeout, child exit, malformed reply, and spawn exceptions to `null` for all
  three modes. `src/main/client-runtime.ts:349-360` can therefore emit only
  `wasm.localVerificationCompleted` or `wasm.localVerificationUnavailable`.
- `src/renderer/harness.ts:760-805` performs fetch, streaming compilation,
  buffered fallback, instantiation, Cartography installation, and Emscripten
  completion inside one awaited promise whose catch emits
  `client.glueLoadFailed`. The promise calls `maybeInstallEnhancements`, but
  that function starts Enhancement installation without awaiting it; companion
  failures therefore do not reach the startup catch.
- `src/renderer/enhancements.ts:22-47` withdraws every requested feature when
  the companion installer throws, without retaining the failed install phase.
  `src/renderer/certified-companion-core-installation.ts:88,558` emits
  `enhancement.installFailed` with only `clockSynchronized`.
- `src/shared/diagnostics.ts:38-52,209-229` and
  `src/main/diagnostics/schema-protocol-renderer.ts:346-351,676-681` deliberately
  use closed, privacy-safe event schemas. Preserve that design.
- `scripts/enhancements-live.ts` exits before its existing `try` for a missing
  `GW_LIVE_SMOKE`, an unknown scenario, preflight refusal, unknown build ID,
  Electron spawn failure, and debugging-endpoint failure. All can bypass the
  `failure.json` written by the later catch. Plan 001 moves the full build into
  this runner, which adds one more explicit pre-launch boundary.
- `scripts/enhancements-live/result.ts:4-17` already demonstrates the right
  pattern: convert arbitrary errors into closed startup codes.
- `scripts/build.mjs:99-220` owns the ordered `BUILD_STEPS`, but each step is an
  unnamed command/argument pair. A missing tool prints one contextual message;
  other failures exit with the child status. There is no stable build phase or
  optional machine-readable terminal receipt.

The runtime lifecycle itself remains as documented in `docs/process-model.md`
and `docs/wasm-host.md`. A receipt describes a boundary outcome; it must not
become launch authority or duplicate lifecycle state.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Build receipt tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/build-receipt.test.ts tests/unit/the-companion-kernel-is-compiled-once-per-build.test.ts` | exit 0; every build step is named once and terminal receipts are closed |
| Verifier receipt tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/local-client-verifier-host.test.ts` | exit 0; timeout, exit, malformed and completed are distinct |
| Renderer phase tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-startup-phase.test.ts tests/unit/enhancement-installation-phase.test.ts` | exit 0; closed phases only |
| Live result tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancements-live-result.test.ts` | exit 0; every early failure creates a receipt |
| Typecheck | `pnpm typecheck` | exit 0 |
| Repository gate | `pnpm run check` | exit 0 |
| Product build | `pnpm build` | exit 0 |

## Scope

**In scope**:

- `scripts/build.mjs`
- `src/main/certification/local-client-verifier-host.ts`
- `src/main/certification/verifier-process-lifecycle.ts` (create)
- `src/main/client-runtime.ts`
- `src/shared/diagnostics.ts`
- `src/main/diagnostics/schema-app-update.ts`
- `src/main/diagnostics/schema-protocol-renderer.ts`
- `src/main/diagnostics/renderer.ts`
- `src/renderer/harness.ts`
- `src/renderer/diagnostics.ts`
- `src/renderer/enhancements.ts`
- `src/renderer/certified-companion-installation.ts`
- `src/renderer/certified-companion-core-installation.ts`
- `src/renderer/client-startup-phase.ts` (create)
- `src/renderer/enhancement-installation-phase.ts` (create only if the installer
  cannot expose its existing phase without a cycle)
- `scripts/enhancements-live.ts`
- `scripts/enhancements-live/result.ts`
- `tests/unit/build-receipt.test.ts` (create)
- `tests/unit/the-companion-kernel-is-compiled-once-per-build.test.ts`
- `tests/unit/local-client-verifier-host.test.ts` (create)
- `tests/unit/client-startup-phase.test.ts` (create)
- `tests/unit/enhancement-installation-phase.test.ts` (create)
- `tests/unit/enhancements-live-result.test.ts` (create)
- `tests/unit/export-detector-rejects-undeclared-event-fields.test.ts`
- `docs/process-model.md`

**Out of scope**:

- Raw error messages, stack traces, paths, memory contents, or account data in
  diagnostics or live receipts.
- A generic error hierarchy, tracing SDK, durable event bus, or lifecycle state
  machine.
- Retrying transforms, relaunching Electron, or changing feature policy.
- Changing the fail-closed result of any existing failure.
- Inferring a phase from error-message text inside production code.

## Git workflow

- Branch: `refactor/agent-runtime-receipts`
- Recommended commit: `feat(runtime): preserve closed failure phases`
- Do not push or open a pull request unless requested.

## Steps

### Step 1: Give the existing build one named phase receipt

Change each `BUILD_STEPS` entry from an anonymous pair to one frozen record
with `phase`, `command`, and `args`. Use a closed phase union derived from that
same array; do not maintain a separate phase list. Stable names should describe
the artifact boundary, for example `renderer-assets`, `renderer-bundle`,
`main-typescript`, `launcher`, `tools`, `native-host`, `gw-dat-decoder`,
`preloads`, `companion-kernel`, `companion-seal`, `cartography-kernel`, and
`cartography-seal`.

Add an optional `--receipt <path>` argument to `scripts/build.mjs`. Write one
atomic terminal JSON document with `formatVersion`, `status`, `phase`, closed
`reason` (`completed`, `missing-tool`, `nonzero-exit`, or `spawn-failed`), exit
code, Node version, architecture, and completed phase names. Do not include the
local working directory, command output, environment, or signing credentials.
Without the flag, preserve current build output and behavior exactly.

Update existing tests that consume `BUILD_STEPS`; they must derive from the
same records, not a compatibility tuple export.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/build-receipt.test.ts tests/unit/the-companion-kernel-is-compiled-once-per-build.test.ts`
→ exits 0; a fake runner proves success, missing tool, spawn failure, nonzero
exit, one terminal write, and the exact failed phase.

### Step 2: Preserve the verifier process outcome

Replace the private `T | null` result inside
`local-client-verifier-host.ts` with this closed process result:

```ts
type VerifierProcessResult<T> = Readonly<
  | { status: "completed"; value: T }
  | { status: "unavailable"; reason: "timeout" | "exit" | "malformed" | "spawn" }
>;
```

Put the repeated settle/timeout mechanics in
`verifier-process-lifecycle.ts`. It accepts a verifier-specific `fork`
callback, a boundary validator, and the timeout; its minimal child interface
contains only `once("message")`, `once("exit")`, and `kill()`. This keeps unit
tests independent of Electron while deleting the three copied lifecycle blocks.
`local-client-verifier-host.ts` remains the only module that imports
`utilityProcess` and supplies the concrete fork arguments.

Keep the three exported verifier functions typed to their concrete proof. Do
not accept a partially validated child value. Install the `message`, `exit`,
and timeout listeners before resolving and guarantee exactly one outcome.

Update `ClientRuntime` so the existing completed event remains, and
`wasm.localVerificationUnavailable` receives a closed `reason` field. Do the
same for native-double-click and extended-memory at their owning preparation
boundary only if their current caller records a failure event; do not invent an
event merely to make the types symmetric.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/local-client-verifier-host.test.ts`
→ exits 0 for all four unavailable outcomes and proves that a late message
after timeout cannot change the result.

### Step 3: Split WASM startup at real boundaries

Create `src/renderer/client-startup-phase.ts` with only:

```ts
export const CLIENT_STARTUP_FAILURE_PHASES = [
  "fetch", "compile", "instantiate", "cartography-install",
] as const;
export type ClientStartupFailurePhase =
  (typeof CLIENT_STARTUP_FAILURE_PHASES)[number];
```

Refactor `harness.ts` into small local operations whose catch site already
knows the phase. Fetch once and reject a non-OK response at that boundary; use
`WebAssembly.compileStreaming` with the current
bounded buffered `WebAssembly.compile` fallback, then instantiate the compiled
module with the import object. This is the smallest way to distinguish compile
from instantiate without parsing exception text.
The final diagnostic becomes `client.startupFailed` with one closed `phase`;
delete `client.glueLoadFailed` after updating every schema, renderer switch,
and policy test. Do not include the error string or fingerprint unless the
existing privacy policy already permits that exact field.

The fallback milestone remains evidence that streaming compilation failed; the
terminal phase is `fetch`, `compile`, or `instantiate`. The JavaScript API runs
linking and the module start function inside instantiation, so do not claim a
finer split the boundary cannot observe. Do not label Cartography exceptions as
glue failures. Enhancement installation is a fire-and-forget companion
lifecycle and remains solely owned by Step 4; do not pretend its failures are
awaited by the client-startup promise.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-startup-phase.test.ts`
→ exits 0 after injecting one rejection per operation; each has one terminal
phase, no double report, and the same user-facing startup refusal.

### Step 4: Preserve the companion install phase

Inside the existing certified installer, identify the smallest stable phases
that map to its real safety boundaries:

```text
extension-load -> manifest -> allocation -> side-module -> observers -> hook
```

Expose a closed phase from the boundary that already detects each refusal. A
single small tagged error local to the renderer is acceptable; a generic error
base class is not. Add `phase` to `enhancement.installFailed`. Continue to
withdraw the complete requested feature set exactly as today.

`src/renderer/certified-companion-installation.ts:20-27` owns the dynamic import
of the Tools companion. Map rejection there to `extension-load` before handing
off to the core installer; the core installer cannot diagnose an import that
never reached it.

Do not report a phase after the installer has successfully cleaned up unless
the failure actually occurred there. Do not expose allocator addresses,
exports, table indices, or exception text.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancement-installation-phase.test.ts`
→ exits 0; dynamic-import rejection and each core refusal have one allowed
phase, cleanup remains reverse-ordered, and every requested feature is
withdrawn.

### Step 5: Make each normal live invocation produce one terminal receipt

Define the run boundary precisely: `--list` and `--describe` are catalogue
queries and produce no run receipt. Every other invocation, including a
missing smoke opt-in, malformed/unknown scenario, failed Plan 001 product
build, preflight refusal, unknown build ID, spawn failure, and debugger
failure, is a live attempt and must produce exactly one receipt. Create the run
directory before these checks; never throw or call `process.exit` from a live
attempt without first settling the receipt.

Move configuration, build, preflight, spawn, and debugging-endpoint acquisition
under the receipt-owning terminal boundary. In
`scripts/enhancements-live/result.ts`, define one versioned, privacy-safe
terminal shape:

```ts
type LiveRunReceipt = Readonly<{
  formatVersion: 1;
  runId: string;
  scenario: LiveScenarioName | "unknown";
  privacy: LiveScenarioPrivacy | "unknown";
  status: "passed" | "failed";
  phase: "configuration" | "build" | "preflight" | "launch" | "debugger" |
    "account" | "readiness" | "scenario" | "acceptance" | "shutdown";
  code: LiveRunCode;
  artifact: {
    appVersion: string | null;
    officialWasmSha256: string | null;
  };
  evidence: {
    precondition: "armed" | "not-armed" | "not-applicable";
    artifacts: readonly (
      | "scenario-result"
      | "failure-detail"
      | "failure-screenshot"
      | "graphics-evidence"
    )[];
  };
}>;
```

Create a unique directory under the current live evidence root per run and
write `result.json` atomically for success and failure. Existing rich
`failure.json`, screenshots, and console output may remain secondary evidence.
For privacy-sensitive scenarios, the receipt must contain no character name,
path, renderer text, account value, or opaque game identifier. Derive
`LiveScenarioName` and `LiveScenarioPrivacy` from Plan 001's registry. Never
echo an invalid CLI scenario: use `scenario: "unknown"` and
`privacy: "unknown"`.

`officialWasmSha256` means the hash of the unmodified installed ArenaNet WASM,
not the selected transformed chain, Cartography predecessor, or final served
module. Obtain it from the existing
`ClientSession.compatibility.clientSha256` returned by
`window.gwNative.client.session()` and projected in
`scripts/enhancements-live/result.ts`; use `null` when compatibility is
unavailable. Do not rehash a served path in the renderer and do not overload
this field with a later transform identity.

Define `LIVE_RUN_CODES` once as a closed constant beside the receipt validator
and derive `LiveRunCode` from it. Every terminal branch must choose one member;
do not accept arbitrary strings. Evidence references are closed logical names,
not operator-controlled filenames or paths, and are capped/deduplicated. A
Plan 003 scenario reports `armed` only after `onArmed` ran, `not-armed` for a
missing/unstable precondition, and `not-applicable` only when the scenario has
no arm-first capture.

Use explicit phase transitions in the runner, not message matching, to assign
the receipt phase. Existing `closedCharacterSwitchFailureCode` can own closed
codes but must not be the phase source.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancements-live-result.test.ts`
→ exits 0; endpoint timeout, missing browser context, account timeout,
acceptance failure, unclean shutdown, and success each write exactly one valid
terminal receipt. It also covers missing opt-in, unknown scenario, build
failure, preflight refusal, unknown build ID, and spawn failure. An unknown
argument containing path/private-looking text is absent from `result.json`;
all codes and evidence references come from their closed constants. A fixture
with distinct official, Enhancement-predecessor, and final served hashes proves
that the receipt selects only the official input hash.

### Step 6: Document and run the gates

Add a compact receipt table to `docs/process-model.md`: producer, boundary,
closed phase vocabulary, and consumer. State that receipts are evidence, not a
second runtime state or retry instruction.

Run every command in “Commands you will need,” then `git diff --check`.

**Verify:** `pnpm typecheck && pnpm run check && pnpm build && git diff --check`
→ every command exits 0.

## Test plan

- Verifier child completes, times out, exits, sends malformed data, and throws
  during spawn; the parent settles once and kills the child.
- Named build steps preserve their order; every build terminal path writes one
  optional privacy-safe phase receipt without changing default output.
- Startup fetch, compile, instantiate, and Cartography install failures are
  distinguishable while the visible fallback remains unchanged; companion
  Enhancement failures use their own installer phase.
- Companion extension-load, manifest, allocation, side-module, observer, and
  hook refusals use closed phases and preserve cleanup.
- Live runner writes a terminal receipt for every normal invocation, including
  configuration/build/preflight failure, before CDP connection, and after an
  unclean shutdown. Catalogue queries do not create a receipt.
- Receipt evidence uses only closed logical artifact names and records whether
  a semantic precondition was armed, not armed, or not applicable.
- Privacy policy test rejects new free-text and unknown fields.
- Existing diagnostic export schema and stale-field tests pass.

## Done criteria

- [ ] Verifier timeout, exit, malformed reply, and spawn failure remain distinct.
- [ ] An opted-in build receipt names the exact failed build phase.
- [ ] Fetch, compile, instantiate, and Cartography install do not share one
      terminal diagnostic; companion install phases remain separate.
- [ ] Companion install failures name the real failed safety boundary.
- [ ] Every normal live invocation writes one atomic, versioned terminal
      receipt, including configuration/build/preflight/launch failures;
      catalogue queries write none.
- [ ] Receipts contain artifact identity when known and no private/free text.
- [ ] Receipts contain the registry privacy class, closed logical evidence
      names, and an explicit armed/not-armed/not-applicable precondition state.
- [ ] No launch, retry, cleanup, or feature-withdrawal behavior changed.
- [ ] Focused tests, `pnpm typecheck`, `pnpm run check`, and `pnpm build` pass.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- a proposed phase cannot be assigned at the boundary without parsing an error
  message;
- distinguishing phases would expose a pointer, local path, account value, raw
  exception, or game text;
- a diagnostic consumer relies on the removed event name outside this repo;
- the streaming fallback behavior or cleanup order would need to change;
- naming build steps would require a compatibility export instead of updating
  repository-local consumers;
- an install phase cannot be surfaced without making domain logic depend on the
  diagnostics transport; or
- an in-scope contract drifted since `4dacdd3b`.

## Maintenance notes

- Add a phase only when a real control boundary can assign it deterministically.
- Never turn receipts into a shadow lifecycle model. The process and installer
  remain the source of current state.
- A future Plan 001 inspection can join these receipts to byte-derived module
  facts without changing certification authority.
