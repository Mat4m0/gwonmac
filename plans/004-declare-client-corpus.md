# Plan 004: Declare and qualify the private client artifact corpus

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the “STOP conditions” section occurs, stop and
> report—do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4dacdd3b..HEAD -- certificates/certified-client.json certificates/client-artifact-corpus.json certificates/README.md src/shared/evidence-reference.ts src/tools/certification.ts src/tools/client-corpus.ts src/tools/client-chain-qualification.ts tests/unit/client-corpus.test.ts tests/unit/client-chain-qualification.test.ts tests/client-artifact/client-chain-qualification.test.ts package.json docs/arenanet-compatibility.md docs/release-verification.md`
> If the artifact identity, qualification chain, or release policy changed,
> reconcile it before proceeding. A second checked-in generation authority is
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 001 and 002
- **Category**: build
- **Planned at**: commit `4dacdd3b`, 2026-08-31

## Why this matters

A clean checkout can build gwonmac-owned artifacts, but it cannot reproduce the
strongest real-client qualification without an undeclared matching ArenaNet JS
and WASM pair. Agents learn this only when a test requires two environment
variables. This plan makes the required private evidence explicit and
content-addressed, then gives the existing certification CLI one read-only
qualification command. It does not check in, download, or redistribute client
bytes.

## Current state

- `tests/client-artifact/client-chain-qualification.test.ts:39-44` requires
  `GW_CLIENT_WASM` and `GW_CLIENT_JS`; lines 59-128 replay each release profile,
  Cartography, native double-click, extended memory, and cache corruption.
- `package.json` leaves `test:client-artifact` separate from the ordinary source
  gate, which is correct for private inputs, but no cheap command says which
  artifact pair is missing.
- `src/main/certification/enhancement-builds.ts:31-36` notes that checked-in
  exact output hashes cannot be exercised without retained official bytes.
- `certificates/certified-client.json` records only the reviewed combined code
  generation. `certificates/README.md` correctly states that it is a detector
  record, not transform authority.
- `internal/upstream/client-generation-ledger.md` records investigation history
  and private bundle references. It is not a machine-readable corpus contract
  and must not be turned into runtime authority.
- The official client scripts acquire the current published generation. They do
  not reconstruct old retained generations, and this plan must not pretend that
  old bytes are publicly reproducible.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Corpus unit tests | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-corpus.test.ts` | exit 0; schema, provenance, and missing/pairing outcomes are precise |
| Fixture qualification | `node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-chain-qualification.test.ts` | exit 0; stage receipts are deterministic |
| Real corpus | `pnpm certification qualify --corpus "$GW_CLIENT_CORPUS"` | exit 0; every required pair/profile passes |
| Existing real-chain test | `GW_CLIENT_WASM=/absolute/path/Gw.jspi.wasm GW_CLIENT_JS=/absolute/path/Gw.jspi.js pnpm test:client-artifact` | exit 0 |
| Typecheck and source gate | `pnpm typecheck && pnpm run check` | exit 0 |

## Scope

**In scope**:

- `certificates/client-artifact-corpus.json` (create)
- `certificates/README.md`
- `src/shared/evidence-reference.ts` (create)
- `src/tools/certification.ts`
- `src/tools/client-corpus.ts` (create)
- `src/tools/client-chain-qualification.ts` (create)
- `tests/unit/client-corpus.test.ts` (create)
- `tests/unit/client-chain-qualification.test.ts` (create)
- `tests/client-artifact/client-chain-qualification.test.ts`
- `package.json`
- `docs/arenanet-compatibility.md`
- `docs/release-verification.md`

**Out of scope**:

- ArenaNet client bytes, authenticated URLs, account data, local absolute paths,
  or encryption material in Git.
- Automatic download, upload, remote cache, artifact registry service, or
  background synchronization.
- Making a corpus receipt transform authority.
- Guaranteeing bit-identical notarized application bundles. This plan qualifies
  repository-owned transforms against exact official inputs.
- Retaining a generation without a legal and operational owner.

## Git workflow

- Branch: `feat/client-artifact-corpus`
- Suggested commits:
  1. `feat(certification): declare required client artifact pairs`
  2. `test(certification): expose full-chain qualification receipts`
- Do not push or open a pull request unless requested.

## Steps

### Step 1: Decide the retained-artifact boundary before writing code

Confirm with the repository owner:

- where authorized private ArenaNet JS/WASM pairs may be retained;
- who can access them;
- how they are backed up and removed; and
- the exact existing generation issue, attestation, or repository investigation
  that proves where each retained pair came from.

Do not claim that whole-file hashes prove ArenaNet's manifest-level
`codeGeneration`: that identity also includes compression, chunk size, and
encoded chunk hashes, which cannot be reconstructed from assembled JS/WASM
bytes. `certificates/certified-client.json` remains the sole owner of the
reviewed current code generation. The corpus records only the exact assembled
pair required for qualification and a provenance reference.

The default local layout is a user-supplied `GW_CLIENT_CORPUS` directory. The
repository must never infer a home-directory location or persist it.

This is an explicit human decision. If the exact current pair or its evidence
reference is missing, implement only schema validation with synthetic fixtures
and leave real-corpus acceptance blocked. A generic section anchor is not
evidence for a particular pair.

**Verify:** after explicit operator approval,
`test -n "$GW_CLIENT_CORPUS" && test -d "$GW_CLIENT_CORPUS"` → exits 0. If the
approval or authorized directory is absent, stop before adding real identities;
do not infer a storage location.

### Step 2: Add one non-authoritative corpus requirement record

Create `certificates/client-artifact-corpus.json` with a closed versioned shape:

```json
{
  "formatVersion": 1,
  "pairs": [{
    "wasm": { "sha256": "<digest>", "bytes": 1 },
    "js": { "sha256": "<digest>", "bytes": 1 },
    "reason": "current-release-qualification",
    "evidence": { "kind": "github-generation-issue", "number": 123 }
  }]
}
```

The `1` values illustrate the positive-integer type only. Replace them with the
measured positive byte lengths of the authorized artifacts; a placeholder must
never pass review as a real corpus identity.

Use exactly `current-release-qualification` and `retained-regression` as the
initial closed `reason` values. Each pair is immutable and uniquely keyed by
the composite of its exact JS and WASM SHA/byte-length identities; do not store
another pair ID or generation digest. Exactly one pair is
`current-release-qualification`; historical retained pairs use
`retained-regression`.

Create the small, dependency-free `src/shared/evidence-reference.ts` contract
for the closed evidence shapes below. Plan 004's corpus parser is its first
consumer; Plan 005's fact evidence is the second. It validates references only
and owns no runtime/corpus/fact policy.

Allow only closed evidence shapes:

- `{ kind: "github-generation-issue", number: <positive integer> }`;
- `{ kind: "github-attestation", sha256: <digest> }`; or
- `{ kind: "repository-investigation", path: <allowlisted internal/upstream or
  internal/research path>, anchor: <nonempty slug> }`.

The validator checks syntax, uniqueness, and that a repository reference exists
with the named anchor. It does not perform network lookup. Step 1 must identify
the exact current external record when the evidence is a GitHub issue or
attestation. Do not copy feature facts, transform outputs, or runtime verdicts
into this record.

Clarify ownership in `certificates/README.md`:

- `certified-client.json` answers “has ArenaNet published a different reviewed
  code generation?”
- `client-artifact-corpus.json` answers “which exact private input pair is
  required to reproduce our strongest qualification?”
- the corpus does not claim that assembled bytes reconstruct manifest chunk
  topology; provenance binds the pair to the separately owned generation
  review;
- neither authorizes a transform; the verifier plus repeated transform does.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-corpus.test.ts`
→ exits 0 for valid schema, unknown fields/values,
malformed digests, invalid byte lengths, duplicate artifact pairs, zero/multiple
current-release pairs, missing repository anchors, and malformed closed
external evidence references. It must not compare or duplicate the detector's
manifest-level generation.

### Step 3: Resolve content, never filenames

Implement a pure `client-corpus.ts` resolver. It scans only the supplied corpus
root, hashes regular files within a documented size bound, and matches by SHA
and byte length. It returns a closed outcome:

```ts
type CorpusResolution =
  | {
      status: "ready";
      artifact: { wasmSha256: string; jsSha256: string };
      wasmPath: string;
      jsPath: string;
    }
  | {
      status: "missing";
      artifact: { wasmSha256: string; jsSha256: string };
      artifacts: readonly ("wasm" | "js")[];
    };
```

Paths are process-local inputs and must not appear in persisted receipts,
diagnostics, or stdout. Symlinks that escape the supplied root are refused.
Do not accept “latest” or basename matching. Because discovery is
content-addressed, a wrong hash, size, or pair is simply not the required
artifact and returns `missing`; do not invent a mismatch state without an
authoritative filename-to-artifact index.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-corpus.test.ts`
→ exits 0 for missing files, arbitrary valid filenames, wrong hash/size/pair,
and symlink escape. Only the exact content pair returns `ready`; all nonmatching
content returns `missing`.

### Step 4: Extract the existing qualification chain into one callable owner

Move the behavior currently embedded in
`tests/client-artifact/client-chain-qualification.test.ts` into
`src/tools/client-chain-qualification.ts` as a pure orchestration function. It
must call existing production verifier/transform functions; do not copy them.

Return a versioned receipt with:

- exact official JS/WASM hashes and byte lengths;
- requested release profile;
- ordered stages and each stage's input/output SHA;
- `proved`, `changed`, `ambiguous`, `refused`, or `not-run` status;
- closed refusal reason and the first failed stage;
- verifier ABI and transform ABI values already owned by executable contracts.

Do not include candidate offsets, raw errors, local paths, or client bytes. A
later stage must be `not-run` after the first failed stage.

Change the real-chain test to call this function and assert the receipt plus
the existing corruption-rebuild behavior. The test remains the acceptance
gate; the CLI becomes the ergonomic interface to the same code.

**Verify:**
`node --import ./scripts/ts-hook.mjs --test --test-timeout=60000 tests/unit/client-chain-qualification.test.ts`
→ exits 0 for ordered success, first-stage failure, later `not-run` stages, and
path-free receipts. The real artifact test remains the Step 6 gate.

### Step 5: Add `certification qualify --corpus`

Use Plan 001's source-run certification CLI. The command:

1. validates the checked-in corpus requirement;
2. resolves each required pair under the explicit corpus root;
3. runs every shipped release profile through the full chain;
4. prints one JSON document containing all qualification receipts;
5. exits 0 only when every required pair/profile passes, 1 for a qualification
   refusal, and 2 for CLI/configuration misuse.

Do not silently skip a missing corpus. “Missing exact ArenaNet pair” is a useful
machine-readable blocked result.

**Verify:** `pnpm certification qualify --corpus "$GW_CLIENT_CORPUS"` → emits
one JSON document, exits 0 only when every required pair/profile passes, and
contains no absolute path.

### Step 6: Document local and CI use, then verify

Update the compatibility and release owners with:

- source-only gates require no private corpus;
- full release/recertification gates require the declared corpus;
- how to point at it without persisting a path;
- how the JSON receipt identifies the exact failed layer;
- how to add/remove a retained pair after the human retention decision.

CI may mount a protected corpus and run the same command. Do not add a network
fetch or a green “skipped” result when the corpus is absent.

Run every command above plus `git diff --check` and `pnpm check:links`.

**Verify:** `pnpm typecheck && pnpm run check && pnpm check:links && git diff --check`
→ every command exits 0; then the real-corpus command and
`pnpm test:client-artifact` both exit 0.

## Test plan

- Valid schema, duplicate pair, zero/multiple current pairs, unknown field/value,
  malformed digest, non-positive size, and unowned/malformed evidence link.
- Missing WASM, missing JS, wrong size, wrong hash, wrong pair, symlink escape,
  and valid content under arbitrary filenames; nonmatching content has the one
  `missing` outcome rather than a guessed mismatch cause.
- Qualification receipt has ordered stages, exact ancestry, first failure, and
  later `not-run` states.
- Each shipped release profile runs.
- Corrupted derived cache is rejected and rebuilt as in the current test.
- Persisted/stdout receipts contain no absolute path.
- Real corpus gate passes for every declared required pair.

## Done criteria

- [ ] A clean checkout can state exactly which private inputs are required.
- [ ] The repository records only identities and evidence links, never client bytes.
- [ ] Corpus resolution is content-addressed and path-private.
- [ ] One callable implementation owns the full-chain qualification behavior.
- [ ] CLI and test use that same implementation.
- [ ] Missing artifacts and failed stages produce closed machine-readable results.
- [ ] The owner approved the retention boundary and exact evidence references,
      and real-corpus acceptance passed. If not, mark the plan `BLOCKED` rather
      than complete.
- [ ] Focused tests, real-chain gate, typecheck, source gate, and links pass.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- legal/operational ownership of retained official client artifacts is unclear;
- a required pair cannot be obtained from an authorized source;
- implementation would commit bytes, authenticated URLs, local paths, or secrets;
- a second transform/certification verdict would be stored in the corpus record;
- the existing qualification path has changed since `4dacdd3b`; or
- an exact JS and WASM pair cannot be tied to a specific authorized evidence
  reference.

## Maintenance notes

- Add a pair only when a release or retained compatibility promise requires it.
  Delete obsolete requirements instead of accumulating every observed client.
- The corpus is evidence availability. It is not a registry of Guild Wars facts
  and it cannot override the isolated verifier.
