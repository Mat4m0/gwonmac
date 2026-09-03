# Launcher settings audit — 3 September 2026

**Follow-up:** The fixes below address F1–F8. The original findings remain as
historical evidence; see [Remediation](#remediation).

## Original verdict

**The settings have a useful foundation, but the complete experience is not
ready to call solid.** The current game identity fits. The next pass should
improve trust, navigation, and task density before adding more customization.

Implementation integrity: **fails the release-readiness bar for settings**.
The controls use a coherent system, but save failures can contradict displayed
values and the global reset understates its scope. The deterministic Impeccable
scan returned zero findings. That does not invalidate the behavioral findings.

This is a new, broader audit of the current working tree. It supersedes the
earlier 16/20 readiness impression from the repair-focused audit. The earlier
checks missed the failed-save presentation and navigation scenarios below.

Classification: normal development; audit only. No production code changed in
this review. Earlier uncommitted settings repairs remain in the working tree.

## Method and limits

- Target: `apps/launcher/src/App.vue`, all eight settings sections, their shared
  controls, native persistence/reset owners, and the game settings consumers.
- Basis: current source and rendered Electron UI, with PRODUCT.md and the user
  guide for product boundaries. This is an Operate surface in a desktop game
  launcher. The current amber/dark interface is the visual reference; older
  DESIGN.md references to an ember accent and the former Hub are not current
  visual truth.
- Single-agent Impeccable audit with scenario-based UI/UX review. This is not
  the separate dual-assessment `impeccable critique` workflow.
- Captured every section at 1180×760, the actual 900×640 minimum, and 200% zoom
  at 1180×760. Also inspected custom map/panel editors, Tools disabled, failed
  saves, section navigation, keyboard focus, and the accessibility tree.
- Two temporary offline Electron audit probes passed. They collected evidence,
  including defects; a passing probe does not mean the interface passed.
- Fault injection replaced the settings IPC handler only in a disposable test
  process. The real game, user preferences, and active sessions were untouched.
- Reused the preceding successful build, full repository check, and three
  focused Electron tests for successful preset persistence, zoom controls, and
  two-window delivery. The audit did not repeat those successful-path tests.
- No live game rendering, macOS VoiceOver session, frame-time benchmark, or
  complete WCAG conformance evaluation. Source inspection cannot prove those.
- No browser overlay was injected or claimed. Electron screenshots, DOM
  geometry, keyboard actions, and accessibility snapshots are the evidence.

## Audit health

Scores are bounded review judgments, not certifications.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 2/4 | Native controls and focus work; zoom can remove the entire error message from the accessibility tree. |
| Performance | 3/4 | Settings have no continuous animation or layout-reading loop; launcher JS is 223.56 kB, 75.26 kB gzip. No runtime performance benchmark. |
| Responsive layout | 2/4 | Controls wrap, but minimum size creates nested scrolling and zoom leaves little working space. |
| Theming | 3/4 | Coherent dark palette and reusable controls; semantic state colors are partly hard-coded and custom themes have no preview. |
| Implementation integrity | 2/4 | Successful persistence and broadcast work; failure presentation and reset scope remain inconsistent. |
| **Total** | **12/20 — Acceptable** | **Significant work remains before the experience is dependable.** |

Eight material findings: **0 P0, 3 P1, 5 P2, 0 P3**. P1 should be addressed
before release. P2 recommendations improve the task flow without replacing the
product identity.

## P1 findings

### F1 — Failed saves leave controls showing values that were not saved

Category: implementation integrity and error recovery.

Locations: [MapsSettings.vue](../../apps/launcher/src/components/MapsSettings.vue)
lines 49–55 and 162;
[ColorControl.vue](../../apps/launcher/src/components/ColorControl.vue) lines
9–20; [RangeControl.vue](../../apps/launcher/src/components/RangeControl.vue)
lines 8–21.

Reproduction: create a custom map style, refuse the next settings writes in the
offline fixture, enter `#112233`, change terrain thickness to `0`, then enable
Exploration grid. The UI shows all three new values. Persisted values remain
`#081014`, `3`, and `false`. The error exists, but is below the long editor.

Cause: local drafts and native checkbox state change before persistence. On
failure, the canonical prop stays unchanged, so value watchers do not reset
those drafts. There is no explicit unsaved state or retry action.

Impact: players can reasonably believe the game is failing to synchronize a
setting which was never saved. Repeating an identical value is not a reliable
recovery interaction when saving is triggered by a change event.

Recommendation: make save completion part of the control interaction. Either
restore the last confirmed value or visibly retain an unsaved draft with Retry
and Revert. Disable or serialize dependent edits while a whole preset is being
saved. Keep canonical settings in the existing owner; do not add a second store.

Acceptance: each failed toggle, select, number, and color save is distinguishable
from a saved value, can be retried without changing the intended value, and
cannot display a success message.

Suggested command: `impeccable harden`.

### F2 — Error feedback disappears in compact layouts

Category: accessibility and responsive layout.

Locations: [style.css](../../apps/launcher/src/style.css) line 230;
[LaunchBar.vue](../../apps/launcher/src/components/LaunchBar.vue) lines 205–216;
[MapsSettings.vue](../../apps/launcher/src/components/MapsSettings.vue) line 201;
[ToolsSettings.vue](../../apps/launcher/src/components/ToolsSettings.vue), final
message paragraph.

Reproduction: at 200% zoom, refuse an Extended memory save. The DOM contains
“This setting could not be saved. Nothing was changed.” The `.status-copy`
element is `display: none`. The accessibility snapshot contains only `- alert`.
At normal size, map errors can sit thousands of pixels below the control.

Impact: both sighted and assistive-technology users can lose the explanation.
A warning icon alone cannot explain which setting failed or how to recover.

Recommendation: show field-related feedback beside its control or in a small
persistent settings status area. Compact layouts must preserve error text.
Use one consistent saving/saved/failed vocabulary across sections.

Standard: the hidden message conflicts with the intent of
[WCAG 4.1.3, Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
The loss of information on resize also warrants a full
[reflow evaluation](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
This audit does not claim a complete conformance result at all required sizes.

Acceptance: force a save failure at normal, minimum, and zoomed sizes. Its text
must remain visible and present in the accessibility tree without scrolling to
the end of a page.

Suggested commands: `impeccable harden`, then `impeccable adapt`.

### F3 — Reset and deletion understate the loss of user customization

Category: implementation integrity and user control.

Locations: [App.vue](../../apps/launcher/src/App.vue) line 412;
[main.ts](../../src/main/main.ts) lines 881–894;
[preferences-coordinator.ts](../../src/main/core/preferences-coordinator.ts)
lines 168–176 and 252–263;
[MapsSettings.vue](../../apps/launcher/src/components/MapsSettings.vue) lines
94–100 and 179.

“Reset launcher settings” resets the main settings document, not just launcher
presentation. That document includes custom map presets, custom panel colors,
Tools preferences, and shortcuts. It also resets launcher presentation and
selects original textures. The confirmation lists preserved data but does not
name the customizations being discarded.

Separately, Delete custom style saves the deletion immediately, without a
confirmation or undo. A style may represent substantial manual editing.

Impact: a player troubleshooting the launcher can lose unrelated game
customization after approving a misleadingly narrow action.

Recommendation: name the real scope, such as “Reset all app settings,” and
explicitly list affected customization. Prefer scoped defaults for routine
tuning. Confirm deletion with the style name, or offer a reliable undo. Keep
destructive controls separate from ordinary display preferences.

Acceptance: the confirmation states what will be lost before reset. Deleting a
custom style has a clear recovery or confirmation path. Restoring one visual
default does not require the global reset.

Suggested commands: `impeccable clarify`, then `impeccable harden`.

## P2 findings

### F4 — Section changes retain an unrelated scroll position

Category: responsive layout, navigation, and orientation.

Locations: [App.vue](../../apps/launcher/src/App.vue) lines 207–220;
[style.css](../../apps/launcher/src/style.css) lines 121, 124, and 167.

Reproduction: scroll to the map color editor, then choose Tools. The shared
content scroller retains `scrollTop: 1383`; the Tools heading lands at `y: -1201`.
At 900×640, clicking lower navigation items also scrolls the outer `main`, while
the content has its own scrollbar. Texture packs can open with its heading and
Add .tpf file button above the visible region.

Impact: players arrive in the middle of a new section and may miss its primary
action. Nested scrolling makes small-window navigation harder to predict.

Recommendation: use one content scroll owner per layout and reset to the new
section heading. Provide a clear keyboard transition to the section content.
When Settings is reopened, consider returning to the last section instead of
always opening Updates; do not carry one section's scroll into another.

Acceptance: switch from the bottom of every long section to every short section
at minimum size and 200% zoom. The new heading and first action are visible.

Suggested commands: `impeccable adapt`, `impeccable harden`.

### F5 — Launcher chrome and large cards consume the settings workspace

Category: layout and task efficiency.

Locations: [style.css](../../apps/launcher/src/style.css) lines 20–35, 43,
121–129, and 224–234;
[ToolsSettings.vue](../../apps/launcher/src/components/ToolsSettings.vue) template.

Evidence: default Tools content is approximately 2,055 CSS pixels tall before
expanding skill labels. At 900×640, the first view shows roughly one feature
card. At 200% zoom, the top bar, funding strip, settings tabs, and launch bar
leave about 148 CSS pixels for scrolling settings content. Maps initially
shows its heading and explanatory text without a control.

Impact: common operations require excessive scrolling. Repeated Change,
Clear, and Restore default shortcut actions receive as much space as the
feature choices players came to adjust.

Recommendation: retain the Guild Wars logo and dark/gold identity. Use a
quieter settings shell: compact the header, keep support promotion on Home,
reduce the settings heading size, and retain a compact game-return/launch
action. Show each shortcut as a compact editable value; disclose secondary
shortcut actions when editing. Use generous spacing between feature groups,
with tighter spacing within one feature.

Acceptance: at 900×640, the Tools master and several feature rows are visible
without scrolling. At 200%, a settings control appears in the initial view.
This must not reduce readable text or keyboard target visibility.

Suggested commands: `impeccable distill`, `impeccable layout`.

### F6 — Saved, enabled, and active-in-game are not clear enough

Category: implementation integrity, discoverability, and system status.

Locations: [App.vue](../../apps/launcher/src/App.vue) lines 60–65;
[ToolsSettings.vue](../../apps/launcher/src/components/ToolsSettings.vue) lines
44–57; [MapsSettings.vue](../../apps/launcher/src/components/MapsSettings.vue)
lines 157–172.

Tools configuration, an individual feature switch, and the running session's
loaded capabilities are different states. The Tools page explains restart
requirements, but Maps receives no active-session readiness information. Maps
also disappears from navigation when Tools or Maps is disabled. The master
Tools switch follows the large Character Switch card.

Impact: players can save a map preference successfully and still be unsure
why it is not visible in their current session. Hiding the section prevents
them from finding their preferences until they discover the enabling path.

Recommendation: keep Maps discoverable and explain its dependency in place.
Put the master opt-in at the top of the optional Tools group, keeping Character
Switch clearly independent. Reuse existing runtime facts to show “Active,”
“Saved for next restart,” or “Tools disabled” where players make the change.
Do not infer “applied to every session” merely from a successful disk write.

Acceptance: a player with a Core session open can distinguish a saved map
preference from an active overlay and find the exact enabling step.

Suggested commands: `impeccable clarify`, `impeccable shape`.

### F7 — Visual customization has no visual context

Category: theming, recognition, and task efficiency.

Locations: [MapsSettings.vue](../../apps/launcher/src/components/MapsSettings.vue)
lines 167–199;
[AppearanceSettings.vue](../../apps/launcher/src/components/AppearanceSettings.vue)
lines 33–58.

Color swatches now communicate the chosen RGB value, but not its effect on a
map, a border casing, or a panel. Selecting Cartographer, Synthwave, or a custom
panel theme has no local sample. Border thickness is separated from the other
walkable-terrain colors in the long editor. Advanced line fields dominate it.

Impact: players must repeatedly move between launcher and game to understand
the choices. With no game open, the task becomes guesswork. Text and background
colors can also be made unreadable without local warning.

Recommendation: show a small representative map/panel preview driven by the
same canonical style values, with no separate preference state. Put common
options together and disclose advanced line styling. Keep a named default
readily reachable. Warn about poor text/background contrast without forbidding
the player's custom colors.

Acceptance: without a running game, a player can identify what each color
changes and compare border thickness and presets. Preview must be described
as illustrative if it cannot reproduce native rendering exactly.

Suggested commands: `impeccable shape`, `impeccable clarify`.

### F8 — Several labels expose implementation terms or obscure scope

Category: language and consistency.

Locations: [MapsSettings.vue](../../apps/launcher/src/components/MapsSettings.vue)
lines 165, 187–193;
[GeneralUpdateSettings.vue](../../apps/launcher/src/components/GeneralUpdateSettings.vue)
lines 39–43;
[App.vue](../../apps/launcher/src/App.vue) lines 385–390;
[ToolsSettings.vue](../../apps/launcher/src/components/ToolsSettings.vue) feature labels.

Examples: “certified pathing geometry,” “Veil color,” and “Boundary casing”
require knowledge of the rendering model. “Automatically update this launcher”
labels a preference named and defined as automatic update checking. “Game
settings” includes only host controls, not Guild Wars' own graphics, audio,
and key bindings. Visible Build Management and its accessible shortcut label
Build Library use different names for the same feature.

Recommendation: use player language and one term per feature. For example:
“Shade areas you cannot walk on,” “Shaded area color,” and “Border outline
color.” Describe checking/downloading/installing updates separately, and state
that native Guild Wars settings remain in the game. For render quality, show
the actual scale alongside the plain-language option if that is the useful
choice being made.

Acceptance: each row explains what changes, where it changes, and when it
takes effect without requiring the player to read technical documentation.

Suggested command: `impeccable clarify`.

## Section and control inventory

| Section | Control suitability | Remaining concern |
| --- | --- | --- |
| Updates | Checkbox, finite channel select, explicit check/install action fit. | Automatic-check wording and consistent save feedback. |
| Content | Boolean switches and the First Home tab select fit. Conditional rows avoid irrelevant choices. | Group news-source switches beneath News more clearly; global failure feedback needs F2. |
| Advanced | Diagnostics switch and explicit maintenance buttons fit. | Reset scope and destructive-action separation, F3. |
| Game settings | Render presets, memory switch, character-return switch, and controller symbols fit. | Restart/active status and separation of host settings from game settings. |
| In-game panels | Style/font choices, bounded opacity, color picker plus hex, and separate import/export fit. | Local preview; Restore default colors is buried under sharing. |
| Tools | Feature switches, native shortcut capture/conflict flow, display-only skill labels, and cooldown colors fit. | Master placement, density, stable navigation, runtime status. |
| Maps | Independent Compass opt-in, thickness slider plus exact value, layer opacity, and named presets fit. | Failed saves, long editor, no preview, unclear technical labels, immediate deletion. |
| Texture packs | Single-choice radio list, import progress, availability, and next-launch note fit. | Minimum-size navigation hides heading/import action; long imported names were not stress-tested here. |
| Game files | Read-only status, repair action, and advanced reset disclosure fit. | Avoid the redundant launch-bar “Open Game Files” action while already here. |

No additional control should be added for `grid.noWalkableColor` merely because
the field exists in the preset schema. The source search found persistence and
preset definitions but no current renderer read. Confirm that legacy contract's
owner before exposing or removing it.

## What is working

- Colors have both visible swatches and exact hex input. Widths and opacity have
  bounded numeric entry and units. These are appropriate desktop controls.
- Native form semantics and keyboard outlines are present. The keyboard sample
  reached the Game controls without a trap. The Tools accessibility snapshot
  correctly exposed checked/disabled state and named shortcut actions.
- Default launcher text tokens have strong contrast against the solid surface:
  secondary text approximately 7.11:1, primary text 15.66:1. These are token-pair
  calculations, not a claim about every composited surface or custom theme.
- Compass grid is off by default. Its independent preference preserves grids
  on the Mission Map and World Map.
- Built-ins remain intact when thickness creates a custom copy. Existing-preset
  edits and reload were verified in the preceding real-IPC regression test.
- The persistence owner and two-window publication path are established. Build
  on that single source of truth.
- Shortcut conflict handling, explicit import feedback for texture packs,
  and native confirmations for broad maintenance are useful patterns to retain.
- Settings do not add decorative motion. Reduced-motion styling avoids an
  animation dependency; there is no reason to add elaborate transitions here.

## Cross-cutting patterns

The principal weakness is the transaction experience: controls, persistence,
feedback, and running-session effects are not presented as one understandable
operation. Another recurring weakness is reuse of the promotional launcher
shell for a dense utility task.

Do not replace native controls or introduce a generic settings engine. Improve
the existing save path, shared controls, scroll ownership, and section grouping.
Do not add a search system just to compensate for the present layout.

Player scenarios:

- Returning player tuning a map: can now choose exact colors, but cannot see a
  local result and may mistake failed persistence for broken live sync.
- Player with multiple accounts: global scope is documented on Maps/Tools,
  but settings do not consistently show which currently open sessions can use
  a saved choice.
- Keyboard or low-vision player: ordinary fields and focus work, but the
  zoomed error loses its text and new sections can open above the viewport.

## Recommended sequence

1. `impeccable harden`: F1–F3. Correct save outcomes, visible errors, and loss
   prevention before further visual work.
2. `impeccable adapt` and `impeccable layout`: F4–F5. One scroll owner, predictable
   navigation, and a compact settings shell.
3. `impeccable clarify` and `impeccable shape`: F6–F8. Active-session status,
   stable entry points, useful previews, and player-facing terminology.
4. Re-run `impeccable audit` against the acceptance cases above.
5. `impeccable polish`: final alignment, spacing, and consistent state treatment.

## Evidence accounting

Impeccable command: `detect.mjs --json apps/launcher/src`; exit 0, result `[]`.
It is a pattern detector, not a save-failure or accessibility test.

A preliminary DOM-name inventory returned empty text for some hidden controls
and buttons because it used the wrong naming fallback. Those candidates were
discarded. The verified accessibility snapshot, explicit role locators, and
source labels do not support reporting those controls as unlabeled.

Capture files and machine-readable observations are preserved in this task's
`launcher-settings-audit` artifact folder. Temporary test specs and their
disposable Electron user-data directories were removed. No audit-only server
was started. The existing development game was not restarted or modified.

Final repository verification: `pnpm check` passed, including type checks, lint,
Markdown links, 1,561 unit tests, 181 policy tests, 146 Tools tests, and 71
launcher tests. `git diff --check` passed. The report is the only new repository
artifact from this audit; the previous repair work remains uncommitted.


## Remediation

Implemented on `fix/settings-controls-live-sync` after the audit. The existing
persistence owner remains authoritative; no additional settings store or
transport was introduced.

| Finding | Implemented correction |
| --- | --- |
| F1 | One pending settings save, explicit unsaved state, exact-operation Retry save, and Revert change to the canonical snapshot. Conflicting edits are disabled. |
| F2 | Persistent settings feedback outside the disabled form. Error text and recovery actions remain visible and accessible at minimum size and 200% zoom. |
| F3 | Reset all app settings names the lost customizations and preserved data. Custom map deletion requires confirmation by name. Scoped map and panel defaults remain available. |
| F4 | Each section opens at its heading with keyboard focus. The content has one scroll owner; reopening Settings keeps the last section. |
| F5 | Compact settings header and launch bar, promotion confined to Home, tighter groups, and compact shortcuts with secondary actions under Options. |
| F6 | Maps stays discoverable. Existing runtime facts distinguish Tools off, Maps off, restart required, and enabled layers. The Tools master appears first. |
| F7 | Illustrative map and panel previews derive from canonical styles. The panel preview reuses game contrast helpers and explains low-contrast correction. Advanced grid fields are disclosed separately. |
| F8 | Player-facing terrain/color labels, accurate automatic-update-check wording, consistent Build Library naming in settings, explicit host-settings scope, and render scales shown with quality labels. |

Also grouped Home news sources and suppressed the redundant Open Game Files
launch action while that section is already open.

### Verification and limits

- `pnpm check` passed: type checks, lint, Markdown links, 1,561 unit tests,
  181 policy tests, 146 Tools tests, and 76 launcher tests.
- Build passed.
- Six focused offline Electron scenarios passed across the final runs: native
  command validation, existing custom-style persistence, color/numeric controls,
  two-window settings publication, failed-save recovery, and section navigation.
- Navigation covered all eight sections at 1180×760 and 900×640, each at 100%
  and 200% zoom. Heading focus, content scroll ownership, and reachable primary
  controls were checked. At minimum size and 200%, descriptions can require
  scrolling; controls remain reachable.
- Forced IPC save failures verified visible and accessible unsaved feedback,
  retry, locking, and restoration of the original hex/grid values. The final
  capture used native Electron capture because browser screenshots crop
  incorrectly with native Electron zoom.
- The Impeccable detector returned `[]`; `git diff --check` passed.
- Final screenshots are preserved in the task artifact folder
  `launcher-settings-fixed`. The original audit captures remain separate.
- These offline checks prove launcher behavior and the settings publication
  boundary. They do not claim live Guild Wars graphics, gameplay, or input QA.
  The existing development game was not restarted during this follow-up.


### Visual layout follow-up

The prior remediation retained too much of the large-card layout. This pass
replaces it with a desktop preferences surface: one flat content area, fine
row dividers, aligned controls, and compact navigation. The Guild Wars logo,
dark palette, gold accents, and section type remain.

Tools shortcuts now sit beside their feature, with secondary actions in a
three-dot menu. The map style picker and edit action share a row; common
adjustments and their illustrative preview form one region. Editing moves
focus into the style editor. Done returns to the edit button. Routine success
feedback no longer inserts a banner or repeated messages between settings.
Errors retain their persistent recovery actions.

The shared desktop inputs use a 34px height, verified against a 32px minimum
in Electron. Checkbox labels retain the larger row target. This intentionally
replaces the previous test's 44px touch-oriented assumption. Accessible names
are concise; feature descriptions are associated through `aria-describedby`.

The rendered minimum window shows the Tools master and multiple feature rows.
Desktop and 200% zoom checks passed for every settings section, custom color
and numeric controls, and failed saves. The shortcut menu was verified through
its visible, hit-testable actions and Escape dismissal. Native screenshot
capture can lag a just-opened menu, so the menu capture alone is not that proof.

Six focused Electron tests passed. The final layout captures are in the task's
`launcher-settings-layout` artifact folder. The detector returned `[]`.
Visual acceptance belongs to review of the actual screens; no numerical
readiness score is assigned by this follow-up.
