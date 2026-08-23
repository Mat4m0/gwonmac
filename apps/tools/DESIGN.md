# gwonmac interface system

This file defines the interface rules for gwonmac surfaces. Settings, Tools,
dialogs, lists, and skill bars use one component system.

## Visual styles

The system has two styles:

- **Guild Wars** is the default. It uses ivory metal, parchment text,
  blue-black primary controls, graphite secondary controls, and gilt accents.
- **Obsidian** uses warm-black layers, system sans-serif text, muted gilt
  accents, and limited shadow.

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

## Component rules

- Use `.ui-frame` for a framed panel.
- Use `.ui-well` for a recessed content surface.
- Use `.ui-raised` for a pressable raised surface.
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

The saved interface style is `guild-wars` or `obsidian`. Panel opacity is from
65% through 100%. These preferences must not change component markup, layout
density, or behavior.

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
- Collapse repeated search matches from one character to their newest matching
  post and show the group count. Keep the live ledger chronological and
  ungrouped.
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
