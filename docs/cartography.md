# Cartography

GWonMac has three independent native-map layers:

- **Cartography grid** draws Guild Wars' fixed 32×32 map-unit exploration cells
  over the Mission Map and World Map. **Grid on Compass** includes the Compass
  only when explicitly enabled. It defaults to off, including existing profiles
  that do not yet have this preference.
- **Walkable terrain** shades the current instance's certified pathing geometry
  on the Compass and Mission Map while preserving the native map artwork.
- **Compass ranges** draws the standard Shout, Cast, Spirit, and Spirit+
  distances around the player. The native Compass edge already represents
  Compass range, so the overlay does not repeat it.

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
preview shows the selected colors, border, grid, and markers without a game
session. Advanced grid lines and Compass inspection options are disclosed
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

- soft green coverage: creditable progress already explored;
- hollow amber: an unexplored continent candidate;
- solid orange: confirmed actionable in the loaded instance; and
- no grey marker.

Continent progress remains visible if current pathing is unavailable. Missing
Compass or map-window projection hides only that surface. Amber is an estimate,
not proof that the current instance can reach a cell. A thin neutral boundary
shows where live current-instance evidence applies.

## Map presentation

Guild Wars exposes separate native contexts for the close-up Mission Map and
the continent-scale World Map. GWonMac certifies each context independently.
Both surfaces consume the same continent state and global grid phase. A failure
on either map hides only that surface.

Continent progress and guidance cover Tyria, Pre-Searing, Cantha, and Elona.
The Battle Isles, Realm of Torment, dungeons, and other maps outside a campaign
world map keep the local walkable-terrain layer but hide the global grid,
coverage, and guidance. The compact control remains visible and explains this
limited mode when opened. Settings remain intact and apply again automatically
after travel to a fully supported area.

The World Map projection and visibility come from one complete native event
context. Unrelated or incomplete events leave the last complete reading intact,
while a validated close event hides the overlay.

At 18 pixels or more per cell, the map draws individual amber diamonds and
orange actionable markers. At 8–18 pixels it groups the global grid into 4×4
clusters. Below 8 pixels it uses 16×16 clusters. Cluster origins are fixed to
the global grid, so they do not jump during pan, resize, or travel. Unreadable
progress hides below the minimum safe scale.

The detailed walkability veil is shown only in close-up presentation. The
continent-scale view keeps green coverage, remaining clusters, solid-orange
current guidance, and the live-evidence boundary without the noisy terrain
veil. Off-screen cells are culled; green coverage is cached by exploration
generation.

Hold Shift while hovering the map window to inspect the normal 3×3 reveal
range. Hold Option+Shift for Bird's Eye 7×7 inspection. The diamond is the
default marker; custom styles can select corner brackets, crosses, stipple, or
hatching.

The Compass stays local and precise. It uses the same fixed grid, live terrain,
exploration, and actionable state, but does not draw continent clusters or the
green continent tint. It works before the map window is opened.

Compass ranges also work without opening the Mission Map. Their radii are
1012, 1248, 2512, and 3500 Guild Wars units, projected from the certified
5000-unit Compass edge. The separate circular control beside the Compass
toggles all ranges when clicked. Hover it to choose individual ranges. Turning
the master off preserves those choices for the next time it is enabled.

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
