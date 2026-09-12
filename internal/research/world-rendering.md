# Retained world-rendering investigation

Status: partial feasibility evidence, recorded 12 September 2026. No production
world-space renderer is established by this record.

Source: the local `gwonmac-certified-world-pass-probe` worktree at `038f857e`
plus its existing uncommitted changes. Those changes were inspected, not copied
or altered. Its `docs/world-render-probe.md` records client build 38888.

## Established boundary

The prior live investigation observed custom WebGL pixels inside the game's
frame after scene composition and before HUD drawing. The visible control
marker used clip-space coordinates with depth disabled. The inspected current
anchor presentation also calls `drawMarker(anchor, false)`.

This establishes an inline draw opportunity. Stable world attachment, terrain
occlusion, long-run state restoration, and update resilience remain unproved.
A program with a world-transform uniform is a candidate, not a certified main
world pass. Character previews and other scene draws must be distinguished.

## Rejected approaches

- Draw ordinal did not establish stable object identity across frames. The old
  probe's next-step list still recommends it; do not repeat it as a stable key.
- A framebuffer number alone did not identify retained scene output. Its color
  attachment changed during postprocessing, so a completed draw could disappear.
- Wrapping the uniform import path blocked startup in the prior A/B tests.
  Program/frame observation worked; bounded native uniform inspection after
  startup produced a complete trace. Do not misdiagnose zero frames as an
  account problem without testing the probe-disabled control.
- The clip-space control cannot prove terrain depth. Drawing before the HUD
  also does not establish correct placement within the native Compass UI.

## Next discriminating experiment

Track actual color and depth attachments during one explicitly armed frame.
Insert a tiny marker using an observed object's exact transform and currently
bound scene target. Establish retained visible output and depth behavior before
adding player-height discovery. Do not split or replay the client's render queue.

Then independently prove stable identity, coordinate/matrix conventions,
camera movement, HUD ordering, context reset, and measured frame cost. Do not
infer player Z from proximity until the coordinate relationship is established.
Keep expensive reflection bounded, and restore every GL state the draw changes.

Use existing scanners and the probe first. Ghidra is useful only if one missing
function relationship becomes the limiting question. Missing login or a tool
setup failure leaves the experiment unverified; it does not disprove WebGL.

## Separate native UI investigation

The local `gwonmac-native-ui-coverage` worktree's
`internal/research/native-ui-coverage.md` records the first tooltip investigation
against WASM `1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`.
Its active-tooltip pointer can survive visible-frame destruction. The bounded
root-child probe found an item tooltip and plausible bounds/order, but did not
establish effective clipping or browser paint synchronization.

FrCache batches native UI drawing. Returning from a Compass helper does not
establish that its pixels have been submitted. These findings explain the next
native insertion experiment; they do not establish a layering fix. Follow that
investigation's current evidence before repeating the work or promoting its
local probe. The world-space depth experiment above answers a different question.
