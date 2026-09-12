# Native UI coverage investigation

## Current review status — 12 September 2026

Matthias accepted the native maps, terrain coverage, skill shortcuts, cooldowns,
and effect durations in the development client, ending with “all working!”.
That acceptance covers the previously tested build. The release review has since
added independent native HUD certification, bounded large-map marker fallback,
lazy atlas allocation, atlas-repack withdrawal, and failure-safe cleanup.
The obsolete tooltip probe and browser drawing paths have been removed.

The branch now includes main's existing Alcohol Timer. Its native observation
stays independent of HUD rendering. The proposed interactive native alcohol icon
is a separate future feature and is not implemented here.

### Release-review findings

- Native HUD insertion previously ran for observation-only and Core profiles.
  A separate exact-body proof now authorizes drawing. Refusal preserves raw
  observers, Core, other Tools, and the existing Alcohol Timer.
- A cached map tile could exceed the individual-marker budget while its scale
  also excluded clusters. Large tiles now keep bounded clustered guidance.
- Atlas repacking could leave a removed label sampling another sprite. An atlas
  generation now invalidates live labels without losing withdrawal ownership.
- Inactive HUDs allocated and uploaded an atlas. They now allocate on first use,
  reuse digit/color sprites, and retain one bounded atlas through short gaps.
- Renderer uploads misread signed wasm32 allocation results above 2 GiB.
  HUD, terrain, map, and range uploaders now normalize addresses before copying
  and releasing their buffers. Tests use actual high-address WASM memory.
- Failed native cleanup could leave listeners or other resources behind.
  Installation rollback and disposal drain owned resources even after failures.
- Playwright's default output directory cleared unrelated local evidence and
  the disposable development profile during this review. Each suite now owns
  a separate output directory. The canonical game files and regular profile
  were outside that directory. Deleted historical captures are unavailable.

The branch includes main commit `0515bdc2`. Capability order preserves Alcohol
Observation at bit 18 and appends Native HUD Rendering at bit 19. Derived output
uses enhancement ABI 67, Cartography ABI 39, and semantic verifier ABI 8.

Final source verification passes: 1,712 unit tests, 182 policy tests, 196 Tools UI
tests, and 81 launcher UI tests, plus types, lint, and documentation links.
Integration (111), release checks (30), and Tools end-to-end tests (42) pass.
The full Electron run found two obsolete map-control selectors and one
focus-sensitive pointer-lock failure. The corrected map checks and isolated
pointer-lock rerun pass (four tests). Packaged launcher and Tools smoke tests
also pass. Both Playwright suites preserved an independent evidence sentinel.
The actual-client artifact suite exits successfully; the retained previous-WASM
comparison is skipped because no previous artifact was supplied. High-memory
HUD bytecode tests also pass.

Native drawing fixtures execute
the emitted WASM; offline visual replay uses the production atlas and ordered
quads. These checks do not replace acceptance of the final signed release.

This review checkpoint precedes stack publication. Earlier sections below are
historical evidence and do not describe current open defects.

## Historical stage 4 checkpoint

**Stage 4: native map migration visually accepted; performance and veil fixes under verification.**
Matthias accepted the corrected Compass terrain, motion and native UI coverage,
including after restarting his Mac. He then accepted the first native Mission
and World Map drawing visually, but reported high performance cost and a missing
dark outside terrain veil. Those reports remain open until the rebuilt version
is tested live. The earlier stage ledgers below retain their historical scope.

The current implementation removes permanent grid lines and explored-area tint,
preserves remaining marker styles, and draws map artwork through native owners.
The initial live counters showed hundreds of texture uploads. Investigation
found that every exploration read advanced a sequence used as a content cache
key, repainting unchanged data. The optimized version compares actual bits,
caches overscanned map artwork through pan/zoom, isolates hover into a small
texture, and skips unchanged native Compass mesh writes. Native camera movement
is not throttled. Terrain and map graphics also use the existing native bitmap
material recipe (14205) rather than the Compass ring recipe, to preserve the
dark outside veil. Ranges retain their previously accepted material.

Focused tests cover unchanged exploration, cached pan/zoom, independent hover,
native bitmap input ownership, matrix restoration, stale/context-reset refusal,
and resource cleanup. Final gate and live measurements are recorded below when
available; counters do not themselves certify gameplay feel or visual quality.

**Stage 2 verdict: native composition demonstrated for one local ring; migration remains on hold.**
Matthias confirmed native panel and tooltip coverage. The ring is visibly off-center,
and resize, UI-scale, full lifecycle and production performance remain unproved.
The experiment is local and uncommitted. See the separate Stage 2 ledger below.

**Stage 1 verdict: on hold.** The bounded probe found a live native item-tooltip frame
and plausible bounds/order. It did **not** establish effective pixel coverage,
inherited clipping, or synchronization with browser presentation. The first
acceptance gate therefore remains open. No occlusion mask or native insertion
was added. This is an uncommitted local research experiment, not merge-ready
capability or current product behavior.

Started 12 September 2026 at 11:07:52 UTC; hard stop 12:07:52 UTC (60 minutes).
Normal development research; no commit, push, PR, release, or subagent.
Investigation and review concluded at 11:52:05 UTC, about 44 minutes elapsed.
The retained result stops at native discovery; no incomplete coverage claim was
used to expand into panel support or rendering changes.

## Question and gate

Can the current WASM identify a weapon/item tooltip covering the Compass with
correct visibility, bounds, clipping, timing, and relative native draw order?
A presentation experiment must first establish those facts independently of
mouse position, item payload presence, frame-table position, and screenshots.
Close, loading, stale, reset, malformed, and ambiguous observations must withdraw
the dependent enhancement; accepted uncovered regions must remain visible.

Opening/closing, overlap/non-overlap, movement, resize/UI scale, and input must
then be checked in the real isolated client. Only after this first boundary
succeeds should a second movable panel and second enhancement be implemented.
Synthetic geometry cannot establish native discovery. Automated observations
cannot award Matthias's gameplay acceptance.

## Identity and containment

- Worktree: `../gwonmac-native-ui-coverage`; branch `research/native-ui-coverage`.
- Refreshed `origin/main`: `70a51d6bbbdbd408bfc337e737d69d88c52fdf7a`.
- Primary checkout remained clean on `fix/native-font-symbol-decoding`; unrelated
  worktrees and sessions were not changed.
- GWCA reference: `e1bc30323bac1194fa4766e1ecbc695fe2e3ca7e`.
- GWToolbox++ reference: `baaaf0de574b02008baa57a574625a99009cd5ac`.
- Official cached WASM SHA-256:
  `1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`.
  Doctor reported verified artifacts, supported client, buildId `514880306`.
- Local, ignored evidence: `test-results/native-ui-coverage/`. It includes private
  live screenshots and is not suitable for redistribution.

Matthias closed his prior session and signed in normally in the isolated app.
As requested, only the existing game artifacts, chunks, and boot-chunk manifest
were copied with APFS copy-on-write into the disposable profile. No credentials
or player settings were copied. Doctor found all 16,175 chunks present,
4,239,980,544 bytes, and cached-live readiness. Chunk completeness is presence
checking, not a fresh content hash of every chunk. The launch required the
cached client; no second game download was needed.

The successful app process was PID 90172, exact worktree Electron executable,
with profile `/private/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/gwonmac-native-ui.vRpbLf`
and ephemeral debugger port 55023. CUA attached only after process/path/profile
verification. Named scalar diagnostics were sampled through that debugger;
there was no runtime memory/pointer access or generic UI-call bridge.

## Round 1: payload presence is not visible coverage

**Hypothesis:** Historical GWCA's `FrTip` / `CMsg::Validate(id)` anchors could
identify a current-WASM tooltip lifecycle. Toolbox's `TooltipInfo` gives callback,
flags and payload; it does not give screen bounds. These were semantic leads,
not a transplanted native implementation.

**Evidence:** A bounded assertion/string scan located the current `FrTip.cpp`
functions. Exact-body replay in
the lifecycle test (retired research fixture)
retains real bodies 6201, 6202, 6203 and 6208 and replaces only enumerated peers:

- 6201 selects an active tooltip and finds root child ID -1 through 6560/6565.
- 6202 refuses disabled/null callbacks, dispatches cancellable message 85, then
  creates root child -1 with the supplied flags OR 32 through 6650.
- 6203 measures/positions it through 6462/6470. This queues positioning; it does
  not itself prove final screen geometry.
- 6208 destroys the child but leaves the active-tooltip pointer set. The replay
  explicitly observes that stale pointer after clear.

**Result:** Active payload alone is rejected as visibility authority. Exact
hashes, signatures, controlled peer calls, suppression, repeated selection,
positioning, close and reopening are executable evidence. The replay does not
execute a real native frame manager or prove live coverage.

## Round 2: a bounded live discovery probe

The local observer (retired research fixture) adds
one internal call at the end of exact native FrCache render body 6594. It adds
13 scalar globals and no callable exports, imports, or renderer memory access.
The existing isolated Cartography verifier verifies the resulting derived
output. The official artifact is unchanged. A changed checked body skips this
research observer while retaining the preceding Cartography output.

Its exact-build facts are:

- Frame array/count `0x5a3b1c` / `0x5a3b24`, frame size 456, ID at +188.
- Root relation at `0x5a3b58`; frame relation +296 and child ID +300.
- Unique root child -1 is the FrTip candidate; Compass label hash is 3268554015.
- Cache array/count `0x5a3be0` / `0x5a3be8`; frame word zero is the native cache
  grouping/order key, not its frame ID or table position.
- Bounds at +268/+272/+276/+280 use the existing frame geometry convention.
  Fields +260/+264 retain the existing `viewportWidth/Height` names, but the
  clipping investigation below shows why these alone cannot certify general
  ancestor clipping or a global viewport for arbitrary frames.

The observer bounds both collections at 16,384; checks frame identity against
its table slot; requires distinct Compass and tooltip cache membership; rejects
hidden/destroyed/disabled candidates and ambiguous identities. It publishes a
sequence and the existing area epoch. Those are diagnostics, **not** proof that
the native cache, area epoch, and browser paint are one atomic presentation.
`aboveCompass` means a larger native cache key; it does not promise pixel cover.

The emitted-bytecode fixture (retired research fixture)
checks bounds, ordering refusal, absence, duplicate membership, stale identity,
state refusal and memory limits, including an actual 4 GiB memory. It runs the
real generated observer against controlled memory, not the game.

### Live measurements

The earlier compiled probe ran in the logged-in isolated client. Screenshots
were used only to compare results, never to discover or drive coverage.

| Observation | Native result | Boundary established |
| --- | --- | --- |
| Item tooltip over Compass, 47 samples, 11:37:41–53 UTC | Frame 339, tooltip order 49, Compass frame 53/order 5, generation 1 | Named root-child candidate present above Compass in native cache |
| Same tooltip's bounds | left 1196.9092, bottom 463.7102, right 1347.2728, top 539.9829 | Projects to the visible rectangle of the **Istani Raiment** item tooltip |
| Inventory restored, 11 samples, 11:40:09–12 | Frame 0, aboveCompass 0 | Visible tooltip closure withdraws candidate identity |
| Item tooltip away from Compass, 19 samples, 11:45:10–15 | Frame 435/order 52; left 880.9999, right 1031.3635; Compass left 1102 | Presence/order is independent of actual geometric overlap |
| User resized/rearranged native windows | Viewport changed from roughly 1396×838 to 1347×620; nine refusal samples during the interval | Candidate can refuse during changing UI; does not prove visual synchronization |

The capture label `equipped-weapon` was an intended interaction label; the actual
visible tooltip was armor, not a verified weapon-set tooltip. Other transient
candidate frames appeared during user movement, but their contents were not
individually verified. Weapon-specific behavior remains untested.

Matthias also placed inventory and Party Formation over the Compass. Rings
visibly painted above both panels. This confirms the broader symptom, **not**
coverage discovery for either panel. The agent's temporary inventory movement
was restored; Matthias's Party Formation placement was preserved.

The live prototype retained old geometry after an absent/invalid observation.
Its identity/status correctly withdrew, but this was a misleading diagnostic.
The final source clears those values, fixes duplicate-membership counting and
checks the end of exact 4 GiB memory. Those final safeguards passed offline
checks; the active game was not restarted to claim a final-code live pass.

### Reproducible module identities

| Stage | SHA-256 |
| --- | --- |
| Live pre-Cartography module | `88cbdc0a15238ea5e01c83c4c63cb6e07d27195beea7f4d72c2ac35fb951c1f3` |
| Live Cartography output | `4ada9e1c747be1e064a8144cf4c8fcd470a9cc6db4a82a5b6b1fe232399649f2` |
| Live final module, after double-click repair | `8e963bef08a8de6a28185e06571075099a0aff236ab22d4bc74065646e3d4a0b` |
| Final source applied directly to official input in fixture | `1a727c49c23429422bfcd43301c9e4f74b84c7c9eb40f8a5c8d70b60fa77f828` |
| Final source on live pre-Cartography input, offline | `3e9cd7c6d941294d8efdb23e1487171ad7a64ef2b94288b69841d90a79fdd076` |

Research transform ABI is 32. These are local experiment identities, not
published certification profiles. Body hashes for each guarded function live
in the observer/test, rather than a second copied table here.

## Round 3: why neither rendering route is accepted

The [range layer](../../src/renderer/cartography-spike/compass-range-layer.ts)
is a pointer-transparent 2D canvas at CSS z-index 10, clipped only to the native
Compass circle. CSS order cannot interleave it with UI already composited into
the single game canvas.

**Bounded coverage mask:** Discovery is promising, but a screen rectangle is
not effective native coverage. FrCache 6585 forms command batches; 6594 renders
those batches, invokes message 53 callbacks and changes native clipping.
6448 reads frame-relative clipping edges (+252 through +264), applies UI-scale
rounding, and 6450 chooses a parent clip or a full viewport from position flags.
Neither the observer's rectangle nor its cache-membership test observes that
full executed clip state. The post-cache sequence is also not tied to the
browser overlay's actual paint. A stale read must withdraw the dependent rings,
not merely the diagnostic object; no such consumer has been claimed here.

Even a correct rectangular cutout would be a **conservative approximation**.
It removes rings through rounded corners, transparent margins, and translucent
backgrounds where native composition would retain some contribution. It cannot
be described as exact alpha composition. No mask was added before this gate.

**Native insertion after the owning surface:** The existing Compass certificate
identifies render function 14240, its call to map renderer 14179 at offset 608,
and their exact body hashes in
[the certificate](../../src/main/certification/cartography-transform-internals.ts).
The named Compass frame's constructor 15750 is not that draw boundary. An
“after map function” hook is not automatically after the corresponding GPU
commands: FrCache gathers and batches UI rendering. The inspected 6585/6594
chain has no accepted per-Compass submission marker that preserves the remaining
UI's order, clipping and state. No arbitrary draw ordinal, program/shader ID,
world-space renderer or queue-splitting experiment was promoted as a solution.

**Next unanswered question:** Can one exact native cache-command boundary bind
the identified tooltip's effective clip and Compass ordering to the same host
presentation? Establish that before a bounded cutout test. For native alpha
composition, separately certify an insertion after the owning surface's actual
submitted UI commands and before subsequent native UI. Neither is disproved;
neither is established by this experiment. No second panel/enhancement was added.

## Commands, failures and verification

From this worktree, with `GW_CLIENT_WASM` naming the retained official artifact:

```sh
pnpm install --frozen-lockfile
python3 tools/wasmscan.py "$GW_CLIENT_WASM" FrTip.cpp FrCache.cpp
node --import ./scripts/ts-hook.mjs --test \
  tests/client-artifact/pathing-spike-transform.test.ts \
  tests/client-artifact/native-tooltip-lifecycle.test.ts \
  tests/client-artifact/native-tooltip-probe.test.ts
pnpm run check
pnpm build
GW_BACKGROUND_LAUNCH=0 GW_REQUIRE_CACHED_CLIENT=1 pnpm exec electron "$PWD" \
  --user-data-dir="$native_ui_profile" --remote-debugging-port=0
```

`native_ui_profile` must name the retained disposable profile; the exact value
is in local `profile-path.txt`. Do not launch a duplicate into an active profile.
The build above produced the **earlier live probe**, not the final safeguards.
The final artifact tests passed 3/3. Final `pnpm run check` passed: type checking,
lint, links, unit/policy tests, Tools and launcher tests. No release, packaged,
performance or broad end-to-end suite was claimed.

Failures retained for avoiding repeat work:

- First evidence was incorrectly stored under `build/`; the build cleans that
  directory. Initial scanner/check logs were lost. Evidence moved to ignored
  `test-results/`; exact-body dumps and final checks were regenerated.
- An extra slash and `/var` versus `/private/var` made `GW_EXPECT_USER_DATA`
  disagree with Electron's canonical profile. The first launcher remained at
  preparation. It did not establish a successful startup.
- A profile-path rewrite accidentally truncated its input before reading, so a
  retry used the worktree root as profile. It exited without gameplay/login.
  Only the generated profile files were moved into ignored `accidental-profile/`;
  the worktree was checked for unintended remaining files. Correct launch
  omitted that unnecessary environment assertion and verified the real process.
- Initial checks caught BufferSource typing, import-type style, a `prefer-const`
  error and missing two-line source headers; fixed before the passing gate.
- `wasmscan.py --help` is unsupported and treated `--help` as an input filename.
  The documented positional interface and its Python decoder were used instead.
- CUA rejected a stale element index and later an action after user UI changes;
  fresh state was read before retry. No inference from an attempted action was
  counted as a completed test.
- Show Launcher initially failed through stale CUA menu state. Resetting only
  the automation connection and selecting the fresh menu item succeeded;
  `gw://app/launcher/index.html` showed ready state and the open account's Show
  button. The game process and login stayed alive.

Not tested: final source in a restarted client; a controlled loading/area-change
cycle; explicit UI-scale changes; inherited clip variants; frame-perfect
open/close synchronization; alpha-correct masking; new-layer input pass-through;
weapon-set tooltips; performance cost; any coverage for Party Formation or
inventory itself. Existing sessions were preserved after the owned test.

## Time ledger

- 11:07:52 UTC: start, scope/instructions and isolated base preparation.
- By 11:21:30: bounded native investigation and lifecycle/probe work underway.
- 11:32:49: successful isolated process checked; user reported logged in.
- 11:34:37–11:37:53: native candidate sampling and real item-tooltip overlap.
- 11:40:12: tooltip closure measured; inventory movement restored.
- 11:43:49–11:43:56: final launcher portion of the passing repository gate.
- 11:45:10–11:45:15: non-overlapping item-tooltip observation.
- 11:52:05: final diff/evidence review complete; real launcher visibly open with
  the game session preserved. Repository gate, focused tests, links and whitespace
  checks passed. No verification-only process remains running apart from the
  intentionally retained isolated app.

## Stage 2: native Compass submission experiment

Additional authorization: 30 minutes, starting 12:02:52 UTC on 12 September 2026;
active investigation hard stop 12:32:52 UTC. Prior evidence remains discovery
only. Objective: one identifiable ring in the native Compass content path,
covered and alpha-blended by later native UI. No panel masks, queue splitting,
world-space work, subagents, publication, or automatic time extension.

At entry, PID 90172 still belongs to this worktree and its retained disposable
profile. Existing game files and dependencies are reused. Necessary owned-app
rebuild/relaunch is authorized; credentials will not be copied.


### Stage 2 implementation and semantic boundary

The exact-build transform appends one magenta ring to the existing Compass Canvas
vertex/index allocation in native function 14137. It preserves the existing
geometry prefix, handle, material, retained transform, clipping and submission.
The Canvas owner attaches its draw object through 14126 → 6827 → 6491, slot 4.
FrCache 6585 retains the batch; 6594 reaches GrDev 2956, whose records execute
through 2852. This is native buffer ownership, not a draw ordinal, shader ID,
post-return GL injection, queue split, replay, or panel rectangle mask.

The ring adds 96 vertices and 288 indices (96 triangles) to that native mesh.
Original allocation calls run once each. The existing [0,256] geometry bound
also becomes active when only the ring is present. Native methods still own
buffer unlock, resource lifetime, render state and submission. This code does
not itself call WebGL, bind a framebuffer, change blend/scissor state, or expose
native pointers. No measured draw-call or GPU-cost claim follows from that fact.

Eleven exact body hashes guard the native owners, allocation/unlock functions,
and submission path. They are listed in `src/main/certification/native-ring-probe.ts`.
The wrappers refuse vertex counts above 60000. Two fixed scalar globals expose
only enable state and update count. The renderer provides an explicit local
ON/OFF button; it starts OFF, resets on graphics-context reset, and disposes its
listener and presentation isolation. There is no general renderer drawing API.

ON temporarily hides the existing external Compass circles through a local
style. OFF removes that style and restores the existing circles. No persisted
range setting is changed. This experiment does not replace the product renderer.

### Stage 2 artifact identity

All live Stage 2 screenshots under `test-results/native-ui-coverage/stage2/`
belong to this exact chain:

- Official: `1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`.
- Pre-Cartography: `88cbdc0a15238ea5e01c83c4c63cb6e07d27195beea7f4d72c2ac35fb951c1f3`.
- Cartography ABI 33: `e97970337e5776fa74eb65ba9e1ebcdfb115ee6ea5b4655546254ab09e647e75`.
- Final double-click derivative: `53acbfe6d25ec0958be651e4135d5eca4ec7bd3171652cbaccf2fb687d4ccfe8`.

`module-hashes.json` records these values. `source-artifact-match.log` independently
regenerates Cartography from the live predecessor and confirms byte identity.
The official artifact remains unchanged. The prior process had exited before
relaunch; the owned app now runs as PID 2574 from this worktree, using the same
disposable profile and existing cached game files. Matthias pressed Play and
signed in normally. No saved credentials were copied. The launcher briefly
showed download status; this record does not claim zero network requests.

### Stage 2 live evidence and user acceptance

- `live-native-ring.png`: native ring visible, native terrain, markers and border
  remain visible. The ring is inside the Compass content. This does not prove
  every marker/ring pixel intersection or clipping at the outer border.
- `party-overlap.png`: Party Formation covers the left/bottom ring and attenuates
  it through translucent background; uncovered top/right arcs remain bright.
- `inventory-overlap.png`: Inventory covers most of the ring while its right
  arc remains visible outside the panel. Native content remains visible through
  translucent regions. Both panels were moved and restored through native UI.
- Two automated item-hover attempts did not show a tooltip. Their filenames
  (`tooltip-overlap.png`, `tooltip-hover-attempt.png`) do not establish tooltip
  coverage. They are retained as failed controls.
- Matthias then reported: “it works too, tooltip overlays are fine too”.
  `user-tooltip-confirmation.png` captures the real Paragon's Crest tooltip
  covering the top-right ring, while the right arc remains visible below it.
- `ring-off-restored-external.png` shows the native ring absent and the four
  previous external range circles restored. `ring-on-again.png` shows the native
  ring returning, with external circles isolated again.
- Closed diagnostic samples in `live-samples.jsonl` record ring enable/update
  values and native Compass/tooltip geometry. These are not frame-time samples.

Matthias also reported: “its good and working but its not centered”. That accepts
the tested coverage while identifying a visible defect. It is not full gameplay,
input-feel, resize, UI-scale, lifecycle, or production acceptance.

### Alignment defect and remaining gates

The ring is centered at fixed Canvas coordinates (128,128). The observed native
Compass frame is 245 logical units wide; its midpoint is 122.5. Screenshots show
an approximately five-pixel right/up offset. The width mismatch is a plausible
explanation, not a verified transform correction. No screenshot-tuned offset was
added. Correct native center/radius mapping, resizing and UI-scale behavior need
a rebuilt exact module and a fresh live check. The current preview remains
intentionally recognizable as an uncentered diagnostic ring.

This run did not force graphics-context loss, change maps, exercise long-lived
resource recreation, resize the Compass, change UI scale, or measure GPU/CPU
frame cost. Source cleanup and offline allocation tests cannot establish those
live properties. Native panel drag and button operation establish only the input
boundaries executed. The native line atlas/material constrains this geometry;
other overlay styles and native textures have not been established.

For Cartography and walkable terrain, reuse of native composition is promising
but remains an inference. A small triangle mesh could follow this owner, subject
to coordinate, clipping, ordering, resource and cost verification. Dense terrain
could require many more vertices or a native texture owner, which this run has
not proved. The current Compass owner does not establish a Mission Map or World
Map owner. Map knowledge, reachability and layer policy remain separate from the
drawing mechanism. Do not migrate all overlays from this single-ring result.

### Stage 2 verification and ledger

- 12:02:52 UTC: additional 30-minute authorization begins.
- Native Canvas/FrDraw/FrCache/GrDev path inspected using existing local artifacts.
- First emitted fixture failed because fixture type encoding used strings;
  corrected to Wasm numeric value types. No live artifact used that broken fixture.
- Four focused client-artifact tests pass: ring geometry/prefix preservation,
  tooltip probe, tooltip lifecycle, and combined Cartography transform.
  See `fixture.log`. The ring test executes emitted wrappers against controlled
  allocators, checks all vertices/indices, default OFF and oversized refusal.
- `pnpm run check` passed; final run exit 0, see `check-final.log`.
- Full build passed, then the final renderer owner build passed after adding
  temporary external-circle isolation. See `build-final.log`, `renderer-final.log`.
- Rebuilt owned app launched; Matthias signed in. Native panel comparisons,
  user-confirmed real tooltip, and OFF/ON controls completed on the hashed module.
- No benchmark, new dependency, subagent, extra task, commit or publication.

**Recommendation:** retain this as an exact-build proof of native composition.
Next, correct native coordinates and complete ring lifecycle/resize/cost checks.
Only then test one small walkable-terrain layer. Production migration is on hold.

Stage 2 investigation and handoff concluded at 12:30:55 UTC on 12 September 2026,
within the additional 30-minute cap. The launcher is visibly open with one
account still open and Show available. Native ring is OFF; external range
circles and pre-comparison panel positions are restored. The owned game session
is preserved. Final source/artifact identity, Markdown links and whitespace
checks passed. The centering defect remains unfixed; no further implementation
or investigation is claimed under this timebox.

## Stage 3: centering, lifecycle and a small terrain control

Matthias explicitly authorized a new sequence after the completed Stage 2:
correct centering, verify resizing and cleanup, then try a small walkable-terrain
layer. Migrate the relevant renderer and remove its old drawing path only after
that layer passes. This authorization has no new time cap. It does not authorize
publication or a migration of every map surface.

### Centering and resize evidence

Native Canvas body 14137 projects vertices using the retained rectangle at
owner offsets 172–184. Bodies 14132 and 14147 independently use that rectangle
for inverse projection and hit testing. The ring now uses half the current
width and height, with radii proportional to those dimensions. The native
retained transform continues to own the origin. No host width cache or
screenshot-tuned offset was added. Bounds grow when the native rectangle grows.

The fixture executes the emitted allocation wrappers. It checks 256, 245 and
384 unit rectangles, a nonsquare rectangle with a nonzero origin, malformed
dimensions, original geometry preservation, and OFF behavior.

The live centering build uses Cartography ABI 34:

- Pre-Cartography: `88cbdc0a15238ea5e01c83c4c63cb6e07d27195beea7f4d72c2ac35fb951c1f3`.
- Cartography: `29dc105dbd3f71206626460248faca3a821e45165b3778b64632111e75decc01`.
- Final derivative: `ae4c833c29044cf98b70c4b9a87a085f47df98febd44bd63d1fd0be16f6e6e0e`.

The existing isolated profile and game cache were reused. Matthias signed in
normally. Ignored evidence lives under `test-results/native-ui-coverage/stage3/`:

- `centered-ring.png`: the corrected ring is centered in the Compass.
- `large-interface-centered.png`: the setting was **Extra Large**, despite the
  filename. The native Compass and ring remain aligned.
- `window-zoom-centered.png`: alignment after enlarging the game window.
- `live-samples.jsonl`: named scalar diagnostics for those boundaries.

Normal interface size, DPI scaling ON, and the original game-window size were
restored. Native interface scale changes reflowed some panel positions. Full
layout restoration remains to be checked. Automated Compass handle drags did
not establish a size change. Matthias was asked to resize it once; that check
is pending. UI-scale and window resizing do not substitute for this boundary.
These are automated observations, not Matthias's graphics acceptance.

### Resource ownership

The ring adds no texture, material, buffer, or draw-object owner. It appends to
the native Canvas buffers, retaining the original allocation and release path.
A focused fixture replays unchanged native destructor 14116 against controlled
release peers. It releases the Canvas buffer and draw handles once each.
The current exact-build guard also checks this destructor.

Renderer fixtures prove OFF, graphics-reset handling, listener removal,
detached-button refusal, and removal of the external-circle isolation style.
They do not prove live GPU context recovery or long-duration resource behavior.
No forced context loss or production performance measurement is claimed.

### Bounded terrain control prepared for the next live check

ABI 35 adds an explicit OFF-by-default terrain button. Its input is the accepted
Cartography walkability raster, world anchor and area identity. It selects an
8 × 8 patch near the player and publishes only two bitset words and fixed scalar
coordinates. There are no public native pointers, generic calls, or writes.

The native Canvas update captures its own current camera coordinates and
direction. The patch uses that same native projection and retained material.
It adds at most 256 vertices and 384 indices to the existing buffer. It creates
no texture or extra retained resource. Stale area identities, invalid dimensions,
and invalid camera directions withdraw the patch. Complete cells outside the
bounded Compass circle have zero alpha. The control temporarily isolates the
old Compass mask while ON; OFF and teardown restore it without changing settings.

Offline fixtures check raster bit identity, map-to-world orientation, camera
projection, original geometry preservation, simultaneous ring/terrain indices,
stale-area rejection, and reset/disposal. These do not establish live atlas
sampling, panel coverage, style parity, or graphics cost.

This patch is a placement and ownership control. It is not the existing inverse
veil with its soft boundary. Static inspection found native texture creation
and copy ownership, but did not prove a reusable pixel-upload path. Several
candidate functions proved to be color adjustment or sampling instead. A full
raster migration must preserve the current style and avoid unbounded mesh size
or texture creation on every camera update. Native Canvas projection and the
existing host projection also use different scale constants; parity needs an
explicit comparison. No renderer cutover or old-path removal is claimed yet.

## Stage 4 verification checkpoint

The optimized ABI 38 build passes `pnpm run check` (1,698 unit tests, 182 policy
checks, 196 Tools UI tests and 81 launcher tests) and `pnpm build`. The emitted
native ownership fixtures pass for both Compass surfaces and all four map
surfaces, including separate Mission/World inspection layers. Final focused
checks cover content cache identity, local inspection, copied pixel ownership,
unchanged-camera reuse and reset/disposal. Saved map styles and existing game
chunks are reused from the persistent isolated profile under ignored
`test-results/native-ui-coverage/profile`.

The ABI 37 game had exited cleanly before the optimized app was launched.
ABI 38 launcher startup was verified at `gw://app/launcher/index.html`. Live
performance and outside-veil acceptance remain pending sign-in. No before/after
FPS improvement is claimed from offline cache assertions.

## Stage 5 — native skill and effect HUD migration (2026-09-12)

Migrated skill-key badges, skill cooldown labels, and controlled-player effect
labels together. The existing certified geometry, recharge, effect observations,
formatters, policy and settings remain the data owners. Removed the three
positioned browser HUD renderers. Settings previews remain browser components;
no launcher or game panel layout was rearranged.

The private native HUD transform extends the Enhancement output independently
of Cartography. Exact native function guards refuse unsupported clients. It
collects per-icon retained meshes in FrDraw slot 9, after the frame's stock
drawing, using the stock clipped category. The SkillBar captured identity and
Effects parent hash constrain attachment. Source draws must have exactly one
mesh. Native viewport/origin changes renew the retained viewport; unchanged
geometry and countdown updates reuse the draw. Native destruction releases the
owned resources, and duplicate matching owners cannot steal a queued label.

One detached 1024-square BGRA atlas holds the key plates and cached numeric
characters. All effect urgency colors are prepainted. Text changes publish only
normalized glyph quads. Effect expiry preserves the remaining resource slots.
There is no browser HUD fallback. Native missing-owner cases display nothing.

The controlled native fixture executes the emitted WASM against resource peers.
It checks final-category attachment, native coordinates, resize, ancestor alpha,
atlas reuse, input refusal and idempotent cleanup. Renderer fixtures check all
three joins, upward timer formatting, stale withdrawal, cached urgency changes,
and no duplicate publications. `pnpm run check`, the focused native fixture,
`pnpm build`, and `git diff --check` passed. Enhancement ABI is 59.

The rebuilt isolated launcher reuses the retained profile and existing chunk
symlink. Its `gw://app/launcher/index.html` handoff is the live entry point. Live
visual acceptance, tooltip coverage and timed native HUD counters are pending
Matthias signing in. No gameplay or graphics acceptance is claimed by the
controlled fixtures. No commit, publication or canonical artifact change occurred.

### Stage 5 live refusal and attachment correction

Matthias reported that none of the migrated HUDs appeared. The ABI 59 live
counters showed four atlas uploads, zero mesh updates and zero created draws.
The enabled settings included all three HUDs and a custom shortcut on skill 8.
The synthetic fixture had incorrectly supplied a reusable stock draw on the
logical skill slot.

Exact initializer 14063 places the visible bitmap at child 2 of each logical
skill slot. ABI 60 targets that bitmap child and captures the native UI matrices
with 6446/1563, following the native 6488 recipe. It creates its own single-mesh
draw, removing the source-bitmap assumption. The fixture now has a logical slot
and bitmap child with no retained stock draw. It refuses attachment to the
logical container and verifies the independent bitmap drawing path. Added
bounded published/matched/collection counters for the live attachment boundary.

The corrected fixture, type checking and build passed. The isolated client was
restarted with the same game files and profile. The live corrected drawing check
is pending sign-in; no successful graphics claim is based on the fixture.

### Stage 5 native cache traversal correction

ABI 60 still published labels without attaching any. Bounded live inspection
confirmed skill 8's bitmap child was visible in the native render list, under
the published SkillBar. Its stock draw vector contained six layer slots.

The exact 6585 cache builder stops collecting ordinary frames when 6492 first
returns zero. Thus a wrapper that only adds slot 9 never sees these icons.
The earlier direct collector fixture skipped that caller behavior.

The expanded fixture executes the unchanged 6585 cache builder and original
6492 collector with a six-slot stock bitmap. It reproduced the failure: only
the stock bitmap reached the compiled output. ABI 61 reports intermediate
empty slots only for a matching published HUD owner, allowing the native loop
to reach slot 9. Other owners and disabled labels retain stock termination.
The exact cache-builder hash is now guarded too.

The regression passes for cooldowns, skill 8 shortcuts and Effects labels,
preserving stock output and verifying hide/re-enable, resize and cleanup.
Live verification of ABI 61 remains pending; fixtures do not establish visual
acceptance.

### Stage 5 child artwork ordering (2026-09-12)

ABI 61 produced live HUD drawings. Matthias then reported dim cooldown numbers,
poor shortcut readability, and missing Effects numbers. A bounded live capture
showed a published Effects timer of 13 seconds for child 1582 under Effects
frame 42. The native icon had a bitmap and two further descendants, which drew
after the logical icon and covered the timer.

ABI 62 uses the exact cache loop's next visible frame to draw labels after each
icon's final visible descendant. The lookup follows at most 16 ancestors; it
does not scan the frame table or upload pixels per frame. The retained draw
still belongs to the icon, with its geometry, projection and destruction.
The fixture executes stock cache traversal with an icon, child veil and later
panel: stock artwork, veil, label, then panel. It covers all three HUD channels.

Shortcut plates use a darker background, heavier outlined text, a larger legible
size and a one-pixel bottom-right inset. Transparent sprite padding no longer
lifts the plate above that corner. Matthias supplied the intended corner
placement. Live verification of this revised ordering and appearance is pending.

### Stock keycap reference

Matthias supplied Minimalus's Unaltered texture directory. Inspection found the
original numeric/F-key atlas `GW.EXE_0x0FB3CF3B.dds` (also present with the
`Gw_T_0XFB3CF3B.dds` filename). Its glyphs are baked into small plates; it has no
Mac modifier chords. The downloaded files remain local references.

`skill-key-artwork.ts` recreates the silver upper-left bevel, dark olive face
and outlined light glyphs across a variable-width plate. The local game's
extracted display font supplies letters; system glyphs supply Mac modifiers.
The visual matrix uses that same painter, including a 51-pixel skill icon with
Shift+Command+X. It keeps the one-pixel bottom/right inset at 1x, 1.5x and 2x.
The obsolete separate DOM keycap artwork was removed from production sources.
No dumped game texture or derived font is committed.

### All eight keycaps

Matthias requested consistent styling across all eight slots and no duplicate
stock labels. ABI 63 keeps saved custom bindings and uses 1–8 for unset slots.
Settings identifies these defaults without saving synthetic bindings.

Exact initializer 13162 identifies the stock keycap as bitmap child 6 with
callback 3359/13124/13125. This is distinct from child 11's icon artwork. The
collector omits only that keycap's drawing when its matching replacement is
published under the captured player SkillBar. It leaves native frame/resource
ownership and game controls intact. Disabling or withdrawing labels restores
the original keycap at the next invalidated native cache build.

The native fixture verifies suppression only for active key labels, preservation
for cooldown/effect-only drawing, and automatic restoration when disabled.
The renderer test verifies all eight defaults plus a retained Shift+Command+X
customization. The expanded native fixtures, `pnpm run check`, `pnpm build`, and
`git diff --check` passed. Stock-style keycap calibration ran at 1x, 1.5x
and 2x using the local game font, including a 51-pixel chord example.
The isolated ABI 63 launcher is open for live acceptance with the retained
profile and game chunks. No commit or publication occurred.


### First-draw latency, ordering and scale (ABI 64)

Matthias reported delayed cooldowns and effect timers, fixed-size shortcut
plates, and cooldowns covered by the replacement keys. The bounded live scalar
capture observed resource creation followed by the first mesh update 987 ms
later. Its optional semantic-state getter was unavailable; the timing evidence
comes only from the named native counters.

Releasing a label cleared its native handles but retained cached icon bounds.
On recreation at the same icon, the bounds check skipped populating the new
mesh. Its next digit change finally filled it. Every new HUD draw now populates
its mesh immediately. The fixture detects the old defect separately for keys,
cooldowns and effects; it fails with that initialization removed. It also
checks cooldown/key coexistence with the cooldown published first. Native draw
order is icon/veil, keycap, cooldown, then later panels.

Read-only native geometry checks at Small and Large both found a 24-unit stock
key frame within a 56-unit icon. The locally supplied original digit atlas has
seven transparent pixels above and left in each 24-pixel tile, leaving 17
visible pixels. The shared artwork layout uses that visible proportion and a
scaled corner inset, without CSS-pixel minimums or maximums. The user's Large
interface size was restored after inspection. No game data or bindings changed.

The seven focused native/renderer checks and `pnpm run check` passed. The final
build and Markdown-link check passed. The keycap visual matrix uses the same
layout and painter at 1x, 1.5x and 2x. ABI 64 is running in the retained isolated
profile for the remaining live first-appearance and readability check.


### Countdown glyph alignment and shortcut spacing

Matthias supplied a 107-frame, 4.727-second crop. Every frame was extracted and
inspected in contact sheets. Value changes occur at frames 18 (0.807 s), 41
(1.847 s), 63 (2.847 s), and 87 (3.847 s). The icon frame stays fixed. Native
text layout used each proportional digit's advance width and a width-dependent
optical offset. The original font also gives digits different ink bearings.

The atlas now centers each digit's ink in an equal-width cell. The native
countdown centers the cell run at a fixed icon anchor. Effect digits use the
same rule. Quads remain identical throughout single-digit changes, and digit
changes still do not upload pixels. An offline replay exercised the real atlas
and publication code with the original font across 10 through 1 and decimals.

Shortcut text now measures visible glyph bounds. A single gap separates each
modifier and the main key; the old fixed modifier cells plus main-key padding
are removed. Shift+Command+C has equal 1.52-CSS-pixel ink gaps at a 64-pixel icon.
The plate height and the original-style single-key minimum width are preserved.
Focused renderer tests, the repository gate, and the shortcut visual matrix
passed. No native transform or client ABI changed in this adjustment.

The build and link checks passed. The updated development game was reopened
with the same profile and data. A bounded activation of Anthem of Flame showed
the cooldown and effect timer, and the shortcut used the tighter spacing.
This screenshot observation is not a claim of Matthias's final visual acceptance.


### Correction: overlapping skill layers must be one native draw (ABI 65)

Matthias identified that the remaining flicker alternates the cooldown below
and above its shortcut, including while a digit stays unchanged. The previous
glyph-only diagnosis was incomplete. The fixture checked native collection
order, but the implementation still submitted two independently sortable draw
objects. It did not prove their final relative order.

The renderer now joins keycap and cooldown quads by icon identity before
publication. One skill record owns one mesh and draw: keycap triangles first,
then cooldown triangles. There is no second draw object for the native renderer
to reorder against it. Expiry removes only the timer's triangles when a keycap
remains. Disabling shortcuts preserves the timer and restores the stock keycap.
A validated flag controls only that stock-key suppression. Different icon
generations are never combined. Effect icons keep their own single draws.
The fixed record pool now contains eight skill compositions and 64 effects.
The byte protocol changed directly with ABI 65; no legacy drawing path remains.


Effect duration placement now reserves the bottom 16% of the icon for the
native duration strip and border. Labels sit inside the artwork with a scaled
right inset. The same glyph publication clips to that content boundary.


ABI 65 verification checkpoint: seven focused native/renderer tests,
`pnpm run check` (1,689 unit, 182 policy, 196 Tools and 81 launcher tests),
`pnpm build`, and whitespace checks pass. The real atlas replay places key
triangles before cooldown triangles and checks effect-label clearance at icon
sizes 24, 32, 48, 64 and 96. This is an offline drawing check, not live acceptance.

The rebuilt isolated client runs with the retained profile and game files.
Live HUD counters confirm attachment. The first attempted cooldown capture
coincided with user window changes; the next captured the open map instead.
Neither is evidence that the reported flicker passed. Live confirmation of the
combined draw and effect inset remains pending. No publication occurred.


Matthias subsequently confirmed “all working!” for the running ABI 65 build.
This closes the reported live cooldown/shortcut flicker and effect-placement
check. Earlier failed captures above retain their limited scope.
