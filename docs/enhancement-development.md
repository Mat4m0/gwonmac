# Core and Tools development

This document gives the change procedure for certified Core features and
optional Tools.

Audience: contributors who change client transforms, companion snapshots,
read-only observation, Tools presentation, or named game commands.

This document owns the development and recertification procedure. The build
certificate in `src/main/certification/enhancement-builds.ts` owns build-local
facts. Tests own exact acceptance thresholds.

Read [WASM host and client certification](wasm-host.md) before you change the
architecture.

## Current product boundary

Core is required and has no player switch. Optional Tools are off by default.
The first enable selects a Tools-capable module and requires a restart. The
current optional features are:

- **Apply teams in Guild Wars** (Beta): allow one explicit Apply action in a
  certified PvE outpost. Build and Team authoring remains local and independent.
- **Target distance and range** (Test): show the selected target's distance and
  range band.
- **Xunlai storage**: open the normal storage UI from the Tools title bar,
  Command-Shift-C, `/chest`, or `/xunlai` in a certified PvE outpost. It has a
  separate Settings opt-in.
- **Quick Travel palette**: Command-T opens host-owned destination autocomplete
  and 1–9 shortcuts. A named, bounded Travel action reaches the certified client
  dispatcher only from the game-thread drain. It has a separate Settings opt-in.

These features then change live. Live observers and commands stop when disabled
or when map policy refuses them. Host-only authoring remains available without
observation or command authority.

## Use the cheapest proof

Use this order:

```text
pure unit or transform test
  -> synthetic companion memory
  -> deterministic presentation fixture
  -> local Electron fixture
  -> one bounded live scenario
```

Most work must finish the first four levels without an ArenaNet request. A live
run confirms semantics. It is not the first debugger.

Start with:

```bash
pnpm certification doctor
pnpm check
pnpm build
pnpm test:integration
```

`certification doctor` reads the local profile and published client. It does not
start Electron. It does not contact ArenaNet. It cannot inspect provisioned
Keychain data.

Use the visual fixture for presentation work:

```bash
pnpm enhancements:visual -- target
pnpm enhancements:visual -- map
```

The fixture is developer-only. It must not become packaged navigation or a
second production UI.

## Add or change a feature

For each field, observer, widget, or command:

1. Write the user-visible behavior.
2. Write the failure behavior.
3. Name the invariant that proves the behavior.
4. Find candidate facts with static analysis or bounded typed observation.
5. Add a build-local fact only after evidence supports it.
6. Test valid, loading, absent, corrupt, torn, and non-finite inputs as
   applicable.
7. Extend or version one bounded snapshot region.
8. Add the presentation through its domain owner.
9. Run one live scenario that changes the real value.
10. Record any remaining semantic gap in the relevant internal evidence file.

Do not add a renderer pointer chain, parallel JavaScript probe, general memory
write, arbitrary game call, raw packet export, or renderer-side copy of the
configuration order.

## Snapshot and ABI rules

Keep snapshots small and domain-specific. Add a region only when the first real
feature needs it.

Each region needs these properties:

- fixed magic and ABI version;
- fixed byte size;
- sequence value for torn-read detection;
- bounded count and capacity;
- explicit invalid and overflow states;
- no game pointer in published output.

The official WASM and build certificate remain canonical. Every derived output
must be rebuildable from them.

Do not build a speculative global game model. Use a tick snapshot for current
state. Add an event ring only when a proven user feature cannot be represented
by current state.

Keep build facts in `src/main/certification/`, capability order in `src/shared/`,
bounded reads in `src/companion-kernel/`, presentation in its renderer domain,
and Team Apply policy in `src/shared/builds/`. The installer owns installation,
not domain rules. Do not move rules into preload, IPC, or a generic bridge.

## Live scenarios

Live scenarios use the normal Guild Wars profile. They are opt-in because they
can contact ArenaNet and can use a real account.

Run one named scenario with:

```bash
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario <name>
```

The scenario registry in `scripts/enhancements-live/scenarios.ts` is the source
of valid names and their acceptance rules.

Use the narrowest scenario. Examples include boot, target readout, movement,
reload, map transition, cursor capture, Tools foundation, and the paired
performance run.

The default live run is cached-only. It cannot fetch a missing ArenaNet chunk
or update the official client. Add `--allow-update` only when you deliberately
want the run to update game data.

Use `--leave-open` only for human inspection. A failure or timeout already
leaves Electron open and writes bounded output under
`test-results/enhancements-live/`.

The harness uses the normal profile and reads structured renderer state through
a random loopback endpoint. An observation scenario gets only a fixed typed
projection. An automation scenario can get trusted input and the bounded parent
channel in an unpackaged build.

Automation permission does not select a feature. A fixed developer program does.
Packaged builds refuse every developer program.

Do not change account or product controls to make a scenario pass. A two-factor,
legal, captcha, or unexpected login screen remains a human boundary.

A live evidence file must not contain game-memory addresses, raw pixels, raw
packets, account fields, or chat. Store the typed scalar result only.

## Performance changes

Use the mirrored Level 1 benchmark for a new hook, observer, snapshot, or render
path. It must prove zero off-arm hooks and expected on-arm cadence. The scenario
definition owns duration, samples, and limits.

Follow the measurement rules in [Diagnostics and performance](diagnostics.md).
Use a clean Level 1 capture for acceptance. Use Level 2 only to locate a cause.

## Cursor changes

The cursor path is shipped Core. Treat it as product code.

The internal evidence proves that the official client already decodes the
cursor, that the host must convert BGRA to RGBA, and that an art pointer is not a
stable identity. The implementation uses bounded pixel content and a Retina
cursor candidate.

Do not reintroduce an artwork bundle, remote cursor download, user size setting,
or parallel JavaScript decoder. Read the internal cursor evidence before you
change these rules.

## Command changes

A command must be a named domain action with typed arguments. It must run at a
certified game-owned safe point.

Every command needs:

- positive map and lifecycle preconditions;
- explicit rate and sequence limits;
- cancellation when policy changes;
- confirmation against observed state;
- an explicit refusal or failure result;
- a live account scenario for the claimed semantic effect.

Never expose `writeMemory`, `callFunction`, `sendPacket`, a generic opcode, or a
general address courier.

The companion kernel stays read-only. Command construction stays in the named
domain outside the kernel.

## Recertify an ArenaNet client

Start from the exact official artifact that triggered the compatibility notice.
Do not clear the downloaded game data: the unsupported artifact and the
retained preceding artifact are the most useful migration evidence.

Run the bounded chain in order:

```bash
pnpm certification doctor
pnpm certification template "/absolute/path/Gw.jspi.wasm" --emit-ts
pnpm certification recertify "/absolute/path/Gw.jspi.wasm"
```

The tool first selects or derives file compatibility. It then inspects that
output as the Core and Tools candidate. The transforms are not alternatives.

If the template report derives one unambiguous entry, review it and write it:

```bash
pnpm certification template "/absolute/path/Gw.jspi.wasm" --write
```

Then add one complete exact-build Enhancement entry. Do not make a new build
inherit addresses from the preceding build. Compare the old and new modules
and record which function bodies, signatures, table slots, data roots and
message anchors stayed exact. Recompute every capability output; a copied hash
is not evidence.

Finish the downstream chain only after the Enhancement entry exists:

```bash
pnpm certification recertify "/absolute/path/Gw.jspi.wasm"
pnpm certification double-click "/absolute/path/Gw.jspi.wasm"
pnpm check
```

`recertify` must report `bundleVerified: true`, `double-click` must report
`matchesShippedTable: true`, and `doctor` must name the new build before a live
run. Native double-click and extended-memory tables are cumulative: add every
profile emitted by the capability registry without removing the preceding
build.

Each recovered fact needs an independent semantic anchor. A common movement is
not enough. Automated candidates are review evidence and cannot create runtime
authority.

Recertification requires exact identities, signatures, caller semantics,
original-call preservation, table and allocation invariants, positive and
negative layout evidence, lifecycle clearing, offline tests, clean teardown,
and one bounded live semantic check per changed domain.

For Xunlai storage, run `pnpm enhancements:live xunlai-storage` from a supported
PvE outpost. The scenario exercises the same named action as the Tools button
and keyboard shortcut twice. Also enter `/chest`, `/xunlai`, and one near miss
such as `/storage`; the first two must be consumed locally and the near miss
must remain a normal Guild Wars command. Record the slash-parser and DataWindow
handler indices, signatures, body hashes, and game-thread drain evidence in the
new certificate. Do not infer them from the preceding build.

Party certification must prove the complete owned roster, player and hero
professions, hero unlocks, behaviour, skill bars, and attributes. Proving only
the hero count or first hero is not enough for Apply team. Each optional party
detail table is an independent observation: a rejected detail table must erase
only its own facts and must never erase the verified roster or another valid
detail group.

The scheduled recertification workflow already detects a new ArenaNet
generation, downloads and verifies its code artifacts, derives the template
entry, and publishes `enhancement.json` as review evidence. It deliberately
does not write Enhancement memory addresses or command facts. Those values can
affect a running game and still need a human review plus bounded live evidence.
Automation should shorten that review; it must not turn a matching index into
runtime authority.

When evidence is incomplete, add no certificate. The verified official client
must remain playable.

## Done criteria

A Core or Tools change is done when all applicable statements are true:

- one source owns every new build-local fact;
- invalid and loading state cannot publish stale data;
- disabled behavior stops its observer or command path;
- no raw pointer, packet, secret, or memory view crosses IPC;
- cached startup performs no transform or network request;
- the required offline layers pass;
- one bounded live scenario proves the real semantic change;
- performance remains within the code-owned budget;
- shutdown has no trap, rejection, unknown socket, or orphan process;
- the unsupported-build path remains playable;
- the internal evidence records any costly fact that a future contributor must
  not rediscover.

Stop when these criteria pass. Do not add a framework for a future feature.
