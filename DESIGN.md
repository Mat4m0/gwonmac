# Guild Wars Reforged Interface

The interface has one visual contract: Guild Wars supplies atmosphere and
macOS supplies interaction.

## Visual system

- Use the reviewed static Reforged landscape as environmental key art. Do not
  load the launcher video in utility windows.
- The launcher title bar shows the gwonmac icon and name, not the Reforged logo.
  Guild Wars artwork stays in the key art and the Guild Wars news mark.
- Keep visual style and typeface independent in in-game GWonMac panels. The
  locally converted Guild Wars body font is the default; Inter/system type is
  the modern option, and Palatino is the fail-safe when the game asset is not
  available. Utility windows such as the Multiple Accounts Hub keep macOS
  system type.
- Use one gold accent (`#e8b75c`) for selection and primary action. Reserve red
  for destructive actions and green for an already-open account.
- The launcher names every colour, radius, and type size once, in the `:root`
  tokens of `apps/launcher/src/style.css`. Shell rules and components use only
  those names; a policy test rejects raw colours and undefined tokens. Settings
  keeps its own `--settings-*` set because the game's Hub draws it too.
- The launcher has one button vocabulary: `.primary` (gold, one per view),
  `.secondary`, `.quiet`, `.icon-button`, and `.small` for rows. Labels and
  statuses use `.chip`. No eyebrows: no small uppercase label above a heading;
  put the source and date in a plain line under the title. Support is a quiet pill
  in the title bar, never a banner or a progress counter.
- Reading happens on pages, not in modals. A news article opens as a full page
  in **News** with a way back to the list; Help pages are the Guide. Modals are
  for short decisions and forms only.
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

Game Settings only enables or leaves Multiple Accounts mode. The Hub is the
single account-management surface, including the empty **Create First Account**
flow and its optional one-time copy from Single Account data.

The launch surface answers one question: which accounts should open? Account
administration uses progressive disclosure:

1. The chooser shows selection, launch state, Retry, and the primary action.
2. A row's More menu exposes Edit Account and Archive Account.
3. Modal sheets handle creation and editing.
4. Hub Settings handles archived accounts, permanent deletion, and account-mode
   switching.

Player text says **account**. Internal code may retain **profile** for stable
IDs, paths, partitions, and existing domain types.
