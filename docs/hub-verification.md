# Hub implementation evidence

The [specification](../spec.md) owns the target behavior. This ledger distinguishes
browser evidence from native game certification.

## Try the browser version

Run `pnpm hub:dev` from the repository root. Open
[the Hub fixture](http://127.0.0.1:4193/?hub). No game login is needed.

This uses the production Hub shell, Builds, Trade, Travel, Characters and Whispers
presentation. Only the game/native/network boundary is synthetic. Prices are sample
NPC quotes and synthetic player advertisements, never live prices. The scenario selector exposes an outpost,
an explorable area, interrupted application, and duplicate names. Reset fixture
clears only fixture data. The fixture is excluded from the embedded entry point.

Try `team gom afk`, `build smiter`, `10 ecto in p`, `trade ecto`, and `char war`.
Build and team previews use the existing planner and observed execution runner.

## Verified behavior

- 27 Hub browser journeys: deterministic search, keyboard navigation, team and
  build application, duplicate refusal, preflight and partial failures, conversion,
  saved phrases and pins, disabled capabilities, silent Storage, character choice,
  Trade query transfer, detachment, and inline Maps controls.
- Browser visual exploration: home and conversion states, both themes, 390px width,
  reduced motion. Raycast-style hierarchy with category icons, 54px rows, a spacious
  search area, rounded selection, conversion cards and a compact action footer.
- 1,692 unit tests passed, including bounded calculator arithmetic, late quotes,
  stale rates, private/global phrase validation and single-build target guards.
- 182 policy tests, 171 Tools tests and 80 Launcher tests passed.
- Type checks, lint, Markdown links and production build passed during this work.

## Ownership and limits

Private build/team phrases live in the existing build library, following its Single
and Multiple Accounts ownership. Global settings store only tool/destination phrases.
Renames retain ID references; deletion removes library references. Older library
readers may discard the optional Hub preferences field when saving; build content
and the library version remain unchanged. No compatibility service is introduced.

Remote conversion reuses Trade's NPC trader source and buy/sell interpretation.
An observation older than five minutes is labelled Last observed. Quotes are estimates,
not executable bulk prices. Armbrace and Zaishen key estimates use the production median estimator with synthetic ads in the browser workbench. Manual rates remain an explicit override. Guided multi-action flows remain future work. Invite stays absent without a certified named capability.

All 19 focused Electron input tests passed across the final targeted runs, including
Core Hub’s Command-R interception, text editing and game-focus restoration, character
selection, detached tools, Travel, and preserved custom modifier shortcuts. Offline tests do not certify live gameplay, server prices, signing,
or release readiness. No release or remote publication was performed.

Conversion coverage includes compact/spaced amounts, decimal shorthand, k/p/e/a/zkey
aliases, 250-item stacks, mixed sums, multiplication, per-stack prices, ambiguous-input
refusal and material batch normalization. Item art loads in the browser. A complete
`pnpm run check`, production build and the 27 Hub browser journeys passed for this
conversion expansion; focused checks cover the final display and rate adjustments.

## Inferred currency prices

- Eight focused estimator tests cover explicit live-observed syntax, malformed and
  ambiguous advertisements, duplicate senders, outliers, sparse evidence, expired
  evidence, fixed endpoint pagination, caching, quiet failures, and late responses.
- An open Hub drops expired evidence without waiting for another keystroke.
- Browser checks cover `~`, median attribution, advertiser counts, original icons,
  seller/buyer selection, manual override, and insufficient evidence without a popup.
- Desktop and 390px browser views were inspected after implementation.
- The complete repository gate passed. Final expiry changes passed focused tests,
  type checks and lint. Production build and all 15 built-preload behavior tests passed.
- A bounded read-only probe verified the public Kamadan HTTP search endpoint and
  timestamp pagination. Live results can legitimately lack sufficient evidence for
  some currencies or conversion routes. No live gameplay or trade was performed.

## Offline title planning

Six focused title tests cover sourced point values, wrong-track refusal, unknown
items, ranks, entered progress, whole-item rounding, excess points, explicit offer
costs and disabled Trade. Two additional browser journeys cover editable examples,
progress-to-shopping navigation and inline corrections. Desktop and 390px layouts
were inspected. Selected shopping rows expose their full details in the preview.
See [title calculators](hub-title-calculators.md) for the supported boundary.

Sample market snapshots carry an explicit sample marker. Both the numeric result
and copied text label them as sample data, never recent Kamadan advertisements.
A focused test and the browser conversion journey cover this distinction.


## Compact Travel and keyboard consistency

Hub and its embedded controls share the system font token. Recent Travel
destinations and characters use horizontal carousels; Travel retains a compact
Favorites grid. Empty-query arrows browse without executing, Enter activates and
Escape returns. Search retains caret editing. Settings stay keyboard-accessible.
Existing Travel and character tests retain refusal and preference coverage.

## Saved-build profession search and skill previews

`build monk` and `build mo` search saved primary professions in the same library
and template source. Name/tag tokens can narrow the query; there is no 12-result
cutoff. Profession-only matches open Review. Exact-name application guards remain
unchanged. Search rows show eight ordered icons, elite outlines and named tooltips;
missing art falls back to numbered slots. Native art comes from the existing skill
catalogue. The offline fixture uses attributed Guild Wars Wiki artwork.

Verified on 7 September 2026: all 28 Hub browser journeys, the complete repository
check and production build passed. A focused controller test covers 15 matches,
primary-versus-secondary profession filtering and combined tokens. Desktop and
390px browser exploration covered skill artwork, keyboard selection, scrolling,
review without application, unavailable images and recovery after reload. These
checks use synthetic game state and do not certify live build application.


## Unified conversations and stable frame

The separate quick-whisper DOM implementation was removed. The Hub mounting owner
reparents the existing Vue Whispers component, preserving session state and reading
position. Person search, direct shortcut and unread launcher share that view. Back,
failed sends and draft-close cancellation preserve text; session reset clears it.
Chat settings and guarded close remain available. No real messages were sent.

On 7 September 2026, 29 Hub browser journeys passed, including exact frame geometry
across conversions, build results, Travel, Characters and Whispers. Browser
exploration also covered incoming messages, returning to an existing draft, compact
character cards and 390px layouts. Production build passed. The repository gate
covers type checks, lint, links, unit/policy tests and Tools/Launcher tests.

## Account choices and left-aligned characters

Character carousels now fill from the left at the start, remain full near the end,
and only leave trailing empty slots for small accounts. Profession artwork is
larger without a square outline; compact cards show shortcut badges and `Lv 20 ·
Kamadan` metadata. `char Toefte` exposes the explicit switch action and retains the
existing explorable-area confirmation and native switch guards.

The general account picker and `acc second` use saved account names. Exact account
search shows the two explicit actions; prefixes first select an account. Current
and opening accounts cannot be activated. Main owns launch-before-close ordering,
source-window identity and concurrency; the existing account launcher owns windows.
Browser verification covers both actions without executing real account operations.

Verification for this expansion: 31 Hub browser journeys passed, including both
account actions, direct `char Toefte`, left-edge layout and unchanged Hub geometry.
Desktop and 390px exploration confirmed readable account choices and compact cards.
All 1,703 unit tests, 182 policy tests, 172 Tools tests and 80 Launcher tests passed,
along with type/lint/link checks and the production build. The 15 built-preload
behavior tests passed with both new account capabilities included. Account launch
and close ordering was tested against an offline owner; no real accounts were
opened, closed or signed in during verification.


## In-game settings and chat pop-out

Acceptance criteria:
- Settings stays inside Hub with fixed geometry, including while toggling a tool.
- Disabled tools disappear from search and can be enabled again in Settings.
- Show Launcher remains an explicit separate action.
- Tool, appearance, shortcut, map and character/chat preferences use the existing
  native preferences owner. Launcher administration keys are rejected by the Hub API.
- Unknown `whisper Foo` opens a composer addressed to Foo, not “Whisper to foo”.
- Pop out and Open in Hub preserve the exact draft and selection without sending.
- Pop-out opacity is adjustable; desktop and narrow settings remain usable.

Browser coverage includes settings navigation, disabling/re-enabling Whispers,
appearance changes, a 390px viewport, Show Launcher, an unknown whisper recipient,
and draft-preserving pop-out/return with opacity adjustment. Native schema tests
exercise allowed changes and reject malformed or launcher-only writes; built-preload
coverage checks each named capability. Live game overlay hit testing and actual
shortcut capture still require a running game; browser checks use synthetic data.

Verified after this change: 33 Hub browser journeys, 1,705 unit tests, 182 policy
tests, 172 Tools tests, 80 Launcher tests and 15 built-preload tests passed.
Type checks, lint, links, production build and whitespace checks passed. The
Impeccable scan of the changed settings/chat UI reported no findings. Desktop and
390px screenshots were inspected. A source-header policy failure was corrected
and the complete policy suite rerun successfully.

## Audit fixes and full shortcut capture — 7 September 2026

All H01–H14 implementation fixes are recorded in [the audit closure table](hub-audit.md).
Final verification passed: 40 Hub browser journeys, 1,710 unit tests, 182 policy
tests, 172 Tools component tests, 80 Launcher component tests and 16 built-preload
tests. Type checks, lint, link checks, production build and whitespace checks pass.

The shortcut tests cover all sixteen modifier combinations, accepted physical key
families, persisted bindings, exact matching, native capture interception and
conflicts. Browser recording verifies separate Control/Option/Shift/F12 keycaps,
Escape cancellation and the resulting character hint. Existing Command shortcuts
retain their meaning. Disabled tools keep read-only shortcut rows.

Fresh desktop screenshots were inspected for shortcut settings, team editing and
pop-out chat, plus team editing at 390px. The fixed Hub frame remains unchanged.
The earlier bounded Impeccable scan reported no findings; rendered interaction
checks, rather than that scan, supply the visual evidence.

Still unverified: VoiceOver and real-game keyboard focus, overlay hit testing,
account launches and gameplay actions. The fixture uses synthetic game state and
never sends a real whisper. Fn/media keys are outside the supported capture model.

## Current-main integration baseline — 12 September 2026

The Hub source at `8e369cb9` was integrated into current main `13c82c09`
in the isolated `feat/hub-overhaul-foundation` worktree. Conflict resolutions
retain main's elite map mounting, native map composition, alcohol timer and
font owners alongside Hub navigation and account actions.

The integrated baseline passed typecheck, lint, Markdown links, 1,756 unit
checks, 182 policy checks, 200 Tools tests, 81 Launcher tests, all 40 Hub
browser journeys, and the production build. The policy check initially found
private task identifiers in the new planning document; those references were
removed and the policy suite passed again. Home and Travel were inspected in
the production offline fixture at 1280 × 720. No live gameplay, account switch,
real message, signed package or VoiceOver result is claimed by this baseline.

## Shared Classic frame layer

The DOM Hub and Vue Library/Trade windows now use the study's decorative
canvas reconstruction through one shared owner. The retained source centre is
cleared before composition, so panel opacity and custom colours still come
from the appearance projector. Frame assets are copied through the explicit
package input list and carry provenance and ArenaNet notices.

Home, Travel, build search, Trade review and detached Trade were visually
inspected. All 40 Hub journeys and two appearance checks passed. The latter
exercise 1×/2× pixel density, a transparent canvas centre, pointer exclusion,
65% opacity, a Modern round trip and 800 × 600 Travel geometry. Typecheck,
lint and links passed. The full unit pass found stale copy-fixture inputs and
an unanchored CSS selector assertion; both were corrected, and all 24 affected
checks passed. The 182 policy, 200 Tools and 81 Launcher tests passed, as did
the production build. Later layers must rerun the complete final gate.
