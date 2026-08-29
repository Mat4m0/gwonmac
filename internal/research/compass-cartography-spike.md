# Compass and cartography feasibility spike

Status: active research on branch `test/compass-cartography-recon`.

This spike answers whether gwonmac can support a clearer compass, range rings,
map borders, and cartography help. It does not implement a player feature.

## Current verdict and product boundary

The feasibility question has moved past “can we draw it?” The exact build now
supports a closed, development-only path from certified native values to a
pointer-transparent overlay:

| Surface | Verdict | Remaining gate |
| --- | --- | --- |
| Compass inverse walkability mask | **Feasible** | Production lifecycle and performance pass. |
| Mission Map frame placement | **Feasible** | Open, move, resize, game-window resize, and close passed live. |
| Mission Map inverse walkability mask | **Partial** | Certify zoom, pan, and player map anchor. |
| Exact generated texture substitution | **Feasible, content-specific** | Keep research-only; no generic asset loader. |
| Cartography completion/unexplored-area reveal | **Out of scope** | Requires an independently certified exploration mask. |

Ship this as one independent **Compass & Cartography** feature, not as more
logic in the generic renderer harness. Its canonical input is a map-generation
snapshot containing bounded pathing geometry and native frame observations.
The feature owns two presentation adapters: Compass and Mission Map. Each
adapter fails closed independently, so an uncertain Mission Map transform
cannot disable the proven Compass mask.

Do not ship the development globals, amber proof outline, checkerboards,
fingerprint controls, or a generic TexMod-compatible loader. Before adding a
player setting, complete the Mission Map affine transform or explicitly ship a
Compass-only first version. The first setting should be one feature toggle with
one restrained clarity strength; separate colors and per-surface controls are
not justified yet.

For production, build the bounded geometry cache once per map generation and
reuse it for both surfaces. Reproject only when the player, direction, native
frame, zoom, or pan changes. Keep raw WASM values in the certification layer;
no address or general memory reader may cross into the renderer.

### Proven Mission Map frame lifecycle

On 2026-08-27 the exact `MapWindow` frame resolved uniquely as frame ID 14.
Its rectangle stayed pixel-aligned while the in-game Mission Map was moved and
resized and while the whole game window was resized. Closing the Mission Map
removed the amber proof outline immediately while the Compass mask remained.
The frame's own viewport dimensions are local to that window; its screen edges
are global logical coordinates and must be projected through the certified
global Compass viewport. This relationship is now an explicit tested rule.

Local evidence is retained under
`test-results/graphics-live/2026-08-27T20-43-37-575Z/` and is intentionally not
committed.

## Decision to make

For each candidate, choose one result:

- **Feasible:** exact client facts and a bounded runtime contract are proven.
- **Partial:** a smaller form has enough evidence, but the full form does not.
- **Too fragile:** the result depends on guessed offsets or visual heuristics.
- **Out of scope:** the result needs game writes, generic memory access, or
  unlicensed assets.

The spike is complete only when each result links to reproducible evidence.

## Difficulty map

| Question | Expected difficulty | Main unknown | Cheapest useful proof |
| --- | ---: | --- | --- |
| Draw fixed range rings over the native compass | Low | Exact compass rectangle and scale | Identify the `Compass` frame and compare its projected bounds at several UI scales. |
| Keep rings aligned while the compass rotates | Medium | Native orientation and projection | Capture a stationary player before and after rotation. Compare native markers and candidate yaw. |
| Show the current map border | Medium to high | Correct coordinate transform and boundary source | Render a diagnostic polyline for one certified map and compare it with the native compass. |
| Read walkable areas | High | Certified pathing owner, array layout, lifetime, and bounds | Publish only presence, counts, and coordinate extrema before publishing any polygons. |
| Identify compass and map textures | Medium | Which uploaded textures are used in each UI state | Compare bounded texture bind activity between timed named checkpoints. |
| Replace native map graphics | High | Stable exact fingerprints, texture lifecycle, and redistribution rights | Replace one locally proven fingerprint with an obvious generated checkerboard in development only. |
| Reveal unexplored cartography | Very high | Exploration-mask source and safe composition point | Prove a bounded mask source independently. Do not infer it from screenshots. |

Walkable-area discovery is the largest technical risk. Rendering trapezoids is
simple. Proving the pointer chain and rejecting stale or malformed data is not.

## Current exact-build findings

The first static run used official client SHA-256
`3cd87bf15df6812073b558e9f365c8fb8e2a54b1b4c37028e5d3a6cbaf5e6f9e`.

- The UTF-16 `Compass` label occurs once in initialized data. Function `15750`
  references it twice. This is a strong frame-discovery anchor, but the two
  references need separate roles before certification.
- `def->trapezoidCount < 1024` occurs once and identifies function `3273`.
- `index < pathMap.trapezoidCount` identifies function `3216`.
- Three other unique pathing assertions identify functions `3281`, `4963`,
  and `4996`.
- Function `3216` independently proves a 48-byte live trapezoid stride. It
  reads the path-map trapezoid count at `+0x14` and pointer at `+0x18`. It
  writes portal indices at `+0x14/+0x16` and six floats at
  `+0x18/+0x1c/+0x20/+0x24/+0x28/+0x2c`.

The last result matches the current GWCA `PathingTrapezoid` layout. GWCA also
suggests this owner chain:

```text
GameContext +0x14 -> MapContext
MapContext +0x74 -> PathContext
PathContext +0x00 -> MapStaticData
MapStaticData +0x18 -> PathingMapArray
```

Treat that chain as a hypothesis. The current WASM must prove every offset.
The external C++ layout cannot authorize a gwonmac reader by itself.

## Evidence loop

Use one loop for every hypothesis:

```text
state a narrow hypothesis
  -> collect bounded static facts
  -> add an offline fixture
  -> collect one named live interval
  -> compare expected and observed change
  -> keep, revise, or reject the hypothesis
```

Every live run writes a timestamped directory under
`test-results/graphics-live/`. Each named capture contains a screenshot and
JSON. The JSON can contain dimensions, formats, ephemeral texture IDs,
fingerprints, and counts. It must not contain texture pixels, WASM pointers,
filesystem paths, chat, character names, account identifiers, or packets.

Run the first loop:

```sh
pnpm install
pnpm recon:client-anchors
pnpm recon:compass-cartography
```

`recon:client-anchors` reads the exact cached `Gw.jspi.wasm`. It reports the
client SHA-256, the fixed `Compass` label, five fixed pathing assertions, and
the functions that reference them. It prints no client path and writes no
artifact. These anchors narrow static analysis; they do not certify a layout.

At the prompt, record controlled states. Wait one second after each visual
change, then enter the matching command:

```text
capture compass-closed
capture compass-open
capture compass-rotated
capture mission-map-open
capture explorable-idle
q
```

The texture probe records no texture pixels. It retains level-zero dimensions,
WebGL formats, a fingerprint for uploads up to 4 MiB, interval duration, and
normalized bind activity. Each checkpoint clears only interval counters. This
lets the next state show which already-loaded textures became active. The exact
client does not call the wrapped draw imports, so the probe does not report a
draw-use count.

Treat a highly ranked texture as a candidate, not as proof. A bound texture can
be counted even when the current shader does not sample it. Repeat the same
transition at least three times. A useful candidate must change consistently
and must disappear from the ranking in a negative-control state.

## Walkable-area investigation

GWToolbox++ renders Guild Wars pathing trapezoids as two triangles. That tells
us the likely shape, not the current WASM addresses. The current client needs
an independent exact-build proof for this chain:

```text
GameContext
  -> MapContext
    -> PathingMapArray
      -> PathingMap
        -> trapezoid array
```

The likely trapezoid fields are left and right X values at the top and bottom,
plus top and bottom Y values. Do not encode those offsets from recollection.

Use three publication stages. Each stage stays fixed-size and read-only.

1. **Owner stage:** publish whether each owner exists, the bounded map count,
   the bounded trapezoid count, and a loading generation. Publish no address.
2. **Shape stage:** publish one candidate trapezoid plus coordinate extrema.
   Require finite values, ordered Y bounds, plausible X bounds, stable counts,
   and a matching live map generation.
3. **Geometry stage:** publish a capped array only after evidence establishes a
   safe maximum. Refuse the complete snapshot when the source exceeds the cap.

Test at least these states:

- login and character select;
- outpost;
- explorable area;
- map loading;
- district change;
- mission restart;
- map with bridges, islands, or multiple pathing layers;
- return to character select.

The owner stage is successful when its presence and counts follow those
lifecycles without a crash or stale publication. The shape stage is successful
when several samples match visible terrain. Only then is a renderer prototype
worth building.

### Exact pathing certification result

The initial static pass proved the pathing record shape but not a safe owner
chain. A later exact-client wrapper avoided that uncertain chain by observing
the already-validated live `PathingMap` after Guild Wars completed its own
converter. Run the bounded static verdict with:

```sh
pnpm recon:pathing-certification
```

The proof joins three independent anchors through the exact builder and loader:

- function `3216` reads a live path-map count at `+0x14` and pointer at
  `+0x18`; it advances by 48 bytes;
- the live record stores two portal fields at `+0x14/+0x16` and six finite
  coordinates at `+0x18..+0x2c`;
- function `3281` constructs the six coordinates and owns the infinite-bounds
  refusal;
- function `3273` owns the unique definition-reference check against 1,024;
  and
- function `3288` calls both writers once, while loader `3208` calls the live
  converter once.

The 1,024 check bounds definition references. It is not a proved total live
trapezoid bound. Static analysis did not establish any of these hypotheses:

```text
GameContext +0x14 -> MapContext
MapContext +0x74 -> PathContext
PathContext +0x00 -> MapStaticData
MapStaticData +0x18 -> PathingMapArray
```

The GWCA owner layout remains a search hypothesis and is not used. The appended
wrapper retains at most 64 maps, refuses more than 65,536 total trapezoids, and
copies only bounded scalar coordinates after the original converter succeeds.
It exports no pointer and resets on the companion map lifecycle. The renderer
independently rejects stale generations, non-finite or excessive coordinates,
inverted Y bounds, and reversed left/right edges.

## Compass geometry and orientation

Reuse the certified UI-frame lookup method. Add a closed `Compass` observation,
not a generic label reader. Publish only the frame ID, outcome, viewport size,
and rectangle. Capture it at 1×, 1.5×, and 2× UI scale and after resizing the
window.

Range rings need only the compass rectangle if the native compass always maps
the same world radius to the same pixel radius. Verify that assumption with a
stationary player and a target at a known companion distance. If the scale
changes with zoom, publish the smallest bounded zoom state that explains it.

Orientation is separate. Compare a fixed world direction with the compass
before and after camera rotation. If the native compass already exposes a
stable rotation in its frame transform, certify that field. Otherwise locate a
read-only camera yaw and prove it with four quarter turns. Do not estimate yaw
from screenshots in production.

### Track C offline result

The exact-client proof now certifies the unique UTF-16 `Compass` label through
the existing label-hash function and bounded frame table. It also requires the
reviewed owner body and the existing SkillBar frame-layout proof. A changed
label use, owner body, hash implementation, frame table, or geometry layout
refuses the spike. Run `pnpm recon:client-anchors` to repeat this proof.

The renderer prototype accepts only closed values: frame ID, visibility,
viewport, rectangle, map generation, player coordinates, bounded trapezoids,
and a proved north-up world-units-per-pixel calibration. It publishes no
address or frame hash. It clips boundary segments to the Compass circle and
hides the complete overlay for loading, hidden, stale, malformed, distorted,
unsupported, or uncertain input. The prototype is not connected to the shipped
companion ABI.

The Compass rectangle, direction, world scale, movement, rotation, and bounded
live geometry have passed the visible prototype loop. The remaining calibration
is Mission Map specific:

1. Certify Mission Map zoom, pan, and player map anchor as bounded scalars.
2. Verify the player marker and three synthetic world points at every zoom.
3. Pan continuously in both axes and reject any one-frame lag.
4. Reuse the proven inverse-mask renderer only after that transform passes.

## Texture investigation stages

1. Rank texture activity across `closed`, `open`, `rotate`, and negative-control
   states.
2. Repeat after a map transition to distinguish UI atlases from map-local data.
3. Prove one candidate with a generated checkerboard substitution in an
   unpackaged development run.
4. Record its full upload form: image or sub-image, compressed or plain, size,
   format, mip behavior, deletion, and context-reset behavior.
5. Decide whether a stable exact-content certificate is possible.

Do not build a TexMod-compatible loader during this spike. A generic loader
would add a new trust and asset pipeline before the one required texture is
known. If exact substitution works, keep the first prototype to one generated
asset and one certified fingerprint.

## Acceptance evidence

For each result, retain:

- exact gwonmac commit;
- official client SHA-256 and build ID from the existing live result;
- named procedure and negative control;
- bounded JSON captures;
- local screenshots when they do not show login or account data;
- automated fixture or refusal test;
- conclusion, remaining uncertainty, and next experiment.

Do not commit downloaded client data, screenshots, generated evidence, or game
assets. Commit only the harness, offline fixtures, tests, and research notes.

## Stop conditions

Stop a line of research when any of these is true:

- it needs a renderer-side raw pointer chain;
- it needs a generic memory or packet bridge;
- a candidate cannot survive three positive runs and one negative control;
- bounds cannot fail closed during loading and map transitions;
- the only usable visual asset has unclear redistribution rights;
- the diagnostic overhead materially changes the behavior being measured.

The useful fallback remains a host-drawn range overlay with a certified compass
rectangle. It can deliver most combat readability without pathing polygons or
texture replacement.

## Confirmed live result: exact Mission Map tile substitution

On 2026-08-27, build 38878, the development probe armed one exact prior upload
fingerprint (`fnv1a32:fcaade3f`). Opening the Lion's Arch Mission Map replaced a
large map region with the generated magenta/cyan checkerboard. The probe
observed five matching uploads before the open-state checkpoint. Its live match
was a full 512×512 RGBA/UNSIGNED_BYTE level-zero sub-image upload of 1,048,576
bytes.

The WASM upload bytes were restored immediately after every synchronous GL
call, and the unit fixture verifies that restoration byte-for-byte. The closed
negative control had zero replacements before opening. After closing, the
matching texture was absent while the cumulative replacement count remained
five.

This proves that gwonmac can identify and replace an exact Mission Map texture
at the existing WASM-to-WebGL import boundary. It also proves that the visible
map is composed from multiple layers: terrain detail remained visible through
or over the generated checkerboard. It does not yet prove stable matching
across client builds, maps, districts, zoom levels, or context resets, and it
does not identify the walkable-area geometry.

Next, repeat the proof for three map loads and one different map. Then replace
two separately identified tiles with different generated colors to establish
tile-to-screen placement and whether the fingerprint identifies map content,
an overlay layer, or both.

## Two-tile texture mapping procedure

The next development run arms these exact upload fingerprints:

| Fingerprint | Generated proof palette | Prior evidence |
| --- | --- | --- |
| `fnv1a32:fcaade3f` | magenta and cyan | Replaced the large Lion's Arch Mission Map region. |
| `fnv1a32:2f4cf29b` | yellow and blue | Matched the first tile's bind count in two Lion's Arch runs. |

Run `pnpm recon:compass-cartography`. Wait one second after every visual change,
then enter these commands in order:

```text
capture mission-map-closed
capture lions-arch-open-1
capture lions-arch-closed-1
capture lions-arch-open-2
capture lions-arch-closed-2
capture lions-arch-open-3
capture after-district-transition
capture different-map-open
reset-context
capture context-restored
q
```

Move to another district before `after-district-transition`. Travel to a map
outside Lion's Arch before `different-map-open`. Keep the Mission Map open for
each `open` capture and closed for each `closed` capture. The `reset-context`
command uses `WEBGL_lose_context` when Chromium exposes it. An unavailable
extension is a recorded limitation, not a failed run.

Each capture records a screenshot, bounded texture facts, timed bind rates, and
scalar proof-color bounds. `texture-matrix.json` is the comparison summary. It
does not retain decoded screenshot pixels. Classify each fingerprint as stable,
content-specific, or rejected only after all three same-map openings, a closed
negative control, the transition, and the different-map capture agree.

## Two-tile live result

The full matrix ran on 2026-08-27 against build 38878. Evidence is retained
locally under
`test-results/graphics-live/2026-08-27T15-19-06-919Z/` and is intentionally not
committed.

- Lion's Arch reproduced both exact matches across the initial load, two
  close/reopen cycles, and an America-to-International district transition.
  The cumulative counters advanced together from 1 to 4 and did not advance in
  either closed capture.
- `fnv1a32:2f4cf29b` visibly produced the yellow/blue checkerboard in stable
  Lion's Arch map-space regions on all three open screenshots and after the
  district transition.
- Delrimor Bowl proved the second independent screen mapping:
  `fnv1a32:fcaade3f` visibly produced the magenta/cyan checkerboard over a large
  terrain region. Its cumulative count advanced from 4 to 7, while
  `fnv1a32:2f4cf29b` advanced from 4 to 5.
- Both candidates remained exact full 512x512, level-zero,
  RGBA/UNSIGNED_BYTE sub-image uploads. The original fingerprints remained in
  every record and the byte-exact restoration fixture continued to pass.
- The proof-color bounds detector is reliable for the unambiguous Delrimor Bowl
  magenta/cyan region. It produced false positives from normal world colors and
  missed some checkerboards blended with terrain in Lion's Arch, so those
  scalar bounds are diagnostic only. The labeled screenshots are the visual
  evidence for Lion's Arch.
- A forced `WEBGL_lose_context` cycle emitted both context-lost and
  context-restored events, but the game canvas remained black with zero live
  tracked textures after an additional bounded recovery window. Context-reset
  recovery is rejected for this client path; the probe must not claim a usable
  restored state merely because Chromium emitted the event.

Classification: exact generated texture replacement is **feasible and
content-specific** for the certified client and upload form. Normal Mission Map
open/close and district lifecycles are stable. Forced graphics-context recovery
is **too fragile** and must fail closed. This evidence supports a narrow
development substitution path, not a generic TexMod loader or production asset
pipeline.

## Augmented native map direction

The preferred player-facing result is not a Toolbox-style replacement minimap.
Keep the native Compass and Mission Map terrain, icons, pings, and markers, then
mute only the regions outside the certified walkable geometry. Pathing is a
navigation approximation, so the feature must describe reachable ground rather
than promise pixel-exact collision boundaries.

Render the effect as an inverse mask:

1. draw a bounded translucent neutral veil over the native map content;
2. rasterize every certified walkable trapezoid into an offscreen alpha mask;
3. cut that mask out of the veil with destination-out compositing; and
4. optionally derive one subtle external contour from the raster mask.

This removes internal trapezoid seams without a polygon-union algorithm. The
first prototype must omit the contour: accept it only if the muted terrain alone
does not provide enough separation. The production surface must omit all spike
frames, needles, labels, and diagnostic colors.

### Compass path

The existing development overlay already has the required closed inputs:
certified frame geometry, player coordinates, camera direction, map generation,
and complete bounded pathing geometry. Replacing its direct fill and per-edge
stroke with the inverse mask requires no new game-state proof.

Acceptance requires stable alignment while moving and rotating, immediate
refusal during loading or stale generations, no input capture, and a visual
comparison at three fixed veil strengths. Prefer one product setting with
`subtle`, `clear`, and `strong` values over independent color controls.

### Mission Map reference result

The current local GWToolbox++ source contains a useful independent reference in
`GWToolboxdll/Widgets/MissionMapWidget.cpp`. It rasterizes all pathing trapezoids
into a walkability grid and shades non-walkable cells over the native Mission
Map. This validates the presentation approach, but its native pointer layouts
are hypotheses only for the official WASM client.

The reference projection uses a Mission Map frame rectangle, viewport scale,
zoom, pan offset, and a conversion through world-map coordinates. gwonmac can
use a smaller current-map-only transform anchored to the live player:

```text
map_x = player_map_x + (world_x - player_world_x) / 96
map_y = player_map_y - (world_y - player_world_y) / 96

screen_x = frame_center_x + (map_x - pan_x) * frame_scale_x * zoom
screen_y = frame_center_y + (map_y - pan_y) * frame_scale_y * zoom
```

This avoids AreaInfo bounds, map-file bounds, world-map anchors, and DAT loading.
The `96` conversion remains a candidate constant until the exact client and live
movement prove it. Frame scale should be derived from the certified content
rectangle and Mission Map logical size when possible, rather than published as
another independent source of truth.

### Mission Map certification work

The exact build contains one UTF-16 `MapWindow` string but no direct code
operand reference, so the existing named-Compass proof cannot simply be reused.
Use the Mission Map context's bounded frame ID as the candidate owner instead.
The build also contains the unique source anchor
`../../../../Gw/Ui/Game/Map/GmMapWindow.cpp`, referenced by a small family of
Mission Map renderer functions, plus unique Mission Map assertion strings. Use
those exact bodies to prove only these closed values:

- visibility and content rectangle from the bounded frame table;
- logical drawable width and height;
- current Mission Map zoom;
- current Mission Map player anchor;
- current pan offset; and
- the same current map generation as the pathing snapshot.

No pointer, hash, AreaInfo record, or DAT-derived map bound crosses into the
renderer. Refuse non-finite values, invalid rectangles, zoom outside the live
observed range, missing owners, loading, generation mismatch, and partial
snapshots.

### Mission Map live proof sequence

1. Draw only a pointer-transparent outline around the certified content area.
2. Draw a cross at the projected player position and compare it with the native
   player marker while stationary, moving, and spectating where available.
3. Draw three synthetic world-space points around the player. Verify their
   direction and distance at every native zoom level.
4. Pan continuously in both axes and require the overlay to remain attached
   without one-frame lag.
5. Replace the synthetic points with the same inverse walkability mask used by
   the Compass.
6. Repeat through close/reopen, resize, UI scale, district transition, map
   loading, a different map, and a layered bridge or underground map.

The Mission Map renderer is feasible only after steps 1-4 prove one affine
transform. If they fail, retain the Compass overlay and do not compensate with
per-map constants or screenshot calibration.
