# gwonmac: unify the Guild Wars visual study and Hub experience

Research and proposed delivery plan — 12 September 2026.

Target: the existing **gwonmac** application, as confirmed by Matthias. Implementation authorized on 12 September 2026. This plan does not claim release readiness. Guild Wars v2 is outside this plan.

## Recommendation

Bring the study's original Guild Wars frame and control treatment into the working Hub. Preserve Hub's interaction model and the current app's feature owners. Complete one real journey before spreading the visual changes across every tool.

The first reviewable milestone is **Hub Home → Travel → destination review/action → return**, rendered with the Classic artwork, with Modern and Custom still working. Use the production components and offline fixture. A second standalone demo would leave the integration question unanswered.

Three sources have different jobs:

| Source | What it owns for this work | What must not be copied wholesale |
| --- | --- | --- |
| [Current gwonmac](../) | Current native behavior, settings, feature availability, persistence, shared controls and release workflow | No replacement with an older checkout |
| [Hub worktree](../../gwonmac-command-palette/) and [Hub specification](../../gwonmac-command-palette/spec.md) | Accepted search, task flows, navigation, shortcuts and preserved state | Unrelated changes, older versions of current native owners, historical bugs |
| [UI study](/Users/matthias/Downloads/gw-ui-study/DESIGN.md) | Classic artwork, frame reconstruction, visual references and theme exploration | Sample records, demo search, browser-only geometry/preferences, extra theme systems |

Task references: [Build Guild Wars UI study](codex://threads/01a081f9-6873-7413-af41-b49dd320b759) and [TOCHECK: RAYCAST COMMAND BAR](codex://threads/01a07a52-9ffc-7ce0-bb64-ebedc53cda37).

## What the research established

- Current `gwonmac` was clean on `main`, at `13c82c09`. It does not contain the Hub implementation.
- The Hub worktree is on `feat/hub-builds`, at `467d77f4`, with substantial tracked and untracked work. That commit alone does not contain the accepted final Hub.
- Their common ancestor is `c1d530f9`. The inspected committed tips have 21 main-only and six Hub-only commits, before counting working changes. This is an integration task as well as a visual task.
- The study was clean at `0e01edd`. Its `GwHub.vue` uses fictional records and simplified substring search. It cannot replace the production Hub controller.
- I opened both local previews and inspected Classic Home, working Hub Home, `build monk`, and `char Toefte`. The working Hub has real presentation for ordered skill bars and explicit action labels. The study has the original silver frame and stronger blue selection treatment.
- The [old audit](../../gwonmac-command-palette/docs/hub-audit.md) contains a later closure table for all H01–H14. Its original verdict is historical. The [verification record](../../gwonmac-command-palette/docs/hub-verification.md) reports 40 passing browser journeys in the final historical batch. These are useful regression specifications, not fresh qualification of current main.
- Main already defines one shared UI system in [Tools design](../apps/tools/DESIGN.md), including font roles, controls, Classic/Modern/Custom, contrast handling, and independent opacity. The overhaul should extend this system.

I did not run the full suites, open a live game, exercise real account changes, or modify application code during this research.

## The combined experience

Hub is the central entry point. It offers a focused search field, optional pins, relevant recent destinations, enabled tools, and an action footer. Its visible name is **Hub**.

Preserve the accepted tool priority: Travel → Switch Character → Whispers → Build Library → Trade Chat → Xunlai Storage → Maps → Switch Account. Explicit pins remain first. Do not introduce learned ranking as part of this overhaul.

Use the same visual language in three presentation forms:

| Form | Suitable work | Behavior |
| --- | --- | --- |
| Search result or compact review | Destination, character, saved build/team, conversion, person | Search, inspect, choose a named action |
| View inside Hub | Travel, Characters, Whispers, settings, build/team authoring, Trade | Fixed outer frame; content scrolls or changes pane inside it |
| Floating tool | Ongoing chat, longer Trade or Library work | Reuse feature state; return to Hub without losing the task |

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

Reuse the study's frame source regions and measurements from [frame.json](/Users/matthias/Downloads/gw-ui-study/visual/frame.json) and its [provenance](/Users/matthias/Downloads/gw-ui-study/visual/provenance.json). The successful reconstruction uses a single decorative Canvas 2D image. Shared integer physical-pixel boundaries avoid seams from separately composited translucent tiles.

Port that drawing logic as a small shared frame renderer usable by the existing DOM Hub and Vue windows. A Vue wrapper may own attachment and disposal, but must not become another geometry or feature-state owner. Keep HTML controls above the decoration, with `aria-hidden` and no pointer handling on the frame artwork. Redraw on size or pixel-ratio changes; dragging alone does not require continuous painting.

Resolve assets through gwonmac's existing build, protocol and font owners. Runtime must not depend on a Downloads path, the study's dev server, or a second font loader. Confirm the redistribution basis and preserve notices before packaging the source artwork. A local provenance hash establishes origin, not permission by itself.

The study is a strong accepted reference, but its [comparison report](/Users/matthias/Downloads/gw-ui-study/visual/results/report.json) explicitly does not establish pixel-perfect equality to the game. Rail landmarks differ by one reference pixel, corner differences remain, and some diagnostic masks contain no comparable pixels. Preserve that distinction.

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

## Scope and next action

Keep native DDS skin replacement, extra themes, new daily/planning features, framework migration and v2 out of this delivery. The HTML companion can match Guild Wars visually without changing ArenaNet's native interface textures.

Start implementation with steps 1–4 as a bounded first milestone: preserve and integrate the Hub, establish baselines, then deliver Home and Travel in the original frame. Review that actual working result before extending the same system to the remaining flows. This establishes both visual fidelity and usable interaction early, while the current owners and player data remain intact.
