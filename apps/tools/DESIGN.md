# GWonMac interface system

The interface sits over a moving game for long sessions. It must stay readable,
feel native to GWonMac, and remain visibly separate from ArenaNet's own UI.

## Direction

Restrained, dark, and operational. A thin metal edge and one accent connect the
surface to Guild Wars without copying its textures or pretending that a
GWonMac panel is an ArenaNet window. The client stacks an inner highlight, an
outer shadow and a stone texture; over live art for hours that reads as noise,
and a texture convincing at 100% opacity is mud at 70%. System UI type carries
every control and label. Colour communicates selection or state; it is not
decoration.

## One runtime source, in two files

| File | Owns |
| --- | --- |
| [`src/shared/ui/tokens.css`](../../src/shared/ui/tokens.css) | every colour, corner, edge, duration and layer |
| [`src/shared/ui/components.css`](../../src/shared/ui/components.css) | what a button, panel, row or chip looks like |

They live in `src/shared` rather than in either consumer because both the
renderer's Settings dialog and this Vue workbench are built independently and
must agree. `apps/**` may only reach into `src/shared/**`
(see `eslint.config.mjs`), and a design system shared by two surfaces is a
contract in exactly the sense the rest of that directory means it.

The renderer links both from `src/renderer/index.html`;
`scripts/copy-renderer.mjs` copies them to `build/renderer/ui/`. Embedded, the
Tools app therefore inherits them and must not bundle its own copy — only
`standalone.ts`, which has no renderer around it, imports them.

`tests/unit/the-ui-system-has-one-place-to-change-a-colour.test.ts` fails the
build if `components.css`, `harness.css` or this app's `styles.css` contains a
literal colour, a literal corner, or a z-index outside the named scale.

## Three primitives

Everything else composes them, so no component re-decides what recessed or
selected looks like:

- `.ui-frame` — a metal-edged panel that floats over the world;
- `.ui-well` — a recess things sit *in*: lists, inputs, tracks, skill slots;
- `.ui-raised` — a control that sits *on* a panel and can be pressed.

The rest of the vocabulary is deliberately small: panel (head, body, foot),
button (default, primary, quiet, danger), link, field (label, control, hint),
input, select, textarea, check, segment, tabs, rail, list and row, chip, kbd,
skill slot, identity mark, progress, divider, empty, banner, toast.

Every interactive component has default, hover, focus, active and disabled
states. Focus uses `--ui-focus` rather than the accent, so it survives moving
game art behind a translucent panel.

## What a player can change

Five preferences are persisted in `AppSettings` and validated by main:

| Preference | Range | Purpose |
| --- | --- | --- |
| Theme | Brass, Steel, Jade | Changes the complete neutral/accent family |
| Density | Compact, Balanced, Comfortable | Changes type, spacing, and control height together |
| Panel opacity | 65–100% | Keeps content readable against live game art |
| Border | 0–4 px | Changes the physical edge without changing layout semantics |
| Corner radius | 0–16 px | Changes all panel and control geometry coherently |

These are product controls, not an arbitrary CSS editor. Every saved value has
a bounded validator and a reset path, and everything else derives from them, so
a player cannot produce a half-themed interface.

## Layout and motion

- Panels respond to their own container width, not only the viewport.
- At narrow widths, list and detail become separate views.
- Common transitions last `--ui-duration` (180 ms).
- Reduced motion sets that duration to zero.
- z-index values come only from the named `--ui-z-*` scale.

## Seeing it

[`docs/ui-gallery.html`](../../docs/ui-gallery.html) links the two shipped
stylesheets directly and has no build step — open it from disk. Its theme,
density and slider controls write exactly what `src/renderer/appearance.ts`
writes, so a component that looks wrong there looks wrong in the product. Its
backdrop is deliberately bright: against a dark one, every panel opacity from
65% to 100% looks the same and the control appears to do nothing.

`pnpm ui:sweep` (with the workbench dev server running) drives the gallery and
the Tools app through all 81 reachable combinations of theme, density, opacity,
border and radius. It writes screenshots to `/tmp/ui-sweep` for a human, and
fails on the faults a machine can see on its own: a surface that scrolls
sideways, content clipped by its own container, a control too short to hit, a
frame with no fill or no edge.

## Adding a theme

A theme is a complete override block on `:root[data-ui-theme="<name>"]`. It
must define the neutral ramp, ink ramp, accent, frame and focus colour. Adding
only an accent is not a theme, and the unit test says so.

Before shipping, verify body text at 4.5:1 and large text at 3:1 against both
the panel and well fills at the minimum supported opacity.
