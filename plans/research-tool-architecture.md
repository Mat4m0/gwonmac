# Research ledger: Toolbox architecture for Chromium, Electron, and Wasm

Status: offline research baseline, 2026-08-01. This is an investigation ledger,
not a client certificate and not a claim of production readiness.

## Decision

The durable architecture is a hybrid, not pure polling and not pure event
payload processing:

```text
exact-build feature evidence
        |
        v
game-owned event function runs first
        |
        v
constant-time passive event callback
        |
        +---- discrete scalar ----------> publish scalar
        |
        `---- mark domain dirty
                    |
                    v
       next certified game tick runs first
                    |
                    v
       passive tick callback rebuilds only dirty domains
                    |
                    v
       validate and publish one coherent snapshot
                    |
                    v
      same-renderer Chromium Toolbox UI
```

Keep the existing freestanding Rust side module. C++ can implement the same
Wasm ABI, but changing language would not improve the event model, update
survival, call altitude, or fault containment. One engine, one typed ABI, and
one same-renderer overlay remain simpler than parallel C++ and Rust paths or a
plugin loader.

Observation and control must remain separate. The certified UI dispatcher is
an excellent post-event observation boundary, but live failures proved it is
not a safe general command gateway. No game command should be reintroduced
until a
natural game-owned execution boundary is found and certified for that command.

The foundation now implements the event-invalidated party snapshot: UI events
coalesce one dirty bit, the next certified tick scans at most seven party hero
entries, and unchanged state publishes nothing. The next feature should be
chosen only after its own natural observation or command boundary is proven;
there is deliberately no generic raw-memory event inspector. The highest
product risk remains cross-build recovery, which needs a second real client
module before portability can honestly be claimed.

## Scope and exact artifact

All exact-module statements in this ledger concern one official client:

| Identity | Value |
| --- | --- |
| Program/build | `1` / `38,797` |
| Official Wasm SHA-256 | `3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817` |
| Post-template SHA-256 | `9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094` |
| Enhancement transform ABI | `11` |
| Companion ABI | `6` |
| Derived SHA-256 | capability-specific; sealed by its cache fingerprint and manifest |
| Companion SHA-256 | `9612283b5a2227ac264b4a7bf373e463dfe5ef07d856a6acb609a5de64e2caf0` |

The official module is archived privately outside Git at:

```text
~/Library/Application Support/Guild Wars Research/client-builds/
  38797-3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817/
```

No second official client binary is available locally. Build 38,790 and hash
`3039ca5489eb2bddb38844d275320e3ac070baf01b5b888fc2062982e343f3a8`
remain useful historical identities, but the binary is absent. One real build
plus synthetic mutations can prove rejection behaviour; it cannot prove that a
locator preserves semantics across ArenaNet builds.

## Evidence grades

Every claim below uses one of these grades:

| Grade | Meaning |
| --- | --- |
| **Live** | Observed in the official running game in a bounded scenario. It proves only the stated action and build. |
| **Exact static** | Derived by fully decoding build 38,797's Wasm. It can prove constants, signatures, calls, strings, and structure, but not human semantics or runtime ordering by itself. |
| **Offline execution** | Executed against transformed or synthetic Wasm and memory fixtures. It proves ABI and failure behaviour, not game semantics. |
| **Reference** | Named or modelled by GWCA, GWToolbox++, GWCAjs, or gwnative. Useful for hypotheses; never an exact-build certificate. |
| **Candidate** | Several signals agree, but timing, completeness, or semantic identity still needs static tracing or a bounded live differential. |
| **Rejected** | A live failure or stronger evidence disproved the hypothesis. |

Two rules prevent research guesses from becoming production facts:

1. A current GWCA name does not make an ID globally true. The archived GWCA
   header is shifted relative to the current header.
2. Finding the same Wasm signature does not certify the same function. A
   signature is one anchor among constants, source/assertion strings, call
   relationships, table relationships, and control-flow shape.

## Crash quarantine and the passive baseline

The transcript's latest `TextParser.cpp:724 IsParam(data)` run is overwhelmingly
associated with the stale, detached worktree at
`/Users/matthias/.codex/worktrees/703d/gwonmac`: its earlier build output names
that path, the profile had no ABI 8 cache, and its console line had the old
format. In that historical run, a stale pre-ABI-5 process/artifact was the leading inference,
not a proven source from the stack alone. The tree's current contents are
massively dirty and user-owned and cannot establish which earlier artifact was
running; it must not be edited or used for another live run. The maintained
worktree is:

```text
/Users/matthias/.codex/worktrees/toolbox-foundation-v2/gwonmac
```

At the time of that failure, the real profile contained only transform cache
ABI 7 while the passive branch required ABI 8. The old console line said only
`installed for client build 38797`; that historical passive build identified
itself with `companion ABI 5` and the first twelve hexadecimal characters of
the kernel hash. Current transform ABI 11 and companion ABI 6 cannot reuse any
of those derivatives.

The failure history is architectural evidence:

| Experiment | Result | Conclusion |
| --- | --- | --- |
| Reuse statically empty table slot 0 | Live `function signature mismatch` on character entry | Slot 0 is a runtime sentinel, not spare capacity. **Rejected.** |
| Link the side module at fixed memory `0x100000` | Static audit proved writes to unreserved game memory; a later run aborted in `TextParser::IsParam` | The memory design is independently unsafe; it is not necessary to claim it caused that exact assertion. **Rejected.** |
| Call the UI dispatcher from the main-loop hook | `s_propContext` assertion | A game tick is not automatically a valid UI property context. **Rejected.** |
| Save/install a guessed context and send after any later UI event | Visible delay; a later stale-ABI run reported `TextParser::IsParam` | Static tracing independently proves an arbitrary nested UI producer is not a valid command gateway. **Rejected.** |
| Passive, original-first observer | Offline ABI, memory, ordering, and lifecycle suites pass | This is the current safe baseline; a fresh live confirmation is still pending. |

The historical transform-ABI-8/companion-ABI-5 passive cutover removed every
known command path. Current transform ABI 11 and companion ABI 6 retain those
constraints while adding capability-specific identities and the closed
party-dirty message set:

- exact wrappers replace tick `#446`, cursor `#2469`, and UI dispatcher
  `#6842` while their clones remain private;
- the fixed table grows from 4,683 to 4,684 entries and owns only the new
  terminal slot 4,683; dynamic sentinel slot 0 remains untouched;
- each wrapper calls its private game clone first;
- an original trap prevents the observer from running;
- the observer callback has exact type `(i32, i32, i32, i32, i32, i32) -> void`;
- only `enhancement_hook_slot` is exported by the transform;
- the companion imports no `game.*` function;
- no hero setter, command export, command-triggering synthetic input, or
  `PropContext` write remains; the separately bounded cursor hit-test refresh
  is presentation reconciliation, not a companion-to-game function call;
- the renderer gives the side module a checked, allocator-owned, zeroed 64 KiB
  runtime block and a private empty table;
- snapshot/config/cursor/toolbox/runtime allocations are positive, aligned,
  in bounds, below 2 GiB, and pairwise disjoint;
- teardown disables first and clears the table slot only by callback identity.

A 512-cycle mixed tick, cursor, chat, and hero fixture changed no byte outside
the allocated regions. The kernel has five `env` imports, no start function,
and no memory or table export. These are **offline execution** proofs. They make
the removed hero command an implausible cause of the stale crash, but the stack
alone cannot mathematically exclude an unrelated official-client or cursor
defect. A current-ABI reproduction would need hook-off/hook-on isolation.

One residual risk remains important: a companion trap, including panic
fail-stop, still occurs on the game's call stack. Wasm does not provide a
useful recovery boundary here. Kernel callbacks therefore need to be total,
allocation-free, bounded, and covered by broad adversarial fixtures;
feature-level compatibility avoids installing uncertain code but cannot
recover after a live callback traps.

## What the three examples actually prove

| Example | Proven mechanism | Live status | Does not prove |
| --- | --- | --- | --- |
| Cursor | Game event marks cursor dirty; the next tick validates and hashes a 32x32 image; trusted click can request one bounded zero-distance refresh. | Item, arrow, salvage, restored arrow, and click refresh were observed on 38,797. | Cross-build discovery, every cursor kind, or zero tick reconciliation. |
| Player chat | Three `0x10000082` producer sites call the central dispatcher; callback preserves the game event and increments one scalar without reading payload pointers. | One ordinary player event incremented once; `/age` did not increment under the historical ABI-5 proof. | Text decoding, sender identity, channel semantics, or current ABI-6 fresh-process confirmation. |
| Hero/party | Validated context and party chains publish owned hero count/ID/agent ID; normal Show/Hide events can be observed. | The corrected context root and Koss ownership were observed; normal panel changes were observed before the passive cutover. | A safe Show/Hide command, complete party state, dirty-event completeness, or a current-ABI live run. |

The developer hero example is now deliberately read-only. That is a successful
safety result, not a missing button to restore with another delay.

## The central event choke point is real

Exact static decoding found function `#6842` with signature
`(i32, i32, i32) -> void`, the source anchor `FrApi.cpp`, and the assertion
`msgId >= FRAME_MSG_EX`.

Among functions that directly call `#6842`, build 38,797 contains:

- 626 producer functions;
- 439 distinct high message IDs;
- 997 high-ID constant sites;
- source/assertion anchors spanning 88 distinct `.cpp`/`.h` paths.

Reproduction used the repository's full instruction decoder, not byte matching:

1. decode every function body with `tools/wasmscan.py`;
2. retain functions containing a direct `call #6842`;
3. collect their decoded `i32.const` values in
   `0x10000000 <= value < 0x10010000`;
4. resolve NUL-terminated source paths through `tools/gensyms.py` and the same
   decoder's data-reference index.

The deterministic evidence capsule is:

```json
{"dispatcher":6842,"gensymsSha256":"b24c1ed9a46f51c4c580704e2a97a87eda427fc9fbfc2d45ace6da1b626a34c2","highConstantSites":997,"highMessageIds":439,"officialSha256":"3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817","producerFunctions":626,"sourcePaths":88,"wasmscanSha256":"2dc512b5904299a415968c00cbbb89cbe6622848df4d40790d26b950c98bfb18"}
```

Its SHA-256 is
`acd560f5145f02c178f61eaa847dffdc58d2a5d12ab65e7e98040e2a4b27c5da`.
Future tooling should emit this capsule directly instead of relying on an
ad-hoc analysis command.

This is strong evidence that one central UI/event dispatcher covers many
useful Toolbox domains. It is an observation choke point, not a command bus.
The correct callback work is a scalar increment or dirty-bit update. The fixed
wrapper necessarily passes the three `i32` arguments into the companion. Any
pointer-shaped values are treated as opaque: the companion must never
dereference, retain, log, or publish them, and no such value may enter a
presentation, diagnostic, IPC, or persisted surface.

The current player-chat certificate is the strongest example:

- `ChCliApi` function `#8947` has exactly three `0x10000082` sites and three
  direct calls to `#6842`;
- nearby `#8942` emits `0x1000007f` and `#8945` emits `0x10000080` to the same
  dispatcher;
- the human name `kPlayerChatMessage` is **reference** evidence from the
  current GWToolbox++ header;
- the one-message counter result is **live** evidence.

## State-domain model

Different kinds of state need different update strategies:

| Domain kind | Examples | Correct strategy |
| --- | --- | --- |
| Discrete scalar | Player-chat count, event frequency | Update directly in the passive callback. |
| Event-invalidated snapshot | Party, owned heroes, skillbar, attributes, inventory | Event sets a dirty bit; next safe tick validates and rebuilds once. Bursts coalesce. |
| Continuous state | Player/target position and distance | Bounded tick read while the feature is visible/enabled; there may be no discrete event for movement. |
| Dirty plus reconciliation | Cursor art/visibility | Event triggers expensive image work; clean ticks perform only the smallest consistency check. |
| Lifecycle invalidation | Map loading, context replacement, logout | Immediately publish unavailable/invalid, discard prior generations, and rebuild only after a valid context returns. |

The game structures remain the source of truth. Events only say that a domain
may have changed. The engine's snapshot generation is the source of truth for
publication; it must not be described as a game-owned generation field.

For an event-invalidated domain, use this state machine:

```text
 relevant event(s)      lifecycle ready       bounded reconciliation
       |                      |                        |
       `---------- dirty |= DOMAIN ------------------'
                              |
                      next certified tick
                              |
             validate roots, bounds, and identity
                              |
              publish ready or unavailable once
                              |
                       clear dirty/latch state

 start-map-load
       |
       v
 publish unavailable once; clear dirty; latch loading
       |
       `-- no traversal until lifecycle-ready event
```

One dirty tick performs one bounded attempt. Whether it publishes ready or
unavailable, it clears the bit and latches that coherent result. A later
relevant event, lifecycle-ready event, or explicit bounded reconciliation
rearms it. Loading itself must not cause a failed traversal on every tick.
Never retain a pointer between ticks.

## Exact-build event discovery matrix

In this matrix, “emits” means the producer contains the exact constant followed
by a direct call to `#6842`. That call relationship is **exact static**. Names
and proposed dirty domains are **reference/candidate** until ordering and
coverage are proved.

The listed sites were individually adjacency-checked, but the reusable locator
must go further and prove stack/dataflow: the constant must supply dispatcher
argument zero on that control-flow path, not merely occur earlier in a function
that also calls `#6842`. Because dispatches can nest, the original-first
observer records callback completion order; it must not claim producer-entry or
wire-emission order.

| Domain/action | Message | Exact producer functions | Proposed use | Remaining proof |
| --- | --- | --- | --- | --- |
| Player identity set | `0x1000002a` | `#8891` | Invalidate player, party, and build identity. | Confirm timing after Character/World context update. |
| Agent profession | `0x1000001d` | `#8282`, `#8283` | Dirty player/hero build metadata. | Identify payload subject without dereferencing it; confirm coverage for primary/secondary changes. |
| Attribute changes | `0x1000002d`–`0x10000030` | 2d: `#7187`; 2e: `#7165`, `#7179`, `#7183`, `#7185`; 2f: `#7184`; 30: `#7167`, `#7174`, `#7185`, `#7187`, `#7188` | Dirty attributes/build. | Current header does not name these IDs; trace each mutation and ordering. |
| Hero agent/data | `0x10000038`, `0x10000039` | `#8785`, `#8787` | Dirty hero metadata and party. | Determine whether ownership/composition can change without either event. |
| Login state | `0x10000050` | `#12023`, `#12288`, `#12291`, `#12304`, `#12306`, `#12880` | Mark lifecycle dirty, then validate roots on the next tick. | Prove scalar direction/timing before using one side for immediate invalidation. |
| Skillbar changed | `0x1000005e` | `#8708`–`#8710`, `#8718`, `#8724`, `#8725`, `#9080` | Primary BUILD dirty signal. | Prove complete coverage for template load, manual slot edit, hero bars, and profession changes. |
| Skills available | `0x1000005f` | `#8743` | Dirty availability/profession metadata. | Separate unlock/map-load noise from actual bar changes. |
| Skill activity | `0x1000005b` | `#8729`, `#8732` | Combat activity only, not structural build state. | None for party/build snapshot; do not over-invalidate. |
| Start map load | `0x100000c2` | `#9005` | Immediately invalidate all pointer-backed snapshots. | Historical ABI-5 ordering evidence; re-confirm under ABI 6. |
| Map loaded | `0x1000008c` | `#9583` | Reconcile all map-scoped domains. | Determine which contexts are already valid at callback return. |
| Load map context | `0x10000098` | `#9927` | Reconcile map/player/party candidates. | Establish relation to `MapLoaded`. |
| Map change | `0x10000111` | `#9856` | Reconcile identity and map metadata. | Establish ordering and duplicate behaviour. |
| World-map update | `0x100000c7` | `#8999`, `#9000` | World-map discovery only; not an instance-lifecycle signal by default. | Keep out of party/build invalidation unless a feature needs it. |
| Party hard mode | `0x1000011a` | `#10697` | Dirty party settings. | Snapshot field not yet modelled. |
| Add/remove henchman | `0x1000011b`, `0x1000011c` | `#10698`, `#10700` | Dirty party composition. | Live differential and post-mutation timing. |
| Add/remove hero | `0x1000011e`, `0x1000011f` | `#10702`, `#10704` | Dirty party composition/ownership. | Live differential, bursts, and map transition. |
| Add/remove player | `0x10000124`, `0x10000126` | `#10710`, `#10711` | Dirty party composition. | Second-player differential and leader/owner changes. |
| Show/hide hero panel | `0x100001a4`, `0x100001a3` | Show: `#14603`, `#16520`; hide: `#15861`, `#16520` | Observe panel state only. | Never use these post-events as a command drain. |
| Weapon swap complete/cancel/update | `0x100000e9`–`0x100000eb` | `#7502`, `#7670`, `#7493` | Dirty equipped weapon/build metadata. | Decide whether visual swap and committed equipment need separate state. |
| Gold update | `0x100000ec`, `0x100000ed` | `#7497`, `#7498` | Dirty inventory currency only. | Not needed for first build manager. |
| Inventory slot update | `0x100000ee` | `#7492`, `#7496` | Dirty inventory. | Prove final slot state is committed before dispatch. |
| Equipment slot update | `0x100000ef` | `#7492`, `#7494` | Dirty equipment/build metadata. | Prove final slot state is committed before dispatch. |
| Inventory slot clear | `0x100000f1` | `#7517`, `#7520`, `#7523` | Dirty inventory. | Prove complete removal coverage. |
| Equipment slot clear | `0x100000f2` | `#7517` | Dirty equipment/build metadata. | Prove complete removal coverage. |
| Item updated | `0x10000106` | `#7450` | Dirty item metadata. | Distinguish property mutation from presentation-only updates. |
| Inventory agent changed | `0x100001c4` | `#15895` | Candidate inventory identity invalidation. | Current header naming and live semantics are incomplete. |

The strongest initial dirty sets are therefore:

```text
LIFECYCLE = 50, 8c, 98, c2, 111

PARTY = 2a, 38, 39, 11a, 11b, 11c, 11e, 11f, 124, 126
        plus map lifecycle

PLAYER_BUILD = 2a, 1d, 2d..30, 5e, 5f
               plus map lifecycle

HERO_BUILD = 38, 39, 1d, 5e, 5f
             plus party/player identity and map lifecycle

INVENTORY = e9..ef, f1, f2, 106, 1c4
            plus map lifecycle
```

Those sets are **candidates**, not complete contracts. In particular, hero
owner changes, party leader changes, template application, hero skillbar
changes, and equipment mutations may have additional producers. The first
event inspector run must attempt each action separately and record only IDs,
counts, engine sequences, renderer-bracketed action-window timing,
map/loading state, and snapshot generation.

Several newer `0x100001a9`–`0x100001b3` and `0x100001c5` messages also have
exact producers. Some are UI requests, tooltip events, or item commands rather
than committed state. They stay out of dirty sets until producer semantics and
post-mutation timing are established. Constant proximity alone is not enough;
for example, `#13753` directly emits `0x100001b1`, not `0x10000106`.

Adjacent exact producer families also contain unclassified candidates that may
explain currently missing coverage: hero-cluster `0x1000003a` from `#8782`, and
party-cluster 11d from `#10701`, 120 from `#10721`, 121 from `#10720`, 122
from `#10684`/`#10705`, 123 from `#10706`, 125 from `#10708`, 127 from
`#10709`, 128 from `#10712`, and 129 from `#10713`. They have no assigned
dirty semantics yet. The inspector must correlate them with owner, leader,
readiness, and composition actions before the certificate names them.

## Generation-counter result

No trustworthy game-owned party, skillbar, agent, or inventory generation
counter was certified.

Reference structure review found:

- GWCA `Array<T>` exposes buffer, capacity, size, and parameter state, not a
  documented monotonic revision;
- party structures expose their arrays but no documented revision;
- `SkillbarSkill.event` is only a per-slot field named `event`; no reference
  evidence establishes a monotonic domain revision;
- inventory `cached_hash` is hash-table metadata paired with chain/slot fields,
  not a mutation counter.

It would be unsafe to rename any changing integer “generation” without tracing
every writer and proving monotonic domain semantics. The production plan should
therefore use engine-owned dirty bits and publication generations, plus a slow
bounded reconciliation chosen by measurement. A future game-owned counter is
an optimization, not an architectural dependency.

The next counter search should be differential and bounded:

1. snapshot only small, already-certified context headers before and after one
   controlled action;
2. identify words that change exactly once;
3. statically find every writer;
4. reject timestamps, sizes, handles, hashes, and per-entry event fields;
5. require multiple actions and a map transition before assigning semantics.

## Scaling analysis

The current proof is bounded but not yet shaped for dozens of features.

### Current costs

The Rust target-observation `collect` path can walk the agent array from 1 to a
certified maximum of 4,096 entries on each game tick. It is now enabled only by
the target capability. Toolbox has a separate dirty path: a fixed developer
program selects cursor plus Toolbox and never target observation; UI callbacks
coalesce a party-dirty signal for the next tick, and one 120-tick reconciliation
recovers from a missed callback. Its hero walk reads only the party vector and
at most seven owned heroes; a synthetic invalid agent array proves it is not a
dependency.

The cursor already demonstrates the desired split:

- its event callback only increments a counter and sets `DIRTY`;
- a dirty tick validates the pointer chain and hashes 1,024 pixel words;
- an unchanged clean tick reads only the cursor show count;
- the renderer reads the small header first and touches 4 KiB of pixels only
  when the published generation changes.

The continuously changing core target snapshot remains a 64-byte frame read
while that capability is enabled. Toolbox reads only its 12-byte header on an
unchanged frame, performs the full 64-byte seqlock decode on a new generation,
and skips DOM updates when decoded values are equal. Only the ten exact-build
hero-readiness, map-lifecycle, and party-membership UI IDs mark party state
dirty; unrelated dispatcher traffic stays on the clean path. Callbacks publish
only when chat, panel, hero, or cursor scalar state actually changes.

Target distance is intentionally different. Player and target coordinates can
change continuously without a useful UI message, so it may remain a per-tick
domain while that feature is enabled. Party composition and skillbar structure
should not inherit that cost merely because they share a module.

### Required budgets

Do not invent a generic event bus, ring, worker, or second memory before these
measurements show pressure:

| Operation | Required property | Measurement |
| --- | --- | --- |
| Event hook callback | Constant-time, allocation-free, bounded branches | Distribution and maximum during event bursts |
| Dirty publication | One scalar read/modify/write | Count and duration by domain |
| Snapshot rebuild | Only when dirty; bounded validation and copy | Duration, entries visited, success/unavailable result |
| Burst coalescing | Many related events cause at most one rebuild per safe tick | Events versus rebuilds |
| Clean tick | No party/build traversal | Per-domain clean-path counter |
| Renderer observation | Header-only when unchanged | Header reads, full reads, DOM writes |
| Map loading | No stale snapshot and no pointer retention | Invalidation-to-ready transition record |

The first implementation can use hard structural bounds before timing data is
available:

- inspector table: exactly 512 counters for IDs `0x10000000`–`0x100001ff`;
- counter behaviour: saturating `u32`, plus one saturating aggregate for IDs
  outside the table; no dynamic allocation or collision probing;
- UI callback: at most one counter increment and one fixed ten-ID dirty-domain
  comparison; no loop over registered handlers;
- first party rebuild: inspect no more than the already certified 64 source
  entries and publish no more than seven owned heroes;
- reconciliation: at most once per 60 certified ticks while lifecycle state is
  ready, never while loading;
- loading: one invalid publication at start and zero party entries visited
  until a lifecycle-ready signal rearms the domain;
- renderer: one header read per animation frame, full decode and DOM update only
  when its sequence changes.

These are ceilings, not performance claims. Measurement can lower them or prove
that a different fixed capacity is required. Raising one requires a fixture and
an acceptance criterion; it is not a configuration option.

The existing live acceptance gate requires the renderer snapshot observer p95
to stay below 250 microseconds, but that is not evidence that the kernel scan is
cheap. Add per-domain counters and offline synthetic timing first, then one
Level 1 live comparison with the existing balanced benchmark. Never draw
production budgets from a developer laptop microbenchmark alone.

### Desired quiet-state invariant

After the event-invalidated party cutover, this must be mechanically testable:

```text
quiet ticks:             N
party event callbacks:   0
party snapshot rebuilds: 0
party entries visited:   0
renderer full decodes:   0
party DOM writes:        0
```

A slow reconciliation may deliberately break the zero at a bounded interval;
if retained, it must have its own counter and rationale so it cannot be confused
with accidental per-frame polling.

## Cross-build survival

The current application has the correct fail-closed floor: one canonical
three-state client certification decision allows the official game to run when
Enhancement support is unknown. It does not yet have feature-level structural
recovery.

The current Enhancement certificate couples tick, cursor, UI dispatcher, and
all memory layout fields under one exact post-template hash. Candidate
inspection checks basic Wasm validity, main-loop export shape, and table shape;
it does not independently rediscover cursor producers, UI producers, or layout
fields. Therefore one changed field currently disables the complete bundle.

The target is feature capability recovery within one derived module, not one
module per feature:

```text
official client identity
        |
        +-- core tick evidence -------- valid / unavailable / ambiguous
        +-- UI dispatcher evidence ---- valid / unavailable / ambiguous
        +-- cursor evidence ----------- valid / unavailable / ambiguous
        +-- party layout evidence ----- valid / unavailable / ambiguous
        +-- build layout evidence ----- valid / unavailable / ambiguous
        `-- command gateway evidence -- absent until independently proven
                         |
                         v
               fixed capability manifest
                         |
                         v
                 one transformed Wasm
                 one companion kernel
```

Dependencies must be explicit. Chat observation needs the UI dispatcher but no
party layout. Cursor needs its publisher plus a safe reconciliation point.
Party needs the UI dirty set, tick, context root, and party layout. A failed
party layout must not remove a separately certified chat counter; a failed UI
dispatcher may legitimately disable all features that depend on it.

The config remains one fixed 49-word ABI, while its contents are capability
scoped. The transform/cache/manifest identity encodes the exact capability
set; inactive words must be zero and are neither validated as game evidence nor
read by the kernel. Hooks are emitted only for active capabilities. Tests prove:

- the manifest, config, and derived-cache fingerprint encode the exact selected
  capability subset;
- a hook is transformed only when its evidence and all dependencies are valid;
- inactive feature fields are zero, rejected when nonzero, and neither
  validated as evidence nor read;
- inactive callback branches are unreachable under the capability bits;
- an ambiguous cursor hook can be omitted while a valid chat hook still
  installs and works, and the inverse is tested where dependencies permit;
- teardown clears only hooks/regions installed for that subset.

One shared renderer/kernel installation may still fail as one transaction on a
runtime ABI, allocation, or lifecycle error. That is honest fail-closed
behaviour, not runtime fault isolation. Feature-level recovery solves changed
client evidence; it should not add a second installer merely to claim that one
consumer failure leaves the others alive.

### Structural locator contract

A locator may propose a candidate only when all mandatory anchors agree and the
result is unique. It must emit evidence rather than a boolean.

| Concept | Mandatory exact signals | Additional independent signals |
| --- | --- | --- |
| Main tick | Export identity and exact signature | Lifecycle/cadence shape, characteristic callers/callees |
| UI dispatcher | `(i32,i32,i32)->void`, `FrApi.cpp`, assertion shape | Hundreds of direct producers, neighbouring message relationships, normalized CFG |
| Player chat | Three same-ID sites in one `ChCliApi` producer, direct common dispatcher | Neighbouring 7f/80 producers and exact cardinality |
| Cursor publisher | Exact signature and two recovered producers | Existing table relationship, cursor globals/texture validation shape |
| Party events | Exact IDs, direct common dispatcher, `PyCliParty.cpp` anchors | Add/remove pairing, mutation-before-dispatch proof |
| Party layout | Independently recovered root and field uses | Array bounds, player ownership relationship, map lifecycle invalidation |
| Skillbar events/layout | `ChCliSkill.cpp`, 5e/5f producers, exact calls | Slot count and mutation-before-dispatch proof |

Function indices, data addresses, and field offsets are outputs. A shared index
or address delta is never evidence. Body hashes are useful rejection anchors
for an unchanged build, but a self-healing locator must also normalize function
indices, relocated data/global addresses, and explicitly classified relocation
operands. It must reconstruct the CFG and preserve every branch edge and target;
branch depth and arbitrary immediates are semantics, not noise to erase.

Each locator report should include:

- exact input identity and artifact family;
- all candidates considered;
- mandatory anchors passed/failed;
- uniqueness result;
- recovered signature, functions, addresses, and table relationships;
- feature dependencies affected;
- transformed output hash and validation result;
- explicit `certified`, `candidate`, `ambiguous`, or `unavailable` result.

“Strong match” should generate a reviewable candidate certificate. It must not
silently authorize a player launch. Promotion still requires the complete
offline suite and one bounded live semantic confirmation for the changed
feature.

### Mutation suite that can be built with one client

Synthetic mutation testing should prove that the locator is structural and
fails closed:

1. renumber/reorder defined functions while rewriting references;
2. add unrelated functions and data;
3. relocate data addresses and globals;
4. remove one non-mandatory anchor;
5. remove one mandatory anchor;
6. change a target signature;
7. alter one producer's message or cardinality;
8. insert a second equally plausible candidate;
9. change the relevant control-flow shape;
10. legitimately grow the bounded input table and require rediscovery of the
    new terminal ownership slot;
11. inject a runtime collision into the newly appended slot or make table shape
    unbounded/unsupported.

Expected outcomes must distinguish recovery from rejection. Index/data shifts
with preserved normalized semantics and a changed fixed table length should
recover to the new terminal slot. Changed signatures, producer evidence,
duplicate candidates, unsupported table shape, and a runtime collision in the
selected slot must reject. These fixtures establish algorithm quality, not
real cross-build portability.

### Real-build corpus and release operation

The first ignored corpus should contain the JSPI family this Electron runtime
actually executes, keyed by official hash and never committed. Add Asyncify
only if it becomes a supported runtime requirement. A developer-only archive
command should:

- hash the active official Wasm and glue;
- read program/build identity;
- copy Wasm, glue, manifest, and version metadata into a new
  content-addressed private directory;
- verify every copy byte-for-byte;
- refuse overwrite;
- emit only a small, non-copyright evidence capsule suitable for Git.

Adopt the strongest operational ideas from gwnative: scheduled candidate
detection, two independent downloads/hashes, reproducible candidate generation,
isolated signing, bounded certificate history, and official-module fallback.
Do not copy its assumption that prior indices plus exact body identity amount to
semantic rediscovery.

The scheduled canary belongs to external CI/developer infrastructure. It must
not add an automatic request to the installed app. A signed certificate update
may arrive only through the existing user-authorized/manual or opt-in release
path, preserving the repository's zero-unrequested-network invariant.

The recognition bar remains unmet until the same blind locator runs against at
least two real official generations. Relocation recovery needs a real generation
where the relevant function/address actually moved; two builds with unchanged
layout prove recognition only. Three generations are preferable because one
successful transition can be accidental. The archived 38,797 module is the
first corpus member, not a portability result.

## Command gateway research

There is no safe game-command gateway in the current foundation.

Exact static tracing explains the failures:

- main loop `#446` clears `PropContext`; being on a tick does not supply a valid
  UI context;
- exact chain `#6842 -> #6535 -> #6507 -> call_indirect` proves dynamic
  handler dispatch and reentrancy potential; the live `TextParser` failure
  proves the tested command route can occur in parser scope, not that every UI
  dispatch is nested in a parser;
- “the next UI event” can be inside a text-parser producer;
- save/install/restore of one guessed global cannot recreate caller-specific
  parser data, JSPI altitude, reentrancy state, or object lifetime;
- a cached HeroID can become stale between snapshot and arbitrary event.

The safe future shape is separate from the observer:

```text
Chromium control
      |
      v
typed, bounded scalar intent
      |
      v
one outstanding typed intent slot
      |
      v
certified natural game-owned command drain
      |
      v
exact domain function with validated preconditions
      |
      v
normal game event marks state dirty
      |
      v
snapshot confirms the result
```

A command may be added only when all of these are proven:

1. exact-build function identity and full Wasm type;
2. a certified game-thread execution point and call altitude; a proven
   context-free low-level builder is a distinct safe class, but it still needs
   a bounded drain rather than running inside an arbitrary observer;
3. the natural gateway itself owns every required property/parser context and
   its reentrancy rule; the companion never guesses, installs, or restores a
   `PropContext`;
4. loading, map, ownership, object-lifetime, and argument preconditions;
5. fixed typed arguments with no arbitrary pointer, memory, function index, or
   packet surface;
6. one-outstanding-intent, busy/cancellation, and rate behaviour;
7. observable completion or rejection through normal game state/events;
8. original observer dispatch remains independent and exactly once;
9. malformed/stale/off-map fixture rejection without calling the game;
10. one command at a time in a bounded live promotion scenario.

Prefer the highest-level official request function whose normal caller already
establishes every invariant. Context-free client-to-server builders are useful
research leads from GWCAjs build 38,615 only when that builder itself is the
proven domain API; they are not certificates for 38,797. Event context
create/destroy and save/restore functions `#230`–`#234` are also leads, not
permission to fabricate a context. If no natural gateway can be proved for hero
panel control, hero control stays read-only.

Never expose `callFunction`, `writeMemory`, `sendPacket`, raw UI message, or
generic plugin command APIs to Chromium.

## Fault containment by feature

Feature-level certificates reduce update blast radius, but they do not justify
multiple engines yet.

Each capability needs:

- independent structural evidence and dependency status;
- exact manifest fields and ABI validation;
- original-first hook preservation;
- enable-last install and disable-first teardown;
- bounded, total callback work;
- snapshot magic/version/size/sequence/capacity validation;
- invalid/loading state that publishes unavailable rather than stale values;
- one scoped live promotion test.

One kernel remains the simpler lifecycle and memory-ownership unit because it
already imports no game functions and owns only allocated output/runtime
regions. It is not a runtime fault boundary: one feature panic or trap can
still freeze or abort the game. Separate modules would multiply allocators,
imports, tables, manifests, lifecycle transactions, and trap surfaces without
making a trap on the game call stack recoverable. Reconsider modules only after
repeated features demonstrate an isolation requirement they can actually
serve.

The panic handler now terminates as a Wasm trap instead of spinning forever on
the game callback stack. The build sealer and browser boundary verify the exact
Wasm type and surface of all eight exports without `Function.length`, and
adversarial tests exercise every dispatch kind plus malformed scalar/pointer
state. This is bounded failure behavior, not a proof that no compiler-generated
panic path is reachable: a trap still aborts the client, so checked total
callbacks and fail-closed initialization remain primary.

The manifest should remain fixed and typed. Feature independence is a real
requirement; a generic `hooks[]` registry or plugin loader is not.

Shared memory, region pointers, the table, and mutable counters now remain in
the installer/observer closure. Toolbox publishes one frozen scalar/projection
runtime with an exact key set. The raw-address `--observe` path was deleted;
cursor capture receives only one fixed cursor-projection read and persists no
address or pixel payload. The target-observer benchmark alone gets its explicit
hook switch.

## Chromium overlay and input boundary

The same-renderer overlay is the correct UI boundary. It avoids a second
BrowserWindow, native injection, an ImGui renderer, cross-window focus, and the
game's canvas-blur audio mute. Guild Wars continues to own the canvas; Chromium
owns only explicit Toolbox surfaces.

The current offline Electron test proves:

- the Open control receives interaction while the collapsed root otherwise
  passes pointer hit testing through;
- opening requests the canonical game-input reset;
- Toolbox key and mouse events stop before simulated game handlers;
- focus is trapped inside the open dialog;
- Escape and an outside click close it and restore canvas focus;
- internal focus transfer does not emit canvas blur;
- cleanup requests another input reset and restores focus.

The implementation also exits pointer lock when opening. That specific overlay
transition still belongs in the live matrix rather than being overstated as an
Electron proof.

That is meaningful, but the complete live matrix remains:

| Transition | Required result |
| --- | --- |
| Canvas to Toolbox and back | No stuck key/button, no game action leaks, no audio mute |
| Escape | Closes only the Toolbox state intended and restores canvas focus |
| Command-Tab away/back | Real application blur releases everything; return is coherent |
| Pointer lock | Opening exits; closing does not silently recapture |
| Held movement or mouse | Synthetic releases reach the game before overlay interaction |
| Game chat input | Toolbox shortcut and typing do not steal text unexpectedly |
| Future Toolbox text input | Game receives no keys while the field is active |
| Fullscreen/windowed | Same hit testing, focus, scale, and audio behaviour |
| Touch translation | Toolbox controls stay controls; canvas gestures remain game-owned |

Do not recreate Toolbox panels inside Guild Wars' native UI. The same-window
Chromium overlay gives better accessibility, layout, testing, and developer
velocity while preserving the feel of an in-game surface.

## Comparison with the reference repositories

| Codebase | What to keep | What not to port |
| --- | --- | --- |
| Current gwonmac | Exact fail-closed certification, original-first passive wrappers, PIC Rust side module, validated snapshots, same-renderer UI, transactional install | Current coupled certificate and unconditional party scan are proof-stage limitations, not the final scale model. |
| GWCA | Assertion/string/call-reference scanning; genuine game-thread scheduling; pre/original/post UI and packet callbacks | x86 scanners, MinHook, native pointers, `std::function` bridges, DLL lifecycle |
| GWToolbox++ | Domain managers and the hybrid pattern where events mark a widget dirty and update reads canonical state | Direct3D/ImGui rendering, global singleton managers, native plugin conventions |
| GWCAjs-web-app | Fast Wasm analysis, captured structure knowledge, failed-call evidence, build-specific direct-call hypotheses | Hard-coded indices, apparently empty table reuse, and direct internal exports that are not portable certificates or a general dispatcher command gateway |
| gwnative | Scheduled/double-fetched certification, signed bounded feeds, runtime-family separation, official fallback | Renderer `requestAnimationFrame` driving a full companion observation every frame; prior-index/body-identity recertification as a substitute for rediscovery |

Specific reference evidence:

- `GWCA/Source/Scanner.cpp` demonstrates source/assertion string locators.
- `GWCA/Source/GameThreadMgr.cpp` demonstrates a real game-owned scheduling
  boundary.
- `GWCA/Source/UIMgr.cpp` and `GWCA/Source/StoCMgr.cpp` demonstrate
  pre/original/post dispatch patterns.
- `GWToolboxpp/GWToolboxdll/Widgets/ActiveQuestWidget.cpp` is the closest
  reference pattern: quest callbacks mark state dirty and the regular update
  reads canonical state.
- `GWCAjs-web-app/GWCAjs/HANDOVER.md` explicitly rejects a universal
  cross-build function-index delta.
- `GWCAjs-web-app/GWCAjs/Source/InternalCallRuntime.js` saves the slot,
  installs a separately discovered/validated build-38,615 root, supports
  nesting, and restores in `finally`. Its bounded live-tested wrappers are
  useful reference evidence for that build. They do not certify the different
  38,797 slot/root, JSPI altitude, or arbitrary UI-dispatch commands.
- `gwnative/web/enhancements.js` schedules `companion_observe` with
  `requestAnimationFrame`, and its Rust observer re-reads state each frame.
- `gwnative/src/wasm/rewrite.rs` conservatively checks prior bodies and whole
  data/element/global-prefix identities; this is good containment, not
  independent semantic recovery.

These repositories are research maps. None supplies a browser-safe production
ABI to vendor wholesale.

## The 10x offline laboratory

The dream result is not a generic mod loader. It is a compatibility compiler
and developer laboratory that makes one feature cheap to discover, prove, and
replay.

### 1. Normalized build analyzer

Given an official Wasm and glue pair, produce a deterministic model of:

- types, imports, exports, tables, elements, globals, and data segments;
- fully decoded instructions, call graph, constants, strings, and references;
- normalized CFG fingerprints;
- source/assertion anchors;
- feature locator candidates and evidence scores;
- exact transform output and validation result.

The report, not the ArenaNet binary, is the committable artifact.

### 2. Feature-level evidence compiler

Turn unique locator results into a fixed data-only certificate consumed by the
existing transform. It should generate only known fields and capability bits,
not code, hooks, or a public plugin ABI.

Example report:

```text
Build 388xx

core tick          matched    6 independent signals
UI dispatcher      matched    8 independent signals
player chat        matched    exact 3-site producer family
cursor publisher   ambiguous  2 equally plausible candidates; disabled
party events       matched    add/remove producer family
party layout       unavailable context field proof changed; disabled
hero command       absent     no safe gateway certificate exists
```

### 3. Developer event inspector

The inspector should be a development-only observer mode over the already
certified dispatcher. Record only:

- message ID;
- current engine tick/sequence ordering;
- one of 512 saturating frequency counters, plus the out-of-range aggregate;
- current lifecycle stage/map-loading boolean;
- dirty-domain bits set;
- engine-owned snapshot generation before/after;
- validation success/unavailable reason.

Never record payloads, pointers, chat content, names, accounts, packet bytes,
or renderer console text. The callback imports no clock and must not gain a JS
clock call on the game stack. The renderer can bracket action-window start/stop
with its own monotonic time outside the callback. Reset zeroes all counters;
closing discards them; persistence is an explicit developer export, never the
default. Use a bounded fixed ring only if controlled action windows prove
aggregate counts are insufficient.

Callback cost is measured with offline Wasm loops and the existing balanced
hook-off/hook-on Level 1 benchmark. Rebuild duration is measured around the
safe tick observer outside nested UI dispatch. Neither measurement requires a
new callback import.

### 4. Controlled action windows

A developer starts a quiet window, performs exactly one action, and stops it.
The report compares baseline and action without guessing:

```text
Action window: add one hero

0x1000011e x1   candidate PARTY dirty
0x10000038 x1   candidate HERO dirty
PARTY events:   2
PARTY rebuilds: 1
generation:     17 -> 18
validation:     ready
```

The first action set should cover party panel open/close, add/remove hero,
add/remove player, skill slot change, template load, attribute change,
profession change, weapon swap, equipment change, and map transition.

### 5. Privacy-safe fixture replay

Persist only synthetic or scrubbed scalar transitions:

- event IDs and relative timing;
- dirty-bit transitions;
- lifecycle/loading transitions;
- bounded canonical scalar snapshots;
- validation outcomes and generations;
- command outcomes only after a gateway exists.

Replay drives the kernel/domain reducer and renderer without launching Guild
Wars. Real pointers, packets, strings, and executable bytes never enter a
fixture.

### 6. Ideal feature workflow

```text
one controlled live action
        |
        v
identify dirty event + canonical state
        |
        v
add one bounded snapshot field/domain
        |
        v
mutation and replay suites
        |
        v
build Chromium panel offline
        |
        v
one bounded live semantic confirmation
```

That is the realistic 10x improvement. Central dispatch is already found.
Game-owned generation counters remain absent. A stable command gateway remains
the highest-upside unknown.

## Staged implementation plan

### Phase 0 — close the passive safety cutover

The passive containment suites and exact-type verification are complete
offline for ABI 6. When the operator is available,
perform one fresh-process run from the authoritative worktree only:

1. fully quit every Electron/Guild Wars process;
2. build and launch transform ABI 11;
3. confirm the verifier structurally accepts the exact Wasm type of all eight
   companion exports;
4. require the console install line to contain `companion ABI 6` and the kernel
   hash prefix;
5. enter a character and confirm normal click-to-move;
6. observe arrow/item/salvage cursor transitions;
7. receive one player chat event and confirm exactly one increment;
8. manually show and hide the first hero panel using Guild Wars controls;
9. transition maps and repeat passive observations;
10. reload once, verify a new installation without duplicate callbacks, and
   quit cleanly.

No Toolbox Show/Hide command or companion-to-game call is part of this run. The
existing cursor reconciliation may still dispatch its two bounded synthetic
mouse moves after a trusted click; record that separately from command
execution.

If any parser/signature abort reproduces, stop the semantic scenario and run
three isolation arms in fresh processes: transformed module with the hook global
disabled, passive UI/tick foundation without native cursor, and native cursor
without the developer foundation. Do not infer causality from one combined run.

### Phase 1 — build the developer event inspector

- Reuse the certified post-original UI callback.
- Add bounded per-ID counts and renderer-bracketed action-window timing, not a
  clock import or payload storage in the callback.
- Keep the surface development-only with no preload/IPC/public setting.
- Add synthetic burst, overflow, privacy, teardown, and reload tests.
- Run controlled differentials only after the passive cutover passes.

Acceptance: a quiet baseline and one-action window identify candidate IDs
without changing game behaviour or retaining sensitive data.

### Phase 2 — cut party to dirty snapshots

- Add engine-owned `PARTY_DIRTY` and publication generation.
- Split a cheap lifecycle/GameContext/player-number read from the continuous
  agent/target collector. Stop forcing target-readout collection merely because
  the developer Toolbox is enabled.
- Mark it from the candidate party union and lifecycle events.
- Rebuild the bounded party snapshot on the next certified tick only.
- At start-map-load, publish unavailable once and latch loading; do not traverse
  again until a ready event. A failed dirty rebuild likewise publishes one
  unavailable generation and clears dirty.
- Add a separately counted reconciliation no more often than once per 60 ready
  ticks until event completeness is established.
- Change the renderer to header-first generation observation and no unchanged
  DOM writes.

Acceptance: add/remove hero and player update immediately; bursts coalesce;
map transitions never expose stale party state; quiet ticks visit zero party
or agent entries except the explicit once-per-60-ticks party reconciliation;
the separately selected target readout may retain its own measured continuous
collector.

### Phase 3 — add the first build snapshot

- Model a fixed eight-slot skillbar plus professions and bounded attributes.
- Use 5e as the primary structural dirty signal, with 1d/2d..30/5f and
  lifecycle reconciliation as candidates.
- Validate agent identity, slot count, skill IDs, attribute bounds, and map
  lifecycle.
- Observe player and one owned hero before attempting team-wide state.

Acceptance: manual skill edit, template load, profession/attribute change, hero
bar change, and map transition eventually publish the coherent final state,
with at most one rebuild per tick, no publication when canonical state is
unchanged, and no quiet-state traversal.

### Phase 4 — prove cross-build recovery

- Archive the next official generation before any cache cleanup.
- Run all locators blind against both modules.
- Record recovered, ambiguous, and rejected features.
- Run the mutation suite against both normalized models.
- Promote only features whose static evidence and bounded live semantics agree.

Acceptance: both real modules are recognized or explicitly rejected; deliberate
decoys reject; synthetic relocations recover; and one failed feature leaves
independent features available. Do not claim real relocation recovery until a
real generation actually moved the relevant evidence.

### Phase 5 — investigate one safe command

Choose one low-risk, reversible action only after its natural game-owned
gateway is understood. Hero panel visibility is not automatically the first
candidate. Keep the public foundation read-only until all command-gateway
requirements above pass.

Acceptance: typed request, exact context, precondition rejection, normal-event
confirmation, no arbitrary call/memory surface, and independent disable-first
teardown.

## Acceptance criteria for the foundation

The foundation is ready to scale when all statements below are true:

- a fresh ABI 6 live run passes without parser, signature, input, or shutdown
  failure;
- party and build domains traverse only when dirty or explicitly reconciling;
- event callbacks are constant-time, bounded, and allocation-free;
- map loading performs one invalid publication and zero repeated structure
  traversals until a ready signal;
- renderer full reads and DOM writes occur only on new generations;
- map loading invalidates every pointer-backed snapshot before reuse;
- every feature has independent exact evidence and explicit dependencies;
- a structural locator rejects ambiguity and changes to mandatory evidence;
- at least two real builds demonstrate blind recognition, and a real moved
  generation is required before claiming relocation recovery;
- unknown/partial builds run the official client with only unsupported
  capabilities disabled;
- the manifest/config/cache fingerprint name the exact active capability set,
  and inactive hooks/fields are never transformed, validated, or read;
- no game command exists without its own certified execution-point/gateway
  evidence;
- all eight companion exports have exact structurally verified Wasm types, the
  panic handler cannot spin, and adversarial dispatch/pointer cases return or
  trap in bounded time without claiming exhaustive panic reachability;
- no pointer-shaped argument, packet, content string, or raw memory appears in
  the presentation, diagnostic, IPC, preload, or persisted API. The private
  installer/observer closure may hold game memory and numeric region addresses
  only for private ownership;
- one source of truth exists for certification, game state, publication
  generation, and presentation.

## Open questions

1. Do the party producers dispatch after the canonical PartyInfo mutation, and
   do they cover leader/owner reassignment without add/remove?
2. Which exact events cover a complete player and hero build change, especially
   template application and attributes?
3. Is there a natural client command queue or domain callback that safely
   drains one typed intent without fabricating `PropContext`?
4. Can a game-owned domain counter be proved across all writers, or is bounded
   reconciliation permanently required?
5. Can every enabled callback path be shown panic-free without mistaking a Wasm
   trap for runtime isolation? A trap still aborts the client, so prevention
   remains primary.
6. What is the measured callback/rebuild/renderer cost during combat, map load,
   and chat bursts?
7. If Asyncify becomes a supported runtime requirement, does it preserve JSPI
   game semantics/data layout or require independent feature evidence?

## Source index

Canonical gwonmac evidence:

- [Enhancement build certificate](../src/main/certification/enhancement-builds.ts)
- [Transform and candidate inspector](../src/main/certification/enhancement-transform.ts)
- [Passive Rust kernel](../src/companion-kernel/lib.rs)
- [Cursor dirty-domain implementation](../src/companion-kernel/cursor.rs)
- [Toolbox scalar snapshot](../src/companion-kernel/toolbox.rs)
- [Renderer installation transaction](../src/renderer/enhancements.ts)
- [Renderer snapshot validation](../src/renderer/companion-snapshot.ts)
- [Same-window Toolbox overlay](../src/renderer/toolbox-foundation.ts)
- [Build 38,797 investigation](../internal/upstream/toolbox-foundation.md)
- [Enhancement development and readiness register](../docs/enhancement-development.md)
- [Companion architecture](../docs/gwonmac-tools-wasm.md)

Reference repositories inspected offline:

```text
/Users/matthias/Git/games/GWCA
/Users/matthias/Git/games/GWToolboxpp
/Users/matthias/Git/games/GWCAjs-web-app
/Users/matthias/Git/games/temp/gwnative
```

The current GWToolbox++ `UIMessages.h` supplies names for candidate IDs. The
archived GWCA `UIMgr.h` demonstrates why those names and values are versioned
reference evidence, not unversioned truth.

## Final research conclusion

The most valuable dream discovery has partly happened: Guild Wars build 38,797
does have a broad central UI/event choke point. That is enough to replace
unconditional party/build traversal with event-invalidated canonical snapshots
and to make future feature discovery dramatically faster.

The other two dream discoveries have not happened. No domain generation counter
is certified, and no general safe command gateway exists. The correct response
is not more timing tricks or a language rewrite. It is a privacy-safe event
inspector, feature-level structural evidence, bounded reconciliation, and a
separate command research track.

This is the simplest foundation worth standing behind:

```text
certified passive hooks
  -> engine-owned dirty domains
  -> validated canonical snapshots
  -> typed generations
  -> same-renderer Chromium UI

future typed command
  -> independently certified natural game gateway
  -> normal event confirms
  -> snapshot refreshes
```

Until the command gateway exists, read-only is a feature, not a limitation.
