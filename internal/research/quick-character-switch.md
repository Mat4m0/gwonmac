# Quick character switching: research and concept

> **Status: native switch proved on the installed client; adaptive metadata and
> ranking acceptance pending.**
> This document records source evidence, the developer-only probe, and the
> proposed design from 2026-08-29. The exact-build Core companion now publishes
> the same bounded read-only character projection. The Core palette, shortcut
> cutover, exact-build native action calls, and privacy-safe diagnostics are now
> implemented. Account-change invalidation, optional metadata semantics, and
> successful native action execution remain live hypotheses.

## Recommendation

Add a **Switch Character** command palette with Command-R as its default
shortcut. It should feel like Quick Travel: the same centered frame, compact
flat rows, focus rules, and bounded status footer. Accounts with at most ten
characters need no search. Accounts with eleven or more get a bounded search
over the live account list, while the empty query remains a ten-row palette.

Treat it as a small **Core** surface, not as a Tools-only feature. A global
Command-R command must remain present when Tools Beta is off, and Core is not
allowed to import the optional Tools implementation. Reuse the shared design
tokens and Travel's proven interaction contract, not its Vue module. The native
character-switch capability may still fail closed for an unknown client build
without blocking the official game.

The first release should work only from an outpost and should switch directly
after the player chooses a different character. It should not preserve the
party, return to the same map, run from an explorable area, or persist account
character data. The production reader follows this boundary: it keeps the
game-memory roots inside the fixed companion kernel, requires three stable
observations, publishes at most 64 validated records through one fixed ABI,
and invalidates the whole projection rather than exposing partial data.

This feature is feasible. Exact static inspection now proves the account-array
root, record stride, name field, native summary decoder, requested metadata
fields, current/selected-name root, and clear paths for this build. The
developer-only observer has now proved the list at character selection and
in-world on one account. Static verification proves the exact logout dispatcher,
bounded frame lookup, and internal frame-dispatch relationship used by the
implementation. The manual live loop then proved that the installed client
accepts the complete logout → select → Play sequence. This iteration still
needs live comparison of secondary profession and the new persisted ranking.

## Implemented live-test boundary

- Core owns one `CharacterSwitchSource`; the palette sees only validated
  character records, playability, closed action states, and one request method.
- The transformed module exports only the named character action enqueue and
  configuration functions. Each logout, Selector, and Play call is rechecked
  and drained on the certified game thread. There is no generic memory reader,
  frame sender, dispatcher, synthetic input, or direct game-memory write.
- The controller captures the target name privately, re-resolves it against the
  fresh production projection after logout, invokes each consequential action
  at most once, and accepts success only after the target identity is published
  in a playable outpost. Before Play, the native action queries the Selector
  pane's selected-index message and requires an exact target-index match; it
  does not misuse the entered/current-name root as carousel state.
- Command-R is owned by Switch Character even on an unsupported build.
  Reload Guild Wars moved to Command-Shift-R.
- Rows expose name, the shared canonical primary-profession icon, and Current.
  One default-on display setting adds primary/secondary profession, level, and
  only locations resolved through Travel's reviewed destination catalogue.
  Campaign and type remain withheld.
- Character-list ABI 2 adds a bounded secondary profession and a nonzero,
  unique one-way 64-bit key derived inside the kernel from the record UUID.
- A separate usage document stores only opaque keys, successful-switch counts,
  and recency sequence. It updates only after playable-outpost and exact target
  identity confirmation and is capped at 256 entries.
- Diagnostics are versioned and bounded to build/program IDs, reader/count,
  pre-game/playability, sequences, focus/policy, stage/code, elapsed buckets,
  three counters, and 32 state transitions. Names, search text, account data,
  UUIDs, pointers, offsets, and raw payloads are excluded.

Before this branch, Command-R opened **Reload Guild Wars…** and the shortcut
model reserved it for application lifecycle behavior. This branch implements
the intentional hard cutover:

- Command-R always opens or closes Switch Character.
- Move **Reload Guild Wars…** to Command-Shift-R and keep its menu item.
- Reserve Command-Shift-R in the shortcut editor.
- Add `character.switch` to the canonical configurable shortcut model with
  Command-R as its default. Do not choose between reload and character switch
  based on the current game state or feature availability.
- If the client capability is unavailable, Command-R opens the palette with a
  short unavailable reason. It must never fall through to reload.

If product review rejects adding this convenience to Core, do **not** make a
Tools-only Command-R behave differently depending on opt-in state. In that
case, keep Command-R for reload and use configurable Command-Option-R for the
Tools feature. The rest of this concept recommends the Core cutover.

This keeps each shortcut predictable. It also preserves the existing reload
workflow instead of deleting it; main still owns its bounded socket close,
filesystem sync, navigation, and relog intent
([`game-reload.ts`, `GameReloader.reloadOnce`, lines 76–121](../../src/main/game-reload.ts#L76-L121)).

## Evidence and confidence

Three evidence classes must remain separate:

1. **Current gwonmac or current WebAssembly evidence** can guide a candidate
   implementation, but exact memory facts still need live certification.
2. **GWToolbox++ and GWCA evidence** proves that the Windows client has useful
   account-character records and a native relog path. It does not prove that
   their offsets, pointers, or messages apply to the WebAssembly client.
3. **Hypotheses** are useful only as a focused runtime research list.

### Proven in current gwonmac

- The last account-service request before character selection is
  `/webgate/my_account/token.xml`. gwonmac uses it only as a signal that
  character selection is expected; it is not proof that the list is ready
  ([`harness.ts`, XHR interception, lines 1116–1128](../../src/renderer/harness.ts#L1116-L1128)).
- Current `preGameControls` publishes only `unknown`, `character-select`,
  `reconnect`, or `loading`, plus playability and a diagnostic mask
  ([`gw-native.d.ts`, `PreGameControls`, lines 205–211](../../src/renderer/gw-native.d.ts#L205-L211)).
  It deliberately exposes no frame pointer, general UI command, or account
  record ([`enhancement-contracts.ts`, lines 111–118](../../src/shared/enhancement-contracts.ts#L111-L118)).
- The exact-build certificate currently proves only the Play, Selector, Yes,
  No, and reconnect-dialog labels and the bounded frame/context layout
  ([`enhancement-builds.ts`, `preGameControls`, lines 512–546](../../src/main/certification/enhancement-builds.ts#L512-L546)).
- Current automatic relog waits for the certified screen, sends one Return to
  the already-selected character, and verifies later playability. It cannot
  choose a named character
  ([`automatic-character-return.ts`, `continueAfterToken`, lines 248–299](../../src/renderer/automatic-character-return.ts#L248-L299);
  [`input.ts`, `activatePreGameControl`, lines 456–478](../../src/renderer/input.ts#L456-L478)).
- The enhancement guide already identifies character switching as a possible
  later consumer, but requires its own bounded input authority first
  ([`enhancement-development.md`, lines 151–161](../../docs/enhancement-development.md#L151-L161)).

### Current WebAssembly static inspection

The locally installed `Gw.jspi.wasm` inspected for this research had SHA-256
`e00e8368a1d0e1003bf1882dce2d4b3cd8e2e8b6c4acc72474c8b56e2e35c6bb`.
The repository's full instruction decoder built a data-reference index
([`wasmscan.py`, `build_ref_index`, lines 243–266](../../tools/wasmscan.py#L243-L266)).
Generated symbol candidates came from source paths and assertion strings, not
from trusted debug symbols.

The exact current artifact proves two different structures. `UiPregame` owns a
0x78-byte visual model-slot array at its scene object offsets `+0xe0` and
`+0xe8`; that is not the account record source. The authoritative account list
is the `GcApi` array used by `func_10128` and `func_10129`:

| Fact | Exact current WebAssembly evidence |
| --- | --- |
| Array root | linear-memory word `0x5a75e8` |
| Character count | linear-memory word `0x5a75f0` |
| Record stride | `0x84` bytes in `func_10128` (`ram:0x80376268`) and `func_10129` (`ram:0x803762a5`) |
| Summary byte count | record `+0x04`; packet construction refuses more than `0x40` bytes in `Base_rtl_List__10132` (`ram:0x8037652d`) |
| Name | record `+0x18`, copied and compared as a 0x14-code-unit UTF-16 buffer by `func_10129`, `func_10035`, `func_10042`, `func_10044`, `func_10046`, and `func_10081` |
| Encoded summary | record `+0x40`, bounded by the byte count above |
| Current/selected identity | UTF-16 name buffer at `0x5a7760`; `func_10129(null, …)` resolves through it |
| Summary decoder | function index `9544`, called by `Base_rtl_Array__11835`; signature `(bytes, source, output, error) -> i32` |
| Current summary format | `func_9544` delegates to `func_9478`; format 8 is read directly and legacy formats take a conversion path. The probe refuses every format except 8. |
| Primary profession | format-8 appearance word at summary `+0x08`, bits 20–23. `func_9191(3, appearance)` delegates to `func_6866`; its exact slot-3 table entry is ID 3, shift 20, width 4. |
| Campaign | low four bits of format-8 summary word at `+0x1c`; `func_9478` publishes this as decoded word 1. `UiChInfo__11846` accepts PvE chapters 1–5. |
| Level | bits 4–8 of format-8 summary word at `+0x1c`; `func_9478` publishes this as decoded word 22 (`+0x58`). |
| Current map ID | format-8 unsigned 16-bit word at summary `+0x02`; `func_9478` publishes this as decoded word 23 (`+0x5c`), resolved through `ConstMission__17530` by `UiChInfo__11846`. |
| PvP type | bit 9 of format-8 summary word at `+0x1c`; `func_9478` publishes this as decoded word 25 (`+0x64`) and the UI consumes it as a boolean. |

`func_10035`, `func_10042`, `func_10044`, `func_10046`, and `func_10081`
grow or update the same array by name. `func_9982` frees it and zeros both root
and count. `func_10118` does the same while tearing down the game connection.
`Base_rtl_Array__9998` clears the list and selected-name buffer on its failed
account branch, and initializes the selected name from the account response or
the first record on its successful branch.

The pure format-8 formulas above were rechecked against the installed binary's
instruction stream, not copied from the sibling projects. At WebAssembly file
offsets `0x3565c7–0x35667b`, `func_9478` checks the format, then reads summary
`+0x08`, `+0x1c`, and `+0x02` into the UI's appearance, campaign, level, map,
and PvP fields. At `0x2bff4b–0x2bffb7`, `func_6866` applies its slot table; the
current initialized-data entry at linear address `0x15ac84` is `(3, 20, 4)` for
primary profession. These direct reads are why the live probe needs no native
decoder call or writable scratch memory.

These are source-proved layout and invalidation facts for only SHA-256
`e00e8368…e35c6bb`. The current isolated semantic verifier re-derived build ID
`3759047528` for the probe profile. Static inspection still cannot prove the
first live instant at which the server has completed the array, whether the
same allocation survives entry into the world, or which renderer/account
transitions occur in practice. Those remain the live phase.

### Proven in sibling repositories

GWToolbox++ defines one `AvailableCharacterInfo` record with name, map ID,
primary and secondary profession, campaign, level, and PvP flag
(`GWToolboxpp/GWToolboxdll/Utils/ToolboxUtils.h`,
`AvailableCharacterInfo`, lines 91–142). It exposes the array as the list of
playable characters “from character select screen” (same file,
`AccountMgr::GetAvailableChars`, lines 177–189).

Its reroll feature gives the strongest timing evidence for that client:

- It registers a check on the login-screen UI-state message
  (`GWToolboxpp/GWToolboxdll/Windows/RerollWindow.cpp`,
  `RerollWindow::Initialize`, lines 637–649).
- Before the list has been captured it tells the player to visit character
  selection; afterward it sorts the retained array by name and shows profession
  icons (`RerollWindow::Draw`, lines 559–625).
- It sends the game's logout message with `character_select = 1`, waits for an
  exact ready predicate, selects the target, presses the native Play control,
  then verifies the loaded character name (`RerollWindow::Update`,
  lines 673–720).
- Readiness requires the native UI state, a visible Selector frame, and a valid
  matching frame context (`GWToolboxpp/GWToolboxdll/Utils/ToolboxUtils.cpp`,
  `LoginMgr::IsCharSelectReady`, lines 251–260).
- Selection resolves the requested name in the Selector's character array and
  uses native frame messages before clicking Play (`LoginMgr::SelectCharacterToPlay`,
  lines 262–324).

GWCA independently finds a pre-game context through the `UiPregame.cpp` and
`!s_scene` anchors (`GWCA/Source/GWCA.cpp`, initialization, lines 78–90) and
defines a character array with a chosen index (`GWCA/Include/GWCA/Context/PreGameContext.h`,
`PreGameContext`, lines 10–25). The newer vendored GWCA source in
GWCAjs-web-app describes a pre-game character record containing campaign/PvP,
level, map ID, and name
(`GWCAjs-web-app/gwca/Include/GWCA/Context/PreGameContext.h`,
`LoginCharacter`, lines 10–22, and `PreGameContext`, lines 23–45).
GWCAjs itself still marks `PreGameContext` unimplemented
(`GWCAjs-web-app/GWCAjs/PROGRESS.md`, line 79), so there is no ready JavaScript
API to reuse.

### Availability conclusion

For GWToolbox++'s supported native client, the full list becomes usable at
character selection and can remain available later in the same process. The
feature explicitly warns when the player has not visited character selection.

For the current WebAssembly client, static inspection now proves the array and
decoder described above. The safe production design remains:

1. Treat the token request as “character selection is approaching,” never as
   “character data is ready.”
2. Publish a snapshot only after the certified Play and Selector readiness
   proof passes and the character array passes independent bounds and content
   invariants.
3. Keep that snapshot in memory only. Refresh it every time character selection
   becomes ready and invalidate it on account exit, module replacement, or a
   failed invariant.
4. Before switching, re-resolve the requested character in the live native list
   after returning to character selection. Never act only on the older UI
   snapshot.

The first live run proved that the WebAssembly list remains safely readable
in-world after it has been observed at character selection. Its same private
root/count pair passed 315 consecutive observations through first world entry,
and later passed through logout and entry on a second character. A renderer
reload created a fresh reader and correctly returned `absent` at login. This
does not prove that a fresh gwonmac attachment made only after world entry can
discover the list, or that account change clears it. Until those paths are
proved, the feature must say **Character list unavailable until the next
login** when no current-session snapshot exists. It must not persist names to
hide that limitation.

## User flow and keyboard behavior

The player is usually in an outpost and wants another character without
navigating the native carousel.

1. Press Command-R. The compact alphabetical list opens and owns keyboard focus.
2. Keep the current character in its alphabetical position, disabled and
   labelled **Current**.
3. Keys 1–9 immediately choose the corresponding visible row; 0 chooses row 10.
4. Tab, Shift-Tab, Up, and Down move through the available characters. Arrow
   navigation wraps and skips the disabled current character.
5. Return switches to the active non-current character. A click does the same.
   The list remains visible but disabled while one request is active.
6. Escape, Command-R, or Close hides the palette and restores canvas focus,
   including during switching. Hiding presentation never cancels, repeats, or
   changes the native transaction; reopening shows its current state.
7. A failure remains inline with the character list. Choosing any available
   character starts one fresh request; technical details stay collapsed unless
   the player opens them.

These rules match Quick Travel's focus, toggle, pointer-lock, and modal owner
([`travel-palette.ts`, lines 16–119](../../src/renderer/travel-palette.ts#L16-L119))
and its Return and Escape behavior
([`TravelPalette.vue`, lines 164–192 and 359–403](../../apps/tools/src/components/TravelPalette.vue#L164-L192)).
The end-to-end test proves that Travel blocks game interaction, dismisses on an
outside click without click-through, yields to other transient dialogs, traps
Tab, and restores canvas focus
([`input-travel.spec.ts`, lines 63–175](../../tests/electron/input-travel.spec.ts#L63-L175)).

### Refusal and progress states

- **Explorable area:** show “Return to an outpost before switching characters.”
  Keep the list available, but disable switching. The MVP must not add a
  confirmation or abandon active explorable progress.
- **List not observed:** show “Character list unavailable until the next
  login.” Do not log out merely to discover the list after the picker opens.
- **Unsupported client:** show the exact capability failure in player language.
  Keep the official client playable.
- **Switching:** show “Switching to {name}…” and no second action.
- **Timeout/refusal:** keep the player at the native screen that the game
  reached, close the operation, and state where it stopped. Do not retry an
  ambiguous native action.
- **Current character:** disabled, with `aria-current="true"` and the visible
  **Current** marker.

## Visual layout and hierarchy

Use a compact 430-pixel frame at Quick Travel's placement, with its shared
tokens, material, entrance, focus treatment, and scroll behavior. Travel
defines the incumbent surface language
([`styles.css`, lines 8–28](../../apps/tools/src/styles.css#L8-L28)). Collections
must remain flat rows, not cards (`apps/tools/DESIGN.md`, component rules,
lines 63–81).

```text
┌─────────────────────────────────────────┐
│  Switch Character                 ⚙  ×  │
├─────────────────────────────────────────┤
│  1  [profession]  Rudolph               │
│  2  [profession]  Toef          Current │
│  3  [profession]  Wintersday Hero       │
├─────────────────────────────────────────┤
│  ↑↓ Choose · Enter · 1–9, 0 Quick     │
└─────────────────────────────────────────┘
```

Hierarchy:

- The header contains title, count, compact details settings, and Close. There
  is no sort menu, favorites surface, or tab hierarchy.
- Each compact 42 pixel row starts with its number and profession icon.
- Character name is the strongest text. The optional second line contains
  professions, level, and a reviewed known location. Unknown locations are
  omitted instead of exposed as raw map IDs.
- The right edge contains only **Current**. Do not use badges for every
  metadata field.
- The footer gives persistent keyboard hints. Errors appear inline above it and
  use the shared live status
  pattern used by Travel
  ([`TravelPalette.vue`, lines 407–420 and 462–465](../../apps/tools/src/components/TravelPalette.vue#L407-L420)).
- Long names and locations truncate visually but remain complete in accessible
  labels. The list becomes one column at all widths; narrow layouts reduce
  metadata before reducing the name or tap target.
- Use only the existing brief palette entrance. Respect reduced motion through
  the shared system; add no character-carousel animation.

The supplied Guild Wars screenshot supports the same information order—name
and profession first, then character type, campaign, level, and location—but
its native Sort control and spacious detail view are not appropriate for a
fast command palette.

## Data matrix

“Login” below means the period after account authentication and before entering
the world. “In-game” means a playable outpost or explorable instance.

| Field | Display value | Authoritative source | Login / in-game availability | Confidence | Fallback |
| --- | --- | --- | --- | --- | --- |
| Character name | Exact game name | Record `+0x18`, bounded to 20 UTF-16 code units | Ready at character selection and retained in-world after three stable reads; absent before login and after renderer reload | High layout/lifetime confidence on the tested build and account | Required. Refuse the whole list for an empty, unterminated, malformed, or duplicate name; never log or persist it. |
| Primary profession | Localized profession name plus canonical icon | Format-8 summary `+0x08`, bits 20–23; exact `func_6866` slot-3 table | Valid range 1–7 observed across all four records at selection and in-world | High structural confidence; on-screen semantic comparison still pending | Omit the field and refuse MVP admission if semantic comparison fails. |
| Secondary profession | Localized name after primary; omitted for none | Format-8 summary `+0x08`, bits 10–13, bounded 0–10 | Published with the list at selection and in-world | High structural confidence; native-selector comparison pending | Treat 0 as none. Refuse the complete publication outside 0–10. |
| Privacy-safe key | Never displayed; joins successful usage to the current live record | 64-bit FNV-1a derived inside the kernel from the record UUID at `+0x08` | Published only with a valid live record | High implementation confidence; final exact-build live acceptance pending | Refuse zero or duplicate keys. Never expose the raw UUID or key in diagnostics. |
| Character type | **Roleplaying** or **PvP** | Format-8 summary `+0x1c`, bit 9 | Field valid for all four records at selection and in-world | High structural confidence; the tested account did not prove both types | Omit until a PvP record is compared with the native UI. Do not default to Roleplaying. |
| Campaign | **Prophecies**, **Factions**, or **Nightfall** | Format-8 summary `+0x1c`, bits 0–3 | Valid range 1–2 observed across all four records at selection and in-world | High structural confidence; only two values observed and semantic comparison pending | Omit until each admitted value is compared. Do not derive it from profession or current map. |
| Level | **Level 4** | Format-8 summary `+0x1c`, bits 4–8, bounded 1–20 | Valid range 1–17 observed across all four records at selection and in-world | High structural confidence; on-screen semantic comparison still pending | Omit until compared with native UI. |
| Current location | Localized map name, for example **Tsumei Village** | Format-8 summary `+0x02` plus a canonical complete map-name resolver | Valid map-ID range 81–249 observed across all four records at selection and in-world | High ID-layout confidence; low confidence in a complete product name resolver and semantic mapping | Show a name only when the ID resolves canonically. Otherwise omit; never expose `Map #123` to players. The reviewed Travel catalogue is only a partial outpost catalogue and must not become a second complete map database. |
| Current character | **Current** marker and disabled action | Exact selected/current UTF-16 name at `0x5a7760`, resolved uniquely against the same list | Unique in-world and changed across entered characters; did not change during the quick character-select browsing phase | High confidence for entered/current identity; highlighted-selection semantics unproved | Use it only as current/entered identity. Never use it as proof of the currently highlighted carousel row or disable by stale index alone. |
| Sort order | Alphabetical by character name | Derived presentation over the one snapshot | Always when snapshot exists | High | Stable native list order if locale comparison fails. No saved sort preference. |

Do not expose account email, account UUID, character UUID, raw record bytes,
frame pointers, or offsets. Do not include names or search text in diagnostics.

## Icon and asset strategy

Reuse the ten profession PNGs already shipped at
`apps/tools/src/assets/trader/professions/1.png` through `10.png`. They are
64×64 and already cover Warrior, Ranger, Monk, Necromancer, Mesmer,
Elementalist, Assassin, Ritualist, Paragon, and Dervish. The existing resolver
maps those profession names to the canonical IDs
([`trader-assets.ts`, `PROFESSION_IDS`, lines 3–35](../../apps/tools/src/trader-assets.ts#L3-L35)),
and a test requires all ten assets
([`trader-assets.test.ts`, lines 12–17](../../apps/tools/src/trader-assets.test.ts#L12-L17)).

Implementation creates a Core consumer, so move only the profession ID, name,
and asset resolver to one shared renderer asset owner and let Trader import it.
Do not copy the mapping, keep two icon directories, or download images at
runtime. Keep the existing ArenaNet content attribution
([`THIRD-PARTY-NOTICES.md`, lines 56–65](../../THIRD-PARTY-NOTICES.md#L56-L65)).
GWToolbox++ uses Guild Wars Wiki Tango profession icons
(`GWToolboxpp/GWToolboxdll/Modules/Resources.cpp`, lines 111–123 and 941–963),
but importing a second icon set would create needless visual and licensing
work.

Use shared search, chevron, close, keyboard-key, status, and focus primitives
for all other symbols. Do not add campaign logos or character-type icons in the
MVP. Text is clearer at this density.

## Technical architecture

### One native capability owns truth and action

Add one narrow, exact-build Core **character switch** capability. The feature
remains independently fail-closed; it does not make game startup depend on
successful character-list certification. It owns:

- discovery and validation of the live account character array;
- an immutable, revisioned snapshot for presentation;
- current-character and playability checks;
- exactly one active switch request;
- logout to character selection, readiness, live target re-resolution, native
  selection, Play, timeout, and terminal verification; and
- invalidation when account, module, or certified state changes.

The capability should expose a closed domain API, not memory:

```ts
type CharacterSwitchSnapshot =
  | { status: "waiting" | "unavailable"; reason: string }
  | { status: "ready"; revision: number; currentName: string | null;
      playable: "outpost" | "explorable" | null;
      characters: readonly CharacterSummary[] }
  | { status: "switching"; targetName: string; stage: SwitchStage };

switchCharacter({ revision, name }): "accepted" | SwitchRefusal;
```

This sketch names the boundary, not the final transport shape. The UI may
filter, sort, highlight, and render the snapshot. It must not send logout,
Left/Right, click, Play, or retry steps itself. The native owner rechecks the
revision and target immediately, then re-resolves the name again from the live
list after Selector becomes ready.

Follow Travel's established separation: Vue owns presentation, while a named
host command owns the game action
([`travel-host.ts`, module boundary and `createNativeTravelHost`, lines 1–5 and
53–60](../../apps/tools/src/travel-host.ts#L1-L5)). Unlike Travel's one-step
command, the complete multi-screen switch state must stay below the UI-facing
host so a renderer rebuild or component error cannot continue half a workflow.
The Core presenter should be a direct, feature-local renderer surface using the
shared UI tokens. It must not import `apps/tools`, add a second component
system, or introduce a generic palette abstraction for one new consumer.

### Native behavior

Prefer the game's own behavior:

1. Issue the native logout-to-character-select action.
2. Wait for the independently certified character-select-ready predicate.
3. Resolve the requested name in the newly live array.
4. Invoke the native Selector behavior and native Play control.
5. Wait for a fresh playable publication and verify the loaded name.

Do not write the selected index directly and do not replay an unbounded series
of keyboard events. GWToolbox++ provides evidence that native logout,
Selector-frame messages, and Play can implement this flow, but the WebAssembly
client needs its own exact functions, messages, and complete-body certificates.

Use a bounded game-thread mailbox or equivalent existing certified command
pattern. Expose no generic frame-message sender. Pause before the consequential
step if the game window loses focus. Refuse a concurrent switch, current target,
missing target, stale revision, explorable state, reconnect prompt, unknown
client build, or failed live invariant. A timeout ends authority; it does not
authorize a retry.

### Snapshot lifetime and privacy

The client list is canonical. The renderer snapshot is derived and rebuildable.
Keep names and metadata only in the owning game window's memory:

- one separate JSON usage document may contain only opaque keys, bounded counts,
  and a monotonic recency sequence;
- no main-process account registry;
- no cross-account sharing;
- no diagnostic character names, search text, UUIDs, or emails; and
- no compatibility path for an older record layout.

Refreshing at every character-select-ready transition gives the snapshot a
clear rebuild story. A failed certificate or invariant publishes unavailable
state and leaves the official client untouched.

## MVP and later work

### MVP

- Command-R palette and Command-Shift-R reload cutover.
- Current-account characters from one certified, in-memory snapshot.
- One complete alphabetical list with direct 1–9 selection and 0 for the tenth
  row.
- A Travel-style bounded search for every account. Multi-term and
  accent-insensitive matching filters the list without changing its order.
- Primary profession icon, name, Current marker, and a default-on optional line
  for secondary profession, level, and reviewed known location.
- Outpost-only switching through one explicit command.
- An explorable-area confirmation before leaving the current instance.
- Progress, refusal, timeout, empty, unsupported-build, and list-not-observed
  states.
- Keyboard, focus, pointer, accessibility, privacy, and exact-build tests.

### Useful later additions

- A complete canonical map-name resolver if another feature also needs it.
- Explicit favorites only if stable alphabetical browsing proves insufficient.
- Party rejoin or return-to-map as a separate product feature with its own
  authority, failure model, and explicit scope.

Do not include party rejoin, status restoration, travel-back behavior,
favorites, aliases, account persistence, campaign art, or a cloned character
carousel in the MVP. GWToolbox++ shows how quickly “switch character” can grow
into party and travel orchestration (`RerollWindow::Reroll`, lines 334–374 and
`RerollWindow::Draw`, lines 521–547); gwonmac should first prove the small core.

## Risks and unknowns

| Risk or unknown | Consequence | Required answer |
| --- | --- | --- |
| Static layout is exact-build-only and live semantics are not yet proved | A valid decode at the wrong lifecycle moment could expose stale account state | Complete the bounded live sequence; keep every other build unavailable |
| List initialization timing | Reading after the token request may see empty or partial data | The list became ready within three 250 ms observations after first settled Selector visibility; still identify the exact token-response boundary |
| Fresh attachment and account change | A new renderer or different account could otherwise inherit stale UI state | Reload correctly produced a fresh absent reader; still prove fresh in-world attach, reconnect, and account change |
| Native WebAssembly selection path | Windows UI messages may not match | Prove the WebAssembly logout, selection, Play, and game-thread call paths independently |
| Character switch leaves active play context | Explorable progress and party continuity can be lost | MVP refuses explorable state and promises no party continuity |
| Existing automatic relog could race explicit switching | A late Return could select the wrong character | Explicit switch and relog share one authority/arbitration owner; starting one cancels or refuses the other before action |
| Current-location naming is incomplete | Partial catalogue could show wrong or missing labels | Use a complete canonical resolver or omit location; do not expand Travel data speculatively |
| Account names are private | Logs or persistence could leak account data | Renderer-memory-only snapshot and diagnostics containing counts/ranges only |
| ArenaNet rebuild changes exact facts | Stale offsets could corrupt behavior | Separate fail-closed capability and normal patch-day recertification |

## Read-only developer probe

The current branch adds only an unpackaged program named
`character-list-probe`. It reuses the existing certified Core profile; it does
not add a production capability or action. The existing Enhancement manifest
gate and the reader both require exact build ID 3759047528. The probe adds no
WebAssembly export, function body, memory initializer, table entry, allocation,
or shipped launch. Packaged policy still resolves every developer program to
`none`.

The installed reader is a direct `DataView` over the live memory and returns a
closed projection. It directly checks:

- a conservative 1–64 character safety bound;
- the `0x84` record range against the current linear memory;
- the root pointer and count again after the complete read;
- three consecutive observations with the same private pointer/count pair;
- unique, non-empty, terminated, well-formed UTF-16 names;
- summary length 33–64 and exact format version 8;
- profession 1–10, level 1–20, campaign 0–5 with no PvE zero, type 0–1,
  and map ID 0–882 (the current artifact's `ConstMission__17530` upper
  bound); and
- an empty selected identity or exactly one matching list index.

The pointer, names, summary bytes, UUID area, raw records, and private content
fingerprint never cross the reader closure. Output contains only status,
reason, observation/stability/revision counts, transition, character count,
selected index, aggregate field validity, and aggregate numeric ranges. The
live runner also suppresses screenshots and does not retain renderer error text
or process output for this program. No probe code invokes a game function,
allocates from the game heap, or writes any live WebAssembly byte. A unit test
compares the complete memory before and after repeated reads.

The probe is intentionally not a production certificate. The live results
must decide which fields and lifetimes graduate into a later exact-build
capability. A new native action requires a separate task and proof.

### First live result — 2026-08-29

One account completed the full manual sequence on build `3759047528`. The
privacy-safe report contained no names, account identifiers, raw records, or
pointers. It proved:

- Before login, the list was consistently absent for 112 observations.
- At the first settled character-select sample, the list appeared with four
  records, warmed for three stable reads, and remained ready for the rest of
  the six-second window.
- Every record passed name, profession, type, campaign, level, and map bounds.
  Aggregate observed ranges were profession 1–7, campaign 1–2, level 1–17,
  and map ID 81–249.
- The same four-record root/count stayed ready through world entry. The first
  in-world settled window ended at 315 consecutive stable root reads.
- Manual logout to character selection did not invalidate the list. Entry on
  a different character kept it ready and changed the unique current identity.
- Normal Guild Wars reload replaced the renderer. The new reader started at a
  fresh observation/revision sequence and correctly reported an absent list at
  the login screen.

The run also exposed three limits:

- The selected-name root did not change during quick carousel browsing. It did
  change across actual world entries, so treat it as current/committed identity,
  not as the highlighted character-select row, until a focused test proves more.
- The run checked structural field validity, not the semantic match between
  every aggregate value and the native on-screen labels. PvP type and every
  campaign were not represented by this account.
- The runner counted one renderer console error during the intentional reload
  and therefore rejected final acceptance, although all ten closed observation
  phases were persisted. Error text was intentionally discarded. A focused
  harness test must determine whether renderer teardown always emits this
  event before the live scenario can claim a clean pass.

Reconnect and account-change invalidation were not exercised. No second
account is required to continue with the read-only production boundary, but
account-change behavior must be proved before the capability can serve more
than one account window lifetime.

### First action result and freeze diagnosis — 2026-08-29

The first action attempt reached and rendered the native character-select
screen, but the renderer then stopped at `selector`. A read-only process sample
showed the Guild Wars renderer continuously using about one CPU core while the
Electron main and GPU processes remained responsive. This rules out a simple
palette-focus problem and localizes the stall to synchronous renderer/WASM
work after logout returned.

Source inspection found two sources of avoidable renderer work. The selector
wait ran the complete pre-game frame scan every 25 ms, and each action-stage
render recomputed the same scan for diagnostics. Separately, the character
snapshot sequence advances every game frame and the Core source notified
listeners even when no displayed character data changed. The production
switch path now performs no pre-game frame scan at all. It waits for a fresh,
already-validated character-list publication, keeps that publication as action
authority, and notifies presentation listeners only when characters, fields,
selected identity, or reader state change. Diagnostic version 2 reports the
pre-game scan as `not-read` with zero reads. This removes the synchronous scan
that the CPU sample localized; the next live run must confirm the freeze is
gone.

The same review corrected the logout payload to `{ unknown: 0,
character_select: 1 }`, matching the established native packet shape in
GWToolbox++. Slot keys are now 1–9 and 0 for the tenth alphabetical row.

### Second action result and Selector correction — 2026-08-29

The next live attempt proved that logout completed and that a fresh Selector
publication arrived without the earlier synchronous freeze. It then failed
closed with `selector-invalid`, one Select call, and no Play call. Comparison
with `LoginMgr::SelectCharacterToPlay` in GWToolbox++ exposed the cause: the
native selector does not accept the desired array index as one direct message.
It queries the current carousel index with message 74, then sends message 49 to
the Selector parent once per adjacent character, with the adjacent character's
name in the native mouse-action payload, querying and confirming the index
after each step.

The certified action now follows that bounded native sequence. It validates the
Selector and child frames, current index, account-array bounds, and every
individual adjacent movement. It stops on the first ambiguity and exposes
distinct privacy-safe codes for missing frame, missing child, invalid index,
and unconfirmed movement. The frame locator also exits its bounded search when
it finds a match; its previous branch targeted the loop and could repeat the
same matching frame indefinitely. The generated module validates and the exact
installed artifact certifies, but the corrected native sequence remains live
acceptance pending.

The palette now uses the same `gwSurfaces` keyboard owner and event-isolation
boundary as Travel. Character rows are native focusable buttons: Tab and
Shift-Tab traverse them, arrows wrap between them, and Return activates the
focused row. Close, Details, and Copy keep native focus behavior. Failures stay
inline with the list, and Escape can hide the palette during a native switch
without cancelling or repeating the action.

### Third action result and frame API correction — 2026-08-29

The next privacy-safe diagnostic reached the visible Selector with frame proof
mask `63`. This proves that count, frame array, matching frame ID, Selector
hash, and visibility all passed. The action then ended with
`selection-not-confirmed`, one Select attempt, and no Play attempt.

A later retry produced a client assertion at `FrApi.cpp:3887`:
`msgId >= FRAME_MSG_EX`. Exact disassembly proves that function `6841` accepts
only message IDs above `85`; its sole native caller passes `88`. The action had
incorrectly passed internal messages `49` and `74` to that external-frame API.
One branch also passed a derived frame pointer where the API required a frame
ID. Exact-body certification had proved the function identity but had not
proved this semantic precondition.

The unsafe API path is deleted. The proof now accepts an internal dispatcher
only when the exact external wrapper resolves the frame once, contains the two
`85` boundary checks, and delegates to exactly one four-argument dispatcher.
For build `3759047528`, this derives function `6508` with body hash
`ccf496f855fa579dac0d1ea86b95b6a6db21104d2a41b1d03c6bd213ee26ca7e`.
The action validates each child and parent ID through the exact native frame-ID
resolver before it calls that dispatcher. It does not encode, offset, or retry
an internal message through the external API.

The Play packet now follows the current frame size and button fields: both
action IDs use the button child ID, the state is MouseUp, and a private bounded
parameter carries the button-owned value. This correction is statically
certified and WebAssembly-valid. It is not live proof that Selector movement or
Play succeeds.

### Fourth action result and readiness correction — 2026-08-29

The next live attempt again proved the visible Selector with frame proof mask
`63`, then failed closed with `selector-child-missing` after 500 ms. Logout was
sent once; no Selector click or Play action was sent. This narrows the failure
to native UI construction timing: the account character array can refresh
before Selector child 0, which owns the carousel, exists.

GWToolbox++ independently uses the same lifecycle distinction. Its
`LoginMgr::IsCharSelectReady` requires UI state 2, a visible Selector, and a
valid Selector context before `SelectCharacterToPlay` resolves child 0 and
queries the carousel index. Its reroll controller separately waits up to ten
seconds for that predicate after logout, then rechecks it before selection
(`GWToolboxdll/Utils/ToolboxUtils.cpp`, lines 252–323;
`GWToolboxdll/Windows/RerollWindow.cpp`, lines 674–720). This is supporting
control-flow evidence only; no Windows address or structure offset is used by
gwonmac.

The fixed 500 ms delay is removed. The WebAssembly action now publishes proof
bits for child existence and validation, index-query dispatch and range, click
dispatch, and click confirmation. The controller may retry only result codes
4–6, which occur before a click. It polls at 100 ms for at most eight seconds,
revalidating focus and the account list each time. Timeout, result 7, or any
post-click ambiguity remains terminal and is never retried. Diagnostic version
4 retains the last Selector proof separately because the following Play action
uses the shared packet. The live runner also records at most 64 changed,
privacy-safe states during the manual action so a renderer replacement or
client failure does not erase the last observed stage.

The first bounded-readiness run ended with mask `1023`: bits 0–9 proved the
visible Selector, carousel child, index query, and valid current index, while
no click bit was present. The apparent `selector-child` repetition was therefore
a diagnostic alias, not a child-readiness failure. The action had reached its
manual parent-relation interpretation and refused before dispatch.

Exact inspection of the installed WebAssembly identifies function `6797`
(`46c90817c6ab335d5b8d57fdc1e38abd146c2b123dd8dcf0f08aca8245b8a9f2`),
signature `(i32) -> i32`, as the native parent-frame resolver: it resolves the
input frame ID, walks the relation through the client's own implementation, and
returns the parent frame ID. This is the WebAssembly equivalent of the
`GetParentFrame(selector)` call used by GWToolbox++. The manual relation read is
deleted. The exact function is now part of the `preGameControls` certificate,
and both Selector and Play use it before separately validating the returned ID
against the certified frame array. Parent failures have distinct closed codes;
they are never mislabeled as missing children.

The first native-parent run returned mask `5119` (`0x13ff`): the native parent
resolver returned a nonzero ID, but the independent validator rejected it
before message 49. Static inspection then proved that the validator was using
the wrong registry. The visible-frame scan uses globals `0x5a1fdc` and
`0x5a1fe4`, while exact function `6534` resolves frame IDs through the native
ID manager at `0x5a3b1c` and `0x5a3b24`. Functions `6796`, `6797`, and the
external wrapper `6841` all use function `6534`; this makes it the authoritative
resolver for IDs returned by the native child and parent relations.

The direct array check is deleted. Function `6534`, signature `(i32) -> i32`
and body hash
`f0d5e7c4c71f920541037b1225613e334e2476723a427cab5c2688538265eb47`,
is now part of the exact `preGameControls` certificate. The action calls it and
then checks that the resolved frame's own ID matches. Diagnostic bits separate
nonzero parent ID, successful native resolution, ID equality, and completion.
This remains fail closed: message 49 is sent only after every check passes.

### Fifth action result and confirmation scheduling — 2026-08-29

The next live run reached mask `96255` (`0x177ff`). This proves the visible
Selector, carousel child, index query, native parent resolution and identity,
and one message-49 click dispatch. The following index query did not yet show
the expected adjacent index, so the action failed with
`selection-not-confirmed`; Play was not called. The client did not freeze or
assert, and no click was repeated.

The generated action had scheduled exactly one confirmation on the next
game-thread drain. That is too early for a WebAssembly UI message whose visible
carousel update may settle on a later drain. Confirmation now remains inside
the native action slot: it performs only the read-only Selector index query
for at most 180 drains, while the renderer retains its four-second deadline.
It never redispatches message 49. Focus loss, policy cancellation, timeout, or
an unchanged index still fails closed before Play. Diagnostic version 5 adds
only bounded requested and observed indices so a later run can distinguish a
delayed update from a Selector/account-array ordering mismatch.

The first version-5 retry crashed with an out-of-bounds read in the generated
action while character selection was still being constructed. Its retained
proof mask was `15`: the registry count, table root, nonzero entry, and matching
frame ID had been observed, but the entry itself had not been range-checked
before reading the remaining frame fields. A bounded count does not make every
mutable pointer in that table safe.

The frame locator now validates the complete pointer-table range against the
current `memory.size` and checks every candidate pointer plus the certified
frame byte size before any field read. A transient stale entry is skipped and
eventually produces a retryable pre-click readiness result rather than a trap.
The controller additionally treats any readiness-shaped result carrying the
click proof bit as terminal ambiguity, so no changing frame registry can cause
a second message-49 dispatch.

The first run with that bound no longer crashed, but timed out with proof mask
`3` for all 60 readiness observations. No click or Play call occurred. Static
reproduction found an emitter bug in the new candidate predicate: it combined
the raw pointer value with a Boolean range result using `i32.and`. Valid frame
pointers are aligned and therefore even, so their low bit is zero and the
predicate rejected every valid entry. The pointer is now normalized to a
Boolean before the conjunction. An executable one-page WebAssembly regression
test uses the exact emitted predicate and proves that null, a truncated record,
and an outside pointer fail while an ordinary aligned pointer and the last
complete record pass. The corrected complete transform also recertifies
against the installed build. Live action acceptance remains pending.

The following live run reached proof mask `96255`, dispatched message 49 once,
and observed index `0` while the requested list index was `2`; it never called
Play. This exposed a separate protocol-number error. GWToolbox++ names its
query enum `kFrameMessage_0x4a`, but the current enum assigns that symbol the
numeric value `0x5a` because earlier message values contain gaps. The action
had encoded the historical symbol suffix as decimal 74 instead of the current
numeric message ID 90. The query now uses a named `0x5a` constant and the
click uses a named `0x31` constant. The bytecode test requires message 90 and
explicitly rejects message 74.

A developer-only `character-selector-trace` live scenario now provides a
second evidence path if the corrected packet still fails. It uses Chromium's
CPU profiler for equal ten-second idle and manual-action windows; precise
coverage was rejected after the current Electron build returned no WebAssembly
functions. Its closed projection contains only bounded function indices and
numeric sample-count deltas; URLs, function text outside the fixed
`wasm-function[N]` grammar, arguments, names, pointers, and payloads are
dropped. The runner performs no game input or native action.

The first CPU trace captured 388 idle and 415 manual-window WebAssembly
functions. Its delta included the certified internal dispatcher `6508`, native
frame resolver `6534`, and nearby frame helpers `6535`, `6567`, `6840`, and
`6843`. This confirms the action is aimed at the same native subsystem as a
manual switch. The window also included Play and world entry, which introduced
unrelated loading work and two renderer lifecycle errors. Future traces stop
after changing the highlighted character and explicitly exclude Play, so they
isolate Selector movement if the corrected `0x5a` query still needs research.

### Sixth action result and native Selector identity correction — 2026-08-29

The corrected `0x5a` query returned native carousel index `1` while the
requested account-list index was `0`. Proof mask `96255` showed that the frame,
child, query, parent, and one click dispatch all completed, but the native
index remained `1`. No Play action ran. This proves that the account character
array index is not authority for the Selector carousel index on this account.

The earlier action also sent the account-record name address as the Selector
button value. GWToolbox++ does neither. Its `LoginMgr::SelectCharacterToPlay`
gets the typed Selector context from the frame's latest callback, finds the
requested name in `context->chars`, and sends that Selector-owned name address.
The current WebAssembly frame dispatcher independently proves the callback-row
shape: function `6508` scans 12-byte rows at frame `+0xa8`, and the context
value is row `+4`. The exact frame body hash already pins that relationship.

The generated action now treats the fresh account record only as the requested
identity. Before a click it:

1. bounds the callback array and finds the latest non-null context;
2. verifies the context frame ID against the live Selector frame;
3. bounds the Selector character pointer array and its capacity;
4. resolves one unique exact 20-unit UTF-16 name match; and
5. uses only that native index and Selector-owned name address for navigation.

Any context, array, record, count, capacity, identity, missing-name, or
duplicate-name failure stops before a native message. Diagnostic version 6
adds only Boolean proof fields for callback rows, context, frame identity,
character array, target match, and target pointer. It exposes no name, pointer,
record, or payload. The exact installed artifact rebuild validates after this
change. Live semantic acceptance remains pending.

The live runner now resolves the sole current `gw://app/` account renderer for
each fixed projection read. This prevents logout or renderer replacement from
leaving the character-switch sampler attached to an obsolete page. It still
has no page evaluator or input capability in the observation scenario.

The first context-aware live attempt proved the callback rows, context, and
Selector frame identity, then refused before the character array with mask
`0xe03ff`. Static comparison found the exact cause: `GW::Array` stores
`buffer`, `capacity`, then `size`. The first transform read `size` and
`capacity` in the opposite order. The Selector context offsets now use
capacity at `+0x0c` and size at `+0x10`. The refusal occurred before a native
click, so the attempt did not leave an ambiguous action.

The next attempt reached the same pre-array mask. The array may describe all
purchased carousel slots, including empty slots, while the account array
contains only used characters. Requiring equal counts was therefore not a
safety invariant and disagreed with GWToolbox++'s null-record check. The action
now accepts a bounded native size up to 64, skips null character records, and
still requires one unique exact target-name match before it can click. Version
6 failure handling also distinguishes context, array, and target readiness.

### First successful native switch — 2026-08-29

After removing the used-count equality and allowing bounded null carousel
slots, the operator reported one successful outpost-to-outpost character
switch. The action used the native logout, adjacent Selector navigation, and
Play sequence. No crash or freeze was reported. This is operator evidence; the
live runner did not record terminal acceptance because the palette reset the
controller's `complete` state to `idle` in the same microtask that closed the
surface.

The palette now retains `complete` until the next open. This gives the 100 ms
observation sampler a stable terminal state without changing native behavior.
The same renderer pass blocks Tab, collapses diagnostics for each new failure,
restores the list with Back or Enter, and skips the disabled Current row during
arrow navigation. A repeated live run still needs to prove the runner's closed
terminal result and updated Current marker.

## Focused runtime research plan

The developer-only, read-only probe is implemented. It includes no switch
action. The first operator run is complete; remaining proof is focused:

1. **Static structure proof — complete.** The exact current artifact owns the
   `GcApi` list and native summary decoder documented above. The `UiPregame`
   model-slot array was rejected as the source. No native sibling offset was
   copied.
2. **Observe timing — partly complete.** Cold login, first settled Selector,
   world entry, logout, second-character entry, and renderer reload are proved.
   The exact token-response boundary, reconnect, fresh in-world attachment, and
   account change remain.
3. **Validate the list.** Require a bounded array, plausible count, stable
   pointer/count/revision, unique non-empty UTF-16 names within the native
   record limit, profession enum in range, level in range, known campaign/type
   values, and a selected index within the list. Diagnostics may record only
   counts, masks, ranges, and hashes—not names or raw records.
4. **Validate each field — structural proof complete.** Compare the native
   on-screen character details with the probe for a PvE and PvP character, all
   available campaigns, several professions, different levels, and known
   locations. Mark any field that cannot be proved as absent from the MVP.
5. **Measure lifetime — partly complete.** The native list remains valid after
   world entry and logout on the tested account; module replacement creates a
   fresh absent reader. Confirm fresh in-world attachment, reconnect, and
   invalidation on account change.
6. **Production reader — complete for this exact build.** The fixed companion
   kernel now owns the same bounded validation and publication contract. Repeat
   the live matrix on a second account only if account-change invalidation must
   be admitted before release, and never record its data.
7. **Native action — repaired and statically certified; live acceptance
   pending.** The external-frame API misuse is removed. The exact internal
   dispatcher relationship, frame-array validation, logout path, and bounded
   Selector/Play payloads are installed behind closed actions. The next live
   run must prove the complete sequence and loaded-name confirmation.
   Explorable, reconnect, and second-account coverage remain deferred;
   ambiguous actions are never retried automatically.

The action research should use a throwaway test character target or another
low-risk outpost character. It should never run in an explorable instance.

## Live operator handoff

### Character-switch acceptance

The feature is ready for one operator-driven action run:

```sh
cd /Users/matthias/Git/games/guild-wars-mac/gwonmac-quick-character-switch
GW_LIVE_SMOKE=1 pnpm enhancements:live -- --scenario character-switch
```

The runner opens the application with observation authority only. It never
opens the palette, selects a row, invokes a native action, or synthesizes input.
Follow its three terminal checkpoints: enter a safe character in an outpost and
compare the palette locally; select another character once and wait for the
target outpost; then reopen the palette and verify Current moved and remains
disabled. The final JSON is safe to return. If the palette fails, use **Copy
diagnostics** and return only that JSON plus a plain description of whether the
game visibly remained in-world, reached character selection, or started
loading. Do not return screenshots, character names, account text, or game
logs. Close Guild Wars normally to stop; Control-C stops a runner left waiting.

This run proves whether the exact WebAssembly client accepts the certified
logout message, Selector action, and native Play packet once each, and whether
the production observer confirms the exact loaded identity. It does not test a
second account, reconnect, explorable refusal, or optional metadata.

### Retired read-only qualification probe

The temporary raw-memory character-list probe and its manual trace scenario
were removed after the compiled companion kernel became the certified
production reader. Keeping both would create two parsers and two sources of
truth for the same private records. The remaining `character-switch` live
scenario reads only the closed production diagnostic projection and never
initiates an action itself.

## Implementation plan and acceptance criteria

### 1. Prove and certify read-only character observation

Acceptance:

- The exact current build publishes the complete account list only after all
  array and record invariants pass.
- Every requested field is either live-verified or omitted.
- Account change, module replacement, and invariant failure invalidate the
  snapshot.
- Unknown builds expose no reader and the official client remains playable.
- Diagnostics contain no names, UUIDs, email, search text, or raw memory.

### 2. Prove and certify one native switch command

Acceptance:

- The command accepts one opaque character key and resolves the live index and
  bounded name inside the controller immediately before enqueue.
- It refuses current, absent, concurrent, unconfirmed explorable, unfocused,
  reconnect, and unsupported states before consequential action.
- It uses native logout, Selector, and Play behavior and verifies the loaded
  name before success.
- Each stage has one deadline. Timeout or ambiguity ends without automatic
  retry.
- Automatic relog cannot send input during an explicit switch.

### 3. Add the palette and shortcut cutover

Acceptance:

- Command-R toggles Switch Character in every game window; Command-Shift-R
  invokes Reload Guild Wars.
- The shortcut editor has one canonical `character.switch` action, detects
  conflicts, and reserves the new reload binding.
- Open, close, focus, pointer-lock, Escape, trapped Tab, arrows, Return, 1–9/0, mouse,
  disabled-current, and canvas-focus behavior matches Quick Travel.
- The surface handles minimum one, typical 5–12, and a certified maximum
  character count without layout or focus failure.
- Rows use shared tokens and existing profession assets in Guild Wars, Modern,
  and Custom styles. Narrow and short viewports remain usable.
- Screen-reader roles, active descendant, current state, live status, full
  accessible names, focus visibility, and reduced motion pass review.

### 4. Verify the complete story

Acceptance:

- Unit tests cover snapshot validation, ordering/navigation, shortcut migration by
  defaulting—not a compatibility layer—and every refusal transition.
- Electron tests cover the palette interaction contract and reload shortcut.
- A live outpost test switches to a different character and confirms the exact
  loaded name. A second test confirms refusal in an explorable instance.
- `pnpm run check` passes, followed by the repository's required live and
  release verification for a new certified Enhancement capability.

## Source index

| Repository | File and symbol | Lines | What it supports |
| --- | --- | --- | --- |
| gwonmac | `src/renderer/travel-palette.ts`, `createTravelPalette` | 16–119 | Palette toggle, focus, pointer lock, isolation, and surface lifecycle |
| gwonmac | `src/main/certification/enhancement-character-switch-transform.ts`, action builders | 34–170 | Closed enqueue/configure ABI, exact game-thread logout, Selector selection confirmation, and Play calls; no generic native export |
| gwonmac | `src/renderer/character-switch-controller.ts`, `createCharacterSwitchController` | 39–263 | Private target lifetime, fresh-name resolution, deadlines, once-only progression, final identity confirmation, and safe diagnostics |
| gwonmac | `src/renderer/character-switch-palette.ts`, `createCharacterSwitchPalette` | 68–240 | Compact canonical icon rows, arrows/Enter/1–9/0 keyboard behavior, Current refusal, recoverable error state, and diagnostic copy |
| gwonmac | `src/companion-kernel/character_list.rs`, `tick` | 97–228 | ABI 2 root stability, bounded records, name/metadata validation, secondary profession, unique character keys, and selected identity |
| gwonmac | `src/companion-kernel/character_identity.rs`, `character_key` | 6–20 | Shared one-way FNV-1a key over the bounded 16-byte character UUID; raw UUID never leaves the kernel |
| gwonmac | Retired character-switch usage document | — | The original private ranking store was removed when Character Switch returned to one stable alphabetical order. |
| gwonmac | `src/renderer/character-switch-palette.ts`, ordering/search/keyboard | 50–105, 220–470 | Stable alphabetical order, all-account search, complete scrolling, optional details, numeric gating, arrows, Return, and Escape |
| gwonmac | `src/renderer/character-switch-controller.ts`, final confirmation | 315–335 | Playable-outpost, exact name, and exact opaque-key confirmation before completion |
| gwonmac | `tests/integration/enhancements-kernel.test.ts`, account-list publication | 275–327 | Compiled-kernel proof for stable warmup, ABI decode, secondary profession, selected identity, and duplicate-key refusal |
| gwonmac | `src/main/window-menu.ts`, `switch-character` / `reload-game` | 420–430 | Command-R hard cutover and Command-Shift-R reload |
| gwonmac | `src/shared/keyboard-shortcuts.ts`, canonical action/default | 5–47 | Core `character.switch` ownership and default Command-R binding |
| gwonmac | `scripts/enhancements-live/scenarios.ts`, `character-switch` | 994–1042 | Observation-only manual acceptance and bounded privacy-safe result |
| gwonmac | `apps/tools/src/components/TravelPalette.vue`, query/watch/key/template | 164–192, 359–420, 462–465 | Search focus, keyboard contract, listbox markup, footer/status |
| gwonmac | `apps/tools/src/styles.css`, `.travel-palette` | 8–28 | Reference geometry and material |
| gwonmac | `tests/electron/input-travel.spec.ts` | 63–175 | Existing interaction acceptance behavior |
| gwonmac | `src/main/window-menu.ts`, `reload-game` | 420–424 | Existing Command-R conflict |
| gwonmac | `src/shared/keyboard-shortcuts.ts`, shortcut model and reserved list | 5–44, 134–162 | Existing actions/defaults/conflict policy and reserved Command-R |
| gwonmac | `src/renderer/harness.ts`, account-token interception | 1116–1128 | Token request precedes character selection |
| gwonmac | `src/shared/enhancement-contracts.ts`, `preGameControls` | 111–118 | Current closed pre-game boundary |
| gwonmac | `src/main/certification/enhancement-builds.ts`, `preGameControls` | 512–546 | Current exact labels/layout only |
| gwonmac | `src/main/certification/enhancement-pre-game-transform.ts`, readers | 1–5, 100–114, 234–264 | Privacy-safe closed observation and state mapping |
| gwonmac | `src/renderer/character-switch-model.ts`, closed domain and diagnostics | current | One typed boundary for controller, host, palette, and privacy-safe live observation |
| gwonmac | `src/shared/character-switch-action-abi.ts`, fixed action contract | current | One source of truth for the private 40-byte action region, result codes, and proof bits |
| gwonmac | `src/shared/enhancement-contracts.ts`, `characterSwitchAction` | current | Native action authority is separate from read-only `preGameControls` observation |
| gwonmac | `src/renderer/automatic-character-return.ts`, `continueAfterToken` | 248–299 | Existing selected-character relog flow and verification |
| gwonmac | `apps/tools/src/trader-assets.ts`, `PROFESSION_IDS` | 3–35 | Existing bundled profession asset mapping |
| gwonmac | `THIRD-PARTY-NOTICES.md`, Trader assets | 56–65 | Existing asset provenance and terms |
| GWToolbox++ | `GWToolboxdll/Utils/ToolboxUtils.h`, `AvailableCharacterInfo` | 91–142 | Rich account character fields and record size for that client |
| GWToolbox++ | `GWToolboxdll/Utils/ToolboxUtils.cpp`, `LoginMgr` | 251–324 | Ready predicate and native named selection for that client |
| GWToolbox++ | `GWToolboxdll/Windows/RerollWindow.cpp`, `Draw`, `Initialize`, `Update` | 559–649, 662–720 | List timing/retention, profession UI, logout/select/play/verify sequence |
| GWToolbox++ | `GWToolboxdll/Modules/Resources.cpp`, profession resources | 111–123, 941–963 | Canonical Wiki Tango icon strategy used by Toolbox |
| GWCA | `Include/GWCA/Context/PreGameContext.h`, `PreGameContext` | 10–25 | Pre-game character array and chosen index for that client revision |
| GWCA | `Source/GWCA.cpp`, pre-game scan and getter | 78–90, 131–139 | `UiPregame.cpp` / `!s_scene` context discovery |
| GWCA | `Include/GWCA/Managers/UIMgr.h`, `UIMessage` | 128–142 | Login state and logout-to-character-select message evidence |
| GWCAjs-web-app | `gwca/Include/GWCA/Context/PreGameContext.h`, `LoginCharacter` | 10–45 | Name, campaign/PvP, level, map ID, array, and chosen index in a newer vendored layout |
| GWCAjs-web-app | `gwca/Source/GWCA.cpp`, pre-game scan/getter | 131–149, 216–218 | Independent `UiPregame.cpp` / `!s_scene` discovery |
| GWCAjs-web-app | `GWCAjs/PROGRESS.md` | 79 | Pre-game context is not exposed by its JavaScript layer |
