# Plan 003: Arm semantic discovery before building feature layers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the “STOP conditions” section occurs, stop and
> report—do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4dacdd3b..HEAD -- docs/enhancement-development.md docs/README.md docs/character-switch.md internal/upstream/investigation-template.md internal/research/quick-character-switch.md scripts/enhancements-live/scenario-checkpoint.ts scripts/enhancements-live/transition-capture.ts scripts/enhancements-live/character-switch-scenario.ts scripts/enhancements-live/toolbox-scenarios.ts scripts/enhancements-live/scenarios.ts tests/unit/live-transition-capture.test.ts tests/unit/live-scenario-checkpoint.test.ts tests/unit/investigation-record-template.test.ts`
> If the feature workflow, scenario contract, or Character Switch ownership
> changed, compare it with the “Current state” below before proceeding. Stop on
> contradictory current guidance rather than keeping both paths.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 001 and 002
- **Category**: architecture
- **Planned at**: commit `4dacdd3b`, 2026-08-31

## Why this matters

The expensive feature failures in Cartography, Dictation, Character Switch,
and Combat Clarity had the same shape: a plausible internal representation was
built before the smallest player-visible semantic fact had been witnessed.
Later live work disproved the model. The fix is not more end-of-project manual
testing. It is a bounded discovery loop that starts watching before the action,
records a state transition automatically, and preserves rejected hypotheses in
the existing research record.

## Current state

- `docs/enhancement-development.md:78-91,207-221` places the real-client smoke
  test at the end of the proof ladder. That is correct for final acceptance but
  unsafe when the meaning of the proposed field/action is still unknown.
- `scripts/enhancements-live/scenario-checkpoint.ts:3-16` blocks on terminal
  input. A short state can appear and disappear before Return is pressed.
- `scripts/enhancements-live/character-switch-scenario.ts:62-119` already has a
  stronger partial pattern: establish setup, then sample automatically on a
  100 ms cadence.
- `scripts/enhancements-live/toolbox-scenarios.ts:145-177` already demonstrates
  the correct cursor shape: stable setup first, record `cursorBefore`, print an
  action request, then sample every 25 ms without waiting for a reply. Its
  mechanics are scenario-local. Other `operatorCheckpoint` calls mix stable
  setup with actions such as `/age` and hero-panel changes, so the contract does
  not tell a future scenario when a terminal reply is unsafe.
- The supplied feature histories showed:
  - Cartography: Mission Map reuse was not World Map context.
  - Dictation: the hidden input proxy was not the visible Guild Wars editor;
    clipboard timing was unsafe.
  - Character Switch: `GW::Array` capacity/size, account-list order, carousel
    selection, and null slots needed stage-specific evidence.
  - Combat Clarity: duplicate effect records did not prove gameplay stacking,
    and short effects defeated reply-timed capture.
- `internal/upstream/investigation-template.md:13-40` preserves rounds and
  measurements but does not label the knowledge kind, applicability, confidence,
  or local witness.
- `internal/research/quick-character-switch.md:1-10` says native switch is
  proved while the same opening says successful action remains a hypothesis;
  later implemented/live sections supersede both. `docs/README.md` has no
  concise current Character Switch owner.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Capture tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-transition-capture.test.ts` | exit 0; pre/event/post are bounded and deterministic |
| Scenario policy tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-scenario-catalogue.test.ts tests/unit/live-scenario-checkpoint.test.ts` | exit 0; timing-sensitive actions never await terminal reply |
| Record policy test | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/investigation-record-template.test.ts` | exit 0; evidence metadata and promotion rule remain present |
| Docs links | `pnpm check:links` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Repository gate | `pnpm run check` | exit 0 |

## Scope

**In scope**:

- `docs/enhancement-development.md`
- `docs/README.md`
- `docs/character-switch.md` (create as the concise current behavior owner)
- `internal/upstream/investigation-template.md`
- `internal/research/quick-character-switch.md`
- `scripts/enhancements-live/scenario-checkpoint.ts`
- `scripts/enhancements-live/transition-capture.ts` (create)
- `scripts/enhancements-live/character-switch-scenario.ts`
- `scripts/enhancements-live/toolbox-scenarios.ts`
- `scripts/enhancements-live/scenarios.ts`
- `tests/unit/live-transition-capture.test.ts` (create)
- `tests/unit/live-scenario-checkpoint.test.ts` (create)
- `tests/unit/investigation-record-template.test.ts` (create)

**Out of scope**:

- A generic memory reader, expression evaluator, packet recorder, or arbitrary
  page-evaluation console.
- Shipping a developer panel in packaged builds.
- Treating external GWCA/Toolbox++ assertions as verified facts.
- Reopening historical feature branches or importing their code.
- Recording screenshots, player text, account names, character names, or raw
  memory in a reusable research record.
- Replacing final live acceptance with the early discovery probe.

## Git workflow

- Branch: `refactor/semantic-discovery-loop`
- Suggested commits:
  1. `feat(tooling): capture live semantic transitions`
  2. `docs(architecture): separate discovery from acceptance`
- Do not push or open a pull request unless requested.

## Steps

### Step 1: Split semantic discovery from final acceptance

Update `docs/enhancement-development.md` to name two distinct real-client
activities:

1. **Semantic discovery** occurs immediately after an external lead or static
   candidate exists and before a durable ABI, settings contract, or UI is built.
   It asks one narrow question about player-visible meaning.
2. **Live acceptance** remains the last proof and verifies the complete shipped
   behavior under normal policy.

Add this required chain for unknown semantics:

```text
external lead -> local candidate -> armed state transition -> retained witness
-> structural certificate -> ABI/snapshot/command -> consumer -> final acceptance
```

State explicitly that a synthetic fixture may verify decoding but cannot prove
that the decoded field has the proposed gameplay meaning.

**Verify:**
`node -e "const fs=require('node:fs');const s=fs.readFileSync('docs/enhancement-development.md','utf8');for(const x of ['Semantic discovery','Live acceptance','armed state transition'])if(!s.includes(x))process.exit(1)"`
→ exits 0.

### Step 2: Add one bounded transition-capture primitive

Create `scripts/enhancements-live/transition-capture.ts`. It must accept only:

- a typed projection callback owned by the scenario;
- `isPrecondition`, `isTransition`, and `isPostcondition` predicates;
- a typed `sameProjection` equality callback, `preconditionStableSamples`, and
  `postconditionStableSamples` so stability and settling are explicit;
- `sampleIntervalMs`, `timeoutMs`, and a hard `maxSamples`;
- a synchronous `onArmed` callback that only emits the structured operator
  request;
- an optional redaction/projection callback before serialization.

Its ordering contract is exact:

1. sample until `preconditionStableSamples` consecutive projections satisfy
   `isPrecondition` and compare equal;
2. retain the last such projection as `precondition`;
3. invoke `onArmed` synchronously and reject a returned Promise;
4. continue sampling without another caller await and retain the first sample
   satisfying `isTransition(precondition, sample)`;
5. retain `postconditionStableSamples` consecutive equal samples satisfying
   `isPostcondition(transition, sample)`, using the last as `postcondition`.

Return this discriminated union; do not use optional projections:

```ts
type CaptureResult<T> =
  | { status: "captured"; precondition: T; transition: T; postcondition: T;
      samples: number; elapsedMs: number }
  | { status: "refused";
      code: "precondition-missing" | "precondition-unstable";
      precondition: null; transition: null; postcondition: null;
      samples: number; elapsedMs: number }
  | { status: "refused"; code: "transition-timeout";
      precondition: T; transition: null; postcondition: null;
      samples: number; elapsedMs: number }
  | { status: "refused"; code: "postcondition-timeout";
      precondition: T; transition: T; postcondition: null;
      samples: number; elapsedMs: number }
  | { status: "refused"; code: "sample-limit"; phase: "precondition";
      precondition: null; transition: null; postcondition: null;
      samples: number; elapsedMs: number }
  | { status: "refused"; code: "sample-limit"; phase: "transition";
      precondition: T; transition: null; postcondition: null;
      samples: number; elapsedMs: number }
  | { status: "refused"; code: "sample-limit"; phase: "postcondition";
      precondition: T; transition: T; postcondition: null;
      samples: number; elapsedMs: number };
```

At each sampling decision, check the wall-clock deadline before the sample
budget, so timeout wins when both expire together. At a precondition timeout,
return `precondition-missing` if no sample ever satisfied the predicate and
`precondition-unstable` if matching samples occurred but never met the stable
count. It keeps neither all samples nor raw page state. The watcher is armed
and the precondition is retained before the operator request is printed.

Do not add an expression language. A feature scenario supplies a normal typed
projection in code and exposes only its bounded result.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-transition-capture.test.ts`
→ exits 0 for a short transition, missing/unstable precondition, transition
timeout, postcondition timeout, sample cap, redaction, and the exact
precondition → `onArmed` → transition → settled-post ordering.

### Step 3: Separate setup checkpoints from timing-sensitive actions

Rename the current terminal helper to `setupCheckpoint`. It may remain for
opening an account, entering a required map, consenting to graphics capture, or
other conditions that stay true.

For a timing-sensitive action, the scenario must:

1. establish its stable setup with `setupCheckpoint`;
2. arm `captureTransition`;
3. print one structured action request to stdout;
4. observe automatically until success/refusal.

Extract the already-correct cursor sampler in
`toolbox-scenarios.ts:145-177` into the new primitive without changing its
action request, 25 ms cadence, 10-second bound, or terminal assertions. Review
every other `operatorCheckpoint` call and classify it as stable setup or a
timing-sensitive action. A persistent action such as `/age` need not be forced
through transition capture merely to increase reuse.

Make Character Switch the second real consumer by replacing only its existing
100 ms bounded before/action/after sampling mechanics with the primitive.
Preserve its preconditions, terminal result codes, privacy projection, and
acceptance behavior exactly. If those semantics cannot be preserved, STOP;
do not keep a generic helper with only the cursor as a consumer.

Do not add an in-game panel in this plan. The structured stdout action request
is sufficient to prove the loop; a developer-only panel can be proposed later
only if terminal focus itself remains an observed source of failure.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/live-scenario-catalogue.test.ts tests/unit/live-scenario-checkpoint.test.ts`
→ exits 0; timing-sensitive actions are arm-first and never await a terminal
acknowledgement after the action, and both cursor and Character Switch exercise
the shared primitive.

### Step 4: Make knowledge records accretive without a database

Extend `internal/upstream/investigation-template.md` with a compact header:

```yaml
status: hypothesis | rejected | verified | superseded
kind: guild-wars-fact | external-lead | external-design | gwonmac-inference | product-choice
applies-to: <client code-generation or repository contract>
confidence: low | medium | high
witness: <local test, live receipt, report, or none>
provenance: <external source or none>
supersedes: <record/round or none>
```

Define the promotion rule: only a locally reproduced witness can make a
Guild Wars operational fact `verified`; external source can establish
provenance, not authority. Every exact address/index/hash must name its client
generation. Every rejected model must record the decisive measurement.

Do not create a knowledge database or duplicate current behavior in
`internal/`. Current behavior still belongs in `docs/` and executable contracts.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/investigation-record-template.test.ts`
→ exits 0; every metadata key/closed value and the local-witness promotion rule
are enforced.

### Step 5: Repair Character Switch ownership

Create a short `docs/character-switch.md` that owns only shipped behavior,
feature boundaries, privacy, fail-closed states, and the strongest current live
witness. Link it from `docs/README.md`.

Change the opening status of `internal/research/quick-character-switch.md` to
one unambiguous historical statement. Mark it as research/provenance and point
to the current doc. Preserve its useful failed hypotheses and measurements;
do not rewrite the 1,000-line history as a second current specification.

**Verify:** `pnpm check:links` → exits 0, including the new current owner and
its link from `docs/README.md`.

### Step 6: Run all gates and perform a manual harness check

Run the commands above. Then run the migrated scenario on a suitable developer
profile. Confirm from its receipt that capture was armed before the action and
that no terminal Return was needed after the action. If a real client is not
available, record this acceptance item as blocked; do not mark the plan done.

**Verify:** `pnpm typecheck && pnpm run check && git diff --check` → every
command exits 0. The migrated live scenario then produces a passed Plan 002
receipt whose evidence records an armed precondition before the action.

## Test plan

- Transition occurs for less than one second and is still captured.
- Missing/unstable precondition refuses before asking for the action.
- Timeout and sample cap are distinct closed outcomes.
- Only pre/transition/post bounded projections survive; raw samples do not.
- Privacy-sensitive projections cannot serialize undeclared fields.
- Registry/checkpoint policy test rejects a timing-sensitive action that awaits
  `prompt.question` after arming.
- Character Switch current doc and historical record do not contradict each
  other; link check passes.

## Done criteria

- [ ] The runbook distinguishes early semantic discovery from final acceptance.
- [ ] One typed, bounded transition capture is used by both the cursor and
      Character Switch live probes without changing their acceptance behavior.
- [ ] No timing-sensitive action is observed only after terminal acknowledgement.
- [ ] The investigation template labels fact kind, applicability, confidence,
      witness, provenance, and supersession.
- [ ] External evidence cannot be labeled locally verified without a witness.
- [ ] Character Switch has one concise current documentation owner.
- [ ] Focused tests, docs links, typecheck, and repository gate pass.
- [ ] One appropriate live run confirms arm-before-action behavior.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- a useful projection requires raw pointers, arbitrary memory, player text, or
  account identifiers;
- the event cannot be observed with a bounded predicate and sample cap;
- a current feature doc contradicts the intended workflow and cannot be
  simplified to one owner;
- preserving a historical record would present an unverified external fact as
  current behavior;
- a scenario cannot distinguish stable setup from the action under study; or
- an in-scope contract drifted since `4dacdd3b`.

## Maintenance notes

- Add a generic harness primitive only after two scenarios need exactly the
  same mechanics. This plan starts with one bounded transition primitive because
  four independent investigations already demonstrated that need.
- A verified witness can become a source-code invariant only when its scope and
  stale condition are explicit.
