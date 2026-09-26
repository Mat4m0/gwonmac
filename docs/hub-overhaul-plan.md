# Hub refinement: intent, focus, continuity, and native workflows

Implementation and acceptance plan — 13 September 2026.

**Status:** implemented locally on `feat/hub-overhaul-flows`; live acceptance
remains with Matthias. The reviewed starting baseline was `c99d5c33`.
`adc3fd67` delivered focus and handoff continuity; the remaining refinement is
recorded in [Hub verification](hub-verification.md#intent-and-continuity-refinement--13-september-2026).
The requirements below describe the implemented contract. The historical delivery
record remains separate. No publication or release acceptance is claimed.

## 1. Product outcome

Support the player's likely intent in the fewest meaningful steps. First entry
should focus the control that advances that task. Returning should restore the
place the player left. Search is immediately available, but it must not become an
extra compulsory stop in a character carousel, account picker, or target chooser.

Consistency means predictable intent, actions, and return behavior. It does not
mean forcing every tool into the same keyboard layout or focusing search on every
page. This supersedes the previous review's suggestion of a uniform search-first
loop and its recommendation to always add team review.

Preserve the accepted Guild Wars appearance, existing game/feature owners,
custom shortcuts, optional Tools boundary, and user data. Keep ordinary actions
fast. Add a decision step only when the player still needs to choose a target,
resolve ambiguity, or understand a materially different operation.

## 2. The anchor journeys

### Switch character

1. Press the resolved Hub shortcut (default `⌘R`). A fresh Hub opens with search focused.
2. Type `sw`. Switch Character appears before Switch Account in ordinary tool ordering.
3. Press Down to focus the selected Switch Character result; Enter opens it.
4. The current character card owns focus immediately. Left/Right moves through
   this account's characters. There is no extra Down or Tab just to start browsing.
5. Enter on another available character performs the visibly named switch action.
   Selecting the current character does not trigger a redundant relog.
6. Up from the cards focuses optional character search. Up from that search
   reaches Back. Down returns to the remembered card. Normal typing from a card
   starts/refines character search without losing the first character.
7. Back restores the parent query `sw`, the Switch Character row, its keyboard
   focus, and the previous scroll position. It does not put focus in search.

The direct Characters shortcut (default `⌘E`) opens the same card-first view,
without a fabricated Home history entry. Explicit `char <name>` searches may
retain their existing direct, named activation when the character is unambiguous;
do not force them through a redundant carousel.

### Switch account

Switch Account already exists in `src/renderer/hub-accounts.ts`; extend that owner.

1. Select Switch Account from Hub results and press Enter.
2. Focus an eligible account row immediately. Show the current account clearly;
   it must not be the default executable choice for switching to itself.
3. Enter on an account opens its actions, with the default Switch Account action
   focused. Label both the target account and the current account affected.
4. Keep Show/Open separately available for keeping the current game running.
   Do not introduce another confirmation over the existing explicit action choice.
5. Back from actions returns to the same account row in the account picker.
6. Back again returns to the Switch Account command in the original Hub results,
   preserving query, scroll, and row focus. Up moves through those results to
   search; when the command is the first/only result, one Up reaches search.

An exact `acc <name>` can continue exposing that account's named actions directly.
Do not manufacture intermediate pages when the player already supplied the target.
Return only through stages actually visited. A failed replacement preserves the
current account through the existing native account owner. Revalidate changes to
account identity/state immediately before execution.

With no alternative saved account, provide a clear empty state and a route to
existing account management in the launcher. Avoid a dead or unexplained command.

### Find and apply a build

1. Search `build monk` or a folder-qualified query. Down browses results.
2. Enter or Right on a build opens the compact target page with the incoming
   build pinned above it. Focus Apply to me, not the optional target search.
3. That row already displays the player's current build. Enter applies to the
   named player if allowed; no second mandatory comparison page is needed.
4. Down selects Apply to hero; Enter or Right opens the hero picker, initially
   focused on the first eligible current-party hero. Search remains optional.
5. Hero rows show their current bars. Enter on an eligible hero performs the
   explicitly labeled apply action because build and target are now both visible.
   Right opens deeper read-only comparison/details when wanted. This deliberately
   removes the current compulsory hero review step while retaining optional inspection.
6. Blocked targets remain inspectable. For these rows, Enter/Right opens the
   explanation/details; they never execute an apply. Make the different action
   explicit in the row/footer. Separate navigation availability from apply permission.
7. Back restores the exact originating target or build row, query, focus, and scroll.

Typing, hovering, and arrow selection never apply a build. A selected row must
always expose the consequence of Enter before it can change the game.

## 3. Entry focus and navigation contract

| Surface | Default focus on first entry | Optional search | Primary activation |
| --- | --- | --- | --- |
| Fresh Hub | Global search | Already focused | Visible selected result action |
| Character carousel | Current/explicitly selected character | Up or type from card | Switch to named character |
| Account picker | First eligible alternative account | Up/type from rows | Open named account actions |
| Account actions | Switch action for the chosen account | Available but not required | Named switch/show/open operation |
| Travel | Existing destination search with a useful selected destination | Already focused | Travel to named destination |
| Build Library/folder | First available folder/build row | Up/type from rows | Open folder or choose build target |
| Build target page | Apply to me | Up/type from rows | Apply to named player, or open hero picker |
| Hero picker | First eligible current-party hero | Up/type from rows | Apply to named hero; inspect blocked target |
| Settings | Relevant section/control | Only where useful | Existing native control behavior |
| Whisper conversation | Composer for the selected conversation | Person picker separately | Send only on explicit composer action |

Returning to an existing stage overrides these defaults with its saved focus.
For empty/loading pages, focus the useful search, retry, or empty-state action;
do not focus a decorative heading or disabled primary action.

### Keys and mouse behavior

- Up/Down follows each view's meaningful vertical order; Left/Right remains
  spatial for characters and native for text, sliders, and selects.
- For list/carousel browsing, Up at the top reaches search; Up from search reaches
  Back. Travel may retain search focus while moving active destinations, but must
  provide that upward escape at the first destination instead of wrapping forever.
- Right on a navigational result opens its child. Use a quiet child cue where
  needed. Right must never execute a world-changing command.
- Enter executes the displayed primary action. A click does the same for the
  clicked row. A separate details affordance may inspect without executing.
- Backspace deletes while editing nonempty text. Outside editing, or in empty
  search, it returns one stage. No navigation during composition. Empty textareas
  and ordinary form fields retain native editing rather than becoming Back controls.
- Escape closes the top submenu/details first, then goes back a stage, then
  dismisses Hub. X dismisses Hub directly. Direct entry has no fake parent.
- Tab/Shift+Tab continues reaching controls. Arrow behavior must not trap focus.
- Typing from browse controls returns to search, preserving query, selection range,
  and caret. An empty optional search starts with the typed character. Do not replace
  a prior query merely because a character card was focused.
- Paste, Option characters, dead keys, IME, selection, undo, and delete must use
  native text editing. Verify the full input path in Electron. Choose the smallest
  input-owner change that supports these cases; do not force a combobox focus model
  onto every carousel or form.
- Mouse hover may preview a row but must not steal keyboard focus. After Back,
  a stationary pointer must not immediately overwrite the restored selection.
- Background updates preserve stable identities. Held keys cannot chain an Enter
  into a newly opened destructive/action stage or leak movement into the game.

## 4. History stores the player's place

Current history retains parent query, row, and list scroll but restores search
focus unconditionally. Mounted views are recreated without a complete focus/state
snapshot. Refine the existing history owner in `src/renderer/hub.ts`.

Each visited stage must retain enough information to restore:

- Stage identity, actual parent, and source account context.
- Search query plus caret/selection range when the input owned focus.
- Selected result/card/account/hero identity, never just its numerical index.
- Focus region: search, selected item, header, footer, or a named form control.
- Relevant scroll position and existing tool-owned view state.

Capture the launching row/control before opening a child. On Back, reconstruct
the stage, refresh current facts, restore selection and scroll, then focus the
recorded control. Breadcrumb jumps restore the saved destination stage and discard
its descendants. Keep focus restoration separate from first-entry defaults.

If the selected item disappears, retain the query and choose a predictable nearby
browse position without executing anything. Explain material removal/availability
changes. If a whole feature disappears, return to its nearest valid parent.
Never enable an action using stale stored game facts.

Use one history stack with small typed restoration data. Existing tools continue
owning drafts, filters, and feature state; do not duplicate their state in a second
global store. Do not retain detached DOM nodes as durable navigation identity.

### Dismissal and lifetime

- Back restores the exact prior stage, including row focus.
- Temporary app blur hides Hub and releases game input, but retains session context.
  Reopening after that temporary hide resumes the stage and revalidates live facts.
- Explicit X, closing from Home, or toggling Hub closed ends that Hub navigation
  task. The next fresh `⌘R` starts in global search. Successful terminal actions
  also end the task. Persistent tool drafts/filters survive independently.
- Popout handoffs retain a return location during the session; reopening Hub may
  resume that location. Repeated shortcuts focus the existing destination as defined
  by that feature rather than creating duplicate windows or history entries.
- Account replacement/restart clears account-specific Hub navigation. Another
  account window must never inherit executable targets from this one.
- No durable navigation-history database or browser-history framework is required.

## 5. Build search, comparison, and completion

### One native library model

Retain native template files/folders as their source; retain saved library records
in their existing owner. Do not copy native templates into another permanent library.
Use the same build matcher inside Build Library, folder views, and global search.

| Query | Intended interpretation |
| --- | --- |
| `build monk` | Primary Monk builds |
| `build folder monk` | Forgiving folder/name/tag words plus primary profession |
| `build parent/child monk` | Ordered contiguous folder path plus profession |
| `build parent child monk` | Forgiving terms across path/name/tags, without promising order |
| `build folder:"Team Builds/Farming" monk` | Explicit folder with spaces plus profession |
| `build folder:Monk mesmer` | Mesmer builds stored under a folder named Monk |
| `build Mo/Me` | Exact profession pair, not a folder path |
| `build folder:Mo/Me` | Explicit folder path even if it resembles a profession pair |
| `build folder:/` | Native skill templates saved at the root |

Preserve case-insensitivity, backslash normalization, unfinished quotes while
typing, and existing supported matching behavior. Exact profession words filter
primary profession; explicit `folder:` disambiguates profession-named folders.
Document leading/trailing slash semantics in Commands examples. Do not silently
reinterpret a malformed precise query as an unrelated executable action.

Browse immediate child folders and files. Parent folders with no direct files
still exist in navigation. Breadcrumbs show actual hierarchy. Keep the current
compact title: **Protection** followed by smaller muted **Mo/Me**, then folder icon
and muted relative folder path. Distinguish duplicate source identities only as
much as needed; root templates and saved-library builds need a source label when
their names otherwise collide. No absolute system paths in result rows.

Show reading, empty, and failed source states distinctly. Preserve valid results
when a source fails. Offer Retry and a concise unreadable-file count/details.
Refresh on relevant entry/resume and explicit retry using existing readers;
do not add a background filesystem watcher without evidence it is necessary.

### Compact, informative comparison

Keep one pinned incoming build, current target bars, grouped Tango attribute icons,
and abbreviated ranks. Keep the removed empty metadata panel removed.

- Align slots, mark changed skills subtly, and show meaningful rank deltas.
- Show Already equipped only when the relevant observations are complete and equal.
- Label invested attribute ranks accurately; do not imply equipment/rune bonuses.
- Preserve unknown values explicitly. A missing bar is not eight empty skills.
- Offer keyboard-accessible Details with skill names/descriptions and full attribute
  names. Do not insert eight mandatory tab stops into every build result.
- Group current-party heroes separately from unlocked heroes outside the party.
  Use current primary/secondary observations, including variable-profession heroes;
  do not infer a chosen secondary from a static hero table.
- Eligibility affects final execution, not access to an explanation or comparison.
  No automatic hero addition as a side effect of inspecting/applying one build.

Reuse `src/shared/builds/presentation.ts`, the existing skill facts, and appropriate
comparison logic in `src/shared/builds/diff.ts`. Adapt unknown live values explicitly
instead of inventing a complete Build merely to call a comparison helper.

### Action feedback and recent use

Expose existing apply progress, bind it to the reviewed build/target, prevent
duplicate execution, and report observed completion. Partial results identify
the skipped skills and remaining problem. Preserve context on failure and revalidate
before retry. Do not imply an atomic rollback or offer Undo without a proven restore.

After confirmed application, record a bounded recent build/target reference through
the existing library/preferences owner. Allow it in Continue or Pins without changing
ordinary results through learned ranking. Revalidate native files and account context
when reusing a recent action. Never persist an old live agent ID as a reusable target.

### Fast team intent

Keep the existing exact, unique `team <name>` path eligible for direct activation
when the named team and consequential changes are visible before Enter. Show a compact
roster/difficulty summary and explicit Apply team label; Right/Details offers review.
Partial or ambiguous matches review/resolve first. If the default view cannot explain
the material changes clearly, fix that presentation before keeping direct activation.
Do not insert mandatory review solely to make teams resemble the single-build flow.

## 6. Coherent surfaces and visual refinement

| Surface | Ownership |
| --- | --- |
| Hub | Discovery, travel, characters, accounts, settings, build browsing and bounded application |
| Build workspace | Authoring, organization, variants, team assembly |
| Trade popout | Offers, filters, comparison, browsing position |
| Whisper popout | Conversations, drafts, delivery and retry |
| Native game | Gameplay and the existing mechanics these tools assist |

With Hub open, the Build shortcut browses in Hub; outside it, the existing authoring
workspace remains available. Trade and Whispers always use their popouts. No docking
controls or duplicate mounted owners are reintroduced.

Polish shared chrome: vertically centered titles, seamless Classic frame/content
edges, plain visible X controls (including command tray and Build Library), restrained
breadcrumbs, useful drag regions, and generous invisible resize hit areas. Classic
uses its corner artwork without painting a second resize-grip button. Keep decoration
out of the accessibility tree and pointer handling.

Only Hub has a subtle lock, initially locked. Other popouts move/resize directly.
Recommend remembering Hub geometry per existing account profile across restart,
while starting each renderer session locked; reset restores default geometry and lock.
Use the existing settings/placement owner and viewport recovery rules. Preserve
current popout placement persistence and clamp windows after display/zoom changes.
Explain existing keyboard movement/resizing in accessible help.

Retain theme IDs, saved palette/opacity ranges, and Classic/Modern/Custom behavior.
Test readable muted metadata, distinct focus/selection/hover, and wrapping over
bright as well as dark game scenes. Keep geometry stable during page transitions.
Reuse shared typography and Tango assets wherever profession identity is shown.

Trade-to-Whisper preserves query, scroll, selected offer, recipient, and drafts.
Selecting a person prepares the conversation; it does not send. Build browsing-to-
authoring preserves source/selection without creating a second editable copy.
Travel preserves filters/district selection and returns focus to its originating
destination after inspection; direct unambiguous travel remains a named activation.

## 7. Implementation order and acceptance

Deliver bounded Conventional Commits on the current topic branch. Do not split
into permanent old/new paths or introduce a new UI/navigation framework.

| Step | Work | Observable exit criterion |
| --- | --- | --- |
| 1 | Reconcile current intent in `spec.md` and `apps/tools/DESIGN.md`; document purposeful per-view differences | One current contract; obsolete embedded Trade/Whisper and shared-lock rules removed |
| 2 | Extend existing history with focus restoration and tool restoration hooks | Character and account anchor journeys return to the exact launching control |
| 3 | Implement task-specific first focus, optional search, native typing, and meaningful arrows | Character entry immediately accepts Left/Right; Back does not require refocusing results |
| 4 | Separate temporary hide from task end; preserve handoff context and revalidate on resume | Wiki/app switch and popout return preserve place without stale executable targets |
| 5 | Unify build matching and folder hierarchy; explain source failures | Same queries work in all build contexts; nested browsing and Retry are understandable |
| 6 | Refine minimal-step build/hero/team actions, comparison, feedback, and recent use | Player can identify the build, target, change, and outcome without redundant stages |
| 7 | Apply chrome, geometry, disclosure, and cross-tool handoff refinements | Existing tools look related and preserve their useful native/task-specific layouts |
| 8 | Complete cross-tool and compiled-app verification, then prepare one candidate for review | Evidence names exact build and remaining human acceptance; no release claim from fixture checks |

Start with steps 2–3 as the first working vertical slice after the contract update.
Prove the concrete character/account journeys before extending restoration to every
view. Shared code should emerge only for shared responsibilities, not visual similarity.

## 8. Verification matrix

| Scenario | Required evidence |
| --- | --- |
| `⌘R`, `sw`, Down, Enter, Left/Right | Character card focus immediately; no input leakage |
| Character search → card → Back | Query/caret/selection and parent row focus restored appropriately |
| Switch Account → account → actions → Back twice | Same account row, then same command row; no extra search focus or account operation |
| Direct `char`/`acc`/team intent | No fake parent or redundant picker; explicit visible action |
| Native text after browsing | First character, paste, Option/dead keys, IME, selection, undo/delete work in Electron |
| Mouse + keyboard + held keys | Hover cannot undo restored focus; key repeat cannot execute the next page |
| Async removal/reordering | Selected identity remains stable; vanished target cannot become another executable choice |
| Blur/resume and account change | Read-only place resumes; live targets refresh; another account never inherits them |
| Nested/duplicate/invalid templates | Hierarchical browsing, consistent syntax, source distinction, and recoverable failure |
| Mixed-profession heroes | Eligible apply, blocked inspection, unknown current bar, and no silent roster changes |
| Apply interrupted or template edited | Named partial result or stale-file refusal, context retained, safe retry |
| Trade → Whisper → return | Offer/search/scroll and draft survive; no automatic send |
| Geometry and appearance | Lock scope, reset, restart persistence, viewport recovery, Classic/Modern/Custom readability |
| Optional Tools unavailable | Core game stays usable; host authoring remains available under existing rules |

Extend existing fixtures with realistic mixed professions, missing observations,
long names, empty/large folders, and account state changes. Measure large-list typing
and observation refresh locally if profiling identifies a delay; do not preemptively
add caching, virtualization, telemetry, or learned ranking.

Use the repository's existing checks:

```bash
pnpm check
pnpm tools:test:e2e
pnpm test:electron
```

During each step run the affected unit/browser tests first; run the relevant final
gate against the final source. Compiled Electron tests require the corresponding
fresh build through the documented workflow. Preserve any existing live session;
never rebuild/restart it silently to obtain a screenshot. PR Application verification
and release-specific checks follow [Development and rollout](development-workflow.md).

Browser fixtures prove presentation and controlled state changes. Electron proves
the exercised native host/input boundary. Neither proves live input feel or gameplay
acceptance. Record checks and limitations in [Hub verification](hub-verification.md).
The verification record distinguishes the exercised fixture/native boundaries
from the remaining live input and gameplay acceptance.

## 9. Rollout, persistence, and completion

Use Developer Builds for the individual stages. Once the coherent candidate passes
review, recommend one Beta train because input, accounts, and placement persistence
are affected. Matthias accepts the exact candidate and authorizes publication under
the existing release process. No per-feature Beta, forced mid-session restart, new
permanent branch, or hidden flag for unfinished work.

Most changes are in-memory presentation behavior. If Hub placement or recent-use
storage needs schema changes, inspect existing readers and downgrade behavior first;
use the existing validated settings owner, optional/defaulted data, and a focused
compatibility test. Preserve saved bindings, account profiles, templates, and drafts.
Rollback must ignore/reset only newly introduced optional state, not wipe user data.
The implementation uses only optional validated profile browser geometry under
`gwonmac.hub-window-placement`; Reset removes that key and older builds ignore it.
Recent target references are bounded to three per renderer session. Saved-build
recency uses the existing `lastUsed` field without adding an Undo transaction.
There is no native settings or saved-library schema migration.
Revert bounded commits or use the documented release repair flow as appropriate;
do not add permanent dual implementations to support rollback.

Completion means all anchor journeys and relevant failure cases pass, obsolete
behavior/tests/docs are reconciled, source ownership remains singular, and the actual
app candidate is available for the requested in-game acceptance with its identity
recorded. The executor owns implementation and technical checks. Matthias owns live
acceptance and release decisions; routine focus/layout choices need no new approval.

Deferred: autonomous multi-action workflows, automatic hero addition, generic AI
search, equipment/bonus simulation, durable navigation across restarts, global undo,
new themes, and a framework rewrite. Native templates and official game mechanics
remain the foundation.

## 10. Evidence and implementation owners

- [Hub renderer](../src/renderer/hub.ts): history, row actions, input, breadcrumbs,
  temporary lifetime, with per-view focus and selection restored on Back.
- [Character carousel](../src/renderer/character-switch-palette.ts): spatial controls
  and optional search, preserving native query editing when typing from a card.
- [Account presentation](../src/renderer/hub-accounts.ts): existing Switch Account,
  explicit replace/open actions, native revalidation.
- [Travel](../apps/tools/src/components/TravelPalette.vue): destination input and
  selection; preserve its useful search-first interaction.
- [Hub build library](../apps/tools/src/hub-library.ts): matching, native folder
  browsing, incoming/current target presentation, application feedback.
- [Shared Hub contract](../src/shared/hub.ts), [build presentation](../src/shared/builds/presentation.ts),
  [build differences](../src/shared/builds/diff.ts), and [bounded apply runner](../src/shared/builds/team-apply-runner.ts).
- [Hub geometry](../src/renderer/hub-window.ts), [Tools design](../apps/tools/DESIGN.md),
  [product boundaries](../PRODUCT.md), and [account profiles](multiple-accounts.md).
- [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): native
  editing/focus guidance for searchable lists; not a requirement to make every task a combobox.
- [Apple search guidance](https://developer.apple.com/videos/play/wwdc2026/292/):
  recognizable search behavior within a custom visual identity.

---

## Historical overhaul record — superseded proposal and completed delivery

The following text preserves the original research and delivery history. Its
earlier focus, presentation, and implementation proposals are superseded by the
current refinement plan above. Historical completion statements refer to that
earlier delivery only.

### gwonmac: unify the Guild Wars visual study and Hub experience

Research and delivery plan — 12 September 2026.

**Amended after Matthias's follow-up on 13 September:** Build search, template
folder browsing, target selection and application stay inside Hub. Trade and
Whispers remain floating. Only Hub has a lock; other floating tools move and
resize directly. Hub settings can restore its default geometry. These decisions
supersede the earlier floating-build-review and shared-lock proposals below.
The current interaction owner is [Tools design](../apps/tools/DESIGN.md#hub-task-presentation).

Implementation completed locally across the three review layers. See the
[verification record](hub-verification.md#unified-hub-candidate--12-september-2026)
for acceptance evidence, exact checks and the remaining native review.

Target: the existing **gwonmac** application, as confirmed by Matthias. Implementation authorized on 12 September 2026. This plan does not claim release readiness. Guild Wars v2 is outside this plan.

## Recommendation

Bring the study's original Guild Wars frame and control treatment into the working Hub. Preserve Hub's interaction model and the current app's feature owners. Complete one real journey before spreading the visual changes across every tool.

The first reviewable milestone is **Hub Home → Travel → destination review/action → return**, rendered with the Classic artwork, with Modern and Custom still working. Use the production components and offline fixture. A second standalone demo would leave the integration question unanswered.

Three sources have different jobs:

| Source | What it owns for this work | What must not be copied wholesale |
| --- | --- | --- |
| [Current gwonmac](../) | Current native behavior, settings, feature availability, persistence, shared controls and release workflow | No replacement with an older checkout |
| [Integrated Hub specification](../spec.md) (source: `gwonmac-command-palette`) | Accepted search, task flows, navigation, shortcuts and preserved state | Unrelated changes, older versions of current native owners, historical bugs |
| UI study (`/Users/matthias/Downloads/gw-ui-study/DESIGN.md`) | Classic artwork, frame reconstruction, visual references and theme exploration | Sample records, demo search, browser-only geometry/preferences, extra theme systems |

Research sources: the “Build Guild Wars UI study” and “TOCHECK: RAYCAST COMMAND BAR” design discussions. The local source checkouts above contain the implementation evidence.

## What the research established

- Current `gwonmac` was clean on `main`, at `13c82c09`. It does not contain the Hub implementation.
- The Hub worktree is on `feat/hub-builds`, at `467d77f4`, with substantial tracked and untracked work. That commit alone does not contain the accepted final Hub.
- Their common ancestor is `c1d530f9`. The inspected committed tips have 21 main-only and six Hub-only commits, before counting working changes. This is an integration task as well as a visual task.
- The study was clean at `0e01edd`. Its `GwHub.vue` uses fictional records and simplified substring search. It cannot replace the production Hub controller.
- I opened both local previews and inspected Classic Home, working Hub Home, `build monk`, and `char Toefte`. The working Hub has real presentation for ordered skill bars and explicit action labels. The study has the original silver frame and stronger blue selection treatment.
- The [old audit](hub-audit.md) contains a later closure table for all H01–H14. Its original verdict is historical. The [verification record](hub-verification.md) reports 40 passing browser journeys in the final historical batch. These are useful regression specifications, not fresh qualification of current main.
- Main already defines one shared UI system in [Tools design](../apps/tools/DESIGN.md), including font roles, controls, Classic/Modern/Custom, contrast handling, and independent opacity. The overhaul should extend this system.

I did not run the full suites, open a live game, exercise real account changes, or modify application code during this research.

## The combined experience

Hub is the central entry point. It offers a focused search field, optional pins, relevant recent destinations, enabled tools, and an action footer. Its visible name is **Hub**.

Preserve the accepted tool priority: Travel → Switch Character → Whispers → Build Library → Trade Chat → Xunlai Storage → Maps → Switch Account. Explicit pins remain first. Do not introduce learned ranking as part of this overhaul.

Use the same visual language in three presentation forms:

| Form | Suitable work | Behavior |
| --- | --- | --- |
| Search result or compact review | Destination, character, saved build/team, conversion, person | Search, inspect, choose a named action |
| View inside Hub | Travel, Characters, settings and utilities | User-sized frame; content scrolls or changes pane inside it |
| Floating tool | All Whispers, Trade, Library editing and build/team review | Reuse feature state across hide/show; no docking control |

One visual system does not require every tool to use the same content layout. Travel needs destinations; Characters needs a carousel; chat needs a transcript; Trade needs a ledger; builds need skill slots. Reuse their frames, type roles, controls, focus states and navigation conventions.

Keep the current Hub geometry as the starting baseline: approximately 780 × 590 CSS pixels where the viewport permits. Adding the original frame must reserve its title and border space without hiding controls. If that leaves too little usable content, agree one revised baseline after the Travel milestone. Results and tool entry must never resize or recenter it automatically.

Hub is a transient search surface: outside-click dismissal preserves the task. Floating tools remain open when the player clicks back into the game. This distinction reconciles the Hub specification with main's existing non-modal tool behavior.

### Interaction rules to preserve

1. Typing searches; it never sends, travels, switches or applies.
2. Enter performs the visible primary action for the selected identity. Ambiguous names require selection; partial build/team matches lead to review.
3. Back restores the immediate parent, query, selected identity and scroll position.
4. Escape dismisses the active submenu, then the current level, then Hub. Direct shortcuts do not create a fake Home step.
5. Text editing keeps its normal arrow keys. Carousel arrows operate when the carousel owns navigation. Tab reaches actions and form controls.
6. Background updates preserve focus and selection by identity. A vanished selection cannot silently become a different actionable item.
7. Disabled features disappear from search, pins, aliases, recents and child actions. Settings may retain disabled, read-only shortcut rows.
8. Failed sends preserve drafts. Failed account replacement preserves the current account. Storage failure remains silent.
9. Closing, docking and changing appearance preserve feature state. Reload behavior follows the existing feature's documented lifetime.
10. Hub input must not leak into the game. Dismissal must release held keys and restore the correct focus.

Preserve the accepted defaults and custom overrides: ⌘R Hub, ⌘E Characters, ⌘T Travel, ⌘B Builds, ⌘K Trade, ⌘D Whispers, ⌘S Storage. Relog moves to ⌘⇧R through the existing resolver. Do not copy Raycast's ⌘K Actions binding because it conflicts with Trade. All displayed keycaps come from the resolved binding, including cleared assignments.

## Reproduce the appearance precisely

### Frame and assets

Reuse the study's frame source regions and measurements from `visual/frame.json` and `visual/provenance.json` in the study checkout. The successful reconstruction uses a single decorative Canvas 2D image. Shared integer physical-pixel boundaries avoid seams from separately composited translucent tiles.

Port that drawing logic as a small shared frame renderer usable by the existing DOM Hub and Vue windows. A Vue wrapper may own attachment and disposal, but must not become another geometry or feature-state owner. Keep HTML controls above the decoration, with `aria-hidden` and no pointer handling on the frame artwork. Redraw on size or pixel-ratio changes; dragging alone does not require continuous painting.

Resolve assets through gwonmac's existing build, protocol and font owners. Runtime must not depend on a Downloads path, the study's dev server, or a second font loader. Confirm the redistribution basis and preserve notices before packaging the source artwork. A local provenance hash establishes origin, not permission by itself.

The study is a strong accepted reference, but its comparison report (`visual/results/report.json` in the study checkout) explicitly does not establish pixel-perfect equality to the game. Rail landmarks differ by one reference pixel, corner differences remain, and some diagnostic masks contain no comparable pixels. Preserve that distinction.

### Tokens, controls and typography

- Keep `src/shared/ui/tokens.css` and `components.css` as the runtime style owners. Map selected study values into existing `--ui-*` roles instead of adding a parallel `--gw-*` public theme API.
- Keep `src/renderer/appearance.ts`, `src/shared/ui-theme.ts`, and existing settings persistence. Do not import the study's `localStorage` theme owner.
- Keep the saved IDs `guild-wars`, `obsidian`, and `custom`. In gwonmac, `obsidian` already means the current Modern style; it is not the study's new copper Obsidian preset.
- Deliver Classic fidelity first while preserving Modern and Custom. Jade, Astral, copper Obsidian and expanded Light appearance are separate later choices, not prerequisites.
- Keep font and material independent. The current app already supports the original game font and readable Reading/Data roles. Do not hard-code QTFrizQuad or a sans face across all Hub content.
- Preserve the current 65–100% opacity setting and custom palette format. The study's lighter transparency experiments do not authorize changing saved ranges or weakening contrast handling.
- Use the current `src/ui` wrappers for complex Vue controls. Reka already exists in Tools. Retain native simple controls. Tailwind was useful in the study; introducing Tailwind/Vite+ into the production build is unnecessary for this result.
- Replace Hub's local material, radius and font overrides with shared roles as each surface moves over. Avoid another stylesheet layered indefinitely over old overrides.

A compact component specimen should include the frame, title, close/back controls, search, result row, selected row, keycaps, menu, field, tabs, checkbox/switch, skill strip and inline failure. Extend the existing [UI gallery](../docs/ui-gallery.html); do not create a second component showcase application.

## Delivery sequence and exit conditions

Each step produces a reviewable result. Keep implementation branches local until publication is requested.

### 1. Preserve and reconcile the real Hub source

Create an integration worktree from current `gwonmac/main`. Freeze the Hub's tracked diff and untracked source, with a verified file inventory. Preserve the original worktree and study unchanged.

Map the required Hub changes against main. Port their intent while retaining newer native, Travel, map, font, account and input corrections. Do not copy old `src/`, settings contracts or native bridges over main. Where history contains a focused committed change, use its history; explicitly account for later uncommitted fixes.

**Exit:** integrated unstyled Hub runs through the current build, required sources/assets are present, and the inherited behavior checks pass. List genuine incompatibilities; do not silently weaken a guard to make the port fit.

### 2. Freeze visual and behavioral baselines

Capture representative current states in the integrated offline fixture. Record shell geometry, text/font choice, theme, viewport, pixel ratio, selected item, query and backdrop. Carry forward the old audit fixes as regression cases.

Measure the accepted study frame and Home styling. Separate original-game reference captures from the accepted web-study baseline. Resolve older contradictory specification wording: later requests require fixed Hub size and allow longer tools inside Hub or detached.

**Exit:** a small baseline set and the journey matrix below describe what must remain true. Tests are reproducible without accounts or network feeds.

### 3. Build the shared Classic frame and essential controls

Port the decorative frame and original control treatment into the existing UI system. Verify corners and joins at normal and odd sizes, including Retina. Ensure title, Back, close, search and footer remain legible and usable. Keep Modern/Custom on the same component structure.

**Exit:** gallery specimens work with keyboard and pointer, without clipping or invisible focus. Theme changes retain state and do not change the interaction layout. Scope new artwork to migrated surfaces until they pass; remove obsolete decoration for those surfaces in the same change.

### 4. Complete the first real journey: Home and Travel

Apply the new frame and shared tokens to the integrated Hub. Preserve the enabled-tool order, pins, recents, explicit action footer and quiet availability. Restyle the existing Travel content, recent carousel and favorite destinations.

**Exit:** Home → Travel → destination → Back works with keyboard and mouse. Query, selection and scroll restore; the outer rectangle is stable; disabled and unavailable states are honest. The Classic frame is recognizably the study's frame. This is the first design review checkpoint.

### 5. Complete Characters, People and Accounts

Keep character cards compact and left-aligned, with actual profession artwork and short metadata. Match card selection to the shared control language. Keep Character above Account for generic switch searches.

**Exit:** `char Toefte` shows the explicit switch action. `acc second` offers keeping Main open or replacing it. Replacement launches the destination successfully before closing the source through its existing owner. Failed or stale actions preserve the current session. No duplicate launcher or account state is introduced.

### 6. Complete build/team search, review and authoring

Keep eight ordered skill icons beneath search results, elite indication, missing-art fallbacks, target choice, profession filtering and exact-name semantics. Use compact party rows for team review and the existing full editor for authoring.

**Exit:** `build monk` shows every saved primary-Monk match and opens review. Duplicate names remain distinguishable. Team review exposes the actual target/configuration before Apply. Editor navigation, detachment, failed save and stale native state retain the correct safeguards.

### 7. Complete Whispers and Trade as one connected journey

Restyle the existing conversation component and Trade ledger. Preserve transcript/draft ownership and the chosen pop-out presentation. Keep ongoing Trade lists stable when new feed messages arrive. Use a narrow in-window detail view when content cannot fit beside the list.

The study's fixed Trade side inspector is a visual exploration, not an instruction to replace main's current ledger and bottom-inspector behavior.

**Exit:** offer → addressed Whisper composer → Back restores the offer/filter. No message sends automatically. Drafts survive failed sends and dock/pop-out. With pop-out enabled, the outer chat icon toggles that surface. There is one composer and one conversation state.

### 8. Complete settings and the remaining surfaces

Bring Maps, calculators, Hub preferences, key recording and in-game settings into the same controls. Keep launcher-only account/update/game-file administration reachable through Show Launcher. Reuse settings definitions and persistence; do not fork the launcher settings model.

Check existing floating Library/Trade/Whispers and other shared-control consumers, including newer map/elite panels. Preserve the launcher's layout and artwork while checking the effect of shared style changes. A separate launcher redesign is not needed to deliver the Hub overhaul.

**Exit:** all in-scope views support Classic, Modern and Custom; shortcuts render resolved modifiers; recording suppresses invocation; disabled settings rows stay read-only. Calculations keep source/age/estimate distinctions. No generic success popups or new feature backlog is added.

### 9. Verify the integrated result and remove obsolete presentation

Remove superseded Hub paint, duplicate title bars, old shortcut displays and unused imports/assets introduced by the cutover. Keep a temporary compatibility path only for an identified dependent; record its exact removal condition if one is necessary.

Run the repository gate, production build, focused browser journeys and relevant Electron input/preload checks against the final candidate. Then prepare a bounded developer build for the required native checks. Use the repository startup procedure and identify the exact worktree/profile; do not rebuild a running player's application underneath it.

**Exit:** visual comparisons and behavior checks pass; remaining native checks are named; cleanup and rollback are documented. Recommend one Beta train for this multi-feature/input change, subject to the existing release authorization process.

## Journey acceptance matrix

| Journey | Required visible result | Important regression |
| --- | --- | --- |
| Open Hub, search, dismiss | Focused search and named Enter action | No game input leakage or held keys |
| Home → Travel → Back | Same frame; restored destination context | Newer main Travel behavior preserved |
| Character carousel / `char Toefte` | Left-aligned cards or explicit named match | No action while typing; current identity rechecked |
| `acc second` | Two clear account choices | Launch failure never closes Main |
| Person → actions | Identity and available actions | Unknown-name whisper uses the exact recipient |
| Whispers → pop-out → dock | Same conversation and draft | Icon honors pop-out; no second composer |
| Trade offer → Whisper → Back | Addressed draft, then original offer | No send; filter/selection/scroll preserved |
| `build monk` | All matching builds with eight skills | Profession filter does not become auto-Apply |
| Exact/prefix/duplicate team name | Correct explicit action or review | No wrong team, target or partial success |
| Full Library editor | Usable controls within the container | Unsaved edits survive navigation/detachment |
| Conversion/title calculation | Correct values and honest evidence | Updates do not replace focused controls |
| Settings and shortcuts | Individual keycaps and clear conflicts | Preserve overrides/cleared keys; disabled rows locked |
| Disable an open feature | Its active surface/actions withdraw | No stale pin, alias or invocation |
| Xunlai Storage | Direct supported attempt | Failure remains silent |
| Change theme/opacity/font | Immediate consistent appearance | No remount, lost draft or altered geometry |
| Narrow/short window | Reachable Back, content and action | Internal scrolling; no automatic outer resize |

## How to verify fidelity without slowing delivery

Use two separate kinds of evidence:

**Visual evidence:** compare the same content, font, backdrop, viewport and pixel ratio. Inspect frame corners, rails, title alignment, control states, typography, density and selected-row contrast. Use exact pixel checks for deterministic artwork/compositing, and explicit tolerances plus visual inspection for text. A whole-page score cannot prove that a missing edge or unusable control is correct.

**Behavioral evidence:** use real controls and synthetic feature state. Extend existing tests only for a demonstrated gap; do not recreate their complete history as a new suite. Include delayed updates, missing art, failed saves/sends, unsupported game context and return navigation.

Start with the established 1280/640/390-width fixture coverage, short windows, and 1×/2× pixel ratios for frame checks. Add 200% zoom, large valid labels, reduced motion, and minimum-opacity bright/detailed backdrops. These are desktop-window stress tests, not a mobile product promise.

Check ordinary text at 4.5:1 and large text at 3:1, including selected, hover, disabled explanatory and translucent states. Test actual composed backgrounds; a token's nominal color alone is insufficient. Preserve readable fallbacks when opacity or fonts prevent faithful artwork treatment.

Use existing `pnpm run check`, the Tools Hub browser journeys after integration, relevant input/preload tests, and `node scripts/ui-visual-sweep.mjs`. Build before checking changed compiled behavior. CI and native gameplay/VoiceOver checks remain distinct from a browser screenshot or a historical green receipt.

## Why these research sources matter

- [Raycast's Action Panel](https://manual.raycast.com/action-panel) supports selected-item actions and an explicit primary action. This reinforces the existing Hub model. It does not justify copying Raycast's shortcuts or fuzzy matching.
- [Reka styling](https://www.reka-ui.com/docs/guides/styling) separates accessible interaction primitives from appearance. Existing wrappers can retain behavior while receiving the Guild Wars treatment.
- [WAI-ARIA combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) supports keeping text editing and result navigation distinct, with the active result exposed to assistive technology.
- [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) supplies the text contrast thresholds. The local study demonstrates why game backdrops must be part of the comparison.

## Scope and delivery status

Keep native DDS skin replacement, extra themes, new daily/planning features, framework migration and v2 out of this delivery. The HTML companion can match Guild Wars visually without changing ArenaNet's native interface textures.

The integrated overhaul and the follow-up polish are implemented in the existing
gwonmac app as of 13 September 2026. The original frame, shared controls and
existing feature owners now cover the journeys above. The post-playtest polish
adds compact team previews, more visible Trade offers and team members, clear
Back/Actions/Pop out behavior, Home context and command examples, and paired Maps
layer/opacity controls. Task state remains with the existing tools when they move
between Hub and floating presentation.

The [verification record](hub-verification.md) distinguishes the earlier live
outpost checks from the final polish's browser, offline Electron and packaging
evidence. These local commits are ready for review; release publication and human
gameplay/accessibility acceptance remain separate from implementation completion.
