# Enhancement engineering retrospective

Status: development decision record. Current behavior remains owned by
[the enhancement runbook](../../docs/enhancement-development.md); exact
build-38,771 evidence remains in
[hero automation](hero-automation.md).

## Verdict

The reverse-engineering boundary is now good enough to build on. The project
should stop expanding the primitive search and make the existing path
repeatable:

```text
explicit attended intent
  -> immutable checked plan
  -> Rust validates current game-owned state
  -> one narrow request
  -> bounded readback becomes stable
  -> continue, or stop with exact partial progress
```

The expensive problems were operational, not a lack of reverse-engineering
power:

- frontend telemetry, visible world entry, companion installation, and team
  readback were collapsed into one vague login outcome;
- companion ABI facts were copied into the official-game manifest;
- a cache fingerprint did not change with transformed bytes;
- failed reversible experiments had no durable restore obligation;
- a persistent profile could have an ambiguous process owner;
- research, product UI, discovery, and live acceptance grew in one change.

The first hardening slice is now implemented and verified:

- companion ABI/size facts were removed from the transformed-game manifest;
- the loaded Rust artifact exports and proves its three region contracts;
- saved-login supervision has its own module;
- the persistent profile has one exact owner lock;
- reversible team scenarios write a durable restore journal;
- build 38,771 completed a cached autonomous `team-readback` in map 81 after
  two bounded Enter inputs, publishing the level-14 player and Devona, with
  zero rejected snapshots and a clean shutdown.

## Evidence language

Use one of these labels. A weaker label must never be described as a stronger
one.

| Label | Required evidence |
| --- | --- |
| Static candidate | body, signature, string, caller, or callee evidence |
| Live observed | a normal UI action reached the candidate with matching scalars |
| Callable | the narrow request returned without assertion or abort |
| Transition-proven | bounded game-owned before/after state changed as requested |
| Round-trip-proven | the exact captured original was restored and acknowledged |
| Product-proven | the real command passed policy, progress, failure, and recovery |

“The call did not crash” proves only `Callable`.

## Ownership after this retrospective

| Concern | Owner |
| --- | --- |
| Official-client build facts | `src/main/core/enhancement-builds.ts` |
| Official-game transform | `src/main/core/enhancement-transform.ts` |
| Companion record ABI/size producer | compiled Rust companion exports |
| Companion record interpretation | renderer decoders |
| Login and readiness classification | `scripts/enhancements-live/session.ts` |
| Exact profile/process ownership | `scripts/enhancements-live/live-session.ts` |
| Live restore obligation | `scripts/enhancements-live/mutation-journal.ts` |
| Feature action and acceptance | direct entries in `scenarios.ts` |
| Static discovery | `tools/wasmscan.py` |
| Product reconciliation | Rust tick kernel |

The transformed-game manifest contains official-client facts only. It does not
repeat kernel ABI or region sizes. The renderer checks the ABI/size words
exported by the exact companion artifact before initializing it.

There is deliberately no generic workflow engine. There is also no generic
WASM-call bridge, arbitrary memory API, packet API, forged property context,
or parallel old/new reconciler.

## Normal development loop

1. Write the user-visible behavior and one semantic acceptance.
2. Reject candidates offline using signatures, calls, context classification,
   constants, and strings.
3. When ambiguity remains, observe at most 2–7 explicit functions during one
   normal UI action.
4. Add one exact-build request or bounded read field.
5. Prove corrupt, absent, loading, and rejected cases with offline fixtures.
6. Run one cached live scenario.
7. Record the remaining uncertainty; do not inflate the evidence label.

Python remains the fast static-analysis language. TypeScript owns transforms,
Electron/CDP, and developer supervision. Rust owns memory validation and
game-tick reconciliation. Ghidra is a fallback for unresolved static
ambiguity, not the first loop.

## Live-run invariants

A healthy automatic run must:

- lock the actual persistent profile before launch;
- name the exact runner and Electron PIDs;
- run the offline doctor and exact-build checks;
- distinguish launcher ready, frontend visible, input submitted, world entered,
  companion installed, map readable, and team readable;
- send a bounded Enter only while a frontend can safely receive it;
- stop sending input during loading or after playability;
- fail immediately on an unsupported companion;
- request a clean quit and prove exit;
- leave one bounded local result.

A mutating run additionally must:

- refuse an unfinished recovery journal;
- write the exact before and planned states before its first request;
- use stable HeroID and resolve current AgentID in the kernel tick;
- issue at most one request before acknowledgement;
- persist the last acknowledged progress;
- restore the exact original through the same checked path;
- leave the journal unfinished if restoration cannot be proven.

The journal is a crash-recovery record for developer scenarios, not a general
transaction system.

## Next work, in order

### 1. Finish supervisor acceptance

Run ten consecutive cached `team-readback` launches. Success is ten autonomous
map/team readbacks with clean shutdown, or a correct machine-readable terminal
layer and no ambiguous profile owner.

Add state-change output and a ten-second unchanged heartbeat only if the
existing checkpoint stream does not make a failed run self-explanatory.

### 2. Exercise recovery at every interruption point

Terminate a reversible hero build run after preparation and after each
acknowledged phase. The next mutating launch must refuse new work and name the
remaining obligation. Then add an explicit recovery scenario that:

1. checks the same official build and PvE outpost;
2. resolves the journal HeroIDs against the current owned roster;
3. submits only the recorded restore plan;
4. marks `restored` only after stable bounded readback.

Do not accept a newly captured baseline as recovery.

### 3. Strengthen acknowledgement

For one field, record only request tick, bounded value, relevant update
generation if found, transition tick, and stability window. Prove one
server-rejected request does not count as acknowledged. Until then, call the
source “game-owned readback,” not “server-authoritative state.”

### 4. Prove the real product boundary

One Tools **Apply** action must submit an immutable team plan, show preflight
failures before mutation, reconcile without kicking matching members, report
member/field progress, and restore through that same boundary. This is the
first `Product-proven` milestone.

### 5. Make client updates routine

Extend the static scanner with a two-build ranked comparison. Produce a
reviewable evidence bundle per exact official hash containing function
signatures, normalized hashes, call neighborhoods, context classification,
layouts, policy constants, companion artifact hash/contract, offline results,
and live evidence labels.

Candidate matching may create a worklist. It must never promote semantic
certification automatically.

## Deferred until a concrete requirement exists

- exact party slot order;
- absent mercenary identity;
- account skill-unlock readback;
- a PvP-character gate beyond the existing certified map flags;
- a generalized scenario dashboard or state store;
- new primitive discovery.

Low-level and level-20 accounts should remain separate deliberate certification
fixtures because each reveals constraints the other hides.
