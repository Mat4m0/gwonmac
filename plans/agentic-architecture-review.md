# Agent-intuitive architecture review

> **Review scope:** repository-wide, read-only architecture review planned at
> commit `4dacdd3b` on 2026-08-31. The review inspected source, tests, scripts,
> current and historical documentation, and the supplied Cartography, Dictation,
> Character Switch, and Combat Clarity Codex tasks. No claim below treats a
> third-party implementation or a generated report as runtime authority.

## Outcome

gwonmac is much closer to an agent-operable system than its size suggests. It
already has the right safety foundation: immutable client generations, an
isolated verifier, deterministic transforms, typed capability manifests,
bounded pointer-free snapshots, named commands, fail-closed feature withdrawal,
and reproducible companion-kernel bytes.

The central problem is not that an agent cannot rewrite WebAssembly. The problem
is that it cannot cheaply answer four prior questions:

1. What exact module and contract am I looking at?
2. Which locally witnessed fact authorizes each field or transform?
3. Which lifecycle phase failed?
4. Which prior semantic assumptions were disproved?

Those answers are split among executable contracts, long research notes,
partial analysis scripts, private client artifacts, external GWCA/Toolbox++
source, and Codex task history. The result is safe but expensive: agents fail
closed correctly, then spend time reconstructing why.

The recommended target is deliberately small:

- extend the existing certification CLI into the read-only inspection surface;
- make the existing live-scenario registry self-describing and state-driven;
- preserve closed phase/reason receipts from proof through behavior;
- make the required private client corpus explicit by content identity;
- record operational Guild Wars facts as local semantic witnesses, with external
  sources retained only as provenance or research leads; and
- remove Cartography's parallel exact-hash authority.

Do **not** add a plugin system, generic memory API, generic call bridge, arbitrary
packet surface, agent daemon, second game model, or separate knowledge service.
The existing architecture already rejects those abstractions for good reasons
(`docs/wasm-host.md:243-284`).

## Evidence labels used in this review

- **Fact** — directly supported by current repository code or a bounded recorded
  observation.
- **Inference** — the simplest explanation that joins multiple facts; it still
  needs confirmation before it becomes an invariant.
- **Proposal** — a recommended change, not current behavior.
- **Unknown** — information the repository cannot currently establish.

## Current-system map

### Build flow

```text
package.json requirements + pnpm lockfile + pinned Rust toolchain
  -> scripts/build.mjs deletes and produces the complete product build/
  -> static renderer assets
  -> bundled game renderer
  -> TypeScript main/shared output
  -> Vue launcher and embedded Tools bundles
  -> Node-API macOS host addon
  -> isolated Gw.dat decoder executable
  -> generated Core/Tools preloads
  -> dependency-free Rust companion kernel
       -> ABI/import/export/dylink/start checks
       -> hash sealed into generated loader
  -> dependency-free Cartography reachability kernel
       -> equivalent sealing
```

**Fact:** `scripts/build.mjs:1-2,102-220` is the sole complete product producer
of `build/` and spells the ordered build steps explicitly. Some focused package
scripts also invoke `tsc` and can create partial output under the same directory;
they are not complete product builds. `rust-toolchain.toml:1-9` pins Rust
1.88.0 and the `wasm32-unknown-unknown` target. The companion verification
recompiles and byte-compares the output (`scripts/verify-companion-kernel.mjs:108-117`).

**Fact:** a clean checkout can build repository-owned artifacts after installing
the documented macOS, Xcode, Node, pnpm, Rust, and Playwright requirements
(`README.md:95-109`).

**Unknown:** a clean checkout cannot reproduce and qualify every retained client
transform without the matching ArenaNet JS/WASM pairs. The strongest chain test
requires `GW_CLIENT_WASM` and `GW_CLIENT_JS`
(`tests/client-artifact/client-chain-qualification.test.ts:39-44`), and checked-in
output hashes cannot be exercised by the ordinary source gate without those
bytes (`src/main/certification/enhancement-builds.ts:31-36`).

The word “reproducible” needs four explicit levels:

| Level | Current claim | Missing guarantee |
| --- | --- | --- |
| Repository build | A clean supported macOS checkout can produce all repository-owned build inputs from the lockfile and documented tools | Node has a version floor and Xcode is system-provided, so the complete app build is not claimed byte-identical across machines |
| Freestanding kernels | Companion and Cartography kernels are recompiled and byte-compared | None within the pinned Rust recipe; signing/packaging is outside this claim |
| Derived client chain | Every rewrite is deterministic for one exact predecessor and certificate | The matching private ArenaNet JS/WASM corpus is not declared or available from a clean checkout |
| Signed release | CI records and verifies the packaged release | Signing, notarization, timestamps, and platform tooling make this a provenance claim, not bit-identical local reproduction |

**Fact:** `package.json:7,16-18` pins pnpm, locks dependencies through the
lockfile, and declares a Node floor rather than one exact Node binary.
`scripts/build.mjs:1,99-220` owns an explicit ordered build but reports a failed
child primarily through its command output and exit status, not a structured
phase receipt.

### Content, proof, and selected-module flow

```text
ArenaNet manifest and artifacts
  -> PatchClient verifies and stages one generation
  -> ClientRuntime serializes preparation/activation/rollback
  -> isolated utility-process verifier reads exact official bytes
  -> typed template and per-capability verdicts
  -> Main repeats every accepted deterministic transform
  -> selected chain:
       official JSPI WASM
       -> template/file-compatibility transform
       -> Core/Tools Enhancement transform
       -> Cartography transform (currently separate authority)
       -> native-double-click transform
       -> optional JS/WASM extended-memory pair
  -> ActiveClientSlot publishes one immutable generation
  -> gw://app streams its exact JS/WASM/chunks to one renderer
```

**Fact:** `PatchClient`, `ClientRuntime`, and `ActiveClient` have separate
generation responsibilities (`docs/process-model.md:87-116`), and the published
slot is immutable (`src/main/active-client.ts:18-46`).

**Fact:** the official artifact remains canonical. Derived modules are rebuildable
caches (`docs/wasm-host.md:109-126`). `src/main/certification/client-module.ts:294-379`
shows the actual complete chain, including Cartography, native double-click, and
extended memory.

**Fact:** the isolated verifier is declared the sole capability authority, and
Main repeats transforms and hashes (`docs/arenanet-compatibility.md:33-61`).

**Contradiction:** Cartography still grants runtime support from
`CERTIFIED_CARTOGRAPHY_BUILDS`, a separate exact input/output hash map
(`src/main/certification/cartography-spike-client.ts:17-132`). The selected row
chooses one of two hard-coded memory-root layouts, while
`cartography-transform-internals.ts:27-127` owns exact function indices, body
hashes, table slots, frame fields, context offsets, and area-info facts that the
transform consumes directly. This exact-build certificate set is a second
authority even though it fails closed.

**Fact:** the existing Cartography research proofs do not yet close that gap.
`compass-frame-spike-proof.ts` and `mission-map-frame-spike-proof.ts` derive part
of the frame layout, but retain body-hash dependencies. `pathing-spike-proof.ts`
accepts only one official SHA and exact function/body identities and explicitly
refuses the owner chain from game context to pathing data
(`src/main/certification/pathing-spike-proof.ts:1-5,18-35,56-79,164-224`). It is
useful evidence, not a generic Cartography runtime certificate.

### Host, instantiation, and runtime lifecycle

```text
classic renderer script declares global var Module
  -> generated ArenaNet glue reuses Module
  -> Module.instantiateWasm receives the import object
  -> host installs narrow Emscripten import wrappers
  -> selected Gw.jspi.wasm is fetched through gw://app
  -> streaming instantiate, bounded buffered fallback
  -> selected capability manifest is checked
  -> official malloc reserves private companion regions
  -> sealed Rust side module is compiled and linked to the same memory
  -> exact side-module import/export/signature/ABI checks
  -> one certified dispatcher occupies one terminal game table slot
  -> observers and presentation install
  -> hook becomes active last
  -> on teardown: disable hook, withdraw policy/surfaces, stop observers,
     remove callback, then release memory
```

**Fact:** gwonmac does not attach to or inject into an unrelated operating-system
process. It hosts ArenaNet's official WebAssembly client and adds behavior through
certified in-process transforms plus a read-only side module. Use “transform and
install” for this lifecycle; reserve “injection” for the user's conceptual goal.

**Fact:** the official module is instantiated at
`src/renderer/harness.ts:667-805`. The companion validates its complete surface
and shares the official memory at `src/renderer/companion-kernel-loader.ts:198-257`.
The cleanup ordering is explicit at
`src/renderer/certified-companion-core-installation.ts:159-239`.

### WASM and ABI ownership

| Boundary | Canonical owner | Runtime guarantee | Current agent cost |
| --- | --- | --- | --- |
| Official client module | Exact selected ArenaNet bytes plus generated Emscripten glue | The glue supplies the host import object; the selected transformed module still exposes the official memory/table/allocation surface | Import/export/type inventory is discoverable only by running parsers or reading glue/host code |
| Enhancement manifest | `enhancement-transform.ts` writes one custom section; `enhancement-manifest.ts` validates it | Transform ABI, build/program IDs, exact capabilities, hooks, table slot, and config words must agree before install | Strong contract, but no cheap standalone inspection projection |
| Companion executable surface | `src/shared/companion-kernel-contract.ts` and the sealed Rust module | Exact import/export names and exact function signatures are checked before any pointer is passed (`companion-kernel-loader.ts:71-106,198-257`) | Good fail-closed behavior; failure currently collapses into a later install label |
| Shared memory regions | Main certificate/config plus `companion-owned-regions.ts` | Official `malloc` reserves aligned, non-overlapping private regions; the kernel imports the same official memory | Region purpose is spread across installer, TypeScript ABI descriptor, Rust ABI structs, and decoders |
| Snapshot wire formats | Host expectations in `src/shared/companion-abi.ts`; actual `repr(C)` Rust layouts in `src/companion-kernel/abi.rs`; feature decoders in `src/renderer/companion-*-snapshot.ts` | Size/ABI/magic checks, Rust size assertions, fixed bounds, and sequence publication fail closed | Several same-format constants and offsets are synchronized by tests rather than generated from one schema |
| Transport bindings | `src/shared/contracts.ts` plus `scripts/generate-preload.ts` | Core/Tools preloads are generated from the shared transport contract | These are generated host bindings, not a WASM IDL; they do not describe module imports/exports or memory layouts |

**Fact:** the side module imports only the official memory, an empty table, and
the standard PIC relocation globals, then exposes a fixed sealed function
surface. It does not import a generic host-call interface
(`src/renderer/companion-kernel-loader.ts:198-257`).

**Inference:** generating the entire ABI now would be a high-risk cleanup, not
the primary autonomy unlock. Plan 001 makes the live contract inspectable first;
only a later measured drift incident should justify a small schema that deletes
manual duplication across TypeScript and Rust.

### Runtime data and command flow

```text
semantic certificate
  -> fixed transform configuration
  -> read-only Rust memory access
  -> fixed-size sequence-protected snapshot
  -> strict TypeScript decoder
  -> freshness/policy feed
  -> domain state
  -> presentation

named UI action
  -> typed bounded arguments
  -> live policy and state preconditions
  -> bounded mailbox
  -> certified game-thread drain
  -> one named client action
  -> observed confirmation or closed refusal
```

**Fact:** the shared capability vocabulary and dependency graph are owned by
`src/shared/enhancement-contracts.ts:31-150`. Feature extension ownership is
documented at `docs/enhancement-development.md:227-305`.

**Fact:** companion publications are fixed-size, pointer-free, and sequence
protected (`docs/wasm-host.md:243-274`). Commands may not expose memory writes,
generic function calls, or generic opcodes
(`docs/enhancement-development.md:421-439`).

### Evidence and current knowledge flow

```text
current behavior          -> docs/ (one owner per subject)
runtime authority         -> exact bytes + isolated semantic verifier
exact regression facts    -> src/main/certification/ + mutation tests
derived evidence          -> reports, caches, generation attestations
costly wrong turns        -> internal/ investigation records
external source           -> lead/provenance only, never launch authority
```

**Fact:** the intended ownership is already written down
(`docs/README.md:1-38`, `internal/upstream/README.md:1-18`).

**Gap:** operational facts do not consistently link to the local witness and live
scope that established their meaning. External semantic leads often survive only
as inline comments or long prose, while resolved negative knowledge can remain
only in a Codex task.

### External knowledge and implementation inventory

| Dependency | What gwonmac currently takes from it | Classification | Independence status |
| --- | --- | --- | --- |
| GWCA / GWCAjs source | Names and semantics for frame lookup, game-thread enqueue, travel/native messages, skill/cooldown structures, arrays, heroes, and candidate manager relationships (`docs/skill-cooldowns.md:13-31`, `docs/enhancement-development.md:151-164`, `src/main/certification/enhancement-builds.ts:230-293`) | Mostly external research leads about Guild Wars; some external implementation choices | Many shipped values are now checked by local proof/live tests, but provenance and local witness are not joined consistently; new features still search external source as the semantic index |
| GWToolbox++ Cartography data | Pinned continent `standable` and `creditable` masks generated into the renderer (`scripts/import-toolbox-cartography-data.ts:86-125`) | Copied derived dataset plus upstream classification choice | Provenance and byte shape are local; semantic correctness remains an estimate in `docs/cartography.md:17-42` |
| GWToolbox++ pathing/reachability | Trapezoid triangulation, plane hints, and search behavior ported into the sealed Rust reachability kernel (`src/cartography-reachability-kernel/lib.rs:1-12,272,362`) | External algorithm choice implemented locally | No routine source lookup is required to build it, but the behavioral choice should be treated as a gwonmac decision and covered by local geometry/live witnesses |
| GWToolbox++ portal route | One fixed bidirectional route used by live acceptance (`scripts/enhancements-live/scenarios.ts:145-153`) | External lead retained as harness fixture | Narrow, visible, and non-authoritative; the live scenario verifies the actual route behavior |
| Toolbox/GWCA effect model | Effect collection, timestamp, skill-type, and source-agent leads (`docs/future-effect-durations.md:9-31`) | Explicit hypothesis/research lead | Not current authority. The Combat Clarity history showed why duplicate records cannot be promoted to gameplay stacking semantics without a local witness |
| Toolbox/GWCA build/team constants and sequencing | Hero IDs, template encoding clues, action order, and message meanings in `src/shared/builds/` | Mixture of Guild Wars facts, inferred values, and external product/implementation choices | Local validators and live observations cover parts; comments are not a uniform provenance/witness index |
| Vendored Gw.dat decoder | Third-party decoder source with retained licenses and an explicit “take upstream changes” policy (`src/native/gw-dat/vendor/README.md:1-23`) | Intentional source-code dependency, not merely knowledge | Rewriting it brings little agent autonomy. It is bounded in a separate process and should remain an explicit vendored exception |
| Public GWToolbox trade feeds | Remote trade messages consumed by the product (`docs/trade-discovery.md:62-85`) | Operational service/API dependency and selected product behavior | Outside WASM certification. Its current document already separates useful model choices from choices gwonmac rejects |

The target is therefore not “erase every upstream origin.” It is:

- runtime support derives from local bytes and local witnesses;
- copied code/data remains an explicit, pinned, licensed exception with local
  tests and a replacement/staleness story;
- an external implementation choice becomes a named gwonmac product/algorithm
  decision before shipping; and
- a future feature agent reads the local fact/witness first and consults
  upstream only when acquiring genuinely missing knowledge.

## Representative agent task journey today

This journey uses “add a bounded player-effect duration observation” because it
combines unknown Guild Wars semantics, a WASM proof, a snapshot, UI, and live
behavior. The same failure points appeared in the supplied feature tasks.

| Step | Current action | Guess, lookup, or weak feedback |
| --- | --- | --- |
| 1. Find ownership | Read `docs/README.md`, `docs/wasm-host.md`, and `docs/enhancement-development.md`. | Some shipped capabilities have no concise current owner; Character Switch requires a 1,070-line historical file with conflicting status. |
| 2. Establish the workspace | Run `pnpm certification doctor`. | The command first runs the complete application build, so unrelated UI/native/toolchain failures can block a read-only diagnosis. Cached snapshot readiness also proves expected filenames only unless the agent manually inspects content. |
| 3. Inspect WASM | Use `certification verify/compare`, bespoke TypeScript recon scripts, or Python tools. | No single JSON inventory names module identity, imports, exports, memory/table shapes, transform ancestry, and unresolved contracts. Python tools implement a narrower second parser. |
| 4. Learn likely semantics | Search GWCA/Toolbox++ and historical notes. | The external projects act as the searchable semantic index. The repository does not consistently distinguish Guild Wars fact, external design choice, local inference, and independent proof in a queryable form. |
| 5. Prove a candidate | Add feature-local locators and typed facts. | Some locators still select through fixed spans/body digests/common relocation. Exact rows remain operational scaffolding instead of purely derived regression views. |
| 6. Extend the ABI | Update TypeScript contract, Rust constants/layout, kernel export values, decoder offsets, and tests. | Several same-format representations are maintained manually. Tests catch much, but not every same-size field/magic/offset drift. |
| 7. Build offline confidence | Add mutation tests, synthetic memory, fixture UI, Electron tests. | A fixture can encode the same false assumption as production. Combat Clarity and Dictation both proved internal proxies before the player-visible behavior was known. |
| 8. Choose live proof | Read `scripts/enhancements-live/scenarios.ts` and run a scenario string. | Scenario names, permissions, prerequisites, privacy, and evidence are not queryable without reading the implementation. |
| 9. Perform an action | Follow a terminal prompt and press Return. | Short states can expire during the human/agent round trip. Combat Clarity needed an arm-first watcher after reply-timed capture failed. |
| 10. Diagnose refusal | Read logs, `failure.json`, feature diagnostics, and source. | Verifier timeout/crash/malformed reply collapse to `null`; fetch/compile/instantiate/install errors collapse into coarse later labels. The agent often cannot assign the failure to one layer. |
| 11. Retain the result | Update exact code/tests and optionally an `internal/` note. | There is no enforced handoff for a rejected semantic model. Dictation and Combat Clarity wrong turns are absent from current repository evidence. |

Historical evidence behind this journey:

- Cartography first modeled World Map as reused Mission Map state; later current
  client and Toolbox investigation established a separate context.
- Character Switch inverted `GW::Array` capacity/size, equated account-list and
  Selector indices, and rejected valid null carousel slots before stage-specific
  evidence corrected the model (`internal/research/quick-character-switch.md:856-892`).
- Combat Clarity built fixtures and presentation around an unverified effect
  model, then learned that duplicate records did not mean gameplay stacking.
- Dictation changed the hidden proxy while the visible Guild Wars editor stayed
  unchanged; a clipboard workaround also exposed unsafe timing.

The common lesson is not “do more live testing.” It is: identify the smallest
real semantic boundary early, arm the observer before the event, and make every
later layer prove that same player-visible invariant.

## Gap analysis

Scores are 1 (minor) to 5 (severe). “Leverage” favors changes that unblock later
work and have a precise verification story.

| Rank | Gap | Autonomy | Correctness | Observability | Efficiency | Classification |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Operational facts still depend on retained baselines and unlinked semantic knowledge | 5 | 5 | 3 | 5 | Foundational |
| 2 | Cartography eligibility and transform facts come from a second exact-build certificate set | 5 | 5 | 3 | 4 | Foundational contradiction |
| 3 | Failure causes collapse between verifier, transform, instantiate, install, and behavior | 4 | 4 | 5 | 5 | Foundational feedback gap |
| 4 | Required private client evidence is not declared as a resolvable corpus | 5 | 4 | 4 | 4 | Foundational reproducibility gap |
| 5 | No low-cost machine-readable module/capability/scenario inspection surface | 4 | 3 | 4 | 5 | High-leverage local gap |
| 6 | Build steps are ordered but do not emit a stable failed-phase receipt | 3 | 3 | 4 | 4 | Feedback gap |
| 7 | Cached-live readiness proves chunk filenames, not chunk content | 3 | 3 | 4 | 4 | Artifact evidence gap |
| 8 | Unknown semantic discovery occurs too late and uses reply-timed checkpoints | 4 | 5 | 4 | 4 | Workflow/harness gap |
| 9 | Resolved wrong turns and provenance are optional, prose-specific, or task-local | 4 | 4 | 3 | 4 | Accretive-knowledge gap |
| 10 | Companion ABI has several manually synchronized representations | 3 | 4 | 3 | 3 | Structural debt; current checks fail closed |
| 11 | Toolbox Cartography masks are provenance-pinned but not semantically revalidated | 3 | 4 | 2 | 3 | Product evidence gap |

### Foundational versus local

Foundational problems change whether the agent can establish truth: semantic
witnesses, one authority, failure receipts, and corpus availability. Fix them
before building broader automation.

Local inconveniences increase commands or reading but do not weaken authority:
stale CLI docs, missing scenario listing, full-build startup cost, and missing
Character Switch current documentation. They are still worth fixing early
because they are cheap and make the foundational work legible.

## Target architecture

### The abstraction tower

| Layer | Owns | Consumes | Emits | Must never own |
| --- | --- | --- | --- | --- |
| 0. Product intent | User behavior, safety/non-goals, human boundaries | Product decisions | Feature intent and acceptance sentence | Client offsets or runtime authority |
| 1. Content identity | Official JS/WASM/snapshot/chunk identity and immutable generation | ArenaNet manifests and bytes | Verified `ActiveClient` inputs | Feature semantics |
| 2. Semantic evidence | Named functions, fields, relations, lifecycles, candidate cardinality | Exact official bytes; optional external leads | Typed local witnesses with `proved/changed/ambiguous` | Presentation or player settings |
| 3. Capability certificate | Dependency closure and feature-local facts | Semantic witnesses | Input/ABI-bound certificate and refusal | Historical hash as authority |
| 4. Deterministic transform | Byte rewrite and output invariants | Exact certificate + exact predecessor | Reproducible derived module and manifest | New semantic guesses |
| 5. Host link | Emscripten imports, selected module instantiation, memory/table linkage | Immutable generation and manifest | Linked official instance + validated side module | Domain interpretation |
| 6. Bounded native adapter | Read-only memory collection or named command drain | Certified configuration | Pointer-free snapshot or closed command result | Generic memory/call/packet access |
| 7. Domain model | Freshness, policy, decoding, state machine, confirmation | Typed snapshots and named results | Accepted domain state | Client addresses or duplicate readers |
| 8. Presentation | Player-visible behavior and operator-only probe UI | Domain state | UI and explicit refusal | Backend invariants |
| 9. Evidence harness | Inspect, build, qualify, launch, capture, classify | Outputs from every prior layer | Versioned structured receipt | Runtime authority |
| 10. Accretive record | Proven fact reference, rejected hypothesis, applicability, provenance | Receipts and tests | Compact searchable history | A second copy of exact runtime values |

Each layer consumes only declared, bounded outputs from lower layers; it may
skip an intermediate layer when its contract explicitly needs identity or
certificate inputs from more than one lower owner. The harness observes and
orchestrates these contracts; it does not bypass them or read private internals.

### Minimal agent control plane

**Proposal:** extend the two existing entry points instead of introducing a new
service.

`pnpm certification` should provide:

- `doctor` — environment/profile availability without a full app build,
  with optional streamed snapshot integrity verification when its I/O cost is
  justified;
- `inspect` — versioned JSON inventory for one supplied or installed module;
- `verify` — existing per-feature semantic verdicts;
- `compare` — existing carry-forward evidence;
- `qualify` — reproduce all checked-in transform expectations from a declared
  content-addressed private corpus; and
- existing transform-specific commands only where a separate proof boundary is
  real.

`pnpm enhancements:live` should provide:

- `--list` and `--describe <scenario>` from the existing scenario registry;
- a versioned run receipt with scenario, privacy class, artifact identities,
  precondition status, phase, a closed result code, and closed logical evidence
  references under the run directory;
- state-driven before/event/after capture; and
- a structured action request after capture is armed. Terminal input remains
  acceptable for stable setup, never for timing. Add a development-only in-game
  checkpoint later only if terminal focus is itself measured as a failure source.

### One failure vocabulary, separate owners

**Proposal:** use a closed redacted receipt shape across process boundaries:

```text
phase:
  environment | corpus | build | artifact | semantic-proof | transform |
  protocol | fetch | compile | instantiate | manifest | allocate | side-module |
  hook | observe | command | confirm | shutdown

outcome:
  passed | refused | failed | timed-out | unavailable

reason:
  a phase-owned closed code

identity:
  source commit, official SHA, predecessor/output SHA, verifier/transform/ABI,
  capability/scenario, renderer generation where applicable
```

This is a vocabulary, not a central state machine. Each layer continues to own
its local errors and maps them once at its boundary. Free text, paths, pointers,
packets, account data, and raw memory remain excluded.

### Knowledge model

Operational facts and research context must remain separate:

1. **Operational Guild Wars fact** — represented by a stable fact/invariant ID,
   typed value, exact applicability, and a local machine-checkable witness. Only
   this can enter a certificate.
2. **External research lead** — source repository/commit/path/hash and the claim
   it suggests. It can help locate a witness but cannot populate a runtime value.
3. **External implementation choice** — an algorithm or product behavior chosen
   by GWCA/Toolbox++. Port it only through an explicit gwonmac decision and test.
4. **gwonmac inference** — a locally reasoned but not yet independently observed
   relationship. It remains non-authoritative until promoted by a witness.
5. **gwonmac product choice** — presentation/policy owned by gwonmac, not a fact
   about Guild Wars.
6. **Rejected hypothesis** — a plausible model plus the decisive measurement
   that disproved it.

Do not put this in a separate database. Exact values stay in proof code and
tests. A tooling-only fact map binds retained operational groups to witness IDs
without entering transform/cache identity; the privacy-safe generation record
remains the durable run evidence index. Compact investigation records link to
fact/invariant IDs and receipts; they do not repeat addresses or become launch
authority.

### Staleness rules

- Exact client facts are stale when their local witness refuses on new official
  bytes or their applicable generation/ABI does not match.
- Derived modules are stale when any input SHA, transform ABI, capability
  profile, build fingerprint, or expected output changes. The current cache
  already enforces this.
- External leads are stale when their pinned source hash changes. They remain
  leads even when current.
- Live semantic claims are stale outside their declared lifecycle and client
  scope. A required scenario receipt must name that scope.
- Narrative current docs are stale when their linked contract vocabulary or
  scenario/fact ID disappears; link/contract tests should detect that.
- A rejected hypothesis does not become stale; it is historical. Its applicability
  must name the client generation or feature design it addressed.

## Implementation sequence

The executable handoff plans beside this review contain exact steps and gates.

| Phase | Outcome | Why first | Acceptance |
| --- | --- | --- | --- |
| 1 | Low-cost inspection and scenario discovery | Gives every later task a cheap map without another registry or full app build | One JSON command reports a module contract; live scenarios list/describe themselves; docs match CLI |
| 2 | Closed phase/reason receipts | Lets an agent assign a refusal to the correct layer before adding more probes | Tests distinguish named build-step failure, verifier timeout/crash/malformed result, and runtime fetch/compile/instantiate/install failures without leaking sensitive data |
| 3 | State-driven semantic discovery and retained wrong turns | Prevents a well-tested false model from reaching durable ABI/UI | Unknown semantics require an early real differential; timing-sensitive scenarios arm first and persist before/event/after evidence |
| 4 | Content-addressed external qualification corpus | Makes “reproducible” honest and machine-checkable | A clean checkout reports exactly which private artifact is missing; with the corpus present, one command reproduces every shipped chain |
| 5 | Queryable operational witnesses and Cartography under the sole semantic verifier | Closes the knowledge lookup gap before removing the clearest authority contradiction | Every active fact group exposes origin, structural/live witness level, applicability, and stale conditions without affecting runtime identity; every Cartography transform input is emitted by one typed local proof; exact constants are regression fixtures only; refusal parity holds |
| 6 | Migrate remaining brittle locators by feature | Completes independence gradually without a risky rewrite | Each migrated fact has a named independent witness plus relocation and adversarial tests; no blanket baseline lookup selects it |

Immediate phases are 1–4. Phase 5 is necessary but high-risk and should be a
separate stacked change after receipts and corpus qualification exist. Phase 6 is
an ongoing feature-by-feature migration, not a big-bang verifier rewrite.

## Documentation ownership updates

This review deliberately does not create another current architecture manual.
The implementation plans update existing owners as follows:

| Owner | Required correction |
| --- | --- |
| `tools/README.md` | List the actual certification and fact-evidence commands; identify the production parser; demote external-source Python helpers to research aids |
| `docs/enhancement-development.md` | Separate early semantic discovery from final acceptance; document inspection, scenario catalogue, evidence metadata, and the single Cartography authority |
| `docs/process-model.md` | Add closed build/runtime receipt boundaries without duplicating lifecycle state |
| `docs/arenanet-compatibility.md` | Declare the private qualification corpus and the complete transform chain; remove the Cartography exception |
| `docs/release-verification.md` | Distinguish source-only gates from exact-corpus qualification and signed-release provenance |
| `docs/character-switch.md` | Become the concise owner of shipped Character Switch behavior and evidence boundaries |
| `internal/research/quick-character-switch.md` | Remain historical evidence with one unambiguous status and a link to the current owner |
| `internal/upstream/investigation-template.md` | Require knowledge kind, applicability, confidence, witness, provenance, and supersession |

Obsolete exact-hash Cartography extension guidance must be removed when the
production map is deleted, not kept as a parallel compatibility path.

## Decision record

### D1 — Extend existing commands, do not build an agent platform

- **Decision:** use `pnpm certification` and `pnpm enhancements:live` as the two
  control surfaces.
- **Alternative:** an MCP server, daemon, plugin host, or generic agent API.
- **Tradeoff:** command processes have startup cost, but they are inspectable,
  composable, CI-friendly, and do not create a new privileged runtime.

### D2 — Keep one runtime authority

- **Decision:** only the isolated local semantic verifier may grant a capability.
- **Alternative:** exact-build allowlists, remote certificates, signed reports,
  or third-party implementation parity.
- **Tradeoff:** proof work is harder, but harmless rebuilds can be accepted locally
  and semantic changes refuse at the owning feature.

### D3 — Keep exact rows as regression views

- **Decision:** exact hashes, indices, layouts, and output seals remain valuable
  regression fixtures and transform binding, but must be derived after local
  semantic selection.
- **Alternative:** delete all exact values or keep using them to locate semantics.
- **Tradeoff:** retained rows still require a private corpus, but they detect
  transformation drift without authorizing unknown bytes.

### D4 — Preserve the narrow native boundary

- **Decision:** use fixed snapshots and named commands only.
- **Alternative:** raw memory inspection, arbitrary function calls, generic
  opcodes, or an extensible hook registry.
- **Tradeoff:** each feature needs explicit work; in return, invalid states,
  privacy scope, fairness, and teardown remain reviewable.

### D5 — Treat external projects as indexed evidence

- **Decision:** record repository, commit, path, digest, claim type, and local
  witness. Routine implementation must read gwonmac's witness, not external code.
- **Alternative:** copy GWCA/Toolbox++ layouts or re-open their source for every
  task.
- **Tradeoff:** initial verification takes longer, but later tasks become cheaper
  and implementation choices remain appropriate to the WASM client.

### D6 — Keep the human boundary explicit

- **Decision:** agents may automate instrumentation, setup-safe input, and capture;
  a person still performs account, captcha, legal, payment, visual-quality, and
  consequential gameplay judgments.
- **Alternative:** claim fully unattended live acceptance.
- **Tradeoff:** not every test is autonomous, but each required human action can
  be short, armed in advance, and followed by automatic evidence.

### D7 — Do not claim the ArenaNet corpus is in the repository

- **Decision:** separate reproducible repository builds from qualification that
  requires content-addressed private/client inputs.
- **Alternative:** silently rely on the installed profile or redistribute client
  bytes.
- **Tradeoff:** setup reports an external dependency, but the dependency becomes
  exact, discoverable, and legally separable.

### D8 — Defer full ABI generation until the P1 control plane lands

- **Decision:** retain current fail-closed ABI checks now; later introduce only a
  small checked-in schema if it deletes repeated constants/offsets across Rust and
  TypeScript.
- **Alternative:** immediately adopt a generic IDL or code generator.
- **Tradeoff:** manual representations remain temporarily, but the project avoids
  a high-risk generator migration before the larger autonomy blockers are fixed.

## Facts, inferences, proposals, and unknowns

### Facts

- Repository-owned build steps are explicit and the Rust companion is byte
  reproducible.
- Runtime capability proof is isolated, typed, input-bound, and fail-closed.
- Cartography currently bypasses that single-authority claim with an exact-hash
  runtime map plus exact transform certificates consumed outside the verifier.
- The certification CLI already emits JSON, but read-only commands trigger the
  full product build and the CLI has no module-contract inspection command.
- The live harness already separates observation and automation permissions and
  writes bounded evidence, but its shared operator checkpoint waits on terminal
  Return (`scripts/enhancements-live/scenario-checkpoint.ts:3-16`).
- Toolbox cartography data has strong source provenance, while its semantic
  correctness remains an estimate (`docs/cartography.md:15-42`).

### Inferences

- External source lookup persists mainly because GWCA/Toolbox++ provide a
  searchable semantic index, not because gwonmac lacks binary parsing.
- The highest-return agent ergonomics work is better evidence projection and
  failure attribution, not more mutation authority.
- Cartography's `spike` naming and parallel authority are residue from a research
  path that became product code before architectural consolidation.

### Proposals

- Add the two small structured control surfaces described above.
- Make receipts and witness references the links between layers.
- Qualify all retained exact outputs through one declared external corpus.
- Consolidate Cartography only after every consumed transform fact has a local
  derivation, parity tests exist, and failure receipts can name the refused fact.

### Unknowns

- Whether future CI/agents can be authorized to read the private retained client
  corpus, and for how long those pairs may be retained.
- Which remaining fixed-span/body-digest facts can be made fully relocation
  resistant without live observation.
- Whether every current Cartography transform input—especially World Map
  dispatcher/context, exploration roots, area-info layout, and remaining body
  digests—can be derived structurally. The present pathing proof explicitly does
  not derive the game-context owner chain.
- Whether Toolbox's bundled continent masks correctly classify every current
  Guild Wars exploration-credit cell.
- Character Switch account-change/reconnect semantics and some metadata/ranking
  acceptance remain incomplete in the historical record.
- Dictation and Combat Clarity are not on current `main`; their task learnings
  are evidence for workflow design, not claims about shipped behavior.

## What not to build

The following were considered and rejected:

- **A generic game-memory inspector in the renderer:** it would bypass the
  certificate/snapshot boundary and make privacy and fairness unreviewable.
- **A second machine-readable knowledge database:** it would duplicate exact
  values already owned by proof code and tests. Add references and generated
  views instead.
- **A remote capability feed:** reports and attestations are evidence, not local
  runtime proof.
- **A universal feature registry containing UI, proof, memory, and scenario
  behavior:** those concerns have different owners. Generate an inspection view
  by joining their closed contracts.
- **An autonomous gameplay bot:** unnecessary for the stated goal and contrary
  to the existing human/account boundary.
- **A big-bang rewrite of all locators or the ABI:** migration must proceed by
  feature with positive relocation and adversarial refusal tests.
