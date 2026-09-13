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

## Unified Hub candidate — 12 September 2026

The final flow layer extends the shared frame to Whispers and the component
gallery. Settings use shared controls. The browser fixture and production
renderer share the packaged fallback font declaration; the original game-font
loader remains unchanged. Classic custom title colours use the existing
appearance projector. Modern keeps its saved `obsidian` identity.

Text fields retain Left/Right caret editing. Enter remains the named action.
Direct tool entry returns to the game without inserting Home into its history.
Actions, nested views and normal Hub entry restore their actual parent.
The Whisper shortcut toggles the active presentation. Its existing scroll owner
captures before docking or detachment changes DOM geometry; drafts remain in
the same session and composer.

Currency and material artwork now appears in the explicit renderer package
inputs. The Electron check requires both conversion images to decode through
the production protocol. A browser failure check keeps labelled values and
Copy result available when optional artwork cannot load.

The compact Library fixes preserve usable catalogue results at 320 × 800 and
team composition at 1024 × 420. The pointer reorder test scrolls its source
into view before dropping; it still verifies reorder, removal and undo.
Character tests now assert the accepted left-aligned Hub carousel, metadata,
identity-preserving updates, confirmation, failure and focus restoration.
The frozen preload inventory explicitly includes the reviewed `accounts` and
`hubSettings` capabilities. Existing validation and refusal checks remain.

### Acceptance evidence by delivery step

| Plan step | Implementation and evidence |
| --- | --- |
| 1. Integrate current main | Baseline and conflict record above; newer elite/map, alcohol, font and client owners retained. |
| 2. Establish baselines | Integrated Home/Travel and accepted study inspected; fixed 780 × 590 shell retained where the viewport permits. |
| 3. Shared frame | [Frame owner](../src/shared/ui/frame.ts), [asset provenance](../src/shared/ui/frame/README.md), shared tokens and [gallery](ui-gallery.html); 1×/2× canvas and production-protocol checks. |
| 4. Home and Travel | [Hub browser journeys](../apps/tools/tests/hub.spec.ts) cover explicit travel, selection, Back, keyboard carousels and stable outer bounds. |
| 5. Characters, People, Accounts | Browser search/availability checks; [Character Electron tests](../tests/electron/input-character-switch.spec.ts); [account replacement refusal tests](../tests/unit/hub-account-actions.test.ts). |
| 6. Builds and Teams | Search, eight skill slots, duplicate names, target review, interrupted Apply and authoring covered by Hub/Workbench browser suites; detached persistence covered in Electron. |
| 7. Whispers and Trade | Browser offer-to-composer and Back; [Electron chat checks](../tests/electron/input-whispers.spec.ts) cover native focus, draft and transcript preservation, toggle and background strength. |
| 8. Settings and other surfaces | Settings/Maps/calculator journeys, resolved keycaps, recording and disabled-feature checks; launcher controls and map editing tested at 200% zoom. |
| 9. Final verification and cleanup | Final gate receipt below; replaced Hub paint and duplicate inset chrome removed. No temporary migration or compatibility owner was introduced by the visual cutover. |

Direct visual inspection covered Home, Travel, character cards, account choices,
build search/review, team editing, Trade review/detachment, Whispers docking,
Settings, Maps, and the shared component specimen. The palette's title and
controls remain above decorative artwork. Narrow Travel keeps Back, search,
favourites and its action hints reachable.

[Appearance checks](../apps/tools/tests/hub-appearance.spec.ts) include minimum
opacity, a bright checkerboard backdrop, reduced motion, font changes, Custom
Classic, Modern round trips and device-pixel density. Composed screenshot pixels
under Hub result labels meet 4.5:1. The Workbench suite separately checks critical
team and skill feedback contrast. These are bounded contrast checks, not an
exhaustive accessibility certification. [Hub Electron checks](../tests/electron/input-hub.spec.ts)
exercise actual 200% window zoom and the `gw://app` artwork route. Native
`webContents.capturePage()` verifies the full zoomed window; the Playwright page
capture cropped this Electron configuration and was replaced.

### Native review and rollback

The offline tests do not establish live gameplay or VoiceOver quality. Before
release, Matthias must check the exact developer candidate in a real game:
Hub input isolation and focus return; Travel and character confirmation; real
account replacement failure; build/team target and result; Trade-to-Whisper and
chat docking; original game-font loading; and VoiceOver announcements. Use a
separate authorized test profile. No real message, trade, account switch or game
action was performed for the initial overhaul gate. The subsequent authorized
computer-use session is recorded below.

The original main, Hub reference and study checkouts remain clean. The isolated
local branch stack separates integration, shared styling and final flows.
Returning to the original checkout restores the baseline; the visual changes
introduce no data migration. Do not remove or rewrite the user's saved appearance,
shortcut or account data when reverting. Publication and merging remain separate.
Recommend one Beta train for this combined multi-feature and input change after
owned live QA and the existing release approval process.

### Local delivery layers

| Branch | Commit | Review boundary |
| --- | --- | --- |
| `feat/hub-overhaul-foundation` | `bdc7ba8b` | Accepted Hub integrated with current main `13c82c09`. |
| `feat/hub-overhaul-style` | `0c7e37e7` | Shared Classic frame, controls, assets and inset chrome. |
| `feat/hub-overhaul-flows` | `d1e97333` | Final flow continuity, fonts, compact layout, packaged artwork and regression checks. |

The source baseline was committed before the implementation goal started.
These branches are local. None was pushed, merged into main, or released.

### Final gate receipt

`corepack pnpm verify` completed successfully against source candidate
`d1e97333`. The final run passed:

- TypeScript, Vue type checks, lint and Markdown links.
- 1,756 unit, 182 policy, 200 Tools and 81 Launcher checks.
- Production builds and both compiled-kernel verification commands.
- 111 integration and 30 release/preload checks.
- 88 browser journeys and appearance/layout checks.
- 158 offline Electron checks; one explicitly live-client test skipped.
- macOS arm64 packaging, packaged launcher smoke and packaged Enhancement
  isolation, host-only continuity, lifecycle and rollback checks.

The final full log is retained locally at
`/tmp/gwonmac-overhaul-final-gate.log`. The visual sweep reported no layout
faults across its theme, opacity and font matrix. Native zoom captures and
additional development evidence remain in ignored `test-results/`; generated
packages, synthetic profiles and logs are not committed.

### Developer handoff

The documented `corepack pnpm dev --isolated --cached-only` startup completed
its build and printed a verified `launcher-open` receipt. The process command,
working directory and isolated profile were checked before attaching UI tools.
Launcher Home was then visually inspected at `gw://app/launcher/index.html`.

The fresh setup was completed with Tools left off. No player data or credentials
were copied. This disposable profile has no game cache and displays **Game files
need repair**. This verifies the launcher handoff, not game readiness. The Hub
browser preview remains available with synthetic state for immediate UI review.
Exact local coordinates and restart instructions are retained in
`test-results/hub-developer/handoff.md`; the command and preview are left running.

## Authorized live UI verification — 12–13 September 2026

At Matthias's explicit request, computer use exercised the real game in the
isolated development profile. This supersedes the earlier cache-empty launcher
handoff: the official game files were prepared normally and login succeeded.
Credentials were entered only in the native sign-in form, with account/password
remembering disabled. No credentials or account identifiers belong in this record.

Observed UI boundaries:

- Hub search, fixed currency conversion, caret editing, Settings navigation,
  Classic/Modern switching and return to the game worked in an actual outpost.
  Typing into Hub did not open the game's inventory.
- Explicit Travel reached Chahbek Village and returned to Kamadan. Character
  search switched to the other existing character in Fort Ranik and back to the
  original character in Kamadan. Search typing alone did not execute either action.
- An unsent Whisper draft survived pop-out, shortcut hide/show and docking back
  into Hub. The test draft was cleared; no message was sent.
- Party capture created one local team and its two observed builds. Skill bars,
  professions and build details were visible; the team correctly reported that
  it already matched the live party. Undo removed the complete test capture.
- The Storage action opened the native Vault Box. No items or funds were moved.
- Compass ranges visibly appeared when enabled through Hub, and the control
  beside the compass restored the original off state.

The Trade-to-Whisper return exposed a real defect: returning automatically
searched before the replacement feed connection was ready, and Retry restarted
the connection and repeated the failure. The existing Trade view now retains
completed results on show, waits for a live feed before sending a new or
interrupted search, and retries a search without replacing a live connection.
Subscription and search completion use separate revision guards. Incoming live
messages retain selection in the displayed result set.

The rebuilt game passed the same live return path: a cold `trade ecto` Hub query
loaded 28 public offers, opening the second offer's empty Whisper composer and
pressing Back retained the query, all 28 results and that exact offer. An explicit
search after returning also succeeded. No Whisper was sent. The original
character remains in Kamadan; the real launcher is left visibly open.

Four focused regression tests cover result/selection restoration, connection
readiness and retry, interrupted search recovery, and Hub query transfer plus
market changes. These supplement the real UI observations; they do not certify
combat, mission completion, graphics performance, VoiceOver, multi-account
replacement, or live changes to player/hero builds. No message, trade, purchase,
mission entry or build application was performed. Release QA remains with Matthias.

The follow-up `corepack pnpm verify` gate passed type checks, lint, links,
1,756 unit, 182 policy, 204 Tools, 81 Launcher, 111 integration, 30 release/preload,
88 browser and 158 offline Electron checks (one live-only test skipped), both
kernel verifiers, arm64 packaging and both packaged smoke checks. Its local log
is `/tmp/gwonmac-live-trade-fix-gate.log`. The final guard cancelling a queued
item search when opening player listings was then checked with the 19-test Trade
suite, targeted lint, a fresh development build and the live retest above.

## Hub experience polish — 13 September 2026

The follow-up implements the experience review in the existing app on
`feat/hub-overhaul-flows`, preserving the fixed Guild Wars frame and the current
feature/state owners:

- `187c2fdc` contains team previews, clarifies Home/search/navigation, displays
  resolved shortcuts, filters unavailable Home travel recents, and pairs each
  Maps layer switch with its opacity control. Maps follows external settings
  changes and restores the saved value after a failed edit, with an inline retry
  path.
- `59e73fd9` gives the Trade ledger and team roster more room. At the tested
  1280 × 720 viewport, the Hub displays five complete Trade offers or three
  complete team members with skill bars. Whisper seller remains primary;
  secondary offer actions and team options expand on demand. Pop out and Open
  in Hub retain the same tool, selected offer and team edits.
- `6a5bf952` removes Back when a directly opened view has no parent, keeps the
  narrow header usable, and adds the supported Trade query example.

Browser exploration inspected Home, Trade actions, team search/editor and Maps.
Focused regressions cover preview containment at 1280/640/390 widths, short
windows, resolved and cleared shortcuts, command hints, Maps external updates
and save recovery, Trade selection during docking, persisted team edits, and
reachable team options/actions. These use synthetic game and market state; no
Whisper, travel or build application was issued to the running game in this pass.

### Verification provenance

The complete `pnpm verify` gate passed at `59e73fd9` in a separate detached
checkout: type checks, lint, links, 1,756 unit, 182 policy, 205 Tools, 81 Launcher,
111 integration, 30 release/preload, 97 browser and 158 offline Electron checks
(one live-only check skipped), both kernel verifiers, arm64 packaging and both
packaged smoke checks. The log is `/tmp/gwonmac-hub-polish-verify.log`.

The final navigation changes at `6a5bf952` passed `pnpm run check` with the same
unit/policy/Tools/Launcher counts, a fresh production build, the compiled Electron
Hub input/focus test, and the full 97-test browser suite. Packaging was not rerun
for that final header/example adjustment. Final logs are
`/tmp/gwonmac-polish-final-check.log`, `/tmp/gwonmac-polish-final-build.log`,
`/tmp/gwonmac-polish-final-input.log` and
`/tmp/gwonmac-polish-final-browser.log`.

Local screenshots are retained in ignored `test-results/hub-polish/`. The
synthetic browser preview is left running at `http://127.0.0.1:4194/?hub`.
The existing live game process was preserved on its earlier build; this polish
does not add evidence for live combat, graphics performance, VoiceOver or human
usability acceptance. The temporary verification checkout is removed after its
tests finish. All changes are local commits; no publication or merge is included.


## Floating tools and Hub navigation — 13 September 2026

The player feedback implemented in `36609fca` supersedes the earlier docking
behavior. Trade, Builds and Whispers always use their existing floating windows.
Hub launches and focuses them; build reviews stay in the floating Library. Drafts,
unsaved-edit guards, native target validation and input isolation remain covered.

Hub now restores its page history with Backspace outside text editing or from an
empty input. Breadcrumb ancestors restore the matching query and selection. Arrow
keys connect result rows, search, header controls and footer actions. Characters
retain Left/Right selection; Up reaches search, then Back. Opening a standalone
shortcut does not invent a previously visited page.

Hub and the three floating tools start locked. Their subtle title-bar locks enable
movement and resizing; the Classic corner artwork has an invisible 36px hit area.
The X retains an accessible button target without a painted button frame. Hub
geometry stays through page navigation and fits the current viewport.

Whispers now paints one complete inset background, aligns the title vertically,
and puts conversation controls above the picker. `51e3bc0e` also keeps the Modern
background behind content and separates the keyboard hints. Both materials have
focused checks for frame geometry, background masking, draft preservation and
keyboard navigation. `2bf0a681` updates the compiled character test to assert the
new Up-to-search behavior instead of the retired Up-to-previous-character rule.

Local screenshots are retained in ignored `test-results/hub-feedback/`:
`hub-characters.png`, `hub-maps-breadcrumb.png`, `whisper-classic.png` and
`whisper-modern.png`. They use synthetic game state, not a live account.

### Verification provenance

The full gate at `36609fca` passed type checks, lint, links, 1,756 unit, 182 policy,
206 Tools, 81 Launcher, 111 integration, 30 release/preload and 101 browser checks,
plus both kernel verifiers. Its offline Electron pass had 154 successes, one
live-only skip and four failures: one outdated character-arrow assertion, two
focus-sensitive character-switch checks and a launcher restart timeout. The log
is `/tmp/gwonmac-hub-feedback-verify.log`; this was not a single green full gate.

The final implementation at `2bf0a681` passed fresh type checks, lint, all 102
browser checks, a fresh production build and 15 compiled Electron checks. That
last run includes every earlier native failure and all affected Hub, Character
Switch, floating Toolbox and Whisper input tests. All passed without changing
the focus-sensitive or launcher tests. Logs are
`/tmp/gwonmac-hub-feedback-final-browser102.log`,
`/tmp/gwonmac-hub-feedback-final-build.log` and
`/tmp/gwonmac-hub-feedback-final-electron.log`.

The final arm64 package passed both kernel verifiers again. Its log is
`/tmp/gwonmac-hub-feedback-final-package.log`. The temporary verification checkout
was removed after its tests completed. The browser preview remains available at
`http://127.0.0.1:4194/?hub`. These checks do not certify live gameplay, VoiceOver,
server prices or human usability acceptance. No release, push or merge occurred.

Both packaged smoke checks passed: launcher state/profile startup, and isolated
Enhancement runtime with Toolbox lifecycles and rollback. The log is
`/tmp/gwonmac-hub-feedback-final-smoke.log`. The earlier playtest game process had
closed before the final primary build; no running game was terminated for this
update.

## Hub builds and window controls — 13 September 2026

`9455ff02` implements the follow-up clarification. Build browsing and target
selection stay inside Hub. The full authoring editor remains a separate window.
Command-B browses builds when Hub is open and opens the editor outside Hub.

The first slice reads populated Guild Wars skill-template folders through the
existing template reader. It does not create or change template files. Each
single build requires an explicit target, including exact-name search results.
Hero search includes observed unlocked heroes. Application requires an existing
party member and uses the existing guarded apply runner. Templates are read
again before application; changed files refuse the stale selection.

Only Hub has a lock. Whispers, Trade Chat and the authoring editor move and resize
directly. Their plain X controls are visible in the Classic frame. Hub preferences
and Settings → Appearance can restore the default Hub position, size and lock.

The repository gate passed: types, lint, links, 1,756 unit, 182 policy, 207 Tools
and 81 Launcher checks. All 105 browser checks passed. The browser checks cover
folders, keyboard target selection, unlocked-hero search, party-only application,
Hub reset, direct popout dragging and visible close controls. A focused unit test
also refuses a template file changed between selection and application.

Computer-use inspection confirmed the Classic folder breadcrumbs, build target
screen and editor X. Screenshots are retained in ignored
`test-results/hub-builds-v2/`: `hub-template-folder.png`, `hub-build-actions.png`
and `hub-hero-search.png`. These use synthetic state and sample templates.
Logs are `/tmp/gwonmac-hub-v2-gate.log` and
`/tmp/gwonmac-hub-v2-browser-gate.log`.

Compiled verification exposed a startup race and a native shortcut routing
difference. `2435315a` loads the library when Tools mounts after Hub opens.
`de432117` preserves Hub during the native Build Library command. The repository
gate passed again after the startup fix, and all 50 affected browser checks
passed. Their logs are `/tmp/gwonmac-hub-v2-final-check.log` and
`/tmp/gwonmac-hub-v2-final-focused.log`.

A fresh build with the final native routing fix passed all eight affected
Electron checks: Hub, character switching, Toolbox and Whispers. The Hub check
enables Build Library in its offline profile and sends Command-B through
Electron's native input API. Test commit `cacfc036` records this setup. The final
test source passed type checks and lint. Build and native logs are
`/tmp/gwonmac-hub-v2-build-accepted.log` and
`/tmp/gwonmac-hub-v2-electron-green.log`. Verification used a separate checkout
and disposable offline profiles; the temporary checkout was removed afterward.

The browser preview remains at `http://127.0.0.1:4194/?hub`. Verification did not
rebuild the primary checkout or restart its game. The earlier playtest process
was no longer running at the final check. These checks do not establish live
gameplay acceptance. No push, merge or release was performed.

## Incoming and equipped build comparison — 13 September 2026

`4a132bbb` keeps the incoming build above the target search. It shows the name,
eight skills, professions and invested attributes. Target rows show the current
player or hero observations in the same format. Missing observations do not use
saved builds or the incoming bar as a substitute.

Right Arrow opens build, folder and target details without applying. Selecting a
hero opens its comparison; Apply remains explicit. History restores the incoming
build, query and target selection. Observation changes preserve result focus and
remove unavailable current bars.

The repository gate passed types, lint, links, 1,756 unit, 182 policy, 208 Tools
and 81 Launcher checks. The complete browser suite passed 106 checks. Six focused
comparison checks then passed, including two added viewport cases at 320×800 and
640×500. Final test-source type checks and lint also passed. Logs are
`/tmp/gwonmac-hub-comparison-check.log`,
`/tmp/gwonmac-hub-comparison-browser-all.log` and
`/tmp/gwonmac-hub-comparison-responsive.log`.

Computer-use inspection confirmed the player comparison, hero list and individual
hero comparison. Desktop and compact screenshots are retained in ignored
`test-results/hub-build-comparison/`. The preview remains at
`http://127.0.0.1:4194/?hub`. These screenshots and apply checks use synthetic
observations; no live gameplay acceptance is claimed.

A fresh production build passed the compiled Electron Hub check, including
Right Arrow into native template browsing, Back and zoomed frame geometry.
Logs are `/tmp/gwonmac-hub-comparison-build.log` and
`/tmp/gwonmac-hub-comparison-electron.log`. The disposable verification checkout
was removed after the test completed. No push, merge or release occurred.

## Compact attributes and Tango professions — 13 September 2026

Individual build results no longer reserve a lower preview or display template
file paths. The incoming summary, equipped comparisons and saved library rows
show abbreviated attribute ranks grouped under one Tango icon per profession.
Thin dividers separate ranks. Full names remain in tooltips and accessible labels.
One shared asset set also supplies Character Switch, profession filters and
Trader views; original sources and GFDL notices are in the third-party notice.

`pnpm check` passed types, lint, links, 1,757 unit, 182 policy, 208 Tools and
81 Launcher checks. The full browser run passed 109 of 110 checks; the remaining
new image-load assertion ran before the asset finished loading. It now waits
for decoded artwork. All eight focused Hub build checks passed after the final
grouping change, covering that assertion, 320px/1280px results, 320×800/640×500
comparisons, keyboard navigation and explicit application. Logs are
`/tmp/hub-polish-check.log`, `/tmp/hub-polish-browser.log` and
`/tmp/hub-polish-grouped.log`.

Computer-use inspection covered grouped Hub results, the incoming/current
comparison, Build Library and Character Switch. Compact browser screenshots
were also inspected. Evidence is in ignored `test-results/hub-compact-builds/`.
The fixture preview remains at `http://127.0.0.1:4194/?hub`.
These checks use synthetic observations. No new native or live-game check,
production rebuild, push or release was performed for this presentation change.

## Folder-aware build search — 13 September 2026

Build search combines folder words with names, tags and primary professions.
Ordered slash paths, quoted names, explicit `folder:` filters, root selection,
case-insensitive prefixes and backslash separators are covered by the mounted
library test. Import provenance is not treated as a live template folder.
Results and incoming comparisons show muted profession codes without parentheses,
followed by a folder icon and relative path. Narrow results wrap the folder label.

`pnpm check` passed types, lint, links, 1,757 unit, 182 policy, 209 Tools and
81 Launcher tests. The Hub browser suites passed 51 checks. After correcting
narrow folder-label clipping, all nine build browser checks passed again; the
Tools type check, focused lint and 11 UI policy checks also passed.
Logs are `/tmp/hub-folder-check.log`, `/tmp/hub-folder-browser-final.log` and
`/tmp/hub-folder-wrap-browser.log`. Computer-use inspection confirmed the desktop
result; the final 320px screenshot is in ignored
`test-results/hub-folder-search/compact.png`. The fixture preview remains open.
No native build, live-game check, push or release was needed for this change.

## Resume typing after result navigation — 13 September 2026

A printable key from a focused Hub result now restores the search input before
the browser inserts the character. The saved caret or selection is preserved.
The normal input event refreshes results. Enter, directional navigation and
Backspace history retain their existing behavior.

The repository gate passed. All 43 Hub browser checks passed, including the new
regression for typing from Home, appending after navigation, replacing selected
query text and typing on target pages. The final native-editing refinement passed
that focused browser check, renderer types and lint. A fresh production build in
a disposable checkout passed the compiled Electron Hub test, including typing
after Down and restoring game focus on dismissal. Logs are
`/tmp/hub-resume-typing-check.log`, `/tmp/hub-resume-typing-browser.log`,
`/tmp/hub-resume-native-editing.log` and
`/tmp/hub-resume-typing-native-final.log`.

Computer-use inspection confirmed that Down followed by typing resumes the
preview search. The existing live game session was preserved; it needs a relaunch
to load this change. No live gameplay acceptance, push or release is claimed.


## Intent and continuity refinement — 13 September 2026

This completes the remaining local work after `adc3fd67` on
`feat/hub-overhaul-flows`, against the current
[refinement plan](hub-overhaul-plan.md). Character/account entry and history retain
their task focus. Travel and Settings resume their query, selection, controls and
scroll. A removed Travel target clears the executable choice until the player
selects another destination.

Build search shares one matcher across global and folder contexts, distinguishes
profession pairs from explicit folder paths, and reports recoverable template
source failures. Eligible heroes apply directly with a named action; blocked
heroes remain inspectable. Optional details show full skill descriptions and
attribute changes. Saved builds open the existing authoring workspace, including
at compact width, with focus on a visible field. Apply feedback stays with its
actual target; confirmed use records bounded session recents without fake Undo.

Hub geometry reuses the existing normalized floating-window serializer. Only the
validated `gwonmac.hub-window-placement` key persists in profile browser storage;
lock state resets each launch. Reset removes only that optional key. Older builds
ignore it, and no native settings or library schema changes are needed. The Core
storage policy permits only these three geometry calls and continues rejecting
other browser-storage access. Native credential ownership is unchanged.

Verification on the final runtime source:

- `pnpm check`: types, lint and links passed; 1,757 unit, 183 policy, 212 Tools
  and 81 Launcher tests passed (`/tmp/gwonmac-refinement-accepted-check.log`).
- Full browser suite: 124 passed, covering cross-tool history, account actions,
  appearance, target failures and geometry. The subsequent compact editor focus
  correction passed both focused 390px/1280px handoff cases
  (`/tmp/gwonmac-refinement-final-browser.log`,
  `/tmp/gwonmac-refinement-handoff.log`).
- Fresh `pnpm build` passed (`/tmp/gwonmac-refinement-candidate-build.log`).
  The focused compiled Electron run passed 12 of 13 checks; the new character
  select-all assertion was mistakenly placed before entering its query. After
  correcting that test setup, both character checks passed. Hub, character,
  clipboard, Tools and Whisper coverage is now green
  (`/tmp/gwonmac-refinement-final-electron.log`,
  `/tmp/gwonmac-refinement-character-final.log`).
- Native editing exercises physical Meta+A/Meta+V through Electron's input owner,
  clipboard isolation, query selection, undo/redo and Delete. Chromium composition
  is exercised with dead-key/IME events; this does not test the macOS input-source
  chooser or certify every physical keyboard layout.
- Computer-use inspection covered Classic/Modern presentation, mixed-profession
  target rows, interrupted apply feedback, optional details and desktop/compact
  authoring handoff. The final compact editor visibly focuses Build name. Fixture
  observations are synthetic; no real build apply or account switch was executed.

The candidate was rebuilt and opened with `pnpm dev --cached-only`. The launcher
receipt verified the `gwonmac-hub-overhaul` checkout, the default Guild Wars
profile, PID 59713 and `gw://app/launcher/index.html` with `launcher-open` status.
The launcher remains open for acceptance; its receipt is
`/tmp/gwonmac-refinement-launcher.log`. The existing preview server was preserved.

Remaining acceptance: Matthias checks the exact candidate in live gameplay,
including input feel, real character/account switching and native build application.
Packaging and release checks were not rerun for this renderer/Tools refinement.
No push, merge or release was performed. Rollback reverts the bounded refinement
commits; geometry may be reset independently without deleting profiles, templates,
drafts or saved bindings.

## Beta preparation — 13 September 2026

Matthias accepted developer candidate `8d65a984` in live use and requested the
stack PRs and next Beta. PRs #446, #447 and #448 form that stack. The planned
version is `2026.9.2-beta.1`, cut from verified main after the stack merges.

The versioned candidate passed the complete local `pnpm verify` gate: 125 browser
checks, 159 native checks with one explicit live-client skip, and both packaged
smokes, as well as types, lint, policy, unit, integration and release checks.
The log is `/tmp/gwonmac-beta-version-verify.log`.

Hosted verification exposed stale lower-layer test expectations. Existing final
carousel, sandbox, shortcut, drag and compact-layout corrections now belong to
the layers that introduce their behavior. Frame tests explicitly cover both
transparency preferences and distinguish decorative canvas from the game.

Hosted native verification also exposed a real deferred-focus race: closing or
superseding a tool could leave its queued focus callback active. Tool ownership
changes, user input and disposal now cancel that callback. A deterministic
regression failed on the previous runtime and passes with the fix. The updated
runtime passed `pnpm check`, a fresh build, nine native input/editing checks and
both compact/desktop editor handoffs. Logs are
`/tmp/gwonmac-hub-focus-race-red.log`, `/tmp/gwonmac-hub-focus-check.log`,
`/tmp/gwonmac-hub-focus-build.log`, `/tmp/gwonmac-hub-focus-green.log` and
`/tmp/gwonmac-hub-focus-handoff.log`. The complete local gate above predates this
bounded focus fix; exact-head CI remains required for merging and releasing.

The existing developer game session was preserved. Acceptance of that session
does not certify the later signed assets. Signed qualification, Stable/Beta
round-trip and the exact-draft live checklist in
[Release verification](release-verification.md) remain release gates.
