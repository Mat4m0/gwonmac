# Plan 001: Expose low-cost machine-readable system inspection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the “STOP conditions” section occurs, stop and
> report—do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4dacdd3b..HEAD -- package.json src/tools/certification.ts src/tools/wasm-inspection.ts src/tools/enhancement-workspace.ts scripts/enhancements-live.ts scripts/enhancements-live/scenarios.ts scripts/enhancements-live/catalogue.ts tools/README.md docs/enhancement-development.md tests/unit/certification-inspection.test.ts tests/unit/live-scenario-catalogue.test.ts tests/unit/enhancement-workspace.test.ts`
> If any in-scope file changed since this plan was written, compare the
> “Current state” excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `4dacdd3b`, 2026-08-31

## Why this matters

An incoming agent cannot currently ask one cheap question for the selected
WASM contract or the available live scenarios. The first documented diagnostic,
`pnpm certification doctor`, also rebuilds the complete application before it
reads the profile. This plan turns the existing certification CLI and scenario
registry into the inspection surface; it does not add another daemon, registry,
or source of runtime authority.

## Current state

- `package.json` runs a full build for every certification command:

  ```json
  "certification": "pnpm build && node build/tools/certification.js"
  ```

- `src/tools/certification.ts:71-80` exposes `doctor`, `recertify`, `verify`,
  `compare`, `template`, `transform`, and `double-click`, and already sends
  machine-readable output to stdout (`src/tools/certification.ts:19-23`). It has
  no module-contract inspection command.
- `scripts/enhancements-live.ts:49-62` accepts a scenario string and reports only
  `unknown Enhancement live scenario: <name>` for a miss.
- `scripts/enhancements-live/scenarios.ts:603` owns the exported `SCENARIOS`
  registry. Its scenario types currently expose tier, program, readiness, run,
  and validate, but no query-safe description/privacy/operator metadata
  (`scripts/enhancements-live/scenarios.ts:103-141`).
- `tools/README.md:51-62` omits the already implemented `verify` and `compare`
  commands.
- `src/main/certification/wasm-evidence.ts:41-50,241-280` is the production
  bounded parser and exposes module types, function type indices, exports,
  memory/table/element sections, data segments, and decoded relationships.
  `WebAssembly.Module.imports/exports` can add import names and kinds without a
  second binary parser.
- The repository already runs source TypeScript directly through
  `node --import ./scripts/ts-hook.mjs`; `client:official` and
  `enhancements:live` are examples in `package.json`.
- `package.json` currently prefixes `enhancements:live` with `pnpm build`.
  Therefore an early `--list` branch inside `scripts/enhancements-live.ts`
  alone would still rebuild the product. The build must move behind the
  catalogue-only branches while remaining mandatory for normal live runs.
- `scripts/enhancements-live.ts:56` separately derives output-capture privacy
  from `plan.name === "character-switch"`. Adding registry privacy metadata
  without making the runner consume it would create a second, drift-prone
  privacy source and could leak output for a future private scenario.
- `src/tools/enhancement-workspace.ts:100-125,194-220` marks cached snapshot
  completeness from expected chunk filenames only and labels the result
  `evidence: "presence-only"`. A corrupt or truncated file with the expected
  name can pass this cheap preflight. The default should remain cheap, but an
  agent needs an explicit integrity mode before a costly live investigation.

Architecture constraints to preserve:

- Generated reports are evidence only. The isolated verifier remains the sole
  capability authority (`docs/arenanet-compatibility.md:33-50`).
- The live registry remains the one source of valid scenario names and
  acceptance rules (`docs/enhancement-development.md:351-363`).
- Do not expose pointers, packets, account data, paths from the player profile,
  or raw memory (`docs/enhancement-development.md:390-397`).

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused inspection tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/certification-inspection.test.ts` | exit 0; all tests pass |
| Focused catalogue tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-scenario-catalogue.test.ts` | exit 0; all tests pass |
| Workspace integrity tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancement-workspace.test.ts` | exit 0; presence and verified-content evidence remain distinct |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Fast gate | `pnpm run check` | exit 0 |
| Product build | `pnpm build` | exit 0 |

## Scope

**In scope** (the only files to modify):

- `package.json`
- `src/tools/certification.ts`
- `src/tools/wasm-inspection.ts` (create)
- `src/tools/enhancement-workspace.ts`
- `scripts/enhancements-live.ts`
- `scripts/enhancements-live/scenarios.ts`
- `scripts/enhancements-live/catalogue.ts` (create)
- `tools/README.md`
- `docs/enhancement-development.md`
- `tests/unit/certification-inspection.test.ts` (create)
- `tests/unit/live-scenario-catalogue.test.ts` (create)
- `tests/unit/enhancement-workspace.test.ts`

**Out of scope**:

- Any runtime verifier, transform, capability, cache, or launch decision.
- A generic symbol database, decompiler, MCP server, or renderer memory API.
- Automatic downloading or retention of ArenaNet bytes.
- Live scenario acceptance thresholds. This plan exposes metadata and makes
  the existing runner privacy decision consume that canonical metadata; it
  does not otherwise change scenario behavior.
- Python-tool deletion. Plan 001 may mark them historical/secondary in docs,
  but migration of their unique functionality requires separate evidence.

## Git workflow

- Branch: `refactor/agent-harness-inspection`
- Use atomic Conventional Commits, for example:
  `feat(tooling): expose wasm and live-scenario inspection`
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Run certification directly from source

Change `package.json` so `pnpm certification` runs
`src/tools/certification.ts` with `scripts/ts-hook.mjs`, matching the existing
source-run convention. Do not add a second CLI entry point.

Add a unit/policy assertion that the `certification` package script does not
contain `pnpm build` or `build/tools/certification.js`. The complete product
build remains a separate explicit gate. If a certification subcommand is found
to consume a generated `build/` artifact, make only that subcommand return a
closed prerequisite refusal; do not restore a global build prefix.

Add `doctor --verify-snapshot`. The default retains its current cheap
filename-presence scan and explicitly reports `integrity: "not-checked"`. With
the flag, stream each expected chunk through SHA-256 with bounded concurrency,
verify its exact expected byte length, and report:

```ts
snapshot: {
  /* existing residency fields */
  evidence: "presence-only" | "content-verified";
  integrity: "not-checked" | "verified" | "invalid";
  invalidChunkCount: number;
  invalidChunkIndices: readonly number[]; // capped, sorted, no paths or hashes
}
```

Do not load the complete snapshot into memory, persist a second index, or make
full hashing the default. With verification requested, `readyForCachedLive`
must be false for an invalid or truncated chunk. Without it, docs and JSON must
call the result presence evidence, never content integrity.

**Verify**:
`pnpm certification doctor --profile /tmp/gwonmac-plan-001-missing-profile`
→ prints exactly one JSON document, performs no product build, and exits 1
because `readyForCachedLive` is false.

`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancement-workspace.test.ts`
→ exits 0 for missing, valid, truncated, and same-name/wrong-content chunks;
the default performs no snapshot-content reads.

### Step 2: Add `certification inspect`

Create `src/tools/wasm-inspection.ts` with a pure function that accepts bytes and
returns this closed shape:

```ts
type WasmInspection = Readonly<{
  formatVersion: 1;
  artifact: {
    sha256: string;
    bytes: number;
    validation: "valid" | "invalid" | "not-checked";
  };
  module: {
    functions: { imported: number; defined: number };
    types: readonly { params: readonly string[]; results: readonly string[] }[];
    imports: readonly {
      module: string; name: string; kind: "function" | "table" | "memory" | "global";
      typeIndex?: number;
    }[];
    exports: readonly { name: string; kind: string; index: number }[];
    tableRelations: number;
    dataSegments: number;
  } | null;
  refusal: null | "invalid-wasm" | "module-shape-unsupported" | "analysis-limit-exceeded";
}>;
```

Use `wasmEvidence(bytes).moduleView()` and `WebAssembly.Module` reflection. Do
not copy the section decoder. Sort imports and exports deterministically. A
parser refusal must be data in the report, not partial plausible output.
If the input exceeds the production analysis bound, report
`validation: "not-checked"` with `analysis-limit-exceeded`; do not run an
unbounded validation just to manufacture a boolean. Use `invalid` only when the
bounded validator actually rejected the bytes, and `valid` when validation
succeeded even if a later supported-shape check refused.

Wire `certification inspect [PATH/Gw.jspi.wasm]` into the existing CLI. Default
to the same installed artifact as `verify`. Print JSON only to stdout. Exit 0
for a complete valid inspection, 1 for a closed parser refusal, and 2 for CLI
misuse.

The first version does **not** claim host-provider ownership or transform
ancestry it cannot derive from the input bytes. Add neither as guessed strings.
Those can be joined later from runtime receipts after Plan 002.

**Verify**:
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/certification-inspection.test.ts`
→ passes fixtures for a minimal valid module, function import/export signatures,
deterministic ordering, invalid bytes, unsupported shape, and analysis bounds;
over-budget input is `not-checked`, never guessed invalid.

### Step 3: Make the live scenario registry self-describing

Add these closed metadata fields to every `LiveScenario`:

- `description`: one sentence;
- `privacy`: `"standard" | "character-private" | "graphics-consented"`;
- `operator`: `"none" | "setup" | "actions"`;
- `evidence`: a stable short label for the strongest behavior proved.

Keep `tier`, `program`, and `readiness` as the executable source of permissions
and prerequisites. Do not copy them into another list.

Make runtime process-output capture derive from `plan.scenario.privacy`, not a
scenario-name comparison. Preserve today's behavior: `character-private`
suppresses captured process output, `graphics-consented` keeps its existing
explicit-consent treatment, and `standard` remains captured and bounded. The
registry field is both the catalogue projection and the runner's single privacy
source.

Create `scripts/enhancements-live/catalogue.ts` to project the executable
registry into sorted, JSON-safe summaries. Add these non-launching interfaces:

```text
pnpm enhancements:live -- --list
pnpm enhancements:live -- --describe <scenario>
```

Change the `enhancements:live` package script to invoke the source runner
without a `pnpm build` prefix. In the runner, handle `--list` and `--describe`
before `GW_LIVE_SMOKE`, profile reads, or any build. For a normal live run,
invoke the same full product build that the package prefix ran before, require
its successful exit, and only then perform preflight or spawn Electron. Do not
duplicate the build recipe or add a second launch script.

`--list` emits one JSON document containing every scenario. `--describe` emits
one scenario or exits 2 with a JSON refusal that includes the valid names. A
normal miss should also include valid names.

**Verify**:
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-scenario-catalogue.test.ts`
→ proves every registry entry appears exactly once, metadata uses only closed
values, ordering is stable, describe/list perform neither build nor launch,
normal live execution still requires a successful build, and output capture
uses the registry privacy field rather than a scenario name.

### Step 4: Correct the owning documentation

Update `tools/README.md` to:

- list `inspect`, `verify`, and `compare`;
- state that maintained inspection uses the production TypeScript parser;
- label `wasmscan.py`, `packet_builders.py`, `gensyms.py`, and
  `gwca_anchor_probe.py` as research helpers that cannot grant authority;
- state that `gwca_anchor_probe.py` requires an optional external checkout and
  is not part of routine feature implementation.

Update `docs/enhancement-development.md` so its first commands use the cheap
inspection path, explain when `doctor --verify-snapshot` justifies its full
content-read cost, and document `--list`/`--describe`. Keep `pnpm build` as an
explicit later gate.

Do not create a new runbook. These two files already own the subjects.

**Verify**: `pnpm check:links` → exit 0.

### Step 5: Run the complete gates and inspect output

Run the focused tests, `pnpm typecheck`, `pnpm run check`, and `pnpm build`.
Then inspect one generated list and one minimal-WASM inspection with `jq` if
available; the commands must each emit exactly one JSON document to stdout.

**Verify**: `git diff --check` → no whitespace errors.

## Test plan

- `tests/unit/certification-inspection.test.ts`:
  - minimal valid module;
  - named function/memory/table/global imports;
  - export indices and function type link;
  - invalid binary;
  - unsupported/over-budget shape returns a closed refusal and no partial module;
  - stable sort and identical result across two runs.
- `tests/unit/live-scenario-catalogue.test.ts`:
  - complete registry coverage;
  - unique sorted names;
  - all closed metadata variants;
  - no function objects or environment values in JSON;
  - `--list` and `--describe` do not require `GW_LIVE_SMOKE`, a profile, or a
    product build;
  - normal live execution builds exactly once before preflight/launch;
  - a synthetic `character-private` scenario suppresses process-output capture
    without a name special case.
- `tests/unit/enhancement-workspace.test.ts`:
  - presence-only mode preserves the cheap default;
  - verified mode checks exact length and SHA with bounded concurrency;
  - invalid indices are sorted/capped and never expose names or paths.
- Existing pattern: use Node's built-in test runner as in
  `tests/unit/enhancements-are-derived-from-their-registry.test.ts`.

## Done criteria

- [ ] `pnpm certification doctor` does not run `pnpm build`.
- [ ] `doctor --verify-snapshot` distinguishes missing, truncated, corrupt, and
      content-verified chunks without reading the full snapshot into memory.
- [ ] `pnpm certification inspect <wasm>` emits the versioned closed JSON shape.
- [ ] Inspection code reuses `wasmEvidence`; no new section/instruction parser exists.
- [ ] `pnpm enhancements:live -- --list` works without `GW_LIVE_SMOKE=1`.
- [ ] `--list` and `--describe` do not build; normal live execution still
      performs one successful full product build before launch.
- [ ] Every scenario is described from the executable registry exactly once.
- [ ] The runner's output-capture policy derives from the registry privacy
      field; no scenario-name privacy special case remains.
- [ ] `tools/README.md` lists all current certification commands and labels
      external-source Python tools correctly.
- [ ] Focused tests, `pnpm typecheck`, `pnpm run check`, and `pnpm build` pass.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report if:

- the TypeScript hook cannot run an existing certification subcommand directly;
- a subcommand requires a generated build artifact not named in “Current state”;
- the production parser cannot distinguish unsupported input from invalid input;
- scenario metadata would need account names, paths, free text from runtime, or
  another privacy-sensitive value;
- implementation requires changing runtime proof or launch decisions; or
- any in-scope excerpt has drifted since `4dacdd3b`.

## Maintenance notes

- `inspect` is an evidence view, not capability authority. Review every future
  field for whether it can be derived from bytes or an existing canonical
  contract.
- When a live scenario is added, its metadata and behavior stay in the same
  registry entry.
- Do not add formatted human output until a real maintainer need appears; agents
  can format the stable JSON themselves.
