# Plan 000: Prove agent autonomy before approving the architecture program

> **Frozen evaluation contract:** The implementation agent may read this file
> but must not modify it. The evaluator must compare it byte-for-byte with the
> copy present when implementation started. A changed proof contract is an
> automatic FAIL, even if all implementation tests pass.
>
> **Planned at:** clean `main` commit `4dacdd3b`, 2026-08-31.
>
> **Iteration-two amendment:** The first run stopped in Case 1 because bare
> trial checkouts had no dependencies, causing `pnpm` to attempt registry
> access before the repository commands could start. For the next run, the
> evaluator provisions lockfile-pinned dependencies offline before dispatch,
> verifies zero downloads, disables trial network access, and records the
> dependency-tree identity. This amendment is frozen before implementation;
> the next run requires a new implementation commit, seed, manifest, and trial
> IDs. The first run and its `FAIL` report remain unchanged.
>
> Pre-trial validation also established that pnpm 11 writes its script banner
> to stdout. JSON-only public commands therefore use pnpm's explicit
> `--silent` flag. This is part of the frozen command contract; the repository
> must not globally silence unrelated pnpm operations merely to hide the
> banner.
>
> **Purpose:** Build the smallest reversible pilot that can prove or disprove
> the proposed agent-operability direction. This is not authorization for the
> full refactor in Plans 001-005 and is not a production Cartography cutover.

Before dispatch, the coordinator records the contract digest outside the
implementation branch. The later evaluator receives that value directly from
the coordinator and compares against it; it must not learn the expected value
from the implementation worktree.

## Decision this proof controls

The architecture program may proceed only if all five cases and every hard
gate below pass. A partial pass, an average score, a persuasive demo, or the
implementation agent's own report is not enough.

The claim under test is:

> A fresh agent can understand gwonmac, reproduce and inspect its artifacts,
> add one bounded capability from locally owned evidence, survive a harmless
> client rebuild, diagnose failures at the correct layer, and leave reusable
> evidence—without routinely reading GWCA or Toolbox++ source.

The pilot may add narrow tooling, tests, fixtures, and a developer-only feature.
It must not change production feature policy, replace an existing runtime
authority, or introduce a generic agent platform.

## Roles and separation

Three roles must remain separate:

1. **Implementation agent** — builds the pilot in an isolated worktree. It may
   run public tests and read this contract. It must not create, edit, or read
   evaluator-only tests or the held-out seed.
2. **Independent evaluator** — is created only after the implementation commit
   is frozen. It reviews the complete diff, creates held-out tests, runs the
   trials, and reports PASS or FAIL. It must not repair the implementation.
3. **Fresh trial agents** — start with only the repository, one fixed task
   prompt, evaluator-provisioned lockfile dependencies, and the commands
   documented by the implementation. They do not receive implementation-task
   history or evaluator reasoning. Provisioning finishes before the trial
   begins and is not performed by the trial agent.

The implementation agent must not grade itself. The evaluator must record its
own commit, the frozen implementation commit, the proof-contract SHA-256, and
the held-out random seed in the final report.

## Pilot boundaries

### Required pilot slices

The implementation must provide only the smallest slices needed for the proof:

- a cheap, source-run, JSON-only system/selected-WASM inspection path;
- a self-describing live-scenario catalogue;
- closed, machine-readable failure receipts for the boundaries exercised by
  the proof cases;
- one shadow-only semantic locator for the representative capability, with a
  proof result that distinguishes unique proof, no candidate, ambiguous
  candidates, and unsupported module shape;
- one developer-only, read-only **Character Selection State observer** that
  exposes bounded state needed to prove the selected character/menu lifecycle;
- arm-before-action live evidence for that observer;
- a versioned, content-addressed evidence record for the facts used by the
  observer, including provenance, validation level, and applicable client
  identity; and
- one command that emits the proof results as JSON.

The observer is deliberately chosen because it crosses the same layers as a
real feature—WASM semantics, shared memory, host installation, decoding, live
behavior, and retained knowledge—without adding a production action or
changing player state.

### Explicitly out of scope

- Production Cartography authority cutover or execution of Plan 005.
- Generic raw memory, arbitrary function-call, opcode, packet, or MCP APIs.
- A plugin system, daemon, background knowledge service, or second game model.
- Automatic acquisition or redistribution of ArenaNet client bytes.
- New production commands that mutate Guild Wars state.
- A compatibility fallback based only on a known whole-file hash, function
  index, table slot, absolute address, raw function-body digest, or a common
  relocation delta.
- Modifying this file, weakening an existing safety refusal, or changing a
  public test solely to make the pilot pass.

If the representative observer cannot be proved from repository-owned facts,
the implementation must stop and report the exact missing semantic fact and a
bounded acquisition experiment. It must not silently consult external source
or substitute a weaker feature.

## Public pilot deliverables

Names may follow repository conventions, but the following behaviors are
required and must be documented in the existing canonical docs rather than a
new overlapping runbook:

1. `pnpm --silent certification doctor` runs without a full product build and
   emits exactly one JSON document on stdout.
2. `pnpm --silent certification inspect [wasm]` emits a versioned,
   deterministic module inventory and a closed refusal when inspection cannot
   complete.
3. `pnpm --silent enhancements:live -- --list` and `--describe <scenario>`
   emit structured metadata without building or launching Electron.
4. The proof-readiness command emits one JSON document containing local
   subcheck receipts, artifact identities, receipt schema versions, and evidence
   IDs. The fields `case`, `hardGate`, and overall `PASS`/`FAIL` are reserved for
   the independent evaluator. The command must never emit
   account data, raw memory, private paths, stack traces, or client bytes.
5. The representative locator and observer have focused public tests with
   positive, negative, ambiguity, bounds, stale-state, and privacy cases.

The implementation may choose the exact proof-command name. It must be a direct
repository command, documented and discoverable from `package.json` and the
existing Tools documentation.

## Five proof cases

### Case 1: Cold-start system understanding

Give a fresh trial agent a clean detached checkout with dependencies already
installed offline from the frozen lockfile, an evaluator-provided authorized or
synthetic WASM path, and this fixed prompt:

> From a clean checkout, identify the canonical source of truth for the
> selected client WASM, its imports/exports and memory/table shape, the host
> that supplies its imports, the transform chain, the companion ABI, available
> live scenarios, and the command that verifies each boundary. Return JSON
> with file references and command evidence. Do not use the web, task history,
> GWCA, or Toolbox++.

PASS requires all of the following in every trial:

- correct ownership for all named boundaries;
- no invented or contradicted authority;
- `doctor`, `inspect`, `--list`, and `--describe` produce parseable JSON;
- no full application build occurs for catalogue or read-only inspection;
- no more than 10 agent tool calls after evaluator-controlled provisioning and
  before the final answer (each trial-agent tool invocation counts once,
  including a batched invocation; filesystem reads hidden inside a search
  command are not misrepresented as individually measured files); and
- no external lookup or human clarification.

The concrete module inventory comes from the provided WASM. Host ownership and
transform ancestry come from repository contracts. If no real selected client
is authorized for the trial, the report must label the inventory synthetic.
The evaluator must prove that provisioning used the frozen lockfile, made zero
downloads, left Git clean, and completed before the fresh agent started. A
trial-side package-manager network attempt remains an automatic FAIL.

### Case 2: Reproducible build and exact qualification

From a clean worktree with dependencies and an evaluator-provided synthetic
client corpus, a fresh agent must:

- build every repository-owned artifact through the documented command;
- identify the exact input and output SHA-256 values;
- reject malformed corpus schema and symlink escape with distinct closed
  reasons; resolve missing, corrupt, wrong-size, or mismatched content uniformly
  as `missing`, because content identity—not filenames—is authoritative; and
- produce a terminal receipt that identifies the failed build or qualification
  phase without exposing paths.

PASS requires byte-identical repository-owned freestanding kernels across two
clean builds on the same declared toolchain, exact content-addressed corpus
resolution, and no undeclared manual step. This case does not claim a
bit-identical signed application across machines.

### Case 3: Harmless ArenaNet rebuild survival

The evaluator generates held-out valid WASM modules after the implementation
commit is frozen. Starting from a positive fixture, it independently randomizes
irrelevant function indices, table slots, data/global positions, import/export
ordering, and unrelated function bodies while preserving the representative
feature's semantic structure. It also generates semantic-break and duplicate-
candidate fixtures.

PASS requires:

- every semantics-preserving relocation is proved and produces an equivalent
  derived behavior;
- every semantic break is refused;
- every duplicate candidate is refused as ambiguous;
- proof does not select by the known whole-file hash, historical index, table
  slot, absolute address, raw body digest, fixture filename, or shared
  relocation delta; and
- the shadow proof never changes production launch authority.

This is the direct proof of the update-survival promise: unchanged relevant
semantics survive; changed or ambiguous semantics fail closed.

### Case 4: Idea-to-live representative capability

The implementation pilot supplies the base Character Selection State observer.
After implementation freeze, the evaluator selects exactly one small extension
that the pilot does not already expose:

- `selection-ready` transition derived from locally witnessed states;
- bounded carousel occupancy summary; or
- selected-slot consistency assertion.

If the implementation already exposes a candidate, that candidate is
ineligible; the evaluator must select another. A fresh agent then receives only
this prompt with the selected extension substituted:

> Implement and verify the evaluator-selected developer-only, read-only
> Character Selection State extension using gwonmac's local evidence and
> harness. Do not read external
> GWCA or Toolbox++ source. Establish structural identity offline, arm the live
> observer before the operator action, prove the selected-character/menu-state
> transition, and retain the verified facts for the next agent.

The trial agent must extend the reusable pilot path without receiving
implementation history. The evaluator may use a
synthetic/live adapter when Guild Wars cannot be launched automatically, but a
final production-readiness claim requires the real game and an operator action.

PASS requires:

- no external-source lookup;
- one bounded semantic contract from structural proof through decoder and live
  assertion;
- arm-before-action capture with run identity and artifact identity;
- stale, wrong-run, missing-transition, and privacy cases are refused;
- the evidence record names fact IDs, provenance, validation level, applicable
  client identity, and the validating command; and
- a second fresh agent can find and reuse that evidence without task history.

An offline/synthetic pass proves harness ergonomics. It must be reported as
`pilot-passed`, not `production-verified`, until Matthias performs the bounded
live action in Guild Wars and the bound receipt passes. `pilot-passed` may
approve only the inspection, receipt, corpus, and offline harness foundations;
the semantic/runtime work in Plans 003 and 005 remains unapproved until
`production-verified`.

### Case 5: Failure diagnosis and knowledge handoff

The evaluator randomly injects one failure at a time through evaluator-owned
dependency doubles at existing pure or process boundaries. The pilot must not
add production environment switches, hidden test modes, or fault branches to
make injection possible. Boundaries:

- source/toolchain build;
- corpus qualification;
- WASM validation/shape;
- semantic proof (none or ambiguous);
- host fetch/compile/instantiate;
- companion ABI/install;
- live readiness;
- live transition/behavior; and
- evidence identity or staleness.

A fresh agent receives the receipts and repository only. It must name the
correct failed boundary and the next bounded diagnostic command.

PASS requires exact layer classification for every injected fault, no raw error
text parsing in production logic, no secret/path/account leakage, and no false
claim that a lower-layer success proves player-visible behavior. A second fresh
agent must also recover the representative fact, its confidence/validation
level, and its staleness rule using only documented repository commands.

## Trial count and hard gates

- Run each case with at least **three fresh-agent trials**.
- Before trials, the evaluator registers exact model IDs and reasoning settings.
  For this host, each case uses two `gpt-5.6-luna` trials at `medium` and one
  `gpt-5.6-terra` trial at `medium`. If either model becomes unavailable, the
  evaluator must amend the contract before implementation restarts; it may not
  substitute a model after seeing results.
- Correctness, privacy, fail-closed behavior, proof-contract integrity, and
  external-lookup isolation must pass **every run**. These gates cannot be
  averaged.
- Resource metrics are descriptive except for Case 1's explicit tool-call gate.
  Record elapsed time, tool calls, paths returned in tool output,
  bytes/artifacts inspected, human actions, and model settings. Do not claim
  that transcript-visible paths equal all filesystem reads.
- A flaky result is a failure. Re-running until green is not permitted unless
  the report includes the first failure and classifies the flake.

## Anti-cheat controls

### Freeze before evaluation

The evaluator records:

- implementation commit and clean/dirty state;
- SHA-256 of this proof contract;
- SHA-256 of public tests and fixtures;
- evaluator commit;
- held-out seed generated after implementation freeze; and
- exact model/reasoning settings for every trial.

It also creates an immutable trial manifest before the first trial. The manifest
contains exactly 15 trial IDs, the five frozen prompts, selected Case 4
extension, model/reasoning settings, and expected evidence classes. The final
report must contain each registered ID exactly once, including failed or flaky
runs.

Any implementation change after the seed is generated invalidates the run and
requires a new freeze and new seed.

### Held-out generation

The evaluator owns tests and fixtures outside the implementation agent's scope.
Names, ordering, relocation values, corruptions, and fault choices are derived
from the recorded seed only after freeze. The evaluator keeps the seed private
until the implementation is immutable, then includes it in the final report so
the result is reproducible.

### Static shortcut audit

The evaluator searches the implementation diff and candidate-selection path for:

- current or historical client SHA-256 literals;
- known function indices, table slots, absolute addresses, or body digests;
- fixture filenames or evaluator test names;
- special branches for `test`, `fixture`, or a held-out seed;
- production environment switches, hidden fault modes, or production-bundle
  branches used only by the evaluator;
- unconditional success/proved results;
- production parsing of raw error-message strings; and
- a second source of capability truth.

A literal may appear in a test-only regression fixture or artifact identity
record, but it must not participate in semantic candidate selection. Any
exception needs a direct data-flow explanation in the evaluator report.

### Capability isolation

- The implementation and fresh-trial prompts forbid network and web use. Where
  the host supports enforcement, network access is disabled as well. The
  evaluator must disable network access for iteration-two trials rather than
  relying only on the prompt.
- External GWCA/Toolbox++ checkouts are not intentionally provided or referenced
  in their worktrees. On this same host, that is an audited rule rather than a
  filesystem security boundary.
- Web calls, task-history lookup, or reading another task's transcript are an
  automatic FAIL for the affected trial.
- The evaluator audits task transcripts and filesystem diffs for these actions.
- Same-host task separation is process isolation, not a security boundary. If a
  high-stakes result is needed, repeat the final trials on a clean host or
  account that cannot access implementation/evaluator task history.

Fresh agents run from clean worktrees at the frozen implementation commit; the
evaluator branch and held-out files are not copied into those worktrees. The
evaluator process runs held-out tests separately against the implementation
commit. The report must label assurance as `same-host-audited` or
`clean-host-isolated`; it must never describe the former as tamper-proof.
Ignored `node_modules/` content may be present only when its dependency-tree
identity is derived from the frozen lockfile and recorded by the evaluator.
The evaluator must ensure the assigned trial directory does not expose sibling
task or evaluator directories through its provided workspace surface. Any
trial attempt to enumerate or read such directories is still an automatic
FAIL under `same-host-audited` assurance.

### No self-authored ground truth

The implementation's public fixtures prove regression behavior only. The
evaluator must independently construct held-out relocation, semantic-break,
ambiguity, corruption, wrong-run, stale-evidence, and failure-injection cases.
It must read the asserted semantics, not merely count passing tests.

## Machine-readable evaluator report

The evaluator must create `proof-report.json` and a short `proof-report.md` in
its isolated evaluation branch. The JSON has this minimum shape:

```json
{
  "formatVersion": 1,
  "verdict": "PASS",
  "implementationCommit": "<sha>",
  "evaluatorCommit": "<sha>",
  "proofContractSha256": "<sha256>",
  "heldOutSeed": "<seed>",
  "assuranceLevel": "same-host-audited",
  "trialManifestSha256": "<sha256>",
  "hardGates": {
    "contractUnchanged": { "passed": true, "evidence": ["<id>"] },
    "noExternalLookup": { "passed": true, "evidence": ["<id>"] },
    "noSemanticShortcuts": { "passed": true, "evidence": ["<id>"] },
    "privacy": { "passed": true, "evidence": ["<id>"] },
    "failClosed": { "passed": true, "evidence": ["<id>"] }
  },
  "cases": [
    {
      "case": 1,
      "verdict": "PASS",
      "trials": [{
        "id": "case-1-luna-a",
        "model": "gpt-5.6-luna",
        "reasoning": "medium",
        "promptSha256": "<sha256>",
        "transcriptSha256": "<sha256>",
        "outputSha256": "<sha256>",
        "startedAt": "<ISO-8601>",
        "endedAt": "<ISO-8601>",
        "toolCalls": 1,
        "verdict": "PASS"
      }],
      "evidence": ["<id>"]
    }
  ],
  "productionReadiness": "pilot-passed",
  "failures": []
}
```

The report validator rejects missing or duplicate registered trial IDs, empty
hard-gate evidence, a model/prompt mismatch with the manifest, or fewer than
three trials per case. Hard-gate results are derived from referenced evidence,
not accepted as hand-set booleans.

`verdict` is PASS only when every hard gate and every case passes. Until the
real-game action in Case 4 succeeds, `productionReadiness` must remain
`pilot-passed`; it may become `production-verified` only from a receipt bound to
the frozen implementation, exact client identity, scenario, and run ID.

## Go/no-go rule

Approve the complete Plans 001-005 direction only when:

- the evaluator verdict is PASS;
- the full diff contains no generic agent platform or second source of truth;
- Case 3 demonstrates relocation survival and semantic-change refusal;
- Case 4 is `production-verified` by the real-game action; and
- Case 5 proves that a fresh agent can diagnose the correct layer and recover
  retained knowledge without task history.

If all cases pass offline but Case 4 remains `pilot-passed`, only the inspection,
receipt, corpus, and offline harness foundations of Plans 001, 002, and 004 may
proceed. Plans 003 and 005 remain blocked.

If the proof fails, do not expand the pilot until it passes. Use the first
failing case to revise or reject the underlying architecture proposal. The
right result may be that only Plans 001-003 are worth doing, or that the current
architecture should remain mostly unchanged.

## STOP conditions

Stop and report rather than improvising if:

- implementation requires a production authority cutover;
- the observer requires a write/action capability rather than read-only state;
- the necessary client bytes or semantic fact are unavailable;
- external source lookup appears necessary;
- a held-out test must be disclosed before implementation freeze;
- the implementation cannot keep proof/evidence output privacy-safe; or
- a task environment cannot prevent access to evaluator artifacts or task
  history strongly enough for the claimed assurance level.
