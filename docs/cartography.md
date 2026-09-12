# Cartography

GWonMac has three independent native-map layers:

- **Cartography grid** draws Guild Wars' fixed 32×32 map-unit exploration cells
  only where exploration remains on the Mission Map and World Map. **Markers on
  Compass** includes the Compass
  only when explicitly enabled. It defaults to off, including existing profiles
  that do not yet have this preference.
- **Walkable terrain** shades the current instance's certified pathing geometry
  on the Compass and Mission Map while preserving the native map artwork.
- **Compass ranges** draws the standard Shout, Cast, Spirit, and Ext. Spirit
  distances around the player. The native Compass edge already represents
  Compass range, so the overlay does not repeat it. Choose distinct colors or
  a high-contrast monochrome treatment from the Compass menu or Maps settings.

The layers can be enabled separately. Cartographer, Synthwave, and Monochrome
styles are included. **Customize style** creates an editable copy of a built-in
style. **Terrain border thickness** is available beside the main controls for
both built-in and custom styles; 0 hides the border. Changing a built-in style
creates a custom copy automatically. Custom colors, line patterns, widths, and
cell markers can be copied and
imported as versioned text. Each color has a picker and a six-digit hex field.
Opacity and line width have a slider and a numeric field. Slider values preview
while dragging and save on release. Saved changes update every open game window
without a reload when Tools and Maps are active.

Maps settings remain available when Tools are off. The page explains how to
enable Maps and whether an application restart is needed. An illustrative
preview shows the selected colors, border, and remaining markers without a game
session. Inspection outlines and Compass inspection options are disclosed
separately. **Use Cartographer defaults** selects the built-in style without
deleting custom styles. Deletion requires confirmation with the style name.

Failed saves remain visibly unsaved. **Retry save** repeats the intended change;
**Revert change** restores the confirmed settings. Other edits are blocked until
the player resolves the failure, preventing a stale whole-preset overwrite.

## One evidence pipeline

The client provides a continent-wide exploration bitmap. A compact GWToolbox++
mask estimates which cells can award exploration somewhere. These form an
independent continent partition:

```text
explored creditable = explored AND creditable
remaining estimate  = NOT explored AND creditable
```

The current instance adds exact, live evidence:

```text
actionable now = remaining estimate AND currently reachable
```

GWonMac remembers the revealable-cell mask for each visited map. It does not
store the number shown on the World Map. The current exploration bitmap always
recalculates that number.

For a grouped World Map number, evidence has this priority:

1. Use live current-map cells when that map overlaps the group.
2. Otherwise, use remembered visited-map cells when they overlap the group.
3. Otherwise, use the continent-wide estimate.

A proven zero hides the group. It does not fall back to a larger estimate. For
example, live map evidence can replace an estimated `12` with actionable `2`.
After both cells are explored, the number disappears. After travel or restart,
the remembered `2` remains the basis for the lighter non-current number.

The default visual language is:

- explored cells: no exploration artwork;
- hollow amber: an unexplored continent candidate;
- solid orange: confirmed actionable in the loaded instance; and
- no grey marker.

Continent progress remains visible if current pathing is unavailable. Missing
Compass or map-window projection hides only that surface. Amber is an estimate,
not proof that the current instance can reach a cell. Existing marker shapes and
colors distinguish live evidence from estimates; no permanent lattice or
explored-area tint covers the map.

## Map presentation

Guild Wars exposes separate native contexts for the close-up Mission Map and
the continent-scale World Map. GWonMac certifies each context independently.
Both surfaces consume the same continent state and global grid phase. A failure
on either map hides only that surface.

Continent progress and guidance cover Tyria, Pre-Searing, Cantha, and Elona.
The Battle Isles, Realm of Torment, dungeons, and other maps outside a campaign
world map keep the local walkable-terrain layer but hide global exploration
guidance. The compact control remains visible and explains this
limited mode when opened. Settings remain intact and apply again automatically
after travel to a fully supported area.

The World Map projection comes from a complete native event context.
Unrelated or incomplete events leave the last complete projection intact.
Each presentation read also checks the certified native display flag, which
clears before the close fade starts. Closing withdraws all World Map overlays;
reopening requires another complete projection. Mission Map and Compass
readings reject hidden frames and frames that are being destroyed.

At 18 pixels or more per cell, the map draws individual amber diamonds and
orange actionable markers. At 8–18 pixels it groups the global grid into 4×4
clusters. Below 8 pixels it uses 16×16 clusters. Cluster origins are fixed to
the global grid, so they do not jump during pan, resize, or travel. Unreadable
progress hides below the minimum safe scale. Large cached tiles use clusters
when individual markers exceed the drawing budget, so resizing does not erase
remaining guidance.

The detailed walkability veil is shown on the Compass and Mission Map. It
darkens the area outside walkable terrain while leaving the interior clear,
with the chosen boundary color. The continent-scale view keeps remaining
markers and clusters. Explored cells are clear on every map.

Hold Shift while hovering the map window to inspect the normal 3×3 reveal
range. Hold Option+Shift for Bird's Eye 7×7 inspection. The diamond is the
default marker; custom styles can select corner brackets, crosses, stipple, or
hatching.

The Compass stays local and precise. It uses the same fixed grid, live terrain,
exploration, and actionable state, but does not draw continent clusters or the
continent tint. It works before the map window is opened.

Terrain, remaining markers, and ranges are composed inside their owning native
maps. Compass terrain and markers share a native Canvas texture; ranges have a
separate retained mesh. Mission and World Map bitmap quads draw after their
native background and before foreground icons. Native matrices and clipping
control continuous motion and coverage by later panels and tooltips. The old
positioned browser drawing surfaces are removed. Menus and tooltips remain
application UI. Compass and Mission Map share the inverse-veil painter.

The Compass caches one nearby terrain texture. It repaints when the map, terrain
tile, style, opacity, or interface scale changes. Movement within a tile and
camera rotation update only native mesh coordinates. Optional Compass inspection
repaints when its selected player cell changes; it does not follow every subcell
movement in the CPU painter. The texture has a fixed
size limit, and its input buffer is released after the native copy. The Canvas
owns the retained mesh and material until its destructor runs. Missing native
support or stale map identity hides Compass terrain without changing settings.
Stationary Compass geometry is reused; range geometry changes only with its
Canvas rectangle or artwork, not camera motion.

Mission and World Map cache artwork in world coordinates, with a margin around
the visible rectangle. Small pans reuse it. Zoom moves it continuously through
the native camera; raster detail changes in eighth-octave steps. Textures are
bounded to 2048 pixels per edge. Hover and Shift inspection use independent
small textures, so moving the pointer does not rebuild terrain or remaining
markers. Closing a map withdraws its drawing; native destruction releases its
retained handles. Graphics resets invalidate uploads, and loader disposal frees
its detached canvases and listeners. Failed installation releases each resource
already acquired; one failed native withdrawal does not stop other cleanup.
Missing native support hides that surface and skips its CPU painter. Compass
geometry remains available for a healthy Mission Map projection.

Exploration invalidation compares bitmap contents rather than the observation
sequence. Identical polls reuse the masks and artwork; real progress updates
at the existing model polling interval. Native presentation remains at the
game's frame rate. Cached textures trade bounded memory and slight raster
resampling during zoom for fewer CPU paints and GPU uploads.

Compass ranges also work without opening the Mission Map. Their radii are
1012, 1248, 2512, and 3500 Guild Wars units, projected from the certified
5000-unit Compass edge. Click the separate circular control beside the Compass
to open its menu. Use the menu to show or hide all ranges, choose individual
ranges, and preview each ring's opacity. Turning the master off preserves those
choices. Settings → Maps provides the same durable controls.

The Cartography and Compass-range controls form one centred stack. A lone
available control remains centred by itself. Both menus use the same size,
spacing, idle visibility, and outward-facing placement.

## Safety and lifecycle

Raw WASM addresses never reach the renderer. A generation mismatch, loading,
invalid scalar, excessive geometry, uncertain projection, or unsupported build
fails the dependent evidence layer closed. Travel withdraws stale orange and
terrain immediately without discarding a healthy continent snapshot.

An area without continent progress fails only that evidence layer closed with
the bounded `unsupported-area` reason. Certified local terrain can remain
available, but limited-area reachability cannot update visited-map knowledge.

Main stores visited-map knowledge atomically in
`cartography-map-knowledge.json`. The file contains global map geometry, not
account or character progress. Normal and Bird's Eye reveal modes stay
separate. Repeated visits only add proven cells. Corrupt data is quarantined,
and a different installed Guild Wars content generation or reachability kernel
starts an empty ledger.

## Evidence export

**Export Cartography Evidence** writes one strict report for the current
continent, an optional current-instance record, a deterministic color preview,
and `cartography-summary.txt`. The continent report remains exportable when the
kernel is unavailable. The summary labels amber as an estimate and includes the
exact current-instance failure reason.

Reports contain no account name, character name, route, chat, pointer, free
text, or raw memory. Use `pnpm cartography:validate`,
`pnpm cartography:compare`, and `pnpm cartography:merge` to inspect reports.
Merged evidence is review input and never becomes shipped truth automatically.

## Verification

The operator matrix and capture labels are in
[Live cartography certification](live-cartography-certification.md). Shipping
requires stable projection through movement, rotation, pan, zoom, map-window
move and resize, travel, loading, close/reopen, and context restoration.
