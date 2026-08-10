# Full refactor and optimization plan

Status: accepted direction; implementation has not started unless a section
explicitly describes current behavior.

Reviewed: 2026-08-10

Evidence baseline:
54c6e0806d484fdd6ac4c03b1edf102a16a9bd10

Scope: evolve the shipped application in place through the smallest set of
independently useful pull requests. Do not build a second application, keep
old and new paths beside one another, or treat file size as a reason to invent
an architecture.

This plan supersedes the previous version of this document. Older plans and
research notes remain historical evidence, not current implementation
instructions. Active behavior is owned by code, executable tests, PRODUCT.md,
AGENTS.md, and the documents indexed by docs/README.md.

The standard is:

> Keep the official game playable, make ArenaNet patch days fast and safe,
> keep host-only Tools useful when optional client integration refuses, give
> players truthful Stable/Beta application updates and return-to-stable
> behavior, and stop refactoring when those outcomes are proved.

The default preference throughout is:

~~~text
delete > simplify > replace > add
~~~

---

## 1. Executive decision

Do not execute the former eleven-PR chain.

The former plan correctly valued official-client fallback, atomic generations,
bounded diagnostics, one updater, hard cutovers, and measurement before
optimization. Its implementation sequence was nevertheless stale against the
current repository and proposed several concepts that already exist:

- the repository already has one certification command line;
- the scheduled ArenaNet detector already downloads, verifies, derives, and
  opens a proposal or investigation issue;
- verified client publication, candidate health, rollback, and the exact
  generation/fingerprint token already have owners;
- granular Enhancement capability profiles already exist;
- ToolsHost already exists; and
- Tools is already a separately built, lazily loaded Vue application.

The former sequence would also have missed three outcome-critical defects:

1. selected host-only Tools is mounted only inside certified Enhancement
   installation in the production renderer path;
2. public-beta rollback was described as an older stable merely opening beta
   data, which does not prove that stable preserves it on its next write; and
3. the remote certificate-feed code has a real pin and makes authorized
   requests, but recent releases publish no feed assets and an old application
   cannot gain newly measured Enhancement facts from it.

The revised program has five required implementation PRs:

1. remove the non-operational remote certificate-feed authority;
2. make host-only Tools independent of optional client integration;
3. add the Stable/Beta application-update track and release gates;
4. add one complete stateless WebGate/login protocol story; and
5. remove feature workflows from the generic IPC registrar.

One patch-day evidence consolidation is conditional on the next real ArenaNet
update demonstrating that it deletes manual or duplicated work. Generation,
main-process cancellation, GameHost, Vue-shell, and broad certification
restructuring are not required.

After those required PRs and the signed/live release gates pass, this program is
complete. Deferred architecture is not unfinished work.

---

## 2. Evidence baseline

### 2.1 Repository state reviewed

The program was re-evaluated at the evidence baseline above. The preceding
baseline, cfcdb4c, predates PR 120. PR 120 changed 130 files and shipped the
current Tools, settings, UI, and host shape, so conclusions based on pre-PR-120
file ownership are not sufficient.

Important history:

| Commit | Evidence retained |
| --- | --- |
| e3c236f / PR 71 | one certification CLI replaced separate maintainer commands |
| 622789d / PR 74 | scheduled patch detection, artifact derivation, proposal PR, and issue |
| 7399414, 0220fd0, 8f0391a | remote feed delivery/publication/key implementation |
| 49f9c80 / PR 104 | synthetic input fallback was deleted rather than preserved |
| ba21e3b / PR 117 | pure Builds/Teams domain and safe Apply |
| cfcdb4c / PR 118 | duplicate process tests were deliberately removed |
| 481d8cf / PR 120 | current Tools host, delivery, settings, and product UI |
| d6f6d52 | measured demand reservation replaced a generalized scheduling idea |
| ee58f94 | bounded quit fixed a reproduced liveness failure |
| db8f166 | error causes were preserved behind closed boundary codes |

The strongest reusable gwnative lessons are transactional artifact ownership,
bounded diagnostics, release provenance, and measurement-backed performance
decisions. Its browser-specific HTTP trust machinery and monolithic
orchestration are not module templates for this application.

The gw-new repository is useful as an evidence notebook. Its broad speculative
architecture, prewritten error catalog, multi-stage companion design, and
documentation volume are not foundations to import.

### 2.2 Current topology is not itself the defect

Several files remain large. That is a reason to inspect ownership, not a target:

| File | Approximate lines at review | Decision |
| --- | ---: | --- |
| src/renderer/harness.ts | 1,223 | fix the host-only mount defect; do not create a generic GameHost |
| src/main/ipc.ts | 1,048 | extract concrete feature workflows |
| src/main/client-runtime.ts | 878 | retain current generation owner until a failure disproves it |
| src/shared/contracts.ts | 871 | split only with a real capability owner, not for line count |
| src/main/main.ts | 799 | reassess after feed and IPC deletion |
| apps/tools/src/host.ts | 456 | retain the existing ToolsHost |

### 2.3 Test baseline

The 45-second fast gate and 3m38s complete gate recorded for cfcdb4c are
historical measurements, not current thresholds. PR 120 added significant
Tools and product coverage afterward.

Before the first implementation PR:

1. use a complete warm dependency tree;
2. record current-HEAD timings for pnpm check, pnpm verify:runtime, packaging,
   and pnpm verify;
3. name the machine and operating-system build; and
4. preserve raw samples.

When a PR claims an improvement, alternate base and candidate runs on the same
machine and report raw samples plus medians. Do not build a benchmark
framework.

---

## 3. The three update flows

The word update currently covers three different authorities. They must never
share a state machine, progress value, or source of truth.

| Flow | Owner | Player/maintainer decision | Canonical truth |
| --- | --- | --- | --- |
| ArenaNet client generation | main ClientRuntime and certification chain | official bytes always remain playable; maintainers certify optional transforms | verified published artifacts, generation, and health token |
| Guild Wars game data | main chunk store plus the existing dataStrategy | player chooses quick/on-demand play or the foreground full-data update | verified chunk residency, never a progress counter |
| Gwonmac application | the existing AppUpdater | release users choose Stable or Beta; restart remains explicit | AppUpdater state plus one UpdateTrack setting |

ArenaNet certification must never block the player from using verified official
bytes. The game-data choice must never be confused with application update
consent. Application-update failure must never prevent play.

---

## 4. Dream-enough end state

### 4.1 Player outcomes

When the required program and operational release gates are complete:

1. An unknown ArenaNet build starts the verified official client.
2. If the player selected Tools, host-only Builds and Teams mount on every game
   build.
3. Apply, observations, native double-click, and other client-dependent actions
   state their own availability and refuse safely.
4. A shared foundational certificate may correctly disable more than one
   consumer. The UI describes the smallest evidence-bound refusal rather than
   claiming false independence.
5. The player can choose the existing quick/on-demand or full game-data
   strategy without waiting for optional Tools recertification.
6. Existing settings, credentials, Builds, Teams, templates, window state,
   client generations, and game chunks survive normal application updates.
7. Application-update failure does not block play.
8. Quit retains its bounded deadline.
9. Diagnostics remain local-only, bounded, redacted, and previewable.
10. No new account, gameplay, or diagnostic data leaves the machine.

### 4.2 ArenaNet patch-day outcomes

The normal path is already mostly automated:

~~~text
scheduled detector
→ exact official JS/WASM download and verification
→ existing certification CLI and local verifier
→ generated table proposal or named investigation
→ human reviews only facts that have no structural locator
→ scoped artifact/live proof
→ small application release when compiled facts change
~~~

The end state keeps:

- one certification command line;
- one scheduled workflow;
- official bytes as fallback;
- local structural proof for template-save compatibility;
- compiled exact-build facts for Enhancement;
- deterministic transforms and output hashes; and
- named live checks for semantics a fixture cannot establish.

The end state deletes the remote certificate feed. New Enhancement facts ship
with a signed application release. The rare template-only case that the feed
could theoretically recover remotely is not worth a signer, publication
workflow, runtime delivery path, persisted record, diagnostics surface, and
test hierarchy without an observed incident proving that latency matters.

### 4.3 Application Stable/Beta outcomes

Canonical terminology:

- Distribution identity: release, preview, or development. It controls bundle
  ID, signing, Keychain, profile authority, and updater capability.
- Update track: stable or beta. It is a preference inside the release identity
  only.
- Installed stage: stable, beta, RC, or historical alpha.
- Preview: a separately signed tester snapshot. It is never the public Beta
  track.
- GWonMac Tools Beta: a feature-maturity label unrelated to application update
  tracks.

There remains one public release application, one profile, one Keychain
identity, and one AppUpdater.

~~~ts
type UpdateTrack = "stable" | "beta";
~~~

The selector policy is:

| Installed stage | Selected track | Remote condition | Decision |
| --- | --- | --- | --- |
| stable | stable | newer stable | native forward update |
| stable | stable | beta, RC, or alpha only | no offer |
| stable | beta | newer beta, RC, or stable | newest eligible forward update |
| beta | beta | later beta, RC, or final stable | native forward update |
| RC | beta | later RC or final stable | native forward update |
| beta/RC | stable | newer stable | native forward update |
| beta/RC | stable | latest stable is older | manual stable return |
| historical alpha | not available | newer stable | forward update to the stable enabler; the track choice exists only afterward |
| historical alpha | not available | prerelease only | no offer |
| any | any | malformed, duplicate, wrong-architecture candidate | refuse truthfully |
| any | any | offline | failed check; play remains available |
| any | any | automatic checks disabled | no automatic request; explicit check remains |
| any | any | track changes during a check/download | current operation unchanged; next check uses new track |

No alpha is eligible through the application or the website's public Beta
surface. Alpha remains only a historical installed-stage recovery case.

There is no native automatic downgrade. When the latest stable is older than
the running beta/RC:

1. the UI displays the exact latest stable version;
2. it opens only the fixed repository Releases page;
3. it tells the player to download the signed and notarized stable DMG;
4. macOS Gatekeeper verifies the downloaded application when opened; and
5. Gwonmac neither downloads nor verifies that DMG and never sends an older
   release to Squirrel.Mac.

Binary replacement and player-data compatibility are separate claims.

### 4.4 Maintainer outcomes

- main.ts sequences existing owners and lifetime.
- ipc.ts validates senders and values and forwards direct calls. It owns no
  reset, dialog, relaunch, or storage workflow decisions.
- ClientRuntime retains generation/update/rollback ownership until a reproduced
  defect justifies a smaller extraction.
- The renderer uses concrete Module-host operations. There is no generic
  one-implementation GameHost interface or second status store.
- The existing ToolsHost remains the only Tools host contract.
- Host-only Tools mount independently; optional live ports are supplied only
  after exact client certification.
- Diagnostics observe features and cannot become required dependencies.
- Active documentation describes shipped behavior. Future behavior belongs in
  this plan until its implementation PR lands.

### 4.5 Sources of truth

| Concept | Canonical owner | Derived/disposable state |
| --- | --- | --- |
| Official client generation | verified manifest and published artifacts | prepared transform cache |
| Candidate health | active generation plus ClientHealthToken | renderer presentation |
| Game content | main content-addressed chunk store | renderer byte LRU and progress |
| Certification | compiled tables plus isolated local structural proof | UI availability summary |
| Live game state | renderer companion snapshot | Tools view models |
| Builds and Teams | main-owned atomic BuildLibrary | editor drafts and filtered lists |
| Settings | one AppSettings record | form controls |
| Credentials | release Data Protection Keychain | short-lived memory |
| App update | existing AppUpdater | UI copy |
| Update eligibility | one UpdateTrack plus a pure selector | displayed installed stage |
| Diagnostics | canonical recorder | exported summaries |

No PR may create a second authority for any row.

---

## 5. Program rules

### 5.1 One outcome per PR

Every PR description must answer:

~~~text
Player or maintainer problem:
Current evidence:
Invariant served:
Current owner:
New owner, if any:
Code deleted or simplified:
Persisted/wire impact:
Failure and cancellation behavior:
Cheapest executable proof:
Overengineering considered and rejected:
Stop condition:
~~~

A PR that only moves files, adds forwarding wrappers, creates an interface, or
renames an existing owner does not qualify.

### 5.2 Hard cutovers

- Do not retain old and new implementations behind a flag.
- Do not introduce internal compatibility aliases.
- Do not write through two paths.
- Do not add migrations for derived or disposable state.
- Move callers and delete superseded code in the same PR.
- Preserve a legacy reader only for a released canonical player-data format.

### 5.3 Tests follow the claim

Use the cheapest layer capable of proving the invariant:

1. pure unit test for deterministic policy;
2. fixture integration for filesystem, network, process, or native boundaries;
3. Electron story for a real process/window/IPC claim;
4. packaged proof for delivered artifact behavior;
5. signed proof for signing, Keychain, and updater identity;
6. exact ArenaNet artifact proof for transforms; and
7. a narrowly owned live scenario only when fixtures cannot establish the
   behavior.

Do not test every enum member, Cartesian capability combination, or forwarding
handler. Test equivalence classes and complete user/process stories.

### 5.4 Performance claims require a decision

No decomposition PR is an optimization by itself.

An optimization PR must state:

- observed problem;
- metric;
- current baseline;
- candidate;
- controlled input;
- acceptable regressions;
- alternating raw samples; and
- code deleted if the candidate wins.

Do not rewrite rendering, caching, scheduling, or process topology without a
measurement that identifies that boundary.

### 5.5 Stop conditions

Stop or split a PR when:

- it adds a generic abstraction with one production implementation;
- it changes persisted data and runtime architecture together;
- it needs a temporary compatibility layer;
- its tests broadly rewrite unrelated coverage;
- it treats line count or framework uniformity as the defect;
- it makes patch day, check, packaging, or release materially slower without
  catching a demonstrated failure class; or
- it cannot name the old code deleted.

---

## 6. Program sequence and ranking

Required PRs are ranked by outcome leverage, not by a false linear architecture
dependency. Stable/Beta can progress in parallel once the current-state
documentation and release baseline are recorded.

~~~mermaid
flowchart TD
    D["Documentation alignment and measured baseline"]
    D --> P0["PR 0 · Delete remote certificate feed"]
    D --> P1["PR 1 · Host-only Tools continuity"]
    D --> P2["PR 2 · Stable/Beta update track"]
    D --> P3["PR 3 · Complete WebGate story"]
    P0 --> C{"Next real patch exposes duplicated evidence work?"}
    C -->|"Yes"| C1["Conditional PR · certification review output"]
    C -->|"No"| S["Keep current CLI/workflow"]
    P0 --> P4["PR 4 · Extract IPC feature workflows"]
    P1 --> G1["Patch-survival gate"]
    P3 --> G1
    C1 --> G1
    S --> G1
    P2 --> G2["Signed beta/data gate"]
    P4 --> G3["Main-process stop/go review"]
    G1 --> F["Close program and archive residue"]
    G2 --> F
    G3 --> F
~~~

Score legend:

- PV: player value
- PD: ArenaNet patch-day leverage
- FR: failure/risk reduction
- M: maintainability
- D: deletion/simplification yield
- E: implementation effort
- RR: regression risk
- OE: overengineering risk
- TC: test/release cost
- C: confidence in evidence

Higher is better for PV, PD, FR, M, D, and C. Lower is better for E, RR, OE,
and TC. Scores are not averaged.

| Rank | PR | PV | PD | FR | M | D | E | RR | OE | TC | C |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | delete remote feed | 2 | 4 | 4 | 5 | 5 | 3 | 3 | 1 | 3 | 4 |
| 1 | host-only Tools continuity | 5 | 5 | 5 | 4 | 2 | 3 | 4 | 2 | 3 | 5 |
| 2 | Stable/Beta update track | 5 | 1 | 5 | 4 | 2 | 3 | 3 | 2 | 4 | 5 |
| 3 | complete WebGate story | 4 | 2 | 5 | 3 | 1 | 2 | 2 | 1 | 3 | 4 |
| 4 | IPC feature workflows | 2 | 1 | 3 | 4 | 4 | 3 | 3 | 2 | 3 | 5 |
| conditional | certification review output | 3 | 4 | 3 | 3 | 3 | 2 | 1 | 2 | 2 | 4 |

---

## 7. PR 0 — Delete the remote certificate feed

### 7.1 Problem

The repository currently contains a real Ed25519 public-key pin. Release builds
therefore attempt two fixed feed asset URLs on each allowed app-update trigger.
Recent public releases do not publish those assets.

Even if publication worked, the feed cannot introduce newly measured
Enhancement facts to an older app. Those facts are accepted only as exact
restatements of ENHANCEMENT_BUILDS compiled into that app. The only distinct
remaining capability is rare template-only recovery when local structural
proof refuses.

This does not justify:

- a signing key and protected publication environment;
- a generator and two-runner reproducibility pipeline;
- schema, parser, signature and sequence machinery;
- runtime fetch, storage and reconciliation;
- diagnostics state;
- release-workflow coupling; and
- a large unit, policy, and Electron test hierarchy.

### 7.2 Invariant

Unknown official bytes remain playable. Template save is enabled only by
compiled facts or the isolated local structural verifier. New Enhancement facts
arrive only in a signed application release.

### 7.3 Scope

Delete:

- certificate-feed schema, trust, proof, and delivery modules;
- feed generator and publication workflow;
- the generator invocation and candidate-feed evidence in
  `.github/workflows/client-recertification.yml`, while retaining the exact
  generation-record step;
- build and package wiring that exists only for the feed generator;
- the bundled public-key resource;
- feed-specific runtime/main wiring;
- stored-feed paths and reconciliation;
- feed diagnostics fields and report copy;
- feed-specific unit, policy, and Electron tests; and
- active documentation presenting the feed as an operational recovery path.

Retain:

- certificates/certified-client.json as the scheduled detector's generation
  record;
- compiled template and Enhancement tables;
- the isolated local client verifier;
- the existing certification CLI;
- the scheduled recertification workflow; and
- official-client fallback.

Do not add a migration. game/certificate-feed.json is derived state and simply
ceases to be read. A later general cache reset may remove it; it never remains
an authority.

### 7.4 Failure behavior

| Situation | Result |
| --- | --- |
| known compiled build | current certified stages remain available |
| unknown build with local template proof | official client plus template compatibility |
| unknown build without local proof | untouched official client |
| new Enhancement layout | host-only Tools remain; client-dependent actions wait for app release |
| offline | identical certification answer from local bytes and compiled facts |

### 7.5 Verification

Fast proof:

- typecheck/lint and existing certification suites;
- local-verifier known, template-only, and refusal fixtures;
- the retained recertification workflow records the reviewed generation and
  produces its proposal without generating or attaching a feed artifact;
- policy assertion that no runtime project-release request exists outside the
  AppUpdater; and
- diagnostics schema/report fixtures contain no feed state.

Process proof:

- unknown compatible fixture reaches template-only;
- unknown incompatible fixture reaches official-only; and
- automatic update opt-out still makes zero project-release requests.

No live ArenaNet or signed package proof is required unless deletion changes
the selected client in a real artifact test.

### 7.6 Stop and rollback

Stop if deletion reveals a real released feed asset successfully used by an old
application to recover a build. Preserve that artifact and reassess a
template-only design.

Rollback is a normal code revert. There is no canonical data migration.

### 7.7 Better afterward

- one fewer network authority;
- one fewer signer and operator procedure;
- one fewer persisted derived record;
- one clearer patch-day story; and
- new Enhancement facts have one truthful delivery path.

---

## 8. PR 1 — Host-only Tools continuity

### 8.1 Problem

The product domain and current ToolsHost can operate without commands, but the
production renderer imports and mounts Tools only inside certified companion
installation. The existing Electron test manually mounts with a null command
port, so it proves capability but not production routing.

An unknown ArenaNet build therefore hides host-only Builds and Teams even though
their persistence and editing do not require client memory integration.

### 8.2 Invariant

When the player has selected Tools, host-only Tools mounts for every verified
official client. Optional live observations and commands appear only when the
selected exact client integration supplies them.

### 8.3 Scope

Use the existing ToolsHost and existing Tools bundle.

Change the renderer composition so that:

1. host-only Tools selection decides whether the Tools UI mounts;
2. certification decides which optional observation/command ports are supplied;
3. no manifest means those ports are unavailable, not that Tools is absent;
4. Builds, Teams, authoring, import/export, and persistence continue;
5. Apply and live readouts show a closed, calm unavailability reason; and
6. official bytes remain the selected client.

A small immutable session availability projection may be derived from the
already prepared client selection. It must not:

- persist;
- become another certification source;
- invent independently owned facts;
- duplicate EnhancementCapabilities; or
- cross the preload bridge unless a main-owned fact is actually needed.

Delete any condition that equates Tools UI availability with presence of
enhancement_manifest.

### 8.4 Explicit non-scope

- no new ToolsHost;
- no plugin API;
- no generic capability registry;
- no fact ledger;
- no separate Tools renderer/process;
- no Vue-shell rewrite;
- no generic GameHost;
- no attempt to make client-dependent Apply host-only; and
- no recertification changes.

### 8.5 Failure behavior

| Client result | Host library | Template save | Observations | Apply |
| --- | --- | --- | --- | --- |
| fully certified | available | available | exact enabled subset | exact enabled subset |
| template-only | available | available | unavailable | unavailable |
| official-only | available | official behavior only | unavailable | unavailable |
| optional transform refuses | available | previous safe stage | refused stage unavailable | refused stage unavailable |
| Tools bundle fails to load | game remains playable | unaffected | unavailable | unavailable |

### 8.6 Verification

Unit:

- derive availability for full, template-only, official-only, and optional
  transform refusal;
- prove host-only availability does not depend on an Enhancement manifest.

Electron:

- launch the normal renderer path with an unknown official fixture;
- enable/open Tools;
- create, edit, and persist a Build and Team;
- reload and read them back;
- observe Apply unavailable with a closed reason;
- confirm no optional command is sent; and
- confirm the official generation remains active.

Extend the existing Tools smoke. Do not create another fixture framework or
repeat the same behavior at component, Electron, packaged, and live layers.

Packaged proof is required only if the bundle routing or package inventory
changes.

### 8.7 Stop and rollback

Stop if mounting Tools inherently loads or mutates certified client state.
Separate that side effect first; do not add a compatibility flag.

Rollback is the previous mount decision. BuildLibrary data is unchanged.

### 8.8 Better afterward

- ArenaNet patch-day blast radius is reduced immediately;
- the product promise becomes true in production;
- host value no longer waits for address recertification; and
- optional integrations remain fail-closed.

---

## 9. PR 2 — Public Stable/Beta application updates

### 9.1 Problem

Players need an opt-in public Beta path and a truthful way back to Stable.
Preview packages are not suitable: they intentionally use a separate bundle
and Keychain identity.

The return promise is dangerous if treated only as binary replacement.
Settings ignore unknown fields but rewrite only known fields, BuildLibrary
requires its exact version and quarantines another one, and unknown window-state
formats are deleted. Merely opening beta-written data with stable does not prove
that stable preserves it.

### 9.2 Invariant

Stable and Beta share the existing release identity, AppUpdater, profile, and
Keychain. UpdateTrack changes eligibility for the next check. It never changes
distribution identity and never creates a downgrade path.

Every public beta and RC is semantically round-trip compatible with the actual
latest stable release.

### 9.3 Scope

Add one setting:

~~~ts
type UpdateTrack = "stable" | "beta";
~~~

Stable is the default. Read the canonical setting once when a check begins or
pass it directly into AppUpdater.check. Do not maintain an in-memory mirror.

Add one pure selector inside the updater ownership boundary. It understands:

- installed release stage;
- selected track;
- candidate version/stage;
- GitHub draft/prerelease agreement;
- supported architecture and exact automatic-update ZIP; and
- whether stable return is manual.

If stable return is manual, expose only:

~~~ts
{ kind: "manual-stable-return"; version: string }
~~~

Do not expose a Release object or dynamic URL. The UI uses the existing fixed
repository Releases action.

Update the website's explicit Beta selector to accept beta/RC/final and reject
alpha. Do not invent a shared website/application release service.

Replace renderer copy that infers Stable versus Preview solely from a
prerelease suffix. Installed stage, selected update track, and distribution
identity are three separate facts.

### 9.4 First rollout

The current stable cannot opt into a feature it does not contain. Ship a stable
enabler first:

~~~text
S0  2026.8.6
B1  2026.8.7-beta.1
RC  2026.8.7-rc.1
S1  2026.8.7
~~~

S0 contains:

- the UpdateTrack setting and UI;
- candidate selection;
- the manual-return state;
- all stable readers/writers needed for fields B1 may write; and
- the release-certification scenario.

Do not publish B1 before S0 is available to ordinary stable users.

A beta of an already released stable core is invalid because its macOS bundle
version orders below that final release.

### 9.5 Data compatibility contract

For every public beta and RC:

~~~text
actual latest stable creates realistic canonical state
→ candidate beta reads, modifies, and saves it
→ the same latest stable reads, modifies, and saves it
→ semantic state remains intact
~~~

Mandatory state:

- AppSettings, including UpdateTrack;
- BuildLibrary version 3 with representative Builds, Teams, tags, ordering, and
  references;
- window bounds and mode;
- profiles and one template write;
- no .corrupt quarantine;
- no silent defaults/reset;
- no credential loss; and
- no game-data redownload caused by the application transition.

If a beta introduces canonical fields, relaunch the beta afterward or compare
the semantic/raw representation to prove the stable write did not discard them.

When Electron/Chromium, IDBFS, native Keychain, client storage, or persistence
dependencies change, additionally prove:

- actual IDBFS/IndexedDB reverse readability;
- cached-only official launch;
- existing generation/chunk residency; and
- actual signed replacement Keychain continuity.

Do not introduce a generic migration framework. Use stable expand/contract
before a beta needs a rename or semantic change.

### 9.6 Failure and concurrency behavior

- A check captures the track at start.
- Changing track affects the next check.
- Do not cancel or reinterpret an in-progress/downloaded update.
- A ready beta remains clearly named and may be installed or deferred.
- Selecting Stable while auto-checks are disabled makes no automatic request.
- An explicit Check action remains allowed.
- Offline/failure state remains non-blocking for play.
- An older stable never reaches Squirrel.Mac.
- The app never downloads, hashes, or manages a manual-return DMG.

### 9.7 Verification

PR gate:

- release parser and selector equivalence classes;
- alpha refusal;
- track setting parse/save/patch;
- track captured at check start;
- auto-check opt-out remains zero-request;
- older stable never reaches fake native updater;
- malformed, duplicate, draft, wrong-architecture, and tag/stage disagreement;
- one Electron opt-in/manual-return story; and
- website selector tests excluding alpha.

Pre-publication release gate for every beta/RC:

- exact signed candidate has release bundle ID, Team ID, profile, entitlements,
  and expected macOS build order;
- existing DMG/ZIP/RELEASES/checksum/SBOM/attestation gates pass;
- exact latest-stable artifact and checksum are recorded;
- actual stable → candidate → stable semantic round-trip passes; and
- no profile relocation, quarantine, reset, credential loss, or unintended
  redownload occurs.

Post-publication:

- one owned live S0 → B1 update through the normal production updater before
  broad announcement;
- one B1/RC → S1 live update when final Stable is published.

Draft releases are invisible to the production updater. Do not add a second
test feed to simulate an unpublished native update. Mock policy before
publication and canary the real path immediately afterward.

SIGNED_BETA_UPDATE_PROVEN is historical evidence for the earlier identity
cutover. Do not reuse it as the recurring data-compatibility gate.

### 9.8 Better afterward

- players choose early releases without a second app;
- Stable remains the safe default;
- final Stable is a normal forward update;
- older Stable return is truthful and explicit;
- alpha cannot leak into public Beta selection; and
- rollback safety covers player data, not just the binary.

---

## 10. PR 3 — Complete stateless WebGate/login story

### 10.1 Problem

Current proxy units prove route and header predicates, but not one complete
login-shaped exchange through the production protocol handler. Browser-auth
history in gwnative demonstrates that individually hardened predicates can
still break a complete login session.

This does not prove that Gwonmac needs a cookie jar. Its current contract is
stateless and strips Cookie and Set-Cookie. The missing item is executable
evidence for that contract.

### 10.2 Invariant

The real protocol handler can complete the intended bounded WebGate exchange
without leaking credentials, accepting redirects, storing cookies, or exposing
arbitrary network authority.

### 10.3 Scope

Create one login-shaped local fixture that enters through the same handler used
by gw://app/webgate.

Prove:

- canonical route acceptance;
- bounded request method/body;
- request Cookie removed;
- response Set-Cookie removed;
- redirect refused according to the current contract;
- response size/content handling;
- secret canaries absent from logs, diagnostics, and returned errors;
- offline/fetch failure maps to a closed outcome; and
- no new browser session state persists.

Reuse existing fake transport and protocol seams. Do not duplicate Steam OAuth
coverage.

### 10.4 Explicit non-scope

- no cookie jar;
- no browser-profile state;
- no broad mutation corpus;
- no new HTTP server;
- no generic proxy framework;
- no live network requirement in PR CI; and
- no change to production behavior unless the complete story exposes a defect.

### 10.5 Verification

Keep cheap allowlist/parser edge cases at unit level. One Electron or
process-integrated story owns the composed exchange.

A minimum live login smoke may remain explicitly opt-in and must have a named
owner/cadence. Do not call the fixture live proof.

### 10.6 Stop and rollback

If the fixture passes current code, the PR is test/evidence-only and stops.
If it fails, split the smallest production fix from unrelated refactoring.

### 10.7 Better afterward

- one historical high-impact regression class has a complete owner;
- security predicates are proved in composition;
- no speculative state machinery is added; and
- patch-day changes to client login cannot silently bypass the story.

---

## 11. PR 4 — Extract feature workflows from IPC

### 11.1 Problem

The central IPC registrar correctly owns channel definitions, parsing, sender
validation, and registration. It also currently owns several multi-step feature
workflows involving dialogs, persistent changes, reset ordering, and relaunch.

Splitting registrations by feature would distribute transport code without
fixing that defect. The problem is decisions in the registrar, not its line
count.

### 11.2 Invariant

IPC validates and transports. A concrete feature workflow owns user
confirmation, durable action ordering, relaunch, and recovery.

### 11.3 Scope

Extract only workflows currently visible in ipc.ts:

- settings changes that require restart;
- settings reset plus window-state handling;
- cache clear confirmation, action, and relaunch;
- game-filesystem reset confirmation, action, and relaunch; and
- app-update installation confirmation if it is still implemented as a
  registrar decision.

Use concrete functions with explicit dependencies. Prefer existing owners. One
small file may own related reset workflows if it permits deletion; do not
create one service per button.

Retain centrally:

- channel names;
- argument/result parsers;
- canonical renderer/sender checks;
- handler registration;
- simple native adapters such as fixed external-link and clipboard operations
  when they contain no feature policy; and
- the exhaustive preload capability contract.

### 11.4 Deletion requirement

The PR must delete more workflow code from ipc.ts than it adds in forwarding.
It may not add:

- a feature registrar framework;
- dependency injection container;
- service registry;
- generic command bus;
- compatibility channels;
- duplicated parsers; or
- direct tests for every forwarding handler.

### 11.5 Failure and cancellation behavior

- Confirmation refusal performs no durable action.
- Once a durable reset succeeds, a later window/relaunch presentation failure
  does not falsely report that reset as undone.
- Relaunch is requested only after the owning operation reaches its durable
  boundary.
- Existing secret-operation serialization remains unchanged.
- Existing bounded quit remains the process liveness authority.

Do not thread AbortSignal through operations without a reproduced lifetime
problem.

### 11.6 Verification

Unit/integration:

- refusal;
- durable success followed by presentation/relaunch failure;
- concurrent secret/reset exclusion where applicable; and
- feature error remains a closed code across IPC.

Electron:

- one representative reset/relaunch story per distinct OS-authority class, not
  one per channel.

Policy:

- IPC registrar retains sender validation and parsers;
- extracted workflows are absent from the generic handler body; and
- bridge inventory remains unchanged unless the player-visible feature itself
  requires a deliberate contract change.

### 11.7 Stop/go review after merge

After this PR, inspect main.ts and lifecycle again.

Stop the main-process refactor if:

- main.ts is understandable as sequence/lifetime;
- feature decisions have named owners;
- quit remains bounded; and
- no operation has a reproduced cancellation leak.

Only a concrete remaining defect may create a follow-up. There is no required
StartupCoordinator or generalized cancellation PR.

### 11.8 Better afterward

- generic transport has one legible responsibility;
- reset/relaunch semantics are directly testable;
- contributor changes touch fewer unrelated branches; and
- no framework is introduced.

---

## 12. Conditional patch-day PR — One deterministic review output

This PR does not exist merely because the former plan described it.

### 12.1 Trigger

During the next real ArenaNet client update, record:

- commands a maintainer actually ran;
- manual copying/merging of evidence;
- duplicated derivation between local CLI and workflow;
- inconsistent artifact identity or refusal wording;
- elapsed machine time;
- elapsed human time; and
- facts still requiring manual analysis.

Proceed only if one thin CLI change deletes duplicated work.

### 12.2 Allowed scope

Extend the existing pnpm certification command with one review/update
subcommand. The scheduled workflow must call the same implementation.

Its output may be one deterministic JSON document on stdout or in an explicitly
requested path. It names:

- official JSPI code generation;
- exact official JS and WASM fingerprints;
- local template proof result;
- compiled Enhancement result;
- deterministic derived output hashes;
- closed refusal reasons;
- facts with no structural locator; and
- exact artifact and live checks still required.

The command does not:

- create another pnpm alias;
- fetch or publish by default;
- create a report store;
- create Markdown and JSON authorities;
- introduce generic CapabilityId;
- invent addresses;
- write production certification automatically;
- sign anything; or
- open a PR.

### 12.3 Acceptance

- same bytes and tool revision produce byte-identical JSON;
- the workflow and local command use the same implementation;
- a fresh process re-verifies emitted candidate facts;
- output distinguishes the three relevant identities rather than saying only
  fingerprint;
- manual steps removed are listed; and
- net code/shell complexity decreases.

If these cannot be met, close the proposal and retain the current CLI/workflow.

---

## 13. ArenaNet failure matrix

| Situation | Official client | Host-only Tools | Optional integration | Recovery owner |
| --- | --- | --- | --- | --- |
| known exact build | runs | available when selected | certified subset | normal selection |
| unknown, local template proof succeeds | runs | available | template stage only | local verifier |
| unknown, proof refuses | runs | available | refused | official fallback |
| optional transform refuses | runs | available | previous safe stage | client-module selection |
| artifact preparation interrupted | exact old or new | unchanged | re-derived | PatchClient recovery |
| candidate lacks frame/socket health | previous verified generation | available | previous selection | ClientHealthToken rollback |
| renderer crashes during update | previous or completed exact generation | recoverable | previous selection | generation lock/recovery |
| player chooses quick data mode | runs using demand content | available | unrelated | current dataStrategy |
| player chooses full data mode | waits behind foreground verified download | available afterward | unrelated | chunk residency |

Acceptance language must never claim that an offline fixture proves real
gameplay semantics. Exact transforms receive artifact proof; gameplay behavior
receives the minimum named live check.

---

## 14. Testing and release matrix

| Invariant | Fastest proof | Higher gate |
| --- | --- | --- |
| unknown official fallback | client-module unit plus artifact fixture | minimum owned live patch smoke |
| local template derivation | isolated verifier fixture | exact new client artifact |
| host-only Tools continuity | derived-state unit | one production-path Electron story |
| Apply unavailable without commands | domain/UI decision test | same Electron story |
| complete WebGate exchange | process/local transport fixture | optional named live login smoke |
| atomic generation/rollback | existing filesystem/unit tests | existing crash/concurrency stories |
| IPC workflow ownership | direct workflow tests | representative Electron reset/relaunch |
| Stable/Beta selection | pure table tests | fake AppUpdater integration |
| no native downgrade | fake native updater integration | manual-return Electron story |
| alpha excluded | application and website selector tests | release catalog audit |
| release identity unchanged | package/policy tests | signed candidate gate |
| beta data compatibility | source fixtures cannot prove it | actual latest-stable release scenario |
| Keychain continuity | native harness | actual signed two-version scenario when relevant |
| native Stable→Beta→final | mocked policy before publication | post-publication live canary |
| performance | no proof for file movement | alternating measurements only when hot path changes |

Do not add broad new test infrastructure. Extend current fixtures and stories.

PR and Preview packaging currently packages the runtime-tested build. The
versioned release pipeline separately verifies exact source and then tests the
exact signed candidate it builds. Documentation must not collapse those into
one inaccurate phrase.

---

## 15. Release and rollout

### 15.1 Ordinary code PRs

Each code PR:

1. runs the cheapest targeted tests during development;
2. runs pnpm check;
3. runs the relevant integration/Electron lane;
4. lets existing PR CI package and smoke the candidate;
5. reports current measured gate deltas when tests were added; and
6. updates active docs in the same PR when shipped behavior changes.

Avoid a standalone prose-only cleanup PR after every behavior PR. Delete stale
prose with the code that makes it stale.

### 15.2 Public Beta

Before the first Beta:

1. publish stable S0 with the selector and data readers;
2. verify ordinary stable adoption;
3. build/sign/notarize candidate B1 under the same release identity;
4. run the full stable → B1 → stable semantic round-trip; and
5. publish B1 only after those pass.

After publication, run the owned production updater canary before announcement.

Repeat the data gate for every public beta and RC. Run deeper IDBFS, cached
client, and Keychain continuity whenever their implementation or dependencies
change.

When final S1 publishes, prove B1/RC → S1 through the normal updater.

### 15.3 ArenaNet patch day

The scheduled detector remains the heartbeat. An ordinary unknown build should
require no emergency host release for play or host-only Tools.

Patch-day completion means:

- exact artifact identity recorded;
- local structural result reproduced;
- generated transforms deterministic;
- unlocated facts named, not guessed;
- official-only fallback exercised;
- host-only Tools exercised;
- minimal live semantics owned; and
- any compiled facts ship through normal signed release provenance.

---

## 16. Deleted and deferred architecture

### 16.1 Former PR dispositions

| Former PR | Final disposition |
| --- | --- |
| one ArenaNet update command/report | conditional thin extension to existing CLI; no second alias/store |
| offline update and login fixtures | split; retain complete WebGate story only, fold any real report fixture into conditional CLI work |
| capability-owned certification | split; retain host-only continuity and derived availability, defer fact-owner reorganization |
| generation/runtime split | defer until a mixed-generation defect exists |
| feature-owned IPC | keep in reduced concrete-workflow form |
| composition root and cancellation | defer; reassess after deletion/IPC work |
| public Beta | reorder early and strengthen release/data gates |
| GameHost boundary | defer until a second consumer or recurring defect |
| Vue launcher/settings | delete |
| Tools host boundary | merge host-only outcome; existing ToolsHost remains |
| residue cleanup | continuous with behavior plus final archive/status pass |

### 16.2 Explicitly deleted ideas

- remote certificate feed;
- second update command alias;
- report store or report registry;
- generic capability/fact registry;
- one-capability-per-fact fiction;
- ClientGenerationToken duplicating ClientHealthToken;
- twelve generalized transaction failpoints;
- StartupCoordinator;
- universal AbortSignal plumbing;
- generic GameHost interface and status store;
- Vue launcher/settings rewrite;
- second ToolsHost;
- plugin or MCP surface;
- extra process, database, background job, or cache;
- native automatic downgrade;
- application-managed DMG downloader/verifier; and
- exhaustive Cartesian test matrices.

### 16.3 Evidence triggers for deferred work

| Deferred concept | Required evidence before a PR exists |
| --- | --- |
| generation extraction | reproducible mixed old/new artifact or recovery defect current owners cannot isolate |
| cancellation expansion | operation survives ownership/quit in a way that causes data loss, hang, or externally visible work |
| GameHost interface | second production implementation or repeated UI/Module ownership defects not fixed by concrete operations |
| renderer process split | prototype proves Emscripten/JSPI/OffscreenCanvas/IDBFS compatibility and measured benefit |
| capability fact split | independent verifier, transform, fallback, and second real consumer |
| remote template feed | real incident where app-release latency caused material harm plus old signed app adopting a real signed template-only asset |
| Vue shell | measured defect or net deletion that outweighs boot/package/test cost |

---

## 17. Documentation discipline

This plan owns proposed behavior. Current user/operations documents must not
claim Stable/Beta, host-only unknown-build continuity, or remote-feed deletion
before the corresponding code ships.

Each implementation PR updates:

- PRODUCT.md only when the product contract changes;
- AGENTS.md when an invariant or owner changes;
- docs/content-pipeline.md for network/update ownership;
- docs/wasm-host.md for certification/runtime behavior;
- docs/process-model.md for process/identity ownership;
- docs/user-guide.md for shipped player behavior;
- docs/release-verification.md for release gates; and
- tests that map public claims to evidence.

Historical research remains historical. Add a supersession note instead of
rewriting evidence as though it had always reached the new conclusion.

Do not make documentation a second implementation:

- contracts live in types and tests;
- command help lives with the command;
- release workflow details live in the workflow and verification scripts;
- docs state invariants, outcomes, and operator decisions; and
- line counts and file inventories are evidence snapshots, not architectural
  acceptance criteria.

---

## 18. Final program gate

The program is complete only when:

- [ ] an unknown ArenaNet build starts verified official bytes;
- [ ] selected host-only Builds and Teams mount through the production path;
- [ ] Apply and observations refuse truthfully without hiding host-only Tools;
- [ ] player game-data strategy remains independent of certification;
- [ ] one certification CLI and one scheduled workflow own patch-day evidence;
- [ ] no remote certificate-feed runtime, signer, persisted state, diagnostics,
      workflow, or test authority remains;
- [ ] one complete stateless WebGate/login story passes;
- [ ] Stable/Beta uses one release identity, updater, profile, Keychain, and
      setting;
- [ ] Preview is still a separate tester identity, not public Beta;
- [ ] alpha is excluded from application and website Beta selection;
- [ ] no older version reaches Squirrel.Mac;
- [ ] manual Stable return uses the fixed Releases page and truthful copy;
- [ ] every public beta/RC passes actual latest-stable semantic round-trip;
- [ ] the stable enabler and post-publication update canaries have passed;
- [ ] IPC owns validation/transport, not reset/dialog/relaunch policy;
- [ ] quit remains bounded and no reproduced cancellation defect is open;
- [ ] diagnostics remain bounded and local-only;
- [ ] current test timings are recorded and have not grown without a named
      defect class;
- [ ] active documents match shipped behavior;
- [ ] no duplicate GameHost, ToolsHost, generation token, updater, feed,
      report store, or capability authority was introduced; and
- [ ] deferred work is closed rather than carried as implied debt.

When this checklist passes, Gwonmac is in the dream-enough state.

Future architecture work requires a reproduced player/maintainer defect or a
measured decision. Large files, framework consistency, and aesthetic preference
do not reopen this program.
