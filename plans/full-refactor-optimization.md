# Refactor program: outcome and completion record

Status: accepted and in progress as a six-branch stack. Later stacked PRs
implement the target outcomes below; the final PR records only what the exact
stack head has actually proved.

Evidence baseline: `main` at `54c6e0806d484fdd6ac4c03b1edf102a16a9bd10`,
reviewed on 2026-08-10. Workflow steps, contracts, and test inventories belong
to their executable owners rather than being duplicated here.

## Purpose

This program is complete when GWonMac is the smallest system that:

1. keeps the verified official Guild Wars client playable on an unknown
   ArenaNet build;
2. keeps host-owned Build and Team authoring usable while exact-client
   observation and Apply refuse;
3. has one fast, reviewable ArenaNet certification path;
4. gives release-app players truthful Stable/Beta selection and a safe manual
   return to Stable;
5. has one owner for each native invariant and keeps multi-step feature
   workflows out of generic IPC; and
6. can be verified without turning ordinary contribution into release
   certification.

The preference throughout is:

```text
delete > simplify > replace > add
```

This is a target outcome, not a second implementation. Exact schemas live in
types, exact release steps live in workflows/scripts, and exact behavior lives
in tests.

## Terms that must not be conflated

- **ArenaNet client update:** official JS/WASM/game data selected by ArenaNet.
- **Certification:** a maintainer proposal that may enable exact-build repairs
  or optional integration after local proof and review.
- **GWonMac application update:** a signed macOS application release selected
  by the one `AppUpdater`.
- **Distribution identity:** `release`, `preview`, or `development`; controls
  bundle ID, signing, Keychain, profile, and updater authority.
- **Update track:** `stable` or `beta`; a preference inside the `release`
  identity only.
- **Tools Beta:** feature maturity, unrelated to the application update track.

## Dream-enough state

### Player outcomes

- The launcher paints before long client work and reports truthful progress.
- The player may choose when to download all game data; the client itself may
  still perform ArenaNet's mandatory update before play.
- Verified official bytes remain the fallback on every unknown or refused
  build.
- Builds and Teams remain editable on unknown builds. Party observation and
  Apply are unavailable rather than guessed.
- Quit remains bounded even when cleanup fails.
- Stable is the default application track. Beta admits beta, RC, and later
  Stable releases, never alpha.
- Selecting Stable affects the next update check. It does not reinterpret or
  cancel an operation already owned by the native updater.
- An older Stable is a manual signed/notarized DMG install from the fixed
  Releases page; it never reaches native automatic downgrade machinery.

### ArenaNet patch day

- One existing `pnpm certification` command and one scheduled workflow own
  detection and proposal. No report database, registry, or second CLI exists.
- Unknown official bytes remain bootable. The isolated template proof is
  bounded to five seconds; refusal serves the preserved official module.
- Template compatibility may be derived and proved locally.
- Enhancement memory/layout facts remain exact-build facts shipped in an app
  release; no remote certificate authority can widen them.
- Candidate promotion remains an atomic generation transaction already owned
  by `PatchClient`, `ClientRuntime`, and the exact `ClientHealthToken`.
- Patch-day live checks are explicit and minimal; ordinary PR CI stays
  deterministic and offline.

### Application release safety

- Stable and Beta share one release bundle ID, Keychain authority, profile,
  updater, and settings store.
- A Stable enabler containing the selector ships before the first public Beta.
- Every public beta/RC is newer than the exact latest Stable baseline.
- The latest Stable already accepts every durable settings key and value a
  candidate may write; Beta never invents rollback compatibility state.
- The release gate launches that exact signed Stable, the exact signed
  candidate, then the same Stable again.
- Settings, Builds, Teams, tags/references, window state, and origin-owned
  browser storage survive semantic writes with no quarantine or reset; a
  sentinel proves the chunk directory was not wholesale deleted.
- The recurring browser-store probe proves origin continuity only. A production
  Emscripten IDBFS/template round-trip is additionally required whenever
  Electron, Chromium, or the filesystem/persistence contract changes.
- Actual signed updater canaries remain release operations: Stable enabler to
  first Beta, then Beta/RC to final Stable.

### Maintainer outcomes

- Main is an explicit composition/lifetime root, not a service container.
- Feature modules own their multi-step dialogs, durable markers, and recovery
  decisions; main retains app-wide lifecycle and update presentation.
- IPC validates senders and values, registers channels, and either forwards a
  direct owner-local capability or calls its workflow owner. It is not a
  second feature service.
- The preload remains a frozen, narrow capability bridge.
- Renderer game integration and host-only Tools share only lifecycle behavior
  that has two real consumers; there is no generic `GameHost`, plugin ABI, or
  registry.
- Diagnostics remain bounded, closed-schema, local, previewable, and redacted.
- Performance claims name a measurement boundary; unproved public absolutes are
  removed rather than converted into architecture.

## Target owners

| Concern | Owner | Executable proof |
| --- | --- | --- |
| Release grammar, ordering, and track eligibility | `src/shared/release.ts` | `tests/unit/release.test.ts` |
| Application discovery/download/install | `src/main/app-updater.ts` | `tests/unit/app-updater.test.ts` |
| Website release acquisition | `apps/website/server/utils/release-select.ts` | `tests/website-smoke.ts` |
| Stable-readable candidate data | `scripts/verify-stable-beta-roundtrip.ts` | release workflow only |
| Official client publication/rollback | `PatchClient` + `ClientRuntime` + `ActiveClientSlot` | active-client unit and client integration/package stories |
| Shared Tools lifetime | `src/renderer/toolbox-foundation.ts` | packaged Enhancement runtime |
| Host-only Tools mounting | `src/renderer/tools-host.ts` | packaged unknown/soft-refusal stories |
| Settings workflows | `src/main/settings-actions.ts` | unit/Electron settings stories |
| Bridge channels and payloads | `src/shared/contracts.ts` + preload | policy and Electron bridge tests |
| Diagnostics | per-feature event fragments + recorder | diagnostics unit/export tests |

No other document may redefine these rules.

## Required stacked PRs

The program uses six cohesive PRs, not eleven enlarged ones. Removed and
deferred proposals account for the smaller count.

| Order | Branch | Outcome | Value | Risk/cost |
| ---: | --- | --- | --- | --- |
| 0 | `refactor/docs-foundation` | delete stale plans and unsupported claims; establish truthful architecture/update vocabulary and this target record | high maintainer | low-medium |
| 1 | `refactor/remove-certificate-feed` | delete the non-operational remote authority, profile-controlled proof cache, and all residue | high simplification/security | low-medium |
| 2 | `refactor/host-only-tools` | keep host authoring available across unknown/soft-refused clients | high player/patch day | medium |
| 3 | `refactor/stable-beta-updates` | one Stable/Beta selector, website policy, manual return, and exact data gate | high player/release | medium-high release cost |
| 4 | `refactor/webgate-story` | bind every client-backed `gw://` response and ready signal to one active client generation; keep WebGate stateless, cap proxy request bodies, and compact materialized snapshot/icon views | high regression reduction | medium |
| 5 | `refactor/ipc-workflows` | move settings dialogs, markers, and recovery out of generic IPC; keep quit/marker failures bounded and honest | high maintainability | medium |

Each branch may contain several atomic commits. A PR is split only when each
part is independently safe to ship; line count alone is not an ownership
boundary.

## Verification by invariant

| Invariant | Fastest sufficient proof | Expensive scope |
| --- | --- | --- |
| Release parsing/eligibility/alpha refusal | pure unit table | none |
| Website exact canonical DMG | website selector + served smoke | website build |
| Older Stable never reaches Squirrel | updater unit/integration | none |
| Exact Stable/candidate identities and ordering | release script preconditions | signed release runner |
| Stable-readable durable state | none locally substitutes for released Stable | every public beta/RC |
| Host-only Tools on unknown/soft-refused build | packaged production-path story | packaged suite |
| Host-only live disable/re-enable | same packaged story | packaged suite |
| Official bytes/no companion command on unknown build | same packaged story | packaged suite |
| No ready signal or client artifact before activation | active-client unit + client-runtime Electron story | Electron suite |
| No patch alias replacement while an active generation is serving | client-runtime concurrency + launcher retry stories | Electron suite |
| Stateless WebGate auth/cookie boundary | unit classifier + one composed Electron story | Electron suite |
| Settings decision ownership | unit plus focused Electron story | Electron suite |
| Source/import/bridge boundaries | policy/type tests | ordinary check |
| Signed identity/Keychain/notarization | signed package workflow | release only |
| Live account/client/update behavior | [owned release-only canary record](../docs/release-verification.md#release-only-canary-record) | release/patch day only |

Ordinary local targets remain:

- `pnpm check`: deterministic source/unit/policy/Tools gate;
- `pnpm verify`: integration and compiled-runtime proof;
- Electron/package stories: final integration or a change that directly needs
  them; and
- signed/live checks: release operations only.

Tests prove behavior or a trust-boundary call site. They must not pin formatting,
comments, prose inventories, or implementation order already exercised by a
packaged story.

## Deleted complexity

- remote certificate feed, signing workflow, key resource, delivery state,
  diagnostics, and tests;
- a second patch-day report representation;
- another generation token/journal abstraction over existing transaction
  owners;
- generic `GameHost`, coordinator, cancellation framework, registry, ledger,
  plugin surface, background job, or database;
- Vue shell rewrite without measured player value;
- duplicate website release version/track policy;
- source-regex tests that duplicate packaged behavior; and
- public performance absolutes without evidence.

Hard cutovers are required. No compatibility layer keeps deleted authorities
alive. Derived cache files that are no longer read need no migration framework.

## Deferred until evidence

| Proposal | Evidence required before reconsideration |
| --- | --- |
| Generic renderer `GameHost` | second real implementation or repeated defect impossible to isolate directly |
| Startup coordinator | remaining cross-feature decision after IPC extraction with net simplification |
| General cancellation framework | reproduced lifetime leak not solved by an owner-local abort/deadline |
| New generation journal/token | atomicity defect not expressible by existing generation + health token |
| Remote template feed | material incident where app-release latency harms players, plus an old signed app demonstrably adopting a real template-only asset |
| Worker/renderer split | prototype proves Emscripten, JSPI, OffscreenCanvas, IDBFS compatibility and measured benefit |
| More prefetch/concurrency/cache architecture | benchmark identifies that boundary as the bottleneck |

Deferred means absent from the program, not partially scaffolded.

## External release operations

Code can be complete before these operations are possible, but Beta must not be
advertised as safely returnable until the pre-publication gates and bounded
post-publication certification checks pass:

The release approver executes and records these operations using the
[release-only canary record](../docs/release-verification.md#release-only-canary-record).
Every step reuses the existing protected `release` environment and Apple
secrets. One maintainer-owned Apple Silicon Mac is sufficient for the live
check; this program requires neither a Beta-specific signing setup nor a
second-device hardware matrix.

1. publish Stable enabler `S0` with the selector and stable-readable contract;
2. build a newer `B1` under the same release identity;
3. run the approval-gated signed/notarized `S0 → B1 → S0` data proof;
4. publish B1, then run one owned production-updater `S0 → B1` canary;
5. repeat the data proof for every public beta/RC; and
6. on final Stable publication, run one owned `B1/RC → S1` updater canary.

No draft-only feed, second updater, automatic downgrade, or custom DMG
downloader is added to make these checks easier.

## Final completion gate

The refactor program closes when all applicable boxes are evidenced:

- [ ] full stack is rebased and each PR remains independently reviewable;
- [ ] user-owned unrelated worktree changes are unchanged;
- [ ] typecheck, lint, unit, policy, integration, release, Tools,
      website, Electron, packaged runtime, and packaged smoke gates pass against
      the exact final stack head;
- [ ] the mandatory thermonuclear review has no unresolved P1/P2 finding;
- [ ] unknown and soft-refused ArenaNet modules keep host-only Tools, while
      live observation/Apply remain absent;
- [ ] Stable/Beta selection has one release-policy source and every candidate
      is exact, newer than Stable, and Stable-readable;
- [ ] WebGate remains stateless and no credential or cookie becomes app state;
- [ ] multi-step settings workflows are outside IPC; direct owner-local IPC
      operations remain explicit rather than hidden behind another service;
- [ ] no remote certificate authority, duplicate updater or release
      version/track policy, generic `GameHost`, second Tools host, coordinator,
      registry, migration framework, or refactor-only compatibility shim
      remains. The one existing `ToolsHost` and released-data readers remain
      intentionally;
- [ ] active documents describe shipped behavior and distinguish local proof
      from signed/live release operations; and
- [ ] the program stops. Further architecture work requires a reproduced player
      or maintainer defect, or a measured performance decision.

Passing this gate is “dream enough”: not a claim that software will never
change, but proof that this architecture program has no unfinished cleanup or
speculative foundation left behind.
