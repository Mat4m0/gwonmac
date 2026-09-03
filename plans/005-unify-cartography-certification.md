# Plan 005: Bind operational facts to witnesses and unify Cartography certification

> **Executor instructions**: This is a large architectural correction. Execute
> it as the four reviewable layers under “Git workflow”; do not combine them
> into one oversized pull request. Run every gate for each layer. If a STOP
> condition occurs, stop and report—do not add a fallback hash table or silently
> retain one exact constant. Update `plans/README.md` only after the complete
> stack is merged.
>
> **Drift check (run first)**:
> `git diff --stat 4dacdd3b..HEAD -- src/shared/evidence-reference.ts src/main/certification/enhancement-build-model.ts src/main/certification/enhancement-builds.ts src/main/certification/enhancement-fact-evidence.ts src/main/certification/cartography-certificate.ts src/main/certification/cartography-proof.ts src/main/certification/cartography-world-map-proof.ts src/main/certification/cartography-exploration-proof.ts src/main/certification/cartography-world-anchor-proof.ts src/main/certification/cartography-spike-client.ts src/main/certification/cartography-transform-internals.ts src/main/certification/client-module.ts src/main/certification/compass-frame-spike-proof.ts src/main/certification/mission-map-frame-spike-proof.ts src/main/certification/pathing-spike-transform.ts src/main/certification/local-client-verifier.ts src/main/certification/local-client-verifier-host.ts src/main/certification/local-client-verifier-process.ts src/main/client-runtime.ts src/main/main.ts src/main/core/paths.ts src/tools/certification.ts src/tools/client-chain-qualification.ts src/tools/cartography-visual-review.ts scripts/client-recertification-evidence.ts scripts/enhancements-live/scenarios.ts scripts/enhancements-live/graphics-probe.ts tests/unit/enhancement-fact-evidence.test.ts tests/unit/client-recertification-evidence.test.ts tests/unit/client-chain-qualification.test.ts tests/unit/cartography-certificate.test.ts tests/unit/cartography-local-verifier.test.ts tests/unit/client-module.test.ts tests/unit/paths.test.ts tests/unit/live-cartography-probe.test.ts tests/unit/cartography-visual-review.test.ts tests/policy/source-wasm-host.test.ts tests/client-artifact/cartography-spike-client.test.ts tests/client-artifact/client-chain-qualification.test.ts tests/client-artifact/compass-frame-spike-recert.test.ts tests/client-artifact/mission-map-frame-spike-recert.test.ts tools/README.md docs/arenanet-compatibility.md docs/wasm-host.md docs/enhancement-development.md docs/cartography.md certificates/README.md`
> If Cartography preparation, transform inputs, or verifier modes changed,
> rebuild the inventory below before proceeding. Stop if a released external
> consumer depends on a production identifier this plan would remove.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 001, 002, 003, and 004
- **Category**: architecture
- **Planned at**: commit `4dacdd3b`, 2026-08-31

## Why this matters

The documented architecture has one runtime authority: an isolated semantic
verifier proves exact input bytes, then Main repeats the deterministic
transform. Two gaps still make that architecture costly for agents. Existing
Enhancement fact groups do not expose which local structural and live witnesses
support their semantic meaning, while Cartography bypasses the verifier with an
input/output hash map and a large exact certificate beside the byte emitters.
This plan first binds operational facts to queryable evidence without changing
authority, then derives every Cartography transform input, switches runtime to
the one verifier, and deletes the parallel authority.

## Current state

- `src/main/certification/enhancement-build-model.ts:176-469` owns exact
  Enhancement fact groups such as hook, observation, dispatcher, cursor,
  commands, travel, storage, skill, and pre-game layouts. The type carries no
  local-witness, external-lead, behavioral-validation, or stale-scope metadata.
- `src/main/certification/enhancement-builds.ts` mixes independently recovered
  facts, GWCA/Toolbox++ cross-checks, live observations, and product labels in
  comments. The verifier re-derives requested structural roles, so these rows
  are regression evidence rather than launch allowlists, but an agent still
  must read comments and research history to learn what each group means.
- `scripts/client-recertification-evidence.ts` already emits privacy-safe input
  identities, verifier ABI, closed feature verdicts, invariants, candidate
  counts, and output digests. It does not emit fact/witness IDs or behavioral
  validation scope. Plan 004's `client-chain-qualification.ts` likewise needs
  to expose those IDs so `certification qualify` can prove evidence ancestry.
- `docs/arenanet-compatibility.md:33-61` declares the isolated verifier the sole
  capability authority and requires Main to repeat accepted transforms.
- `src/main/certification/cartography-spike-client.ts:17-132` contains
  `CERTIFIED_CARTOGRAPHY_BUILDS`: eight exact predecessor hashes select
  `official` or `relocated` memory roots and one expected output hash.
- `src/main/certification/cartography-transform-internals.ts:27-127` owns the
  rest of the runtime certificate as module constants:
  - frame layout, Compass label/render functions/body hashes/call site;
  - Mission Map dispatcher/table slot/gameplay-context function and projection;
  - World Map dispatcher/table slot/context layout;
  - exploration context/array/grid offsets;
  - world-anchor context, area-info count/stride, and coordinate offsets; and
  - two exact frame/context/area-info memory-root layouts.
- `src/main/certification/pathing-spike-transform.ts:209-468` reads those
  constants directly, checks selected body hashes/call sites, rewrites two exact
  table slots, and emits the observer functions.
- `src/main/certification/client-module.ts:294-330` applies that transform after
  file compatibility/Enhancement and before native double-click.
- Partial reusable proofs already exist:
  - `compass-frame-spike-proof.ts:47-98` derives the named Compass and shared
    frame layout, but retains one owner-body hash.
  - `mission-map-frame-spike-proof.ts:33-74` derives MapWindow and shared frame
    layout.
  Use them as starting points; do not copy their outputs into another table.
- `pathing-spike-proof.ts` is separate research evidence. It accepts one
  official SHA and exact function/body identities and explicitly refuses the
  owner chain. It does not authorize the runtime transform and is out of scope
  for this cutover.
- `tests/client-artifact/cartography-spike-client.test.ts` and
  `tests/client-artifact/client-chain-qualification.test.ts` exercise real
  retained inputs. Plan 004 must make those inputs reliably available before
  the authority changes.

Architecture constraints:

- Fact evidence classifies and points to witnesses; it never grants a
  capability or duplicates numeric offsets, indices, hashes, or layouts.
- A structural proof can establish identity/shape. Only a bounded live witness
  can establish player-visible meaning or lifecycle. The schema must keep those
  validation levels distinct.
- Cartography remains a distinct derived stage because its input is the selected
  post-Enhancement predecessor. Do not force it into the Enhancement bitmask.
- Main may validate a child result and repeat a transform; it may not parse an
  unknown module or trust child-produced output bytes.
- Exact rows may remain test-only regression evidence. No production path may
  consult them after the cutover.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Certificate unit tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/cartography-certificate.test.ts tests/unit/cartography-local-verifier.test.ts` | exit 0; every fact is validated and every locator is adversarially tested |
| Fact-evidence tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancement-fact-evidence.test.ts tests/unit/client-recertification-evidence.test.ts tests/unit/client-chain-qualification.test.ts` | exit 0; every active fact is classified and receipts expose ancestry without numeric duplication |
| Cartography live-evidence tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-cartography-probe.test.ts tests/unit/cartography-visual-review.test.ts` | exit 0; the matrix and immutable review artifact remain bound |
| Client preparation tests | `GW_CLIENT_WASM=/absolute/path/Gw.jspi.wasm node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-module.test.ts tests/client-artifact/cartography-spike-client.test.ts` | exit 0; Main repeats and cache corruption rebuilds |
| Retained locator tests | `GW_CLIENT_WASM=/absolute/path/Gw.jspi.wasm node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/client-artifact/compass-frame-spike-recert.test.ts tests/client-artifact/mission-map-frame-spike-recert.test.ts` | exit 0; retained positive and adversarial locator cases pass |
| Full private chain | `pnpm certification qualify --corpus "$GW_CLIENT_CORPUS"` | exit 0 for every declared pair/profile |
| Source/runtime gates | `pnpm verify:runtime` | exit 0 |
| Live Cartography | `GW_LIVE_SMOKE=1 GW_CARTOGRAPHY_LIVE=1 pnpm enhancements:live -- --scenario cartography-probe` | passed Plan 002 receipt with the required capture matrix; visual evidence remains explicitly reviewed |

## Scope

**In scope**:

- `src/main/certification/enhancement-build-model.ts`
- `src/main/certification/enhancement-builds.ts`
- `src/main/certification/enhancement-fact-evidence.ts` (create)
- `src/main/certification/cartography-certificate.ts` (create)
- `src/main/certification/cartography-proof.ts` (create)
- `src/main/certification/cartography-world-map-proof.ts` (create)
- `src/main/certification/cartography-exploration-proof.ts` (create)
- `src/main/certification/cartography-world-anchor-proof.ts` (create)
- `src/main/certification/cartography-spike-client.ts`
- `src/main/certification/cartography-transform-internals.ts`
- `src/main/certification/pathing-spike-transform.ts`
- `src/main/certification/client-module.ts`
- `src/main/certification/compass-frame-spike-proof.ts`
- `src/main/certification/mission-map-frame-spike-proof.ts`
- `src/main/certification/local-client-verifier.ts`
- `src/main/certification/local-client-verifier-host.ts`
- `src/main/certification/local-client-verifier-process.ts`
- `src/main/client-runtime.ts`
- `src/main/main.ts`
- `src/main/core/paths.ts`
- `src/shared/evidence-reference.ts` (created by Plan 004; modify only if the
  Layer 1 consumer exposes a validation hole)
- `src/tools/certification.ts`
- `src/tools/client-chain-qualification.ts`
- `src/tools/cartography-visual-review.ts` (create)
- `scripts/client-recertification-evidence.ts`
- `scripts/enhancements-live/scenarios.ts`
- `scripts/enhancements-live/graphics-probe.ts`
- `tools/README.md`
- `tests/unit/enhancement-fact-evidence.test.ts` (create)
- `tests/unit/client-recertification-evidence.test.ts`
- `tests/unit/client-chain-qualification.test.ts`
- `tests/unit/live-cartography-probe.test.ts` (create)
- `tests/unit/cartography-visual-review.test.ts` (create)
- `tests/unit/cartography-certificate.test.ts` (create)
- `tests/unit/cartography-local-verifier.test.ts` (create)
- `tests/unit/client-module.test.ts`
- `tests/unit/paths.test.ts`
- `tests/policy/source-wasm-host.test.ts`
- `tests/client-artifact/cartography-spike-client.test.ts`
- `tests/client-artifact/client-chain-qualification.test.ts`
- `tests/client-artifact/compass-frame-spike-recert.test.ts`
- `tests/client-artifact/mission-map-frame-spike-recert.test.ts`
- `docs/arenanet-compatibility.md`
- `docs/wasm-host.md`
- `docs/enhancement-development.md`
- `docs/cartography.md`
- `certificates/README.md`

**Out of scope**:

- `src/main/certification/pathing-spike-proof.ts` and
  `tests/client-artifact/pathing-spike-recert.test.ts`. That shape-only research
  proof needs its own owner-chain migration if it becomes runtime input.
- Moving Cartography into the Enhancement capability bitmask.
- Redesigning overlays, projections, reachability, or Toolbox++ mask data.
- A whole-client hash fallback, remote certificate, compatibility shim, or
  parsing unknown WASM in Main.
- Renaming the complete `src/renderer/cartography-spike/` directory. Remove stale
  production option/cache language only where touched by the authority cutover.

## Git workflow

Use four stacked pull requests and show these boundaries to the repository
owner before creating branches:

1. **`feat/enhancement-fact-witnesses`** — queryable fact classification and
   witness ancestry; no launch or transform behavior changes.
2. **`feat/cartography-certificate-contract`** — complete typed certificate,
   validator, inventory test, and mutation matrix; runtime unchanged.
3. **`feat/cartography-structural-verifier`** — structural derivation and isolated
   verifier mode; runtime unchanged; retained corpus proves parity with the
   legacy certificate.
4. **`refactor/cartography-certification-cutover`** — Main repetition, runtime
   switch, deletion of maps/constants, docs and touched production names.

Use matching Conventional Commit titles. Do not push or open PRs unless asked.
If a temporary parallel comparison path must survive a merged layer, record its
exact removal condition in `internals/migrations.md` as required by `AGENTS.md`,
and delete the entry with Layer 4. Prefer keeping comparison test-only so no
ledger is needed.

## Steps

### Layer 1: Bind current Enhancement facts to queryable witnesses

Create `enhancement-fact-evidence.ts` as a tooling-only typed companion keyed by
the exact `KnownEnhancementBuild.sha256`. Derive `EnhancementFactId` from one
constant containing
exactly these operational groups:

```text
hook, observation-base, play-region, player-skillbar, ui-dispatcher, cursor,
target, team-apply, game-thread, xunlai, travel, chat-aliases, party,
skill-slot-geometry, pre-game-controls, skill-cooldown
```

`sha256`, `outputSha256`, `programId`, and `buildId` are artifact/regression
identity, not semantic fact groups. Do not manufacture witnesses for them.

Do **not** add evidence to `KnownEnhancementBuild`: `client-module.ts` includes
the complete build object in the derived-cache fingerprint, so metadata there
would change runtime cache identity. Keep
`ENHANCEMENT_FACT_EVIDENCE` beside the retained rows, keyed by their exact input
SHA, and have tooling join the two. The transform, verifier baseline, and cache
fingerprint never receive the companion metadata.

Each present fact group has exactly one entry with this closed shape:

```ts
type EnhancementFactEvidence = Readonly<{
  origin: "local-discovery" | "external-lead" | "mixed";
  structuralWitness: readonly AnyLocalFeatureInvariant[];
  behavioral: readonly Readonly<{
    claim: string;
    status: "verified" | "structural-only" | "unknown";
    scenario: string | null;
    scope: "field-meaning" | "read-lifecycle" | "command-effect" | null;
    record: LocalBehaviorEvidenceReference | null;
  }>[];
  external: readonly Readonly<{
    project: "gwca" | "toolbox-plus-plus";
    commit: string;
    path: string;
    symbol?: string;
  }>[];
}>;
```

Require 1–8 unique, bounded claim slugs per fact group. Compound groups must
split materially different behavior: at minimum, `pre-game-controls` has
separate character-list/read-lifecycle and logout-select-play/command-effect
claims. Do not let one successful command witness silently certify a read
lifecycle or vice versa.

Use `AnyLocalFeatureInvariant` from
`local-client-verification-contract.ts`, then define one
`FACT_INVARIANT_OWNERS` map so each fact ID accepts only the feature/invariant
subsets that can actually prove it. A non-null scenario must
be a bounded slug and a policy test must prove that it names an entry in Plan
001's executable scenario registry; do not import a scripts-layer type into
Main certification.

Define `LocalBehaviorEvidenceReference` in the tooling-only evidence module as
either (a) an allowlisted repository investigation path/anchor plus the SHA-256
of its retained Plan 002 live receipt, or (b) a GitHub attestation digest plus
the SHA-256 of that receipt. Add an optional visual-review digest only for a
claim that actually depends on reviewed images. A corpus generation issue,
artifact provenance reference, task URL, or external source can never satisfy
this type. Reuse Plan 004's shared digest/path/anchor guards, not its whole
general-purpose union, and mutation-test rejection of provenance-only evidence
for `verified`.

Replace the opaque external `reference` with a closed object containing
`project`, an exact 40-hex commit, a safe repository-relative path, and an
optional bounded symbol. It is provenance only; it cannot grant `verified`.
Mutation-test missing/invalid commit, path, and symbol fields. A `verified`
behavioral fact requires a
scenario, scope, and durable evidence reference. `structural-only` requires a
local invariant and null behavioral record. `unknown` is explicit, never
silently promoted. The mapping contains no numeric fact value and is ignored by
the transform and runtime capability decision.

Populate the existing retained build by classifying every active group from
repository evidence. Do not guess: facts whose only surviving support is an
external comment become `structural-only` or `unknown` even if runtime remains
unchanged. Add an inventory test that fails when a present fact group lacks
metadata, an absent group has metadata, an invariant is attached to the wrong
fact, an external-only lead is marked locally verified, or distinct behavioral
claims are collapsed into one witness. The enclosing map key binds the evidence
to the exact build SHA; do not claim that an offline GitHub reference validator
has inspected the referenced artifact.

Add `certification facts [--feature <name>]`, derived directly from the retained
build and verifier invariant constants. It emits only fact ID, validation
level, witness IDs/references, external project/reference, the enclosing exact
input SHA, and derived stale conditions (`input-sha-change`,
`verifier-abi-change`, and, where relevant, `scenario-contract-change`). It
never emits offsets, indices, addresses, labels, or raw reports. Extend Plan
004's qualification receipt and
`scripts/client-recertification-evidence.ts` with the same fact IDs and
validation levels so an agent can trace qualified output ancestry without
reading `enhancement-builds.ts`.

Update `docs/enhancement-development.md` with the promotion rule: external code
is a lead; a local structural invariant proves identity; a local live witness
proves player-visible semantics. New operational groups cannot be added without
an evidence entry, and docs must not call `structural-only` behavior verified.
Update `tools/README.md`, the command owner established by Plan 001, with
`certification facts`, its bounded output fields, and the distinction between
evidence lookup and runtime authority. Do not create a second tools runbook.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/enhancement-fact-evidence.test.ts tests/unit/client-recertification-evidence.test.ts tests/unit/client-chain-qualification.test.ts`
→ exits 0; every current group is classified, invalid promotion is refused,
qualification output includes fact ancestry, and transform/capability output is
byte-for-byte unchanged. Assert the derived Enhancement cache fingerprint is
identical before and after the tooling-only evidence join. Run
`pnpm check:links` after the docs update.

### Layer 2: Define and inventory the complete Cartography transform certificate

Create `cartography-certificate.ts` with:

- `CARTOGRAPHY_VERIFIER_ABI`;
- a closed `CartographyFactId` union, one ID per independently derived group;
- a deeply readonly `CartographyCertificate` containing every value currently
  read from `COMPASS_CERTIFICATE`, `MISSION_MAP_CERTIFICATE`,
  `WORLD_MAP_CERTIFICATE`, `EXPLORATION_CERTIFICATE`,
  `WORLD_MAP_ANCHOR_CERTIFICATE`, and `CARTOGRAPHY_MEMORY_LAYOUTS`;
- a boundary predicate that rejects missing/extra fields, non-integers,
  out-of-range offsets/indices/counts, incoherent function/table relations, and
  wrong input SHA/verifier ABI; and
- `CartographyVerification` with exact input SHA, `proved | changed | ambiguous`,
  per-fact verdicts/candidate counts, and a certificate only for `proved`.

Do not use `string` for invariant/reason fields. Derive the closed IDs from one
constant. The certificate contains transform inputs, not output SHA, local path,
raw bytes, or a memory-layout label.

Add an inventory test that projects the current constants into this type by
reference and proves no transform input is absent. It must fail when a read of
any legacy certificate symbol is added to `pathing-spike-transform.ts` without a
matching typed field. Production continues to use the legacy path in Layer 2.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/cartography-certificate.test.ts`
→ exits 0 for the current full inventory and one mutation per field/group;
`git diff --exit-code 4dacdd3b -- src/main/certification/cartography-spike-client.ts src/main/certification/pathing-spike-transform.ts`
→ exits 0 because runtime authority has not changed.

### Layer 3: Derive every certificate fact in the isolated verifier

Create one coordinator, `cartography-proof.ts`, over small fact-local proofs.
Reuse `deriveCompassFrameSpikeProof` and `deriveMissionMapFrameSpikeProof` after
removing body hashes only when a positive structural relation plus adversarial
mutation establishes the same identity.

Add the missing fact-local proofs for:

1. frame-array/count roots and frame layout shared by Compass, Mission Map, and
   World Map;
2. Compass render/map-render relationship and unique call site;
3. Mission Map dispatcher, unique table slot, gameplay context, and projection;
4. the distinct World Map dispatcher/table slot/context—never infer it from
   Mission Map reuse;
5. game/world/map context roots, exploration array/grid layout; and
6. area-info base/count/stride and World Map anchor coordinate fields.

Each proof must start from a semantic anchor or an already proved relation,
return `changed` for zero candidates, `ambiguous` for more than one candidate,
and include a hard analysis budget. A body hash, historical index, exact memory
address, or layout label may assert regression parity after selection but may
not select the candidate. Use the supplied Cartography history as a warning:
Mission Map and World Map are separate contexts.

Add a `cartography` mode to `local-client-verifier-process.ts` and the closed
validator to `local-client-verifier.ts`. It reads the exact post-Enhancement
predecessor. The host boundary follows Plan 002's timeout/exit/malformed/spawn
receipts. Do not connect this mode to runtime yet.

Run every declared retained pair/profile and compare the derived certificate
field-for-field with the legacy constants, then transform both and require
byte-identical output. Add coherent-relocation fixtures that change function
indices, table slots, and memory roots while preserving relations; they must
prove without adding a row. Mutate each anchor/relation independently and
require the owning fact verdict to refuse.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/cartography-certificate.test.ts tests/unit/cartography-local-verifier.test.ts`
→ exits 0 for every fact, coherent relocation, zero/multiple candidates, and
analysis bounds; `pnpm certification qualify --corpus "$GW_CLIENT_CORPUS"` →
exits 0 with field and output-byte parity for every retained pair/profile.

### Layer 4: Switch runtime, repeat the transform, and delete exact authority

Change `client-module.ts` to:

1. send the exact selected post-Enhancement path/SHA to the Cartography verifier;
2. validate one `proved` certificate;
3. invoke `transformCartographySpikeWasm(input, certificate)` again in Main;
4. compute the expected output SHA from those repeated bytes; and
5. use the existing derived-cache contract with exact predecessor SHA,
   transform ABI, certificate/build fingerprint, and computed output SHA.

`prepareCartographySpike` receives the validated certificate and locally
computed output identity. It must not look up an input hash. The child never
supplies output bytes. `pathing-spike-transform.ts` and its emitters receive only
the certificate; delete direct reads of legacy exact certificate constants.

Delete `CERTIFIED_CARTOGRAPHY_BUILDS`, `CARTOGRAPHY_MEMORY_LAYOUTS`, and the
production `*_CERTIFICATE` value objects after no production import remains.
Keep exact hashes/old field values only in clearly named test regression
fixtures, generated or checked against Plan 004's corpus. Production must not
import those fixtures.

Update canonical docs with the complete stage order and one verifier authority.
Remove guidance to add a Cartography hash row. Rename `cartographySpike` in the
touched Main option/cache contract if it now describes shipped behavior; accept
the derived-cache miss as a hard cutover and do not add a dual-path shim.

Strengthen the existing `cartography-probe` without pretending screenshots are
machine-proved semantics. Its validator must require unique captures for closed
labels covering maps closed, Compass, Mission Map, World Map, exploration/grid
layers, district transition, different map, and restored graphics context. For
each label, assert only bounded projected facts the harness can know (expected
surface present, non-refused model, generation/epoch progression where the
action requires it, and context recovery). Add World Map actions to the printed
operator matrix. Preserve screenshot/evidence capture for visual review.

Use the Plan 002 run directory as the one evidence root. Change
`runGraphicsProbeSession` to accept the runner-created `runId` and an explicit
`outputDirectory`; pass `<live-run-directory>/graphics`. Remove its independent
timestamp/root selection. The fixed private layout is:

```text
<run>/result.json
<run>/graphics/evidence.json
<run>/graphics/capture-*.json
<run>/graphics/capture-*.png
<run>/visual-review.json
```

Include `runId` and `matrixVersion: 1` in `graphics/evidence.json`, and require
them to match `result.json`. The receipt still stores only the logical
`graphics-evidence` reference; consumers resolve that to this fixed relative
layout, never a timestamp guess or absolute path.

Extend `certification qualify --corpus` with optional
`--live-receipt <result.json>`. Validate the Plan 002 schema, require a passed
`cartography-probe`, and compare its `artifact.officialWasmSha256` with the exact
current-release corpus WASM identity. Emit only hashes and closed statuses. This
proves which retained input was exercised; it does not turn the receipt or
screenshots into transform authority.

Create `src/tools/cartography-visual-review.ts` and add:

```text
pnpm certification record-cartography-review \
  --live-receipt <result.json> --reviewer agent|operator --status passed|failed
```

After the live run, the reviewer inspects the required named screenshots. The
command validates the passed Cartography receipt and complete matrix, hashes
`<run>/graphics/evidence.json` plus every required screenshot into one
deterministic evidence-set digest, and writes `visual-review.json` beside the
receipt with exclusive-create semantics (refuse overwrite):

```ts
type CartographyVisualReview = Readonly<{
  formatVersion: 1;
  runId: string;
  scenario: "cartography-probe";
  reviewer: "agent" | "operator";
  status: "passed" | "failed";
  matrixVersion: 1;
  evidenceSetSha256: string;
}>;
```

It stores no notes, filenames, paths, game text, or reviewer identity. Extend
`certification qualify` to require
`--visual-review <visual-review.json>` whenever `--live-receipt` is supplied,
recompute the evidence-set digest, require matching run ID/matrix and `passed`,
and refuse tampered or missing screenshots. Do not claim that the old
`result.evidence` truthiness check proves marker placement, Mission/World
projection, or reachability.

**Verify:**
`rg -n "CERTIFIED_CARTOGRAPHY_BUILDS|CARTOGRAPHY_MEMORY_LAYOUTS|COMPASS_CERTIFICATE|MISSION_MAP_CERTIFICATE|WORLD_MAP_CERTIFICATE|EXPLORATION_CERTIFICATE|WORLD_MAP_ANCHOR_CERTIFICATE" src/main`
→ exits 1 with no production matches; the client-preparation tests and
`pnpm certification qualify --corpus "$GW_CLIENT_CORPUS"` exit 0; then
`pnpm verify:runtime` exits 0 and the live Cartography command writes a passed
Plan 002 receipt. Finally,
`pnpm certification qualify --corpus "$GW_CLIENT_CORPUS" --live-receipt <result.json> --visual-review <visual-review.json>`
exits 0 for the current-release pair, the required matrix passes, and the
immutable visual review is bound to the exact evidence set.

## Test plan

- Enhancement fact inventory covers every present operational group, rejects
  absent/extra groups, wrong feature invariants, opaque external provenance,
  invalid local promotion, and collapsed compound behavior claims.
- Fact metadata changes neither transform bytes, capability verdicts, nor the
  derived Enhancement cache fingerprint. Facts/qualification/generation views
  contain IDs and evidence ancestry but no numeric layouts or private paths.
- Boundary validation: format/ABI/input SHA, extra/missing fields, integer/range
  limits, status/certificate coherence, and every function/table relation.
- One positive structural locator and one zero/multiple/adversarial mutation for
  each of the six fact groups in Layer 3.
- Coherent relocation changes indices, table slots, roots, and predecessor hash
  while preserving semantics; it proves without an allowlist row.
- Main repeats the transform and rejects certificate/byte disagreement,
  malformed child output, timeout, crash, and cache corruption.
- Every declared private pair/profile matches legacy certificate values and
  output bytes before the deletion layer.
- Static policy test proves no production exact Cartography map/certificate or
  test regression fixture is imported.
- Cartography live validation requires the closed Compass/Mission/World/layer/
  lifecycle capture matrix and exact current corpus identity. Visual projection
  and reachability correctness are retained for explicit image review rather
  than inferred from `result.evidence` truthiness.
- Visual-review tests refuse overwrite, missing/duplicate matrix labels,
  changed evidence JSON, changed/missing screenshot, mismatched run ID,
  evidence copied from a different run, `failed` review, unknown fields, and
  path/free-text leakage.

## Done criteria

- [ ] Every active Enhancement fact group is queryable with structural witness,
      behavioral validation level/claims, origin, provenance, applicability,
      and derived stale conditions, without changing runtime/cache identity.
- [ ] `certification facts`, full-chain qualification, and generation evidence
      expose the same fact IDs from the one tooling-only evidence map.
- [ ] Every scalar/index/offset/hash relation consumed by the transform exists
      in one typed certificate and has one named local proof.
- [ ] The isolated verifier is the only Cartography support authority.
- [ ] Main validates the result, repeats the transform, and binds exact ancestry.
- [ ] No production exact Cartography input/output map or certificate constants remain.
- [ ] Unknown structurally equivalent modules prove; changed/ambiguous facts refuse.
- [ ] Retained real-client chains preserve certificate and output-byte parity.
- [ ] Cartography remains a distinct derived stage, not an Enhancement bit.
- [ ] Canonical docs describe the actual full chain and no hash-row workflow.
- [ ] Focused, corpus, runtime, and live gates pass.
- [ ] The live receipt matches the current corpus WASM, the required capture
      matrix passes, and the retained visual evidence has an explicit review
      result.
- [ ] Any temporary migration ledger entry is removed with the old path.
- [ ] `plans/README.md` status is updated after the complete stack merges.

## STOP conditions

Stop and report if:

- a fact cannot be classified without inventing a witness or treating an
  external lead as local verification;
- fact evidence changes a transform input, capability verdict, or derived-cache
  fingerprint;
- a behavioral group contains distinct claims that cannot be represented
  without collapsing their scopes;
- any transform input cannot be derived from a positive local relation and is
  known only because it was copied from a baseline, GWCA, or Toolbox++;
- a locator still selects by whole-client SHA, historical function index, body
  digest, fixed span, or one of the `official`/`relocated` labels;
- Main would need to parse unknown WASM or trust child-produced bytes;
- a coherent relocation cannot prove without weakening an invariant;
- retained certificate values, output bytes, or live behavior differ unexpectedly;
- the live receipt cannot be bound to the current-release corpus identity or
  the required Cartography evidence cannot be reviewed;
- a released external dependency consumes a renamed production contract; or
- pressure arises to keep any exact map/constant as a runtime fallback.

## Maintenance notes

- Exact regression fixtures remain useful only if Plan 004 can replay them and
  production cannot import them.
- `pathing-spike-proof.ts` is still an exact, shape-only research witness after
  this plan. Do not describe it as independent until a separate feature need
  justifies deriving its refused owner chain.
- Semantic validation of Toolbox-derived Cartography masks is a separate product
  evidence task; do not mix dataset review into this authority cutover.
