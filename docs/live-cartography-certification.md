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

### Compass ranges

Enable **Compass ranges** and run `pnpm recon:compass-ranges`. The rings must
stay centred on the player marker, scale from the native Compass edge, and
remain visible without opening the Mission Map. The Cartography and range
controls must remain centred as one stack.

| Action | Capture | Pass condition |
| --- | --- | --- |
| Default Compass | `capture ranges-default` | Four distinct thin, cased rings are visible and diagnostics report 1012, 1248, 2512, and 3500 units. |
| Move the Compass | `capture ranges-compass-moved` | Every ring and both controls follow the Compass; their stack remains centred. |
| Resize the game | `capture ranges-game-resized` | Ring radii scale with the Compass width. |
| Toggle one range | `capture ranges-one-hidden` | Only the selected ring hides; the other choices remain unchanged. |
| Drag one opacity slider | `capture ranges-opacity` | The selected ring previews smoothly, saves on release, and retains its opacity after restart. |
| Switch Color to Monochrome | `capture ranges-monochrome` | All four rings become neutral white without moving or changing opacity. |
| Inspect both controls | `capture ranges-controls` | Both center icons stay white; only the range control's outer border reports its on/off state. |
| Turn all ranges off | `capture ranges-toggle-off` | No ring remains and diagnostics report `disabled`. |
| Restore graphics context | `capture ranges-context-restored` | Enabled rings return once, with no stale or duplicate canvas. |

Click, drag, scroll, and use keyboard controls through the overlay. Guild Wars
must receive input unchanged. A stationary state must not redraw continuously.

## Mission Map

| Action | Capture | Pass condition |
| --- | --- | --- |
| Open default | `capture mission-default` | Grid fits the drawable map, not its frame, and highlights the player cell. |
| Horizontal pan | `capture mission-pan-horizontal` | Lines remain attached to artwork without visible delay. |
| Vertical pan | `capture mission-pan-vertical` | Absolute cell phase does not reset at an edge. |
| Minimum zoom | `capture mission-zoom-min` | Individual cells become stable 4×4 and then 16×16 clusters; unreadable progress hides. |
| Maximum zoom | `capture mission-zoom-max` | Cell size grows proportionally and guidance stays aligned. |
| Move map window | `capture mission-window-moved` | Overlay follows the drawable region exactly. |
| Resize map window | `capture mission-window-resized` | Bounds and scale update without an old-sized frame or vertical offset. |
| Resize game window | `capture mission-game-resized` | Projection remains attached at the new global scale. |
| Hold Shift and hover a cell | `capture mission-cell-hover` | Hover guidance identifies one cell and its normal 3×3 reveal neighborhood without intercepting map input; releasing Shift hides it. |
| Hold Option+Shift and hover a cell | `capture mission-birds-eye-hover` | The same cell shows the Bird's Eye 7×7 footprint; releasing either modifier returns to the expected smaller or hidden state. |
| Explored creditable cell | `capture mission-explored-credit` | Soft green coverage follows the artwork and never covers a remaining estimate. |
| Continent remaining estimate | `capture mission-remaining-estimate` | Hollow amber cells or clusters appear across the visible continent, including when live pathing is unavailable. |
| Unseen cell revealable from this map | `capture mission-current-map-credit` | Solid orange overrides amber only where the current live instance can reveal the cell. |
| Current evidence boundary | `capture mission-live-boundary` | A thin neutral boundary encloses live evidence without hiding surrounding continent progress. |
| Explored or non-creditable cell | `capture mission-non-actionable` | No amber or orange marker is drawn. |
| Close and reopen | `capture mission-reopened` | Projection returns without a stale duplicate canvas. |

Compare the reported cell pixel sizes with the visible result. Values must
change proportionally with zoom and resizing.

## World Map

Open the continent-scale World Map through the game's normal control and repeat
pan, zoom, resize, hover, close, and reopen. The same global grid phase, green
coverage, and remaining bitset must remain attached. The detailed walkability
veil must be absent at continent scale. Solid orange may appear only inside the
thin current-instance boundary. The World Map observer must report `ready` only
while the surface is visible. Its failure must not affect the Compass or Mission
Map.

Close the World Map during its fade, reopen it immediately, and close it again.
The grid must hide when the native frame finishes closing. Reopening must show
one attached grid without a stale duplicate.

Find one grouped estimate where the current map proves a smaller number. Record
the estimate and proven number, travel away, and restart gwonmac. The remembered
number must remain lighter outside the map. Explore every proven cell. The
number must disappear and must not return to the larger estimate.

## Layers and lifecycle

Capture `layers-grid-only`, `layers-walkability-only`, and `layers-all` from
the same position. Grid and walkability must remain independently switchable,
use the shared style coherently, and preserve native map detail. Repeat a
combined capture at low, medium, and full opacity for each layer and with the
Cartographer, Synthwave, and Monochrome styles. Select **Customize style…** and confirm
that colors, line widths, line patterns, and all five unseen-cell markers change
the same role on the Compass and shared map window. Copy that style, delete the local
copy, import it again, and confirm the imported style remains selected after
reopening Settings.

Then capture a district transition, explorable entry, mission restart,
different map, return to character selection, and graphics-context reset when
available. All derived geometry must disappear during loading. It may return
only from complete records with the current matching generation. Include one
map with bridges, islands, or multiple pathing layers.

Travel to Gate of Madness or another Realm of Torment area. Confirm that the
Cartography control remains visible, its panel explains the limited area, and
only enabled Walkable terrain is drawn. Grid, coverage, and guidance must stay
hidden, while exported evidence reports the continent as `unsupported-area`
and retains ready current-instance terrain. Repeat in an off-world-map dungeon.
Then travel to Pre-Searing and confirm both Grid and Walkable terrain work.
Finally, return to Tyria, Cantha, or Elona and confirm the prior settings and
eligible layers return without restarting gwonmac.

Stop and fail closed if:

- cell phase differs between Compass and Mission Map;
- a layer drifts during movement, pan, zoom, rotation, move, or resize;
- stale data survives loading or a generation mismatch;
- geometry becomes dense, unbounded, or redraws continuously while idle; or
- Guild Wars input is intercepted.
