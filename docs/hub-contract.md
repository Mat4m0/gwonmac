# Hub interaction contract

The Hub presents commands over Guild Wars. Its state and presentation belong to
`src/renderer/hub.ts`. This document records intent and links to current owners.
Code and tests own exact values and accepted states.

## Keyboard and actions

List movement uses `src/shared/ui/list-keys.ts` and never wraps. Enter runs the
named footer primary. Modified Enter does not run it. Right opens a result page;
text fields keep their caret keys. Command-J opens the existing Actions menu.
Escape closes the innermost menu, disclosure, prompt, query, page, then Hub.
Command-Backspace goes back from any focus. Plain Backspace edits text.

Consequential rows require explicit activation. A click selects; Enter, the
footer primary, or a double-click on the same row runs the action. Destructive
actions ask for confirmation. No transition leaves focus on a removed node.

## Presentation and ownership

Every page keeps the same footer. Disabled slots stay visible. The primary names
its action and target on one line, with the complete accessible name and title.
Views use `HubViewFooter`; they do not add another footer or Actions menu.
A running primary shows progress without an Enter keycap.
Search uses the shared grammar and ranking in `src/shared/hub.ts`.
An owned list refreshes from its own source. Other observations update navigation
facts without rebuilding that list. Home searches all enabled sources.

Conflicting stored exact phrases require a choice. Both stores remain intact.
Tool labels come from `src/shared/tool-presentation.ts`. Settings copy comes from
`src/shared/setting-copy.ts`. Neither surface owns another copy of those labels.

[Settings](settings.md) owns preferences and durable writes.
[Whispers](whispers.md) owns the floating conversation window.
[Trade discovery](trade-discovery.md) owns the floating Trade Chat window.
[The user guide](user-guide.md#hub-command-palette) describes the player workflow.
[Hub verification](hub-verification.md) owns automated acceptance evidence.

Currency icons use the native search input and an inert measuring overlay.
The overlay never rewrites text or owns editing, selection, composition, or undo.
Progress belongs to the page session that started it. Late outcomes show receipts
and cannot navigate a newer session. A closed-Hub failure expires with the resume window.
An observer clears only its matching resolved failure, never another outcome.
Reduced motion keeps progress static.
