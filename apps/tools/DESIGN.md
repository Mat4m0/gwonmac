# gwonmac interface system

This file defines the interface rules for gwonmac surfaces. Settings, Tools,
dialogs, lists, and skill bars use one component system.

## Visual styles

The system has two built-in styles and one saved custom palette:

- **Guild Wars** is the default. It uses ivory metal, parchment text,
  blue-black primary controls, graphite secondary controls, and gilt accents.
- **Modern** uses flat warm-black layers, quiet one-pixel borders, muted gilt
  accents, and limited shadow.
- **Custom** derives the complete system from a material style and semantic
  window, title bar, raised surface, recess, selection, accent, text, muted
  text, and border colours. Warning, danger, success, and profession colours
  keep their fixed meaning.

Both styles use the same information hierarchy, components, layout, and
behavior. Profession colors keep their game meaning in both styles. Do not add
a third component system for a new style.

## Source files

| File | Owner |
| --- | --- |
| [`src/shared/ui/tokens.css`](../../src/shared/ui/tokens.css) | Colors, materials, edges, corners, motion durations, and layers |
| [`src/shared/ui/components.css`](../../src/shared/ui/components.css) | Reusable panels, controls, fields, rows, slots, feedback, and resize controls |

The main renderer loads both files. Embedded Tools uses the same loaded styles.
The standalone Tools fixture imports the files because it has no parent
renderer.

Consumer stylesheets own layout. They must not define a second color, material,
corner, or layer system.

## Token hierarchy

Tokens have three layers and CSS variables are the only runtime source of
truth:

1. **Foundation** owns the 4px spacing ramp, fixed type roles, 34px ordinary
   controls, 30px dense-row controls, radii, motion, shadows, and z-index.
2. **Semantic** owns paired surface/foreground roles, text roles, borders,
   selection, hover, pressed, focus, commands, feedback, and profession data.
3. **Material** projects Classic or Modern paint, edge construction, radius,
   and shadow onto those semantic roles. Material never changes layout,
   density, typography, or behavior.

The four typography roles are Display for identity, Interface for labels and
controls, Reading for prose and messages, and Data for codes, shortcuts,
timestamps, and counts. Guild Wars Original deliberately falls back to the
readable sans face for Reading. Data always uses the monospace stack.

Guild Wars Original and its packaged fallback are single-weight faces. The
system disables synthetic bold globally so Chromium cannot thicken and blur
their outlines. In Classic typography, hierarchy comes from the Display,
Interface, Reading, and Data roles, the fixed size ramp, brighter semantic
text, and spacing. `strong` and headings remain semantic in markup but stay at
the real 400 weight when Guild Wars Original is selected. Fonts with genuine
weight families use the same semantic weight tokens at 500, 600, and 700.

## Component rules

- Use `.ui-frame` for a framed panel.
- Use `.ui-well` for a recessed content surface.
- Use `.ui-raised` for a pressable raised surface.
- Do not add a generic Card. Panes, sidebars, toolbars, and sections are
  transparent structural regions. Collections use flat rows. Repeated values
  use a ledger. Tiles are reserved for spatial commands such as Travel
  shortcuts and skill slots.
- Combine `.ui-panel-head` with `.ui-window-head` for floating windows that
  carry a title and supporting line. The shared primitive owns normal and
  constrained-viewport padding; feature styles must not retune it.
- Use `.ui-scroll` for scrollable wells and lists so scrollbar material stays
  consistent across Builds, Trade, and Travel.
- Use the shared components for buttons, fields, checks, tabs, rows, skill
  slots, progress, empty states, banners, toasts, and resize grips.
- Give each interactive control visible hover, focus, active, selected,
  and disabled states.
- Use the bright focus token. Focus must remain visible over game artwork.
- Vue feature code imports complex behavior through `src/ui`, never from Reka
  directly. Tabs and modal dialogs currently use these thin wrappers. Native
  buttons, fields, checks, ranges, and simple selects stay native.

### Control states

- A default button is a routine command such as Export, Copy, Open, or Browse.
- A primary button is the single completion action for the current scope, such
  as Save changes, Apply team, Search, or the confirming action in a dialog.
- Selected and pressed are persistent states. They use `aria-selected` or
  `aria-pressed`; do not simulate them with the primary variant.
- Focus is keyboard position, not selection. It uses the focus ring only.
- Danger is reserved for destructive actions and always names the consequence.
- Classic gold is an inset selection marker or ornament, never the full
  perimeter of a routine command. Focus has a separate two-pixel perimeter and
  dark halo. It never reuses selection paint.
- Hover is temporary tone, pressed is temporary depth/displacement, navigation
  selection uses a leading rail or underline, and content selection includes a
  persistent text or icon marker. Selected + hover has its own stronger tone.
- Quiet controls are transparent at rest. They gain a surface only on hover or
  focus.

The saved interface style is `guild-wars`, `obsidian`, or `custom`. Font and
panel opacity remain independent. Panel opacity is from 65% through 100%.
These preferences must not change component markup, layout density, or
behavior. Every player-facing Settings and Tools stylesheet consumes the
shared tokens; local palette literals are not allowed.

## Window and interaction rules

- Settings, Builds and teams, and Trade Chat use the same visible resize grip.
- Pointer resize uses capture and handles cancellation and lost capture.
- Arrow keys resize the window. Shift increases the step.
- Start a Tools drag only from title-bar furniture.
- Do not start a drag from an interactive child.
- Keep a non-modal surface open when the player clicks Guild Wars behind it.
- Escape closes the topmost GWonMac surface before Guild Wars receives it.
- Tab enters the topmost open GWonMac surface and wraps inside its controls.
- Keep native confirmation dialogs above non-modal Tools and Travel surfaces.
- Open Travel with Quick Travel destinations only; reveal the full catalogue as
  the player searches.
- Keep version availability collapsed in Settings unless something is
  unavailable.
- Keep a dragged window inside the viewport.
- Let Builds and teams and Trade Chat remain open together. Pointer interaction
  raises one explicit surface; do not add a generic tool registry.
- Treat Trade Chat as a working ledger, not a chat transcript or a variation of
  Builds and teams. Keep source, search, and intent controls above one semantic
  ledger, with the selected offer in a bottom inspector.
- At narrow widths, keep the Trade Chat list DOM and open the selected offer in
  an in-window sheet. The sheet keeps the shared button and scroll primitives.
- Merge Trade Chat messages immediately near the top. Away from the top, queue
  them silently without moving the reading position or showing a repeating
  arrival hint; merge the queue when the reader returns to the exact top.
- Reveal local Trade Chat results 25 at a time as the player nears the bottom,
  up to 200 results.
- Search offer text and the upstream `user:` character index together, then
  merge results by message timestamp. Clearing the field returns immediately
  to the live ledger.
- Keep every timestamp-distinct search result, including multiple posts from
  one character. Keep search results and the live ledger chronological.
- Open Trader prices inside the Trade Chat window and preserve the ledger DOM
  while it is hidden. Back returns to the previous ledger state and position.
- Use a master-detail price layout at wide widths and one navigable pane at
  narrow widths. Keep category, search, selected item, and chart range intact
  while moving between the list and detail.
- Distinguish observed buy and sell history with both labels and stable colors.
  Charts must expose exact values without depending on color or pointer hover.
- Keep saved offers and followed players in one right-anchored Saved drawer.
  It is non-modal at wide widths and an in-window sheet when narrow. Its entry
  and exit share the right edge, focus returns to its trigger, and reduced
  motion replaces translation with a brief cross-fade.
- Reveal compact save and follow actions on ledger-row hover or keyboard focus;
  keep them visible for touch input. Keep the bottom inspector actions on one
  compact, wrapping row so the message remains the visual focus.
- Scroll to revealed Trade Chat messages smoothly by default and instantly
  when reduced motion is active.
- Keep scrolling flex and grid children shrinkable.
- Use container width to change panel layout.
- Keep the skill bar usable with pointer, touch, and keyboard input.
- Do not show drag behavior on a read-only skill bar.
- Anchor a skill-key label to the slot's bottom-right corner. Add modifiers to
  the left without moving that corner or crossing into another slot.
- Keep exported text visible after copy succeeds or fails.
- Remove nonessential motion when reduced motion is active.

Tools chrome must receive input only inside its controls. Guild Wars must keep
normal keyboard and pointer input outside those controls.

## Verification

Open [`docs/ui-gallery.html`](../../docs/ui-gallery.html) to inspect the shipped
tokens and components. Run this command for the automated visual sweep:

```bash
node scripts/ui-visual-sweep.mjs
```

Check narrow, wide, short, transparent, and opaque states. Check the live
Settings dialog too. Body text must have a contrast ratio of at least 4.5:1.
Large text must have a ratio of at least 3:1. Test minimum opacity over bright,
detailed game artwork.
