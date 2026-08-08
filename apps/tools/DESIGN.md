# GWonMac interface system

GWonMac uses one interface inspired by the original Guild Wars client. It is a
product surface, not a selectable theme. Settings, Tools, dialogs, lists, skill
bars, and feedback all consume the same shipped tokens and components.

## Direction

The visual grammar comes from Guild Wars itself:

- ivory metal rings with brighter corner caps;
- engraved parchment text in a Palatino-style serif;
- blue-black selected and primary faces;
- graphite secondary controls;
- recessed translucent black wells;
- gilt selection, focus, and elite-skill accents;
- blue client-like scrollbars;
- profession colours that keep their established game meaning.

The UI remains a dense utility. Ornament belongs to the frame and control
materials; content remains compact, aligned, and scannable.

## One runtime source

| File | Owns |
| --- | --- |
| [`src/shared/ui/tokens.css`](../../src/shared/ui/tokens.css) | every colour, material, corner, edge, duration, and layer |
| [`src/shared/ui/components.css`](../../src/shared/ui/components.css) | reusable panels, controls, navigation, fields, rows, slots, feedback, and resize affordance |

The renderer links both files from `src/renderer/index.html`. Embedded Tools
inherits those links and does not bundle a second copy. The standalone Tools
fixture imports them because it has no renderer around it.

Consumer stylesheets own layout only. The invariant test rejects component
colour literals, literal corners, unnamed stacking values, and any alternate
theme or density selector.

## Materials and primitives

Three primitives establish the material model:

- `.ui-frame`: a translucent panel with the ivory ring and corner swell;
- `.ui-well`: a recessed black surface for content and tracks;
- `.ui-raised`: a graphite, metal-ringed pressable surface.

The reusable vocabulary also includes panel head/body/foot, buttons and links,
fields and inputs, checks, segments, tabs, rails, rows, chips, keyboard hints,
skill slots, profession marks, progress, empty states, banners, toasts, and the
`.ui-resize-grip` shared by floating Settings and Tools windows.

Every interactive component provides visible hover, focus, active, selected,
and disabled states. Focus uses its own bright gilt token so it remains visible
over live game art.

## The only visual preference

Panel opacity is persisted at 65–100%. It controls how much of the game remains
visible behind GWonMac without creating another palette, geometry, or density.
Theme, density, border, and radius selectors do not exist.

Older settings files may still contain those retired fields. Full settings
parsing ignores them, and the next ordinary save writes only current fields.

## Window and layout behavior

- Floating Tools and Settings windows expose the same visible resize grip.
- Pointer resize uses capture and handles cancellation/lost capture.
- The grip supports Arrow keys; Shift increases the step.
- Tools dragging begins only on title-bar furniture, never on an interactive
  descendant, and the window is kept inside the viewport.
- Every flex/grid link in a scrolling window carries `min-width: 0` and
  `min-height: 0` where required.
- Panels respond to their own container width. At narrow widths the library and
  detail become separate views, and team rows stack without horizontal scroll.
- Reduced motion removes nonessential transitions.

## Seeing and verifying it

[`docs/ui-gallery.html`](../../docs/ui-gallery.html) directly links the shipped
stylesheets. Its only control is the same panel-opacity value Settings writes.
The deliberately bright backing makes transparency failures visible.

`node scripts/ui-visual-sweep.mjs` captures the gallery and Tools at minimum,
default, and opaque panel values and audits overflow, clipping, hit targets,
frame material, and missing fills. Browser review must also cover 320×800,
360×800, 640×900, 1024×420, and desktop Tools states plus the live Settings
dialog.

Before shipping, verify body text at 4.5:1 and large text at 3:1 against panel
and well fills at minimum opacity and a bright, detailed game backing.
