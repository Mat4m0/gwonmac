# Live cartography certification

Use this matrix after changes to map projection, frame observation, pathing,
exploration-cell observation, or grid ownership. It covers the generated grid
and walkability layer over Guild Wars' native maps.

## Before launching

1. Build and run all offline checks from the feature worktree.
2. Enable **Grid** in **Settings → Maps**. Leave **Walkable terrain** off for
   the first captures.
3. Start the evidence runner:

   ```sh
   pnpm recon:cartography-live
   ```

4. Open one game account when requested. Wait about one second after each
   visual change, then enter the listed `capture …` command.

Each capture stores a consented game-window screenshot and bounded scalar
diagnostics. It must not store texture pixels or WASM pointers.

## Compass

| Action | Capture | Pass condition |
| --- | --- | --- |
| Default Compass | `capture compass-grid-default` | Grid is clipped to the inner circle and current-cell guidance remains legible. |
| Walk inside one cell | `capture compass-walk-same-cell` | Grid stays fixed to the map artwork; the current-cell index does not change. |
| Cross a grid edge | `capture compass-cross-cell` | The correct index changes once and reveal guidance follows it. |
| Rotate without walking | `capture compass-rotated` | Grid rotates with the native Compass without a phase jump. |
| Resize the game | `capture compass-game-resized` | Circle, grid, and highlight remain aligned. |
| Move or resize Compass | `capture compass-relocated` | Overlay follows the frame and remains pointer-transparent. |
| Toggle reveal range | `capture compass-reveal-ranges` | Off hides persistent bounds; Normal and Bird's Eye use the intended 3×3 and 7×7 footprints. |

Click, drag, scroll, and use keyboard controls through the overlay. Guild Wars
must receive input unchanged. A stationary state must not redraw continuously.

## Mission Map

| Action | Capture | Pass condition |
| --- | --- | --- |
| Open default | `capture mission-default` | Grid fits the drawable map, not its frame, and highlights the player cell. |
| Horizontal pan | `capture mission-pan-horizontal` | Lines remain attached to artwork without visible delay. |
| Vertical pan | `capture mission-pan-vertical` | Absolute cell phase does not reset at an edge. |
| Minimum zoom | `capture mission-zoom-min` | Grid hides before it becomes dense or ambiguous. |
| Maximum zoom | `capture mission-zoom-max` | Cell size grows proportionally and guidance stays aligned. |
| Move map window | `capture mission-window-moved` | Overlay follows the drawable region exactly. |
| Resize map window | `capture mission-window-resized` | Bounds and scale update without an old-sized frame or vertical offset. |
| Resize game window | `capture mission-game-resized` | Projection remains attached at the new global scale. |
| Hold Shift and hover a cell | `capture mission-cell-hover` | Hover guidance identifies one cell and its normal 3×3 reveal neighborhood without intercepting map input; releasing Shift hides it. |
| Hold Option+Shift and hover a cell | `capture mission-birds-eye-hover` | The same cell shows the Bird's Eye 7×7 footprint; releasing either modifier returns to the expected smaller or hidden state. |
| Close and reopen | `capture mission-reopened` | Projection returns without a stale duplicate canvas. |

Compare the reported cell pixel sizes with the visible result. Values must
change proportionally with zoom and resizing.

## Layers and lifecycle

Capture `layers-grid-only`, `layers-walkability-only`, and `layers-all` from
the same position. Grid and walkability must remain independently switchable,
use the shared style coherently, and preserve native map detail. Repeat a
combined capture at low, medium, and full opacity for each layer and with the
Cartographer, Synthwave, and Monochrome styles. Select **Customize style…** and confirm
that colors, line widths, line patterns, and all five unseen-cell markers change
the same role on the Compass and Mission Map. Copy that style, delete the local
copy, import it again, and confirm the imported style remains selected after
reopening Settings.

Then capture a district transition, explorable entry, mission restart,
different map, return to character selection, and graphics-context reset when
available. All derived geometry must disappear during loading. It may return
only from complete records with the current matching generation. Include one
map with bridges, islands, or multiple pathing layers.

Stop and fail closed if:

- cell phase differs between Compass and Mission Map;
- a layer drifts during movement, pan, zoom, rotation, move, or resize;
- stale data survives loading or a generation mismatch;
- geometry becomes dense, unbounded, or redraws continuously while idle; or
- Guild Wars input is intercepted.
