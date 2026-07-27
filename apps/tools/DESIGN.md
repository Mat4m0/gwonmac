# GWonMac interface system

The interface sits over a moving game for long sessions. It must stay readable,
feel native to GWonMac, and remain visibly separate from ArenaNet's own UI.

## Direction

Restrained, dark, and operational. A thin metal edge and one accent connect the
surface to Guild Wars without copying its textures or pretending that a
GWonMac panel is an ArenaNet window. System UI type carries every control and
label. Colour communicates selection or state; it is not decoration.

## One runtime source

[`src/design-system.css`](src/design-system.css) owns the semantic tokens used
by Vue and by the renderer's Settings dialog. Components consume aliases such
as `--ui-panel-fill`, `--ui-text-muted`, and `--ui-accent`; they do not define
their own theme.

Five preferences are persisted in `AppSettings` and validated by main:

| Preference | Range | Purpose |
| --- | --- | --- |
| Theme | Brass, Steel, Jade | Changes the complete neutral/accent family |
| Density | Compact, Balanced, Comfortable | Changes type, spacing, and control height together |
| Panel opacity | 65–100% | Keeps content readable against live game art |
| Border | 0–4 px | Changes the physical edge without changing layout semantics |
| Corner radius | 0–16 px | Changes all panel and control geometry coherently |

These are product controls, not an arbitrary CSS editor. Every saved value has
a bounded validator and a reset path.

## Components

The vocabulary is intentionally small:

- panel: frame, header, body, optional footer;
- well: list, input, or recessed content;
- button: primary, default, quiet, danger;
- segmented control: one choice from a short set;
- field: label, control, optional explanation or error;
- row: one selectable library object;
- chip: compact metadata or status;
- toast: reversible action feedback.

Every interactive component needs default, hover, focus, active, disabled, and
error states where applicable. Focus uses `--ui-focus`, so it survives moving
game art behind a translucent panel.

## Layout and motion

- Panels respond to their own container width, not only the viewport.
- At narrow widths, list and detail become separate views.
- Common transitions last `--ui-duration` (180 ms).
- Reduced motion sets that duration to zero.
- z-index values come only from the named `--ui-z-*` scale.

## Adding a theme

A theme is a complete override block on
`:root[data-ui-theme="<name>"]`. It must define the neutral ramp, text ramp,
accent, frame, and focus colour. Adding only an accent is not a theme.

Before shipping, verify body text at 4.5:1 and large text at 3:1 against both
the panel and well fills at the minimum supported opacity.
