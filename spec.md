# Hub

Status: implementation specification. This document owns the target Hub experience.
It does not claim that the current development build implements these requirements.
The current refinement is tracked in [the Hub delivery plan](docs/hub-overhaul-plan.md).

Hub replaces the earlier Scry product proposal. Existing runtime documentation
continues to describe the development build until each implementation lands.

## 1. Product outcome

Hub is the central keyboard interface for gwonmac. It searches and operates
people, places, characters, saved builds, saved teams, enabled tools, and conversions.
Short tasks finish inside Hub. Trade and Whispers use independent popouts.
Build browsing/application stays in Hub; authoring uses the Build workspace.

Three defining journeys:

- `⌘R → team gom afk` selects the saved team named or explicitly aliased `gom afk`.
  The visible action applies that complete supported team configuration.
- `⌘R → build smiter` selects the saved build or template named or aliased `smiter`.
  The visible action loads it onto the explicitly identified target.
- `⌘R → 10 ecto in p` shows a sourced conversion with buy/sell meaning and quote age.

Typing never changes the game. Enter executes the clearly displayed action for
one explicitly resolved result. Hub does not guess a destination, build, or team.

## 2. Non-negotiable experience

- Call the feature **Hub** everywhere in player-facing text.
- Hide disabled tools completely, including results, aliases, pins, history,
  child actions, and suggestions. Do not offer to enable them from search.
- Open Settings only through an explicit Settings action or the app menu.
- Keep Storage failures silent. Do not show a toast, dialog, sound, or error row.
- Do not show generic success notifications or unsolicited instructional popups.
- Keep failures that matter to an active task inside that task. A failed whisper
  must not look delivered; an incomplete team must not look applied.
- Preserve drafts, selections, and filters through navigation and detachment.
- Use existing game-state restrictions and certified command owners.
- Do not add AI interpretation, typo correction, semantic search, or automatic execution.
- Keep local search independent of remote service availability.

## 3. Entry points and shortcuts

The latest user examples supersede Layout 1's Hub-on-⌘F decision. Hub uses ⌘R.
To retain the no-Shift requirement, this specification assigns Character Switch
⌘E. This is the resulting design choice, not a claim that the user separately
selected ⌘E. The other Layout 1 assignments remain.

| Shortcut | Destination |
| --- | --- |
| ⌘R | Hub home; dismiss Hub when it is already active |
| ⌘E | Hub Characters |
| ⌘T | Hub Travel |
| ⌘B | Browse Builds when Hub is open; Build workspace otherwise |
| ⌘K | Trade popout |
| ⌘D | Whispers popout |
| ⌘S | Open Xunlai Storage directly, silently |
| ⌘G | Existing opt-in Call Target command |
| No default | Settings, Resign, map layers, diagnostics |

Keep editing, window, and macOS system shortcuts intact. Do not bind ⌘F yet.
Keep Travel's existing ⌘1–9 assignment behavior. Do not overload ⌘K for Hub actions.
Remove the dedicated Settings accelerator as requested; retain the explicit menu item.

Direct shortcuts enter the same feature owner as search. They use its Hub view
or popout according to the table. Do not create duplicate windows. Disabled-feature shortcuts do nothing.
Keep each existing shortcut toggle/focus contract. Direct entry has no artificial
Home history step. Returning restores the actual launching control; first entry
focuses the task control, such as the current character card, rather than always search.
The shortcuts are window-scoped, not system-wide hotkeys.

Preserve custom bindings and cleared assignments. A custom binding wins over a
new default. Resolve conflicts in the existing shortcut editor, never on invocation.
Keep Hub accessible from View when its default is occupied. Test old settings
readers before persisting new shortcut keys. Do not silently corrupt downgrade data.
Describe changed defaults in release notes and shortcut settings, without a popup.

A chat slash-command entry point is deferred. Existing `/tp` must continue to reach
Travel. Do not introduce a generic slash-command executor as part of Hub.

## 4. Panel and navigation

Use the existing Classic and Modern appearance systems. Start with a compact
panel near the upper center of the active game window, approximately six to eight
rows. Clamp its size to the viewport. Keep the outer frame fixed through queries and page changes; scroll detailed
content inside it. Respect reduced motion and text scaling.

Home contains a focused search field, a short Pinned section, existing relevant
recents, and enabled sections. Do not show dangerous actions in empty-query recents.
Use the placeholder **Search people, places, builds…**. Use Guild Wars names for
objects: Xunlai Storage, Guild Hall, outpost, hero, profession, skill template,
Globs of Ectoplasm, and platinum. Prefer clear action verbs over invented lore.

Every row has a stable identity, full name, type, and an explicit primary action.
The footer names what Enter will do. Do not rely on colour or icons alone.

- Up/Down selects rows. Enter performs the displayed action.
- Escape closes an action menu, then goes back one level, then dismisses Hub.
- A direct shortcut has no artificial Home step when Escape closes its section.
- A visible Actions button exposes secondary actions. Tab reaches it; its menu
  supports normal arrow navigation. Do not consume text-editing arrow keys.
- Back restores query, caret, selection, scroll, and the launching control.
- A fresh invocation focuses global search. Temporary app blur and popout handoffs
  retain the current task; explicit closure ends it. Tool state and drafts have
  their own existing lifetimes.
- Clicking outside dismisses without sending or applying anything new.
- While Hub owns focus, typing must not reach the game. Restore the previous
  game focus on dismissal and correctly release held modifiers and movement keys.

Observer updates must not move selection to another identity. If a selected item
vanishes, clear selection and require a new choice. Never execute its replacement.

## 5. Deterministic query contract

### Grammar

Recognize a closed set of leading words: `team`, `build`, `travel`, `char`, `acc`,
`whisper`, and `trade`. Their exact registered aliases may also select a scope.
The rest of the input is a name query, not executable instructions.

Recognize conversions only when the entire input matches a supported numeric
expression or `<amount> <unit> in <unit>`. Parse with a bounded grammar, never eval.
Reject unsupported operators, non-finite values, excessive input, and division by zero.
Use decimal arithmetic or equivalent exact unit arithmetic with defined rounding.

Normalize case, surrounding whitespace, and repeated spaces. Preserve punctuation
and diacritics in identities. Do not transliterate or infer abbreviations.

### Matching and execution

1. Restrict candidates to enabled sources and the explicit scope, if present.
2. Prefer exact normalized names and exact explicit aliases as one exact tier.
3. For discovery, match complete query tokens against name/tag token prefixes.
4. Sort equal discovery matches by canonical name, then stable identity.
5. Do not use edit distance, substring fragments inside tokens, hidden popularity,
   remote language models, or changing learned ranks.

An exact alias colliding with another exact name is ambiguous. No exact match
may win merely because it came from a different source.

A unique exact `team` result can expose Apply directly with its configuration
preview visible. Enter is the explicit confirmation; Right opens optional review.
Partial or ambiguous teams require review. Every single build opens a target page
with the incoming build visible and Apply to me focused. Multiple exact matches require explicit row selection first.
Bare person queries open actions; bare build/team queries open detail, not Apply.

Examples:

| Query | Required interpretation |
| --- | --- |
| `team gom afk` | Exact saved team name/alias; never travel to `gom` |
| `team gom af` | Prefix candidates; Review before Apply |
| `team gmo afk` | No match unless that exact alias exists |
| `build smiter` with two templates named Smiter | Show folder/profession/source; require selection |
| `Foo` | Person detail, never send a whisper or travel automatically |
| `10 ecto in p` | Conversion, not a tool-name search |

No matches displays only **No matches** and retains the editable query.

## 6. Team application: the flagship flow

1. Open Hub and type `team gom afk`.
2. Resolve the saved team's stable ID and current revision.
3. Show its canonical name and compact configuration preview in Hub.
4. Show the player build, ordered hero roster, assigned builds, and every other
   field the existing Team Apply plan will actually change.
5. Assess readiness using the existing Team Apply domain owner.
6. Display **Apply team GOM AFK ↵** only when the plan is ready.
7. On Enter, revalidate identity, revision, active client, region, and party state.
8. Execute once through the existing observation-driven runner.
9. Close after observed completion with a brief named build/team receipt.
   If already configured, do not resend changes.

“Full team” means every field supported by the canonical saved-team model and
apply runner. It does not promise equipment, consumables, positioning, travel,
other players' builds, or any unsupported field. Never invent replacement heroes
or substitute a different build to make a plan pass.

Preflight failures appear inside the preview, without a modal or Settings link.
Examples include unavailable heroes, locked skills, profession mismatch, incomplete
party observation, unsupported region, or not being in a PvE outpost.

Hold the selected plan stable. If the saved team changes before execution, require
review of the new preview. Disable duplicate submission while applying. Native
execution still rechecks its own invariants; the preview grants no authority.

Application is not transactional. If a later step fails, show **Team partly applied**
with completed and remaining changes. Do not claim rollback or silently restart.
Retry requires a new assessment against observed state. Dismissal does not claim
cancellation of commands already accepted; reopening shows the existing operation.
Use the runner's existing stop conditions on client or session changes.

## 7. Build and template application

`build smiter` searches the existing saved library and account template owner.
Profession names and acronyms filter by the saved primary profession: `build monk`,
`build mo`, or `build monk smit`. Keep every matching build available in the list.
Profession matches open target selection; searching never applies a build.
Each build result shows eight small skill icons beneath its name, preserving skill
order, with an elite outline and skill names on hover. Missing icons retain a
numbered slot. Production uses the existing skill catalogue and icon route.
Do not copy templates into a Hub database. Distinguish duplicate names with folder,
profession, and source. Display eight skills, attributes, and supported profession
changes before execution, based on the actual decoded template.

Default target is explicitly **Your character: <name>**, never the selected game
target. A target selector may choose an eligible hero. The choice stays visible
and is revalidated at execution. A new root build command resets to Your character.

Every single build opens **Apply to me / Apply to hero**, including exact names.
Enter on an eligible hero applies to that named hero; Right opens optional
comparison. Blocked heroes remain inspectable without executing. Keep current-party
heroes separate from unlocked heroes outside the party. Reuse the existing named build-load path where available. If inspection
finds no suitable certified single-build command, that is capability work for this
milestone; do not simulate a team replacement or broaden a raw bridge to achieve it.

Refuse incompatible or unsupported loads inline. Preserve templates and library
records. Show success only from the existing observation contract. No automatic
substitution, remote build generation, or loading while the player merely types.

## 8. Currency and calculator

`10 ecto in p` resolves exact unit aliases: `ecto` to Glob of Ectoplasm and `p`
to platinum. Fixed conversions and arithmetic work offline. Market-priced results
require a verified quote source and explicit buy/sell semantics.

The current Trade subsystem already owns observed NPC trader buy/sell quotes.
Reuse that source and its network owner. Do not describe NPC quotes as the player
market rate. Player advertisements form a separate, explicitly inferred source.

For an unqualified ectoplasm conversion show one card with a **Buy from trader** /
**Sell to trader** selector when both sides are available.

Always show source, quote observation time, and freshness beside the result.
Verify upstream field direction and units before implementation; do not guess which
field is the player's buy price. If only one side exists, label only that side.
Quote multiplication is an estimate from the observed unit quote, not a guaranteed
executable bulk transaction or promise that the quote stays unchanged.

Fetch only for a complete valid market query while that view is visible. Reuse
bounded existing demand, caching, and request limits. Late responses must belong
to the same query and cannot replace a newer result. No background market monitor.

“Current” requires the existing source owner's documented freshness limit. If no
limit is defined, establish and test one during source validation before shipping.
Stale results say **Last observed**, never Current. Offline with no quote says
**Rate unavailable** inline. No fallback invented number or stale-as-live result.

Manual rates are optional and visibly labelled **Your rate**. They never silently
replace a missing live rate. A source selector can choose manual or observed trader
quotes explicitly. Player-market estimates use the bounded inference rules in [Trade discovery](docs/trade-discovery.md#hub-inferred-currency-estimates). They start with `~`, identify inferred median Kamadan advertisements, and retain side, sample counts, and observation age. Missing evidence stays inline.

Enter copies the selected conversion; both direction and amount are visible.
Round display amounts only at the final step, retain precise arithmetic internally,
and show the unit. Remote conversion disappears when its owning tool is disabled;
the independent calculator and fixed conversions can remain enabled.

## 9. Other end-to-end sections

| Section | Presentation | Completion |
| --- | --- | --- |
| Travel | Existing destinations, aliases, favourites, history, Guild Hall | Explicit destination action, then quiet close |
| People | Identity, presence, available Whisper/Invite/Travel actions | No social or travel action without an explicit choice |
| Whispers | Floating conversation with unread state, history, composer and delivery/retry | Send stays in conversation; Escape preserves draft |
| Trade | Floating ledger with sources, search, filters, message detail and quotes | Contact opens addressed composer without sending |
| Builds/Teams | Browse, inspect and apply in Hub; authoring in the Build workspace | Open the same saved record in its editor; preserve draft |
| Characters | Compact left-aligned carousel; `char name` selects the explicit switch action | Existing switch workflow and explorable-area confirmation |
| Accounts | Saved profile names and runtime state; `acc name` offers open or replace | Launch successfully before closing the source; normal sign-in |
| Maps | Existing layer toggles, ranges, opacity, style controls | Update inline and remain open for comparison |
| Storage | One existing named action | Dismiss and attempt; completely silent failure |
| Resign/reload | Explicit search-only entries | Existing confirmation, never empty-query suggestions |
| Settings | Explicit entry and relevant supported section links | User deliberately chooses configuration |

Travel to a friend means **Travel to outpost**, not join their exact instance.
Current runtime travel only proves map-ID travel with its existing district policy.
Do not promise editable live district selection until the native contract supports it.
Use fresh live location authority, not retained whisper contacts, before travelling.
**Invite to party** sends one named `/invite` line through the certified chat
mailbox, only from a PvE outpost. **Travel and invite** travels to the friend's
outpost (Any district), waits for a settled arrival of the same character, and
then sends one invite. A refused trip, a character change, or no arrival within
60 seconds sends nothing. Guild Wars reports the invite result in chat; Hub
claims only that Guild Wars took the command.

Maps and display features retain their settings owners. Quick Item Move retains
its direct game interaction; Hub does not add inventory automation. Call Target
retains its direct shortcut because combat should not require opening Hub.

Whispers uses one mounted conversation component for Hub person search, its direct
shortcut and its unread launcher. Keep it in its floating window; do not maintain a parallel
quick composer. Existing session-reset rules continue to govern draft lifetime.
Travel recent destinations and characters use horizontal carousels; Travel favorites
remain a compact grid. Arrows browse and Enter selects. Escape returns one level.
Hub keeps one fixed responsive frame across result types and tools. Never resize or
reposition it in response to a query or section change; scroll content inside it.

## 10. Quiet availability rules

Disabled is different from temporarily unavailable. Disabled features have no rows.
An enabled saved team may remain readable when live Apply is unavailable. Explain
that restriction only inside its selected preview. Keep host authoring available
where existing policy permits. Revalidate feature flags at execution, not only search.

When a feature is disabled while selected, remove its view and return quietly to
the nearest available parent. Cancel unsubmitted work; use existing domain rules
for already accepted operations. Do not redirect to Settings.

Accessibility announcements should describe focused results and inline state once.
Do not announce every feed update or create a hidden stream of toast equivalents.

## 11. Vocabulary, pins, and saved flows

Hub settings provide explicit aliases, pins/order, history controls, appearance,
shortcuts, calculator source/rates, and saved flows. Use existing settings storage
and account ownership rules. No new database or generic configuration service.

Aliases refer to stable IDs and a scope. They never contain executable text.
Reserve grammar words and unit names in their scopes. Reject conflicts when saving;
if imported data conflicts, require result selection. Renaming an item preserves
its alias target. Deleting it removes its searchable alias and invalidates flows.

Aliases change how an object is found, not its canonical label. Provide Reset aliases.
Builds, teams, characters, and private contacts must not leak across account profiles.

Start custom flows with saved searches and parameterized named actions:
`home` selects a destination; `smiter` references a build; `gom afk` references a team.
A saved team already represents the multi-step party configuration: do not recreate
it as a user-authored macro.

Later guided flows may sequence reviewed steps such as character, team, and travel.
Each gameplay step requires an explicit action, fresh assessment, and clear target.
No loops, delays, arbitrary scripts, raw chat commands, unattended gameplay, or
implicit messages. Resolve referenced IDs at use time and stop on missing items.

## 12. Architecture and cutover

Keep one Core Hub shell that works without importing optional Tools. Optional
sections mount only through the existing Tools launch boundary. Use closed typed
results and named operations, not a plugin SDK or generic command-execution bridge.

Reuse these owners:

- [Shortcut model](src/shared/keyboard-shortcuts.ts).
- [Team planning](src/shared/builds/team-apply.ts) and
  [observed execution](src/shared/builds/team-apply-runner.ts).
- [Template library](src/main/core/account-template-library.ts).
- [Whispers](docs/whispers.md) and its existing session.
- [Trade source and network policy](docs/trade-discovery.md).
- [Process boundaries](docs/process-model.md) and
  [enhancement policy](docs/enhancement-development.md).

Trade and Whispers retain their existing floating presentation and state owners.
Hub discovers and opens them, preserving its own return location. The read-only
market boundary remains unchanged.

Extract existing reusable tool content rather than mount duplicate applications.
Delete replaced shells and old search rules as each section cuts over. Rename the
old Scry UI, events, and documentation coherently; do not maintain two palette names.
Derived local search indexes must rebuild from canonical owners and permissions.
Never persist a second build/team library or private conversation history for Hub.

## 13. Delivery and evidence

Implement as coherent reviewable layers, not one oversized change:

1. Hub identity, shortcut cutover, deterministic search, quiet availability, focus.
2. Saved build/template and full-team search, previews, existing apply integration.
3. Calculator and validated observed-rate conversion.
4. Shared chrome, task-specific Hub sections, and existing floating tools.
5. Vocabulary editor, pins, saved actions; guided flows only after concrete use.

The three defining journeys are release acceptance criteria, not optional polish.
A missing single-build command or validated rate direction must remain an explicit
milestone blocker, not be hidden behind a misleading working-looking result.

Required executable acceptance:

- Exact, prefix, duplicate, alias-conflict, typo, and no-match fixtures follow section 5.
- `team gom afk` never becomes Travel; typing or key repeat never executes twice.
- A complete valid team applies through the existing runner; preflight failures
  send nothing; partial completion is accurately reported; Retry reassesses.
- Build target, template revision, locked skills, profession and session changes
  cannot apply to the wrong character or silently replace a team.
- Currency fixtures cover both directions, units, rounding, stale/missing quotes,
  offline use, manual rates, source-disabled state, and late response races.
- Disabled tools leave no searchable metadata or network/observer demand.
- Storage refusals emit no player notification, sound, or modal.
- Hub works Core-only; private data stays account/session-scoped.
- Old custom shortcuts and clears survive; no chord dispatches two actions.
- Drafts, selected identities, filters, and operation state survive view handoffs.
- Real browser exploration covers all three flagship flows with synthetic data,
  keyboard-only use, both styles, small viewport, text zoom, and reduced motion.
- Electron tests cover physical shortcut interception, modifiers, key releases,
  game focus restoration, direct scopes, Escape, and native-dialog priority.

Run focused tests and `pnpm run check` per layer. Follow the repository's release
gate for delivery. Matthias owns live gameplay and input-feel verification; offline
fixtures do not certify live team application, build loading, or quote correctness.

## Title planning

The [title calculator specification](docs/hub-title-calculators.md) owns exact
point conversions, entered-progress targets, whole-item shopping quantities and
offer comparisons. All flows remain inline and work offline. Examples replace
the search query without executing an action. Unknown item names are not guessed.


### In-game settings and chat pop-out

`Settings` opens inside the fixed Hub frame. The game’s macOS Settings menu opens
the same view; Settings from the launcher continues to configure the launcher.
Hub includes Tools, Appearance, Shortcuts, Maps, and Chat & characters. Tool switches
remain visible in Settings so disabled tools can be enabled, while search hides
those tools. Changing a tool does not dismiss Settings. The Tools master switch
reports when a restart is required; it never closes an account automatically.

`Show Launcher` is a separate explicit action for account administration, updates,
and game-file management. Hub uses a bounded native settings capability backed by
the same preferences owner as the launcher, with canonical validation and shortcut
conflict rules. The generic game settings transport retains its narrower authority.

Whispers always opens its existing floating panel. Hub person selection, the chat
shortcut, and the floating icon use the same conversation owner. The panel retains
selected conversation, unread state, transcripts, and drafts across hide/show. It
supports dragging and resizing directly; there is no lock or docking control.
Opening a conversation does not send a message.

Shortcut settings show separate keycaps in macOS order: Control, Option, Shift,
Command, then the key. Both Hub and Launcher use the canonical model. Existing
saved Command bindings retain their meaning. Capture accepts combinations using
Command, Control or Option, optionally Shift, and standalone F1–F24. Letters,
digits, punctuation, arrows, navigation, editing and numpad keys are supported.
Plain typing/Shift-only typing remains available to the game. Bare Escape cancels
recording; bare Delete/Backspace clears. Modified editing keys can be recorded.
Reserved system combinations and conflicts remain checked. Fn/media hardware
keys are outside this capture contract. Disabled tools retain visible read-only
shortcut rows. Recording consumes the key without activating its existing tool.
