# Hero and build automation investigation

This is the evidence record for discovering the smallest Guild Wars client
primitives needed to apply one saved team. It is research, not a runtime
contract. Every index below belongs only to official build 38,771,
`b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483`.

## Intended operation

One explicit **Apply** action should eventually:

1. reconcile the current party with the requested heroes;
2. apply the player's skill template;
3. apply each present hero's skill template;
4. apply per-skill enabled/disabled state and hero behavior;
5. stop on the first rejected or timed-out game operation and report it.

This does not imply a generic function-call bridge. The production feature
should expose one checked domain command, remain unavailable in PvP maps and
lobbies, require a foreground user action, and never retry indefinitely.

## Fast feedback loop

Use one controlled action per live run:

```text
static anchor and call graph
  -> breakpoint candidate entries
  -> perform one action by hand
  -> compare the hit and scalar arguments
  -> repeat with one changed input
  -> only then probe a narrowly exported pure function or add a domain command
```

Do not start with memory-access logging. Normal gameplay touches too much
linear memory for that signal to be useful. Function-entry differentials give
faster attribution and do not require dumping memory.

### Offline report

`tools/wasmscan.py --functions … --json` reports signatures, body hashes, direct
callers/callees, and table slots. On the certified artifact:

| Function | Signature          | Body SHA-256    | Direct evidence                                              |
| -------- | ------------------ | --------------- | ------------------------------------------------------------ |
| 16592    | `(i32) -> ()`      | `42ccd0fc…68ec` | called by 16591, 16605, 16607, 16609; calls 16594–16596      |
| 16959    | `(i32, i32) -> ()` | `ae996242…8dc6` | called by 16948 and 16988; calls 16960                       |
| 16988    | `(i32) -> ()`      | `36865754…c318` | calls template helpers 16956, 16957, 16959                   |
| 16989    | `(i32) -> ()`      | `20bd6cb5…d56`  | calls template helpers 16955, 16958, 16960                   |
| 17507    | `(i32) -> i32`     | `7c874c7e…bde8` | small shared lookup; called from party-region function 16637 |

The report completed all 17,600 bodies with zero decode failures. These rows
identify neighborhoods; they do not yet prove names or semantics.

### Live observation

The `hero-trace` scenario uses Chromium's WASM debugger support. It translates
a global function index to a bytecode body offset using:

```text
local function index = global function index - function import count
body offset = functionBodyOffsets[local function index * 2]
```

It then sets entry breakpoints for at most 16 explicit candidates. A scenario
receives only the bounded observer—not Playwright input, the raw CDP session,
or the parent IPC command channel. Evidence is capped at 128 hits and contains
only the candidate index, scalar WASM locals, and eight stack function names.

Run template candidates first:

```bash
GW_LIVE_SMOKE=1 pnpm enhancements:live -- \
  --scenario hero-trace \
  --break-functions 16959,16988,16989
```

During the prompt, manually load exactly one player build. Repeat separately
for one hero build. A candidate that fires in both runs needs an argument
differential before it can be classified.

For party discovery, begin with the `PtSearch`-anchored neighborhood:

```bash
GW_LIVE_SMOKE=1 pnpm enhancements:live -- \
  --scenario hero-trace \
  --break-functions 16591,16592,16594,16595,16596,16605,16607,16609
```

Run **add one hero**, **kick that hero**, and **kick all heroes** separately.
Never combine them in one capture.

## Live results

### Kick one hero, party batch A

The first controlled kick trace observed zero hits for:

```text
16591, 16592, 16594, 16595, 16596, 16605, 16607, 16609
```

This rules those entries out as the direct kick path for this UI action. It
does not prove they are unrelated to party presentation or other party events.
The next batch is the message-handler cluster rooted at 16659:

```text
16652–16665, 16667, 16668
```

### Kick one hero, party batch B

The second controlled kick trace also observed zero hits for the full batch
above. That rules out this adjacent message-handler cluster as the direct kick
path.

GWCA provides a stronger locator than the broad `PtSearch.cpp` path:

```text
assertion: m_activeList == LIST_HEROES
source:    p:\code\gw\ui\game\party\ptsearch.cpp
```

On build 38,771 that exact assertion resolves to function 16607. GWCA derives
`AddHero_Func`, `AddHenchman_Func`, `KickHero_Func`, and `KickHenchman_Func`
from four calls inside the corresponding native function. It also establishes
that all four take one `uint32`, and that `KickAllHeroes()` is exactly
`KickHero(0x26)`.

The manual party-window kick does not execute 16607 itself, but its leaf call
set gives a much smaller primitive batch for the next trace:

```text
10581, 10585, 10607, 10609–10614, 10792, 11090
```

### Kick one hero, primitive batch C

Only function 11090 fired. It is `(i32, i32) -> ()`, has 45 unrelated direct
callers, and the kick-time calls arrived through the party-window refresh
stack rooted at 16521/16522. The second argument was `0`. This is a UI
enable/disable update after party state changed, not the outbound kick
primitive.

The browser socket boundary is an Emscripten `EM_ASM` block identified by
constant `2657187`. Exactly two defined WASM functions reference that block:
1079 and 1088. Breaking on those entries records the outbound call stack and
scalar length without reading the buffer. A controlled idle-versus-kick
differential at this boundary is the next experiment.

### Outbound and hero-row traces

The outbound trace showed that game sends reach 1088 through the shared
`15740 -> 15737` transport path. The queue no longer retains the originating
party action in its stack, so packet length and timing are insufficient to name
the command. No packet bytes were read.

The `PtHero.cpp` path resolves to 16516 and 16520, under callback 16521/16522.
A controlled kick produced a large burst through that cluster only after the
party changed. Those functions rebuild and refresh hero rows; they are useful
acknowledgement evidence, not the request primitive.

### Native-offset mapping does not transfer to WASM

The exact GWCA assertion occurs inside WASM function 16607, but GWCA's native
near-call offsets cannot be projected onto the WASM callback by call order.
That method initially suggested `10614` as `KickHero`. A live developer probe
disproved the important part of that hypothesis:

```text
10614(0x26)
  -> 228(19)
  -> ASSERTION FAILED: s_propContext
     EmscriptenExeProp.cpp:32
```

No party operation was sent. The client aborted before the candidate reached
its inner path. The probe was removed rather than retained as a dangerous
second route.

Static decoding explains the failure. Functions `10611` and `10614` are
byte-identical property wrappers:

```text
context = getPropertyContext(19)
collection = context + 156
10749(collection, suppliedInteger)
```

`10749` bounds-checks the integer against a collection, rejects an empty slot,
and calls `10640(integer)`. Function `10640` constructs internal command `172`
and submits it through `10340 -> 5948`. This proves a context-dependent indexed
command path; it does **not** prove that command 172 means kick hero.

The assertion is expected when a property wrapper is invoked from an arbitrary
JavaScript callback: Emscripten's property context is established only around
the owning game callback. The wrapper might still participate in the desired
action in its valid context, but it is not a standalone primitive and is not a
safe export.

Source strings also identify a `PyCliParty.cpp` cluster (`10656`, `10657`,
`10661`, `10705`–`10718`). Those functions are binding and argument-validation
code, not yet evidence of a public JavaScript party API. The next offline step
is to trace their direct callers and the game-owned callback that establishes
property context before any further live invocation.

The controlled differential has now been run with breakpoints on `10640`,
`10641`, and the known party-refresh controls `16521`/`16522`. During one
ordinary party-window kick, the refresh controls fired and exhausted the
bounded observer, while `10640` and `10641` recorded zero hits. This confirms
the action occurred inside the capture window and rejects the property-wrapper
path as the normal kick request. Command 172/173 must remain unnamed.

### Proven kick path

A focused passive trace on `9159` and `9160` produced the decisive request:

```text
9160(38)
  <- 16729
  <- 16337
  <- party selection callback
```

The later `9159(38)` arrived through `16528`, the hero-row reconciliation path.
Static decoding names the boundary more precisely:

- `9160` is in `ChCliApi.cpp`, accepts one hero id, checks the active property
  context through `9512`, then calls `6884(heroId)`;
- `6884` creates game UI message 31 and submits it through `10340 -> 5948`;
- the party callback also calls `9160(40)`, establishing 40 as this build's
  kick-all sentinel.

Exporting `9160` and calling it from JavaScript reproduced the
`s_propContext` assertion. It is the correct game-owned entry but not a valid
cross-boundary API. Exporting the context-free inner dispatcher `6884` through
the normal certified Enhancement transform succeeded:

```text
scenario: hero-kick-all-probe
build:    38771
map:      outpost
action:   enhancement_hero_kick(40)
result:   [6] -> [], no renderer error, clean shutdown
```

The transform validates the inner function's `(i32) -> ()` signature and stores
the sentinel in the exact-build manifest. The callable method exists only when
the developer-only automation gate is active; packaged builds cannot enable
that gate. There is no arbitrary function bridge, memory write, packet
construction, or reload-time module substitution.

The companion kernel now owns a second fixed-size snapshot containing only
HeroID/AgentID pairs owned by the current player. It walks the certified
`GameContext -> PartyContext -> PartyInfo -> heroes` path, validates every
pointer, array bound, owner, HeroID, live AgentID, and duplicate, and publishes
at most seven pairs through the same sequence-lock discipline as the core
snapshot. Renderer code cannot request arbitrary addresses. The pair is the
identity bridge a team command needs: HeroID 6 selects Koss for add/kick,
whereas Koss's current AgentID targets his skill bar.

That snapshot closed the acceptance gap:

```text
add Koss:       []  -> [6] through dispatcher 6883
kick Koss:      [6] -> []  through dispatcher 6884 with HeroID 6
kick all:       [6] -> []  through dispatcher 6884 with sentinel 40
```

All three build-38,771 runs completed in outpost map 449 with no renderer
errors and a clean shutdown.

The add primitive came from the same static shape:

```text
9159(heroId)
  -> property-context validation
  -> 6883(heroId), internal message 30

9160(heroId)
  -> property-context validation
  -> 6884(heroId), internal message 31
```

Both JavaScript-facing development methods restore the skipped wrapper
invariant by accepting only integer HeroIDs 1–39. Kick-all is a separate method
whose argument comes only from the exact-build manifest.

### Property-context classifier

`wasmscan.py` now derives the property-context roots from functions that
reference the client's `s_propContext` assertion, marks all transitive callers
as context-bound, and reports the first context-free defined callees below a
requested wrapper. On build 38,771 it finds roots 228 and 229 and conservatively
marks 5,341 functions. Its report identifies:

```text
9159: bound, context-free frontier includes 6883
9160: bound, context-free frontier includes 6884
6883: context-free
6884: context-free
```

This classification is a rejection aid, not semantic proof. A frontier may
contain validation, allocation, or presentation helpers; one controlled live
state transition is still required before a function can be certified as a
domain primitive.

### Template application

Two controlled captures now establish both sides of template application.
Loading one saved template through the normal UI reached `16959` and then the
same two inner request functions:

```text
player (live AgentID 616):
  16959(616, template)
    -> 9134(616, 3, attribute_ids, attribute_values)
      -> 7172(context, 616, 3, attribute_ids, attribute_values)
        -> 6870(616, 3, attribute_ids, attribute_values)
    -> 9268(616, 8, skill_ids)
      -> 8706(context, 616, 8, skill_ids)
        -> 6940(616, 8, skill_ids)

Koss (HeroID 6, live AgentID 88):
  16959(88, template)
    -> 9134(88, 2, attribute_ids, attribute_values)
      -> 7172(context, 88, 2, attribute_ids, attribute_values)
        -> 6870(88, 2, attribute_ids, attribute_values)
    -> 9268(88, 8, skill_ids)
      -> 8706(context, 88, 8, skill_ids)
        -> 6940(88, 8, skill_ids)
```

`16959`, `9134`, `7172`, `9268`, and `8706` are property-context-bound.
`6870` and `6940` are context-free and construct the internal attribute and
skill-bar requests respectively. This is stronger than inferring them from
strings: the debugger recorded their exact arguments under a real player load
and a real Koss load, and both normal UI actions visibly changed the requested
bars.

The 140-byte template structure passed to `16959` is:

```text
+0    primary profession
+4    secondary profession
+8    attribute count
+12   12 attribute ids
+60   12 attribute ranks
+108  8 skill ids
```

The operator-paced mapping session then changed Koss's secondary profession
three times while his live AgentID remained 183:

```text
9276(183, 3) -> 6914(183, 3)
9276(183, 5) -> 6914(183, 5)
9276(183, 6) -> 6914(183, 6)
```

This confirms that `6914(agentId, professionId)` is the context-free secondary
profession request. The values are canonical profession IDs, not UI indexes.

The kernel now publishes current professions, attributes, skill IDs, behavior,
and the disabled-skill mask keyed by live AgentID. That readback can acknowledge
an individual request. It is not, however, a canonical skill-template
serialization: the client's party-attribute rows may retain profession entries
that the template validator would reject if replayed.

Calling `16959` requires the property context used by the normal UI path.
Function `228` reads the context pointer at `0x28cb60`. The first synthetic
experiment populated only slot 11 with the shared manager at `0xe2cae0`. It
reached the official
`TemplatesSkillsCanApply(targetAgentId, templateData, NULL)` assertion but the
predicate rejected both the guessed payload and a snapshot-derived restore.
No request was issued.

A bounded normal WMO-to-Koss capture then recorded the complete inputs:

```text
template:
  primary=1, secondary=0
  attributes=[17:1, 19:2, 21:1]
  skills=[322, 382, 348, 1, 385, 2, 0, 0]

property context:
  [14860776, 14860800, 14832272, 14860840,
   0, 99523464, 14832784, 0,
   30, 14862536, 14862560, 14863120]
```

This proves that the real context is not a one-slot structure. A separate
read-only probe sampled `s_propContext` before and after 2,318 invocations of
the current hooked main-loop tick; both were always zero. The legitimate
context exists only inside narrower client callbacks, not at the kernel's
current invocation point.

The forged-context experiment was therefore deleted. The transformed module no
longer exports `16959` or `16960`, and the renderer no longer writes
`s_propContext` or synthesizes the coordinator template. Captured addresses and
words remain investigation evidence only.

### Operator-paced mapping session

`enhancements:live -- --scenario hero-map` keeps one certified client open and
mounts a small development-only checklist over the game. Each row:

1. installs only the 2–7 WASM entry breakpoints relevant to that action;
2. asks the operator for exactly one normal UI action;
3. stops its own trace when the operator clicks **Done** or **Skip**;
4. records party identity before and after;
5. writes one combined owner-only report to
   `test-results/enhancements-live/hero-mapping.json`.

Each function self-disarms after 16 hits.

The overlay never performs the game action. **Finish session** stops the
remaining checklist. The first eight-step run completed without renderer
errors or a restart. It proved secondary profession, but the initial behavior
and skill-toggle candidate set missed their request functions; the next pass
observed the bounded internal request boundary and identified the exact paths:

- hero behavior: `9147(agentId, behavior) -> 6875(agentId, behavior)`;
- hero skill enable/disable:
  `9150(agentId, slotOrFlag) -> 6878(agentId, slotOrFlag)`.

Both inner functions are context-free `(i32, i32) -> ()` request builders. A
second scoped pass observed only each wrapper/inner pair. Koss's live AgentID
was 701:

```text
Fight:        9147(701, 0) -> 6875(701, 0)
Guard:        9147(701, 1) -> 6875(701, 1)
Avoid Combat: 9147(701, 2) -> 6875(701, 2)

disable slot 1: 9150(701, 0) -> 6878(701, 0)
enable slot 1:  9150(701, 0) -> 6878(701, 0)
```

`6875(agentId, behavior)` is therefore the context-free behavior request, with
the stable values Fight = 0, Guard = 1, and Avoid Combat = 2.
`6878(agentId, zeroBasedSlot)` is a toggle, not a setter. Reconciliation must
read the disabled-skill mask first and call it only for mismatched slots;
blindly replaying it would invert already-correct state.

## Language and tooling decision

- Python remains the offline analysis tool. The existing decoder processes the
  certified module in about a second and now owns the static report.
- TypeScript owns live discovery because Electron already exposes the exact CDP
  session and the live harness already enforces observation versus automation.
- The existing TypeScript WASM codec remains the one production parser and
  rewrite path.
- Rust remains appropriate for the checked runtime state machine once the
  primitives are proven. Adding a second Rust WASM parser now would duplicate
  the canonical codec without improving the discovery loop.
- Ghidra is the manual fallback for a candidate whose calls and live arguments
  remain ambiguous.

## Certified map policy

There are two different kinds of map data in the WASM client:

- Map assets such as terrain, models, and textures live in the virtual
  `Gw.snapshot`. GWonMac stores that 4,200,311,296-byte image as 16,023
  content-addressed 256 KiB files beneath
  `~/Library/Application Support/Guild Wars/game/chunks/`. The ordered
  `chunkHashes` in `artifacts/manifest.json` reconstruct the image. A chunk is
  not a map file and the manifest does not map a MapID to a filename.
- Map policy metadata lives in the official `Gw.jspi.wasm`. Its data segments
  initialize a fixed-stride `AreaInfo[888]` table in WASM linear memory. This
  is the useful source for deciding whether a team-management command is
  allowed; decoding map geometry from the snapshot would add complexity and
  would not provide a better policy signal.

GWToolbox does not maintain a PvP map-id list. Its global disable check obtains
the current `AreaInfo` and returns true when either:

```text
flags & 0x40001 != 0  // PvP
flags & 0x800000 != 0 // Guild Hall
```

GWCA's Windows implementation locates the client-owned contiguous
`AreaInfo[]`; `GetMapInfo(id)` returns `base + id * 124`, and `flags` is the
32-bit word at record offset `0x10`.

The same accessor exists in official WASM build 38,771:

```text
function:   17521
signature:  (i32) -> i32
body bytes: 47
body hash:  bc69470755b6d1b14f4ac94f7f92e5e812d5bde1f8988a4afa33919e530d7554
semantics:  assert mapId < 888
            return 0x1cc570 + mapId * 124
```

It is context-free and has no state mutation. The exact input WASM hash gates
the build manifest, which now carries `areaInfoBase = 0x1cc570`. The kernel
does not call the accessor: it performs the same checked address calculation,
reads only the flags word, and fails closed if the map id or memory range is
invalid. It separately requires `instanceType == Outpost`.

Offline decoding of the official table corroborates the policy across both
ordinary and prohibited areas:

| Map | ID | Flags | Result |
| --- | ---: | ---: | --- |
| Ruins of Surmia | 30 | `0x00020104` | non-PvP |
| Ascalon City | 81 | `0x00000000` | non-PvP |
| Kamadan | 449 | `0x00008000` | non-PvP |
| Random Arenas lobby | 188 | `0x040c0003` | PvP |
| Fort Aspenwood mission | 221 | `0x04040300` | PvP |
| Fort Aspenwood lobbies | 293/294 | `0x040c2100` | PvP |
| Heroes' Ascent lobby | 330 | `0x04041001` | PvP |
| Isle of the Nameless (PvP) | 784 | `0x00040000` | PvP |
| Codex Arena lobby | 796 | `0x04040003` | PvP |
| Warrior's Isle Guild Hall | 4 | `0x00800000` | Guild Hall |

The important property is that competitive lobbies already carry the PvP
mask. No application-maintained map list is needed, and a future official
client update receives no Enhancement support until its new table location and
semantics are re-certified.

## What is still unknown

- Whether a future, stable callback inside a legitimate property-context scope
  is worth certifying; it is not required for the chosen context-free path.
- Whether a separate PvP-character bit should be added as defense in depth.
  It is not needed for the map policy: the official map flags already classify
  competitive maps and lobbies, while the command also requires an outpost.

Production exposes one checked `applyTeam` command behind the off-by-default
team-management setting. The Rust kernel owns the PvE-outpost policy gate,
bounded one-command-at-a-time reconciliation, timeout/failure behavior, and
checked readback. Raw roster/build dispatchers are not product features.

## First single-hero reconciler

The first coordinator now lives in the Rust tick kernel rather than in the
renderer. Its command contains a stable HeroID and one immutable desired build.
On every tick it re-joins that HeroID to the current owned roster and uses the
AgentID from that same snapshot. It then:

1. requires an outpost and refuses official map metadata marked PvP or Guild
   Hall;
2. verifies the hero is still owned and its primary profession is unchanged;
3. skips an already-matching secondary profession;
4. otherwise requests the secondary and waits for matching profession
   readback;
5. repeats the same request/wait pattern for attributes, skills, and behavior;
6. reconciles the disabled-skill mask one mismatched slot at a time, waiting
   for each toggle before considering another slot;
7. publishes one sequence-locked progress record with command id, phase,
   completed-step count, and a closed error code.

There is at most one request per tick and no retry. An acknowledgement that
does not arrive within 300 game ticks is a hard failure. Hero removal, map
change, missing game state, or a changed primary profession also stops the
command before another request is issued.

The development live proof is:

```sh
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario hero-build-reconcile
```

It selects the first owned hero in any outpost accepted by the certified
official-map classifier, changes one already-valid attribute rank, swaps two
existing skills, changes behavior, and toggles one disabled-skill bit. It waits
for all five field groups, then submits the original state through the same
coordinator and requires exact restoration. The profession phase is skipped
when already correct; its mutation and acknowledgement path is covered by the
controlled kernel fixture.

This was the first development proof. The product boundary now resolves the
stored team once through the canonical assignment validator before constructing
an immutable kernel plan; the renderer does not own build legality.

### First live proof: Devona

Build 38,771 completed the reversible scenario in post-Searing Ascalon City
(map 81) with Devona (HeroID 38):

```text
initial:
  attributes: [17:4, 19:9, 21:4, 8:8]
  skills:     [1, 351, 356, 357, 354, 2, 316, 371]

command 1:
  attributes: [17:3, 19:9, 21:4, 8:8]
  skills:     [351, 1, 356, 357, 354, 2, 316, 371]
  result:     complete, phase 7, 3/3 acknowledged

command 2:
  exact initial attributes and skills restored
  result: complete, phase 7, 3/3 acknowledged
```

The run recorded zero rejected snapshots, zero renderer errors, no WASM
assertion, and a clean shutdown. Both commands resolved a fresh live AgentID
for Devona; the AgentID changed between the preflight inspection and the
restarted proof, demonstrating why HeroID rather than a cached AgentID owns the
command identity.

That first proof covered the three build fields. Behavior and disabled skills
are now part of the same command, not separate renderer methods. Offline
fixtures prove exact behavior acknowledgement, multi-bit disabled-mask
reconciliation, skip behavior, timeout without retry, and complete progress at
the corresponding acknowledged phases.

Difficulty and panel state are mapped as well. Context-free dispatcher 6885
sets normal or hard mode, and `PartyContext` flag `0x10` provides authoritative
readback before reconciliation continues. Panel visibility is local
presentation state rather than server-owned build state: the transform exposes
a scoped wrapper over `SendUIMessage` function 6839 that can emit only
`HideHeroPanel` (`0x100001a3`) or `ShowHeroPanel` (`0x100001a4`) for a checked
HeroID. It does not expose the generic UI-message dispatcher.

## Authoritative preflight

The coordinator now performs one complete read-only preflight in
`PHASE_ROSTER_REMOVE` before it can call even the first roster dispatcher. The
certified-build layout follows the same client structures used by GWCA and
Toolbox:

| Fact | Exact-build source |
| --- | --- |
| Existing party size | `PartyInfo.players` (`+0x04`, stride `0x0c`), `henchmen` (`+0x14`, stride `0x34`), and `heroes` (`+0x24`, stride `0x18`) |
| Active hero level | `HeroPartyMember +0x14` |
| Available hero, level, primary | `WorldContext.hero_info` at `+0x594`, `HeroInfo` stride `0x9c`, fields `+0x00`, `+0x08`, and `+0x0c` |
| Player level | `AgentLiving +0x110` |
| Current capacity | certified `AreaInfo` table, record `+0x1c` |

The preflight computes the eventual party size from every current member,
including other players, their heroes, and henchmen. It rejects before mutation
when the requested party exceeds the official map limit, a selected standard
HeroID has no `hero_info` record, a low-level build exceeds its proven
attribute budget or changes secondary profession, or the requested primary
profession disagrees with the authoritative record. The low-level budget uses
the game's level progression and hero bonuses at levels 10 and 15. A live
allocation accepted by Guild Wars is stronger evidence and raises the retained
per-HeroID budget for the session, so applying a cheaper build cannot prevent
restoring the original.

Toolbox distinguishes an assigned mercenary slot using its appearance and
character name. GWonMac's boundary intentionally exports neither names nor
appearance. An already-present mercenary is therefore accepted as authoritative
evidence; an absent mercenary fails closed. Account skill unlocks also remain
outside the preflight. The server/client acknowledgement is authoritative, so
an unavailable skill produces a hard timeout with no retry and no continuation.

The integration acceptance test corrupts each prerequisite independently and
asserts both the closed error and a game-dispatch count of zero. This is the
important proof: it is not merely a more descriptive failure after a hero has
already been removed.

## Shared-memory relocation and current live certification

The companion imports Guild Wars' memory. Rust's default WebAssembly link
layout placed both its stack and active data segment at 1 MiB, which is already
live client memory. The small earlier kernel happened not to expose the
collision; the larger team coordinator produced a uniform pink frame before
the game could render. Moving only `__stack_pointer` was insufficient because
the active data segment is copied during module instantiation.

The build now retains LLVM's `reloc.CODE` and `reloc.DATA` records. The renderer
allocates the 828-byte data image (plus alignment) from the game heap before
instantiation and applies exactly the 36 signed-LEB code relocations and 30
little-endian data relocations emitted by the linker. It separately allocates
the Rust stack and the 1,836-byte mutable `KernelState`. Unknown memory
relocation forms fail closed. The regression test fills the former 1 MiB
region with a sentinel, instantiates the relocated production kernel, and
requires every sentinel byte to survive.

The cached build-38,771 live readback subsequently reached map 81 as a PvE
outpost and published the player plus Devona (HeroID 38) with professions,
attributes, eight skills, behavior, and disabled-skill mask. It recorded zero
rejected snapshots and zero renderer errors.

The same account has low-level members. The first conservative build
round-trip was rejected by the former level-20 preflight with error 8, phase 1,
zero acknowledged steps and—by construction—zero game calls. The
level-independent roster proof then completed:

```text
remove Devona: command 1, complete, 2 acknowledged steps, error 0
restore Devona: command 2, complete, 4 acknowledged steps, error 0
```

Readback contained no hero between the two commands and HeroID 38 after the
second. The session shut down cleanly.

After replacing the blanket restriction with the level-aware, retained-proof
budget, low-level Devona completed the reversible build proof. Command 1 and
command 2 each acknowledged six steps: attribute allocation, skill order,
behavior, and disabled-skill mask changed and then returned to the exact
initial state. Both completed with error 0; the run recorded zero rejected
snapshots, zero renderer errors, and a clean shutdown.
