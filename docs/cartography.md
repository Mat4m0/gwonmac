# Cartography

GWonMac has two separate, optional native-map features:

- **Cartography grid** draws the game's fixed 32×32 map-unit exploration
  cells over the native Compass and Mission Map. It highlights the player's
  current cell and uses no external artwork.
- **Walkability overlay** shades terrain outside certified pathing geometry
  while preserving the native map artwork.

The features share appearance controls but can be enabled independently.

## Generated grid

The grid is generated at runtime from certified map projections. There is no
grid texture or per-map data file. Both map surfaces use one 32-map-unit cell
definition and the client's half-open boundary rules.

The Mission Map provides absolute map coordinates, pan, zoom, and drawable
size. The Compass contributes its certified camera direction and circle. A
generation mismatch, invalid scalar, excessive visible range, loading state,
or unsupported build hides the derived layer instead of guessing. Canvas
layers are pointer-transparent and redraw only when their projection changes.

The grid makes the game's exploration-cell boundaries visible beneath the
smoothed fog. Current-cell and reveal-range guidance show where the character
can uncover cells. Observed exploration state distinguishes cells already seen
from cells that may still need attention. That state is advisory and resets or
hides whenever the client cannot provide a complete current-generation
snapshot.

## Walkability

The walkability layer uses certified pathing trapezoids from the current map
generation. Raw WASM addresses never reach the renderer. Invalid coordinates,
excessive geometry, stale generations, loading, or an uncertain projection
hide the complete result.

## Verification

The operator matrix and capture labels are in
[Live cartography certification](live-cartography-certification.md). Shipping
requires stable projection through movement, rotation, pan, zoom, map-window
move and resize, game-window resize, map transitions, and context restoration.
