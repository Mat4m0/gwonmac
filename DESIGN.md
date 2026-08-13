# Guild Wars Reforged Interface

The interface has one visual contract: Guild Wars supplies atmosphere and
macOS supplies interaction.

## Visual system

- Use the reviewed static Reforged landscape as environmental key art. Do not
  load the launcher video in utility windows.
- Use the existing Reforged logo as the only ornamental brand element.
- Use the macOS system font for application controls, labels, forms, and status.
- Use one ember tint (`#b84618`) for selection and primary action. Reserve red
  for destructive actions and green for an already-open account.
- Prefer native hierarchy: system-sized controls, semantic checkboxes, sheets,
  menus, concise labels, and visible keyboard focus.
- Use translucent material only where it improves separation from key art.
  Reduced-transparency mode replaces it with an opaque warm-dark surface.
- Keep motion short and functional. Reduced-motion mode removes nonessential
  transitions and animation.

## Multiple Accounts Hub

The Hub uses a 960×700 hidden-inset window with a 640×560 minimum. Its chooser
is content-sized and anchored at bottom-right; compact widths turn it into a
bottom sheet. Account rows scroll within the chooser, so many accounts do not
move the primary action off-screen.

The launch surface answers one question: which accounts should open? Account
administration uses progressive disclosure:

1. The chooser shows selection, launch state, Retry, and the primary action.
2. A row's More menu exposes Edit Account and Archive Account.
3. Modal sheets handle creation and editing.
4. Hub Settings handles archived accounts, permanent deletion, and account-mode
   switching.

Player text says **account**. Internal code may retain **profile** for stable
IDs, paths, partitions, and existing domain types.
