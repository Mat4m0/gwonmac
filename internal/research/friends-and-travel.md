# Quick Travel to friends

Date: 2026-09-03. Status: proposal with static client evidence; not implemented
or live-certified.

## Outcome

Add friend search to the existing Quick Travel palette. A player can
search a friend alias or current character and travel to the friend's reported
outpost when that outpost is supported and unlocked.

Matthias clarified that Quick Travel to friends is the main goal. The first
version has one UI consumer: Quick Travel. A separate Friends window and
independent Friends setting are outside this implementation.

This is technically plausible. The cached official WebAssembly client contains
traceable friend-table accessors, update handlers, and native UI consumers.
The main missing work is a certified, bounded reader with correct lifecycle
invalidation. Quick Travel already owns the map-travel action.

Do not describe the first version as joining a friend's district. The inspected
friend data gives a map ID. Current Travel resolves the local player's region
and language and uses district Any. Reaching that map does not prove that the
friend is in the same district, party, or instance.

## Scope and provenance

This is normal feature investigation, not release stabilization. The inspected
gwonmac checkout was on `fix/settings-controls-live-sync`, at `d8ffc7f0`, with
unrelated changes already present. Those changes were not edited. This report
does not authorize runtime use of any recovered address.

Sources inspected:

- [WASM host](../../docs/wasm-host.md), [feature procedure](../../docs/enhancement-development.md),
  and [account profiles](../../docs/multiple-accounts.md).
- Current Travel command, controller, palette, catalogue, and tests.
- Current Rust companion, character-list decoder, region installation, and
  capability registry.
- Local GWToolbox++ checkout `baaaf0de574b02008baa57a574625a99009cd5ac`
  (2026-08-30), especially `FriendListWindow.cpp` and `TravelWindow.cpp`.
- Local native GWCA source at `e1bc30323bac1194fa4766e1ecbc695fe2e3ca7e`
  (2023-11-14). This is older reference material, not current WASM authority.
- Local `GWCAjs-web-app`: its friend-manager implementation and entity files
  are empty. Its generated API parity report marks all 13 friend APIs
  `not-started`.
- Cached official `Gw.jspi.wasm`, SHA-256
  `1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`.
  This investigation did not prove that these are the bytes of a running window.

The [Guild Wars update notes](https://wiki.guildwars.com/wiki/Game_updates%3AApril_2011)
document location sharing for mutual friends. The
[Friends List documentation](https://wiki.guildwars.com/wiki/Friends_List)
explains aliases, alternate characters, status, and unavailable locations.
Show only what the client reports. Missing location does not prove that the
friend has not added the player.

## Product definition

The feature answers: "Where is this friend, and can I travel to that outpost?"

Use the existing Tools and Travel opt-ins. Friend observation has independent
certification, but no separate product switch. Activate it only while Quick
Travel is open and the current region and lifecycle permit it. If friend proof
is unavailable, ordinary destination search still works.

Friend search results show the saved alias, current character when available,
reported status, and available location. Label unavailable location explicitly.
Use `Friend` or `Name`, not `Account`: the alias is not a login identity.
Keep the existing modal, keyboard entry points, and focus ownership.

### Quick Travel behavior

1. Open Quick Travel through the existing Command-T or `/tp` entry point.
2. Search a destination, friend alias, or current character name.
3. Show separate destination and friend result groups in the same palette.
4. Show a friend result such as `Romi · Healing Monk · Lion's Arch`.
5. Label its action `Travel to Lion's Arch`; explain that district is unknown.
6. On selection, resolve that friend again from the current accepted snapshot.
7. Submit the existing `{ mapId }` Travel request if the target remains valid.
8. Use the existing queued/loading/arrival feedback. Confirm map arrival only.

Keep a matched friend visible with a reason when travel is unavailable. This
distinguishes an offline friend from a search that found nobody.

| State | Behavior |
| --- | --- |
| Online, Away, or Busy; supported unlocked outpost | Offer map travel. Busy does not automatically mean location is unavailable. |
| Offline or no current character | Show reported status; no travel action. |
| Missing location | Show `Location unavailable`; do not guess. |
| Explorable, mission instance, guild hall, or non-catalogue map | No direct-travel action in version one. |
| Destination locked | Show `Not unlocked by this character`. |
| Unlock evidence unknown | Show waiting/unavailable for the friend action. |
| Wrong Pre-Searing/world context | Show the existing context refusal. |
| Already on the reported map | Show `Already on this map; district unknown`; do not claim co-location. |
| Friend moved after the row was selected | Refresh the row and require a new selection; do not silently retarget. |
| Friend became offline, disappeared, or data became stale | Refuse the action and update the result. |
| Tools, Travel, palette visibility, or region policy withdraws observation | Clear the accepted friend state and pending friend selection. |
| Friend observation cannot certify | Ordinary destination search and Travel continue independently. |

The action is one explicit trip to the location displayed when selected. The
friend can move after submission. Do not chase subsequent updates or promise
that they will still be there on arrival.

Keep destination result behavior and numbered favorite shortcuts intact.
Identify the selected friend by a stable session key, not array position. A
resort must not make Enter activate a different person. Duplicate aliases must
remain separate records; never merge accounts because names match.

Use bounded case-insensitive exact, prefix, and substring matching for friends.
The existing destination normalizer removes non-ASCII letters. Do not reuse it
unchanged for arbitrary friend aliases; test accented and non-Latin names.
Friend records must not be written into saved Travel synonyms or favorites,
because their locations change.

### Deferred behavior

Defer a separate Friends window, persistent alternate-character history, profession enrichment, whispers,
friend add/remove/status commands, temporary friend insertion, automatic party
invites, and exact-district joining. None is necessary for the requested first
trip. This intentionally differs from Toolbox's broader friend module.

Toolbox also resolves explorable locations to a nearest accessible outpost.
Do not silently copy that behavior: the requested action is travel when the
friend is in an outpost. A nearest-outpost option needs its own explicit label
and product requirement.

## Existing owners to reuse

| Concern | Existing owner | Proposed use |
| --- | --- | --- |
| Exact client proof | `src/main/certification/`, `src/shared/enhancement-contracts.ts` | Add an independent `friendObservation` capability, with input-bound layout evidence. |
| Game-thread observation | `src/companion-kernel/lib.rs` | Prefer the existing tick dispatcher; no new friend-event hook initially. |
| Bounded reads | `src/companion-kernel/memory.rs` | Read a proved friend root and bounded records. |
| Bounded names and identity precedent | `character_list.rs`, `companion-character-list-snapshot.ts` | Follow the name validation and private identity pattern, without conflating account characters with friends. |
| Snapshot lifecycle | `createCompanionRegionInstallation`, sequence feed | One fixed friend snapshot with freshness and withdrawal. |
| Optional installation | `certified-companion-tools-installation.ts` | Compose allocation, activation, observer, and cleanup with other Tools. |
| Product and region policy | `src/shared/feature-contracts.ts`, companion policy source | Reuse Travel selection; independently gate friend observation by certification, lifecycle, and palette visibility. |
| Search and interaction | `apps/tools/src/components/TravelPalette.vue` | Add friend result rows and stable keyboard selection. |
| Travel attempt | `apps/tools/src/travel-host.ts` | Retain one attempt, timeout, and map-arrival owner. |
| Travel authorization | `enhancement-travel-controller.ts`, `enhancement-travel-command.ts` | Reuse existing availability and map-only command. |
| Final dispatch | `enhancement-travel-command-transform.ts` | Keep the existing reviewed-map and live-unlock checks. |

The friend snapshot is a justified new domain region: current account-character
and party snapshots do not contain the friend service's records. Do not extend
them into a speculative universal player model.

No live friend IPC is needed for the embedded Travel palette. It already runs
in the game window's renderer. Main continues to own settings and profile identity;
preload does not acquire a generic memory or friend-service bridge.

## How the proposed integration runs

```text
Official client receives friend updates
  -> official friend table changes
  -> existing certified tick reaches Rust companion
  -> bounded Friends reader publishes a complete snapshot
  -> strict decoder and freshness feed accept or withdraw it
  -> Quick Travel displays friend results from the accepted state
  -> explicit valid selection becomes existing map-only Travel request
  -> existing game-thread drain rechecks and dispatches travel
  -> existing map observation confirms arrival
```

This remains an internal game integration, but not Windows DLL injection.
gwonmac derives and verifies a separate WASM artifact, then loads its bounded
companion. The official download remains unchanged. The reader adds no game
calls. Travel continues through the existing named action.

Use GWCA as semantic reference material. Do not import its general API, copy
x86 signature scans, instantiate its optional WASM binary alongside our
companion, or assume a C++ struct comment proves the browser layout.

### Proposed snapshot constraints

- One complete list state: unavailable/warming/ready, plus sequence and bounded
  count. Distinguish a ready empty friend list from an uninitialized service.
- Each published record needs a session-local identity, alias, reported status,
  optional current character, and optional map ID.
- Derive a stable session identity in the bounded reader; raw friend UUIDs and
  pointers stay private. Revoke all keys at account/session transitions.
- Prove table traversal bounds separately from the maximum number of actual
  friends. The native table also contains other categories and can contain
  vacant slots. A 100-friend limit does not justify reading only 100 raw slots.
- Validate UTF-16 termination, count/capacity, pointer bounds, categories,
  statuses, identities, and map values. Never publish a partial traversal.
- A sequence lock protects publication coherence, not the truth of server
  presence. Prove friend-service initialization/disconnect behavior separately.
- Prefer a bounded low-rate scan scheduled through the existing tick. Start
  with a measured target near one second while Quick Travel is visible.
  Withdraw on hiding the palette; rescan on opening. Lifecycle checks must
  still reject stale account data before any read becomes accepted.
- Choose freshness relative to measured sampling and background throttling.
  An unchanged list is still valid when freshly reread; a stopped observer is
  not. Do not mix sequence-only UI repaint suppression with liveness checks.
- Clear friend results on loading, unsupported region, account change,
  service disconnection, malformed data, teardown, or disabling Travel/Tools.

Map labels for the reviewed Travel catalogue already exist. Arbitrary
explorable map labels need a verified existing data source or a separately
justified lookup. Until then, use `Outside supported outposts` for a known
non-catalogue location; do not add guessed map names or another map catalogue.

## Static evidence recovered from the cached client

The repository's `tools/wasmscan.py` decoded all 17,610 defined functions.
`wasm2wat --enable-all` also decoded the cached module. No live memory or
network traffic was read. These findings narrow the next proof; they are not
certificates.

Useful source/assertion anchors retained in the module include:

- `Gw/Friend/FriendApi.cpp`
- `Gw/Friend/FriendTable.cpp`
- `Gw/Ui/Game/GmFriendsList.cpp`
- `friendId < m_array.Count()`
- `status < FRIEND_STATUSES`
- `category < FRIEND_CATEGORIES`

For this input hash only:

| Candidate | Static evidence | Remaining proof |
| --- | --- | --- |
| Friend table at `0x5a6b18` | API functions 8852–8857 use the same root; initialization/reset and event processing also use it. | Independent root derivation, allocation/count limits, account and service lifecycle. |
| Indexed accessor 8829 | Checks index against table `+8`, loads pointer array at `+0`, then dereferences a four-byte slot. | Capacity, holes, and malformed-record refusal. |
| Category at record `+0` | Function 8830 writes it and updates category counts. | Exact category meanings and valid ranges for this build. |
| Status at `+4` | Function 8834 writes it; event handler 8849 updates it; native row formatter 15250 consumes it. | Offline/unknown and service connectivity semantics. |
| UUID at `+8` | Function 8833 compares and copies four 32-bit words and updates its lookup table. | Account-level stability and transition behavior. |
| Alias at `+24`, character name at `+64` | Functions 8832/8831 copy bounded 20-unit strings; formatter 15250 compares and formats both. | Live alias and character-change confirmation, including empty/unknown cases. |
| Record index at `+104` | Accessed by removal and update functions. | Generation/reuse semantics; do not publish it as permanent identity. |
| Location at `+108` | Function 8835 writes it; event 40 in handler 8849 supplies it; formatter 15250 passes it to function 17530 and reads the resulting area-name field. | Live map changes, zero semantics, and full area-lookup proof. |
| Event handler 8849 | Dispatches event IDs 38, 39, 40, and 44; applies table changes and emits UI messages. | Callback ordering and all teardown paths if an event hook is ever needed. |
| Friend UI message `0x1000008b` | Handler emits decimal 268435595 after updates. | It is a candidate anchor, not permission to copy a message constant into production. |

The current GWCA header's offset annotations are inconsistent with its own
20-element `wchar_t` arrays. In particular, following a 40-byte alias starting
at `+24`, the character array starts at `+64`, not the header's `+44` annotation.
The observed WASM consumers support `+64`, with location at `+108`. This is a
concrete reason to derive field roles from code instead of copying comments.

The inspected path contains no proved friend district, region, or language.
That does not prove no such information exists anywhere in the client. It means
exact-district joining is unsupported by this evidence.

## Proof and delivery sequence

Do not create implementation branches or a PR stack from this report alone.
When implementation begins, confirm these review boundaries against current
main and the repository's stacked-PR workflow.

1. **Prove and integrate bounded friend observation.** Derive the root, record
   layout, traversal bounds, service lifecycle, and session identity. Add
   capability/config/ABI plumbing and reuse the companion feed. Prove valid
   empty versus uninitialized/disconnected state and withdrawal before building
   product UI. Inspect a developer-only typed observation. Stop this layer if a
   required fact remains unproved; record the exact missing fact.
2. **Complete Quick Travel to friends.** Add friend matching, refusal rows,
   palette-owned activation, and stable selection. Re-resolve the session key
   and displayed map on selection. Reuse the existing map-only command,
   preconditions, and attempt owner. Confirm one real trip in a Developer Build.

These are two review boundaries for one feature, not two separate products.
Keep unfinished user-facing behavior on the feature stack until complete. Do
not add a setting or Friends window between them. Do not expand the existing
Travel request with unused district fields; those fields in stored shortcuts
are rollback compatibility, not runtime support.

### Apply the implementation advice

Stop broad Toolbox research. Revisit an external source only for a named fact
that cannot be established from the existing local evidence.

Derive layout from accessor, writer, native consumer, and clearing-path
relationships. The recorded input hash and addresses are regression evidence,
not the runtime locator. Test independent harmless relocation of functions,
data roots, and table positions. Equivalent behavior must still identify;
changed or ambiguous behavior must refuse. This is an acceptance requirement,
not a claim that the separate experimental proof program has passed it.

Friend data suggests a map; it never grants Travel authority. Once the friend
selection is validated, submit the same map-only request as a destination row.
Do not add a friend travel controller, location cache, or generic game API.

Capture exact automated command output directly to local test artifacts. Keep
structural identification, decoding, lifecycle invalidation, installation,
operator-witnessed live behavior, command request, and map arrival as distinct
evidence. Use synthetic identities and bounded scalar live outcomes. Never
save names, UUIDs, search text, or a real roster in these results.

Use commands and fixtures available in this checkout. The documented
`certification` command currently builds before running. Do not assume an
experimental `proof:readiness` command exists, import the larger proof branch,
or make this feature depend on that program. Introduce a small tooling change
separately only when it resolves a concrete implementation obstacle.

### Acceptance tests

- Reader: valid list, valid empty list, mixed categories, vacant slots, overflow,
  corrupt pointers, malformed names, unknown status, duplicate identity, and
  changing roots during collection.
- Lifecycle: old account data never survives logout/login, reconnect, character
  selection, disabling Tools/Travel, unsupported regions, or teardown.
- Structural identification: harmless independent relocation succeeds;
  semantic changes and ambiguous roots refuse certification.
- Freshness: repeated unchanged successful reads remain usable; a stopped feed
  withdraws; UI does not rerender solely because its sequence changes.
- Search: alias/current-character matches, duplicate aliases, Unicode names,
  bounded query/result work, and no persistence of friend names as synonyms.
- Selection: a moving friend, row reorder, reused slot, deletion, or stale snapshot cannot
  silently change the selected trip.
- Travel: locked/unknown unlock, outside-context, non-outpost, same-map,
  queue-busy, delayed start, interruption, and unconfirmed arrival retain clear
  refusal or feedback. A successful enqueue is not arrival.
- Independence: missing friend proof affects only friend results; Core-only imports
  remain free of optional Tools; existing destination search still works.
- Privacy: no names, UUIDs, friend search text, or full snapshots in diagnostics.
  Synthetic names are sufficient for automated fixtures.

Reuse existing Travel host tests, Travel palette tests, character-list snapshot
tests, companion region tests, and synthetic kernel fixtures. Run the normal
`pnpm check` gate for implementation. Changed native code also needs the
relevant artifact/transform and integration tests, then the existing macOS CI.

The required live semantic check is small: compare one consenting mutual
friend with the native list, change their character/status/map, test a missing
location, then select an unlocked outpost once. Matthias must confirm visible
game behavior. Verify the two accounts/profile windows do not share live
friend state. Record only bounded scalar proof, never a friend roster.

Recommend a Developer Build first. New observation and client certification
warrant Beta consideration with the next suitable train; this report does not
select a release channel.

## Remaining decisions and recommendation

The useful first release is **Quick Travel to friends' reported outposts**.
It needs one observation capability and one UI consumer. It needs no backend,
new game connection, persistent friend database, or second travel command.

The next action is the offline proof of the identified friend-table path and
its service/account lifecycle. Exact-district joining remains separate research
until a real source for the friend's region, language, district number, and
matching travel/arrival semantics is proved.

## Verification performed for this investigation

- Decoded the exact cached client with the repository scanner and `wasm2wat`.
  Inspected friend accessors, update writers, event routing, and native UI
  consumers. No runtime reader was installed.
- Passed 22 focused tests across Travel contracts, character-list decoding,
  and companion region installation.
- Passed 39 tests across the existing Travel host and Travel palette.
- Passed the Markdown link checker and whitespace checks for this report.
- Ran `pnpm check`: type checks passed, then lint stopped on the pre-existing
  unused `UiThemeColor` import in `src/renderer/appearance.ts:14`. The later
  full-gate stages did not run. Unrelated appearance work was not changed.
- Did not run a live game, capture a friend roster, submit a Travel command,
  change application code, create an implementation branch, or publish a PR.

These checks support the investigation and the reuse claims. They do not prove
the proposed Friends feature, live location freshness, or district joining.
