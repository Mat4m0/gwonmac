# Core and Tools development

This document gives the change procedure for certified Core features and
optional Tools.

Audience: contributors who change client transforms, companion snapshots,
read-only observation, Tools presentation, or named game commands.

This document owns the feature-development procedure. The local semantic
verifier owns runtime proof. Exact build records are regression expectations.
Tests own exact acceptance thresholds.

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
  separate Settings opt-in and requires a live snapshot that proves the current
  character can access storage. It does not depend on party observation.
- **Quick Travel palette**: Command-T or `/tp` opens host-owned destination
  autocomplete and 1–9 shortcuts. A named, bounded Travel action reaches the
  certified client dispatcher only from the game-thread drain. It has a separate
  Settings opt-in.

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
pnpm run check
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

## Live Tools feedback loop

Use an unpackaged development launch when a named action behaves differently
in the real client. Open the renderer console and keep only lines beginning
with `[tools:dev]`. These events are bounded scalar evidence; they do not log
character names, account data, chat, packet bytes, or Travel search text.

- Xunlai emits `storage.availability`, `storage.configured`, and then either
  `storage.queued` or `storage.refused`. A refusal includes the policy state and
  the tri-state access result that caused the Controls fallback. The certified
  player-record readers index their array by the live login/player number;
  record zero is not a valid shortcut for a real character. Each request also
  has a session-local sequence and elapsed time since the preceding request, so
  an accidental double-open is visible without logging an account identifier.
- Team Apply first emits `command` when the renderer queues an opcode. The
  `team command trace` then reports `drain.count` and `drain.opcode` when the
  certified game-thread boundary consumes it. Builder and sender counters show
  the next boundary reached. This separates queue, drain, builder, sender, and
  observer-confirmation failures.
  Ordinary live publications have been observed just beyond one second, so
  their confirmation window is two seconds. Profession and skill transitions
  retain their feature-specific stability and retry windows.
- Travel emits `travel.search` with query length, token count, catalogue size,
  result count, and bounded result map IDs. It never includes the query itself.
  `travel.queued` or `travel.refused` then identifies the named command result.
  Search covers the reviewed 199-destination direct-travel catalogue. A zero
  result means the query did not match that catalogue; passage-scroll locations
  such as Urgoz's Warren and The Deep intentionally use their original UI.

For a report, reproduce one operation at a time and copy the lines from its
first request through its final success, refusal, or timeout. Also record the
visible map/outpost and whether the character should have Xunlai access. Do not
paste the complete console or account/login screens.

For an input or Xunlai interaction failure, also open
**Help → Diagnostics → Show Input Trace**. Clear it, then open Xunlai once,
close the native storage window with Escape, click empty ground, hold both
mouse buttons briefly, and interact with one merchant. Pause and copy the
trace. Pointer rows name only `canvas`, `surface`, `text`, `secret`, or `other`.
`canvas` proves the event reached Guild Wars; it does not prove the client
accepted the world action. This distinction separates a hidden GWonMac surface
from a stuck native game UI state without copying coordinates or UI text.
For a keyboard shortcut, every `modifier down` must have either a matching
`modifier up` or an `input released (command)` row before the named action.
Command-Shift-C deliberately resets held game input before it opens Xunlai,
because macOS can consume a physical modifier release while Command is held.

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

The official WASM remains canonical. Feature certificates and transformed
outputs are derived from those bytes and the verifier ABI and must be
rebuildable.

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

Use `pnpm graphics:live` for an operator-driven visual investigation. It uses
the observation tier with no developer Enhancement program. Press Enter to
save a screenshot and its bounded numeric state. The diagnostics document owns
the [privacy boundary and procedure](diagnostics.md#live-graphics-investigation).

The harness uses the normal profile and reads structured renderer state through
a random loopback endpoint. An observation scenario gets only a fixed typed
projection. An automation scenario can get trusted input and the bounded parent
channel in an unpackaged build.

Automation permission does not select a feature. A fixed developer program does.
Packaged builds refuse every developer program.

Do not change account or product controls to make a scenario pass. A two-factor,
legal, captcha, or unexpected login screen remains a human boundary.

Ordinary Enhancement live evidence must not contain game-memory addresses, raw
pixels, raw packets, account fields, or chat. Store the typed scalar result
only. The sole exception is the local, operator-consented graphics probe. Its
screenshot is stored separately under `test-results/` and follows the
[graphics investigation privacy rules](diagnostics.md#live-graphics-investigation).

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

Read and follow the [ArenaNet compatibility patch-day playbook](arenanet-compatibility.md#patch-day-playbook).
Routine equivalent rebuilds must pass locally without a source change. Use the
commands below to investigate a refusal, not to publish a new hash allowlist.

Run the bounded chain in order:

```bash
pnpm certification doctor
pnpm certification template "/absolute/path/Gw.jspi.wasm" --emit-ts
pnpm certification recertify "/absolute/path/Gw.jspi.wasm"
```

The tool first selects or derives file compatibility. It then inspects that
output as the Core and Tools candidate. The transforms are not alternatives.

Run the downstream chain with exact regression shortcuts disabled:

```bash
pnpm certification recertify "/absolute/path/Gw.jspi.wasm"
pnpm certification double-click "/absolute/path/Gw.jspi.wasm"
pnpm run check
```

`recertify` must report per-feature ABI/input-hash-bound verdicts, and
`double-click` must prove one unique callback, active table role, signature,
insertion point, and valid output. A shipped hash-table match is regression
evidence, not authority.

Each recovered fact needs an independent semantic anchor. A common movement is
not enough. Automated candidates are review evidence and cannot create runtime
authority.

Do not make the IPC boundary compare a candidate-derived raw body digest with a
preceding generation. Call immediates and data operands legitimately change
when ArenaNet relinks an equivalent client. The locator proves their typed
relationships; the boundary accepts the resulting digest as an input-bound
fact; the production transform verifies that digest against the same candidate
bytes. Add a positive coherent-relocation fixture as well as refusal mutations.

Recertification requires semantic identities, signatures, caller relationships,
original-call preservation, complete address occurrence ledgers, table and
allocation invariants, positive and negative layout evidence, lifecycle
clearing, offline tests, clean teardown, and one bounded live semantic check per
changed domain.

For Xunlai storage, independently recover the player-record array, record
stride, agent identifier, player number, access flags, and area type. External
projects such as GWCA can explain semantics, but they are never runtime
authority. Prove reader and handler roles, signatures, field offsets, and the
game-thread drain from the current bytes. Do not copy them from a preceding
build.
The three player-record readers form one optional, all-or-nothing access proof.
If that proof cannot be certified, omit it: the generated configuration then
contains zero access words, Xunlai stays disabled, and the independently
certified Travel action remains available. Never substitute party state or a
guessed offset.

Run `pnpm enhancements:live xunlai-storage` from a supported PvE outpost. The
scenario records only the tri-state access result and two complete action
cycles from the same named action used by the button and shortcut. Each cycle
opens storage, closes it with Escape, and proves that bounded two-button
movement changes the certified player position. A queued command is not a
semantic success. Also enter `/chest`,
`/xunlai`, and one near miss such as `/storage`; the first two must be consumed
locally only after access is confirmed and the near miss must remain a normal
Guild Wars command. Check one eligible character and the known restricted
character, then switch accounts or characters without restarting and confirm
that access is revoked and restored. A one-gold deposit and withdrawal requires
explicit confirmation from the person operating the client.

STOP if closing storage does not immediately restore click-to-walk, two-button
movement, and merchant interaction. The DataWindow handler consumes two account
pane flags in addition to the character/outpost access proof. Do not infer
those flags from access, hard-code a different payload, or call the action safe
because the mailbox drained. A release claim needs independent proof of those
flags and the native storage open/close lifecycle, plus the recovery cycle
above on accounts with and without each pane.

Party certification must prove the complete owned roster, player and hero
professions, hero unlocks, behaviour, skill bars, and attributes. Proving only
the hero count or first hero is not enough for Apply team. Each optional party
detail table is an independent observation: a rejected detail table must erase
only its own facts and must never erase the verified roster or another valid
detail group.

The scheduled recertification workflow already detects a new ArenaNet
generation, downloads and verifies its code artifacts, and publishes
`enhancement.json` as review evidence. It does not write source, push a branch,
or open a pull request. The isolated runtime verifier remains the sole launch
authority; a CI report or exact table row cannot turn a refused feature on.

When evidence is incomplete, grant no capability. The verified official client
must remain playable.

## Done criteria

A Core or Tools change is done when all applicable statements are true:

- every client-local fact has one typed semantic witness;
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
