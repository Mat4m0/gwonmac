# Hub polish: Performance and Accessibility ledger

Base: `fix/people-builds-feedback`, `d264fdba`, draft PR #481.
Worktree: `gwonmac-perf`; branch: `perf/hub-scale-and-a11y`.

## Scope and evidence

Read the handoff, repository instructions, the complete branch stories, and all
20 assigned report findings. Inspect each finding against this cumulative base.
Assigned: HUB-110, 111, 112, 169, 170, 171, 254, 113, 114, 115,
081, 160, 161, 162, 163, 164, 165, 166, 167, 168.

Root library search still creates every result's skill bar. Each build row scans
all names. Each team row serializes the full library before any apply intent.
Selection updates every option. Explicit close retains the full result DOM.
Source subscription notifications refresh synchronously, including opening reads.

## Verification and boundaries

Offline frozen dependency install passed. No player store is changed.
People hosted Application verification run 36802806816 failed at Audit dependencies,
before runtime checks. This is the existing stack audit blocker; preserve the gate.
Live game, input feel, VoiceOver, and AZERTY cannot be verified here.
Run one Playwright suite at a time, with two workers. Full browser suite waits
for integration. Restore the temporary test port before committing.

## Open decisions

Keep every handoff section 10 decision open. D-15's two announcements govern
search/feed chatter; inspect explicit action refusals before removing existing
feedback. Do not silently discard a meaningful failed action announcement.
The VIS-29 story requests team row 500. Check the real fixture: the library-size
parameter expands builds, not necessarily teams. Record any correction.

## Struggles and review notes

Two guessed owner paths were absent (`src/renderer/hub-library.ts` and a styles
subdirectory). Used `rg --files` to find the existing owners. A combined source
read exceeded its output budget; repeated the library reads in bounded sections.
No product conclusion relies on truncated source.

## Work in progress

The following sections preserve the investigation history. The final finding
outcomes below supersede intermediate classifications.

Initial regression run: three real browser failures on the unchanged base. Root
`m` rendered 502 builds, an arrow wrote 503 row attributes, and explicit close
retained the result DOM. Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-red.log`.

The scale fixture has one team per twenty builds (plus existing teams), so team
row 500 does not exist. Use a scoped build's stable identity for the burst proof.

HUB-110 uses the existing `showRows` owner with an optional initial query. This
single new argument is required to carry a root search visibly into the complete
Build Library. No new store, process, or adapter is needed. Both root groups cap
after exact-first sorting. Team revision capture happens only for direct apply;
review and apply retain their existing freshness guards.

HUB-111 regression failed with 20 immediate searches for 20 notifications, four
synchronous opening searches, and seven by the following frame. Typing correctly
ran synchronously. Source notifications now queue one frame; an explicit query or
opening consumes and cancels it. Async template completion remains a real new-facts
refresh. The opening-count probe delays that external boundary by one second so
it measures opening, rather than conflating a later template answer with opening.
Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-refresh-red.log`.

HUB-254 regression measured 10,030 nodes in the unopened workspace (fails <500).
Keep the controller and outer native-window refs mounted: existing decorative
frame and resize hooks attach on component mount. Lazily materialize only editor
content on its first opening, and retain it thereafter. Each team build select
keeps its current option, then materializes full choices on focus. This prevents
lazy rendering from destroying drafts or losing the established window hooks.
Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-workspace-red.log`.

Five independent semantics scenarios failed on the unchanged accessibility base:
missing status role/count, Home count, verbose build names, unnamed child dialog,
and silent child cues. Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-semantics-all-red.log`.
Reuse the persistent Hub announcer for the 500ms settled count. Keep explicit
navigation announcements and named action failures; feed chatter does not gain
a second stream. Build names stay intact; skills become descriptions. Root groups
keep the visible headings and layout. Empty copy moves outside the listbox.

A targeted typecheck found a nullable-library use in the lazy selected option;
narrowed the render from actual availability. Two existing assignment tests read
full options without focusing the native select; changed their setup to focus,
then kept their persistence/refusal assertions. The first attempted adaptation
missed these different selectors; the focused run caught both, without skips.

Intermediate gate passed: typecheck, lint, links, 1,854 unit tests, 185 policy
tests, 265 Tools tests, and 82 Launcher tests. Ten current browser regressions
passed with two workers (`/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-semantics-green.log`).
This is an intermediate proof, not completion of the branch or all timing budgets.

HUB-081's real selected-conversation browser regression failed with no named log.
The visible selected transcript alone now has the log role; hiding the window
withdraws it. Messages still use the existing keyed transcript and draft owners.

HUB-168 testing struggled: importing a file URL encountered the test environment's
URL mapping; changing constructors did not solve it. Parsing HTML in happy-DOM
unnecessarily attempted localhost stylesheet requests. Simplified to the shipped
HTML raw-loader artifact and one bounded language-attribute check. This finally
failed for the real reason: missing English declaration. Log:
`/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-language-offline-red.log`. No dependency was added.

HUB-166 uses the rendered Hub name and page caption as the dialog label. The
caption becomes a heading without changing its visual styling. A hidden separator
preserves the specified accessible name `Hub — Settings`.

## Remaining work before publication

Measure actual timing and bursts at 1,000 builds. Prove HUB-169 separately without
relying only on code inspection. Decide optional HUB-170 from measured evidence.
Finish HUB-114, 115, 160 (Travel semantics), 162, 163, 164, and 165. Inspect the
real interface. Update owning documentation; run final gate and touched browser
specs. Restore port 4179; review the complete diff; commit, push, and draft the PR.
No findings are finally closed yet. No Performance PR exists yet.

Latest current gate passed with 266 Tools tests (the added production HTML
language regression), plus 1,854 unit, 185 policy, and 82 Launcher tests. All
eleven browser scenarios passed. Logs: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-current-check.log`
and `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-current-browser.log`. Next proof measures actual
frame/entry budgets; do not infer timing from the passing behavior tests.

## Timing failure: do not call this finished

The isolated real-browser timing scenario passed root typing and next-frame
limits (<32ms), but complete library entry measured **120.3ms**, above the
100ms acceptance limit. The later long-task assertion did not execute after this
failure; do not claim that long tasks passed. Log:
`/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-budget.log`. This is a useful remaining regression.
Profile the cost before adding a render cache, virtualization, or another owner.
The current full gate passed; eleven behavior/semantics browser tests passed.
The twelfth timing test intentionally remains red. No Performance commit or PR
has been created. Temporary browser port 4188 remains in this worktree only.

Continuation classification: the previous turn made product changes and obtained
a failing timing proof; it was progress, not a wait or a status-only turn. Rechecked
the current worktree and ledger before continuing.

A temporary offline browser CPU profile measured 128.9ms entry under profiling.
The profile alters the result; this is not a performance pass. Largest sampled
JavaScript costs were row construction, `buildAttributes`, and profession icons.
The attribute helper scans all 40 attribute labels separately for each of ten
professions. Simplified the existing owner to scan once and group invested ranks,
preserving canonical profession/attribute order. Its existing public behavior test
covers ranks, zero omission, names, order, and art. The failing entry-budget test
protects the actual performance requirement. Removed the temporary profiler.
Evidence: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-cpu-profile.json`,
`/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-measured.json`. No render cache or virtualization added.

The metadata simplification reduced isolated entry to 108.5ms, still above 100ms.
Kept the test red. Next remove unneeded false skill-marker attributes (only true
markers have CSS or test consumers) and build sections detached before publishing
them once. This preserves every row, skill bar, pointer action, and accessibility
name without a cache or virtual list.

HUB-170's unchanged-row regression failed: narrowing `build healer` to
`build healer d` disconnected the existing Deep Healer 0008 node. The shell now
reuses matching nodes from the current list, using its existing painted-facts
comparison. No persistent row cache is added. Pointer events are delegated to
the list and look up the current canonical row, so retained DOM cannot execute
stale closures. Modified shortcut bindings still recreate rows.
Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-keyed-red.log`.

Twelve behavior/semantics/reuse scenarios passed. In their concurrent run, the
timing scenario hit a 44.8ms next-frame outlier, while entry was 99.3ms. Reran
that scenario alone with `--workers=2`: all strict assertions passed, entry
96.2ms and maximum next-frame time 23.1ms. Record this timing flake; do not hide it
or weaken thresholds. Logs: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-keyed-green.log` and
`/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-keyed-budget-alone.log`.

Independently proved HUB-169 by restoring only its eager team revisions and
per-row duplicate-name scans, retaining all other optimizations. Entry regressed
to 168.9ms and failed the 100ms assertion. Restored the exact optimized file after
that terminal run. Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-169-red.log`.

An automatic approval review timed out before one authorized browser command
started. Retried it once under the same offline, dedicated-worktree scope and
it ran. This was an approval timeout, not evidence of an unsafe action.

Real Classic Settings inspection at 1280×720 confirmed the current layout and
missing checkbox descriptions. Clicking the visible Switch Character row title
actually started capture; cancelled that fixture-only capture with Escape.
The browser regression also failed on Resign's missing description.
Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-settings-red.log`.

HUB-115 reuses rendered names and descriptions via labelledby/describedby.
Multi-control rows are divs, preserving each button's own action name. The
existing focus restoration now uses a direct control's setting label, so removing
aria-label cannot lose focus after saves or external repaints. Default Reset
uses the existing semantic shortcut comparison. Invalid feedback reuses the
canonical capture hint; reserved feedback remains distinct (Back keeps its
specific name). Corrected only the finding's Xunlai Storage capitalization.
Needs design decision: neutral reserved/invalid capture wording, unless a later
copy review specifies different wording. No player shortcut was migrated.

The first Settings post-fix run passed description, title-click safety, default
Reset, and invalid feedback, but its reserved test used Command-R. Current
`shortcutReserved` deliberately does not include R (the handoff leaves D-9 open),
so the fixture saved it instead of refusing it. This was a mistaken test input,
not a reason to change the unresolved shortcut contract. Changed the test to the
existing reserved Command-C chord. No actual player shortcut was touched.


One command this continuation used the root pnpm wrapper with an extra `--`.
That separator stopped Playwright from reading the spec/worker options. It
started 663 scenarios with five workers. Stopped only that invocation with
SIGINT before it completed; no source was edited while it ran. This violated the
requested suite limit. The full integration suite still must run to completion
once with two workers. Correct subsequent command: `pnpm --filter
@gwonmac/tools-ui exec playwright test -c playwright.config.ts
hub-scale-a11y.spec.ts --workers=2`. This execution mistake needs independent
review; it is not a successful verification run.

The two new focused scenarios both failed against the old code: Trade's summary
was live, and Travel had zero named groups. Reused their existing presentation
owners, without changing the layout or stored data. Character switching now
mounts a plain container in the Hub; its standalone owner still registers a
native dialog. Carousel options expose their ordinal/total and orientation.
Repeated pointer movement over the already selected root row no longer repaints
its footer. Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-semantics-red.log`.


Correction to the earlier semantics RED claim: the initial new scenario failures
were caused by incomplete fixture setup, not yet a valid reproduction. Added
readiness waits, respected Trade's close-Hub shortcut route, and waited for
Travel. Trade's passive count/value test then passed. The combined Travel and
Characters test reached the new semantics and caught my wrong expected total:
five cards are visible in the carousel, but the complete collection has seven.
Use literal seven for this fixture, matching the canonical collection.
Independent backout RED proofs still required for HUB-160/162/163.

HUB-114 root status failed visibility while empty. Reused its existing node and
kept empty statuses visually hidden, rather than display:none. Maps mounts its
status before asynchronous settings arrive. Settings shares the same empty CSS.
A passive receipt still uses its existing top-layer popover, with one persistent
screen-reader-only sibling for the absent popover's first message. The visual
receipt is aria-hidden to prevent double announcements. This adds presentation,
not another action/receipt policy. Named action failures stay available. Strict
D-15's exactly-two-total interpretation conflicts with these required statuses
and HUB-162's connection status; keep that literal interpretation deferred,
while removing per-arrival Trade count and per-step opacity chatter.


HUB-164/165 new regression scenarios failed before the fix. Real Classic Settings
at 1280×720 and 940×500 showed Home's focus outline directly against the text,
with the halo clipped by the breadcrumb scroller. Added only the specified
padding, positive outline offset, and scroller space for the existing halo.
The lock now has one name and pressed state. Shift changes its existing move
step from 16 to 48 pixels. Its existing window owner inserts a compact visible
move hint beside the lock while unlocked; the supplementary context gives that
space to the hint. Footer geometry is unchanged. Needs design decision: this
neutral hint wording/placement was not specified beyond being visible.
Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-chrome-red.log`.


Current gate passed: typecheck, lint, links, 1854 unit, 185 policy, 266 Tools and
82 Launcher tests. Real after-inspection at 940×500 in both Classic and Modern
confirmed space around the focused Home breadcrumb and a visible move hint.
The footer stayed in place. Restored the browser's temporary viewport override.
A development reload returned the inspection tab to Home; one stale Tools-button
press failed, then I inspected/reopened the actual current Settings view.

Timing proof review found a weakness: PerformanceObserver delivery is
asynchronous, but the existing probe disconnected immediately after one frame.
Its empty longTasks result was not sufficient evidence. Added a bounded wait
and takeRecords before disconnecting. All earlier no-longtask claims are
unverified until this corrected probe runs. This is a test-evidence correction,
not a product fix, and must be checked independently.


The corrected isolated budget probe FAILED: root typing was 26.6ms maximum and
next-frame latency 28.7ms maximum, but complete Library entry was 115.3ms with a
169ms long task. This is real remaining HUB-169/BLD-33 work, not a passing flake.
Prior isolated 96.2ms entry cannot override it. The current direct optimizations
remove quadratic name/revision work and retain unchanged rows, but still build
all 1000 rich row DOM nodes before publishing the complete Library. More careful
lazy rendering/virtualization may be needed; preserving accurate scroll height,
focus, accessible option positions and all pointer commands would need its own
proof. I have not achieved that requirement. Defer complete-library <100ms and
no >50ms task; do not mark HUB-169 fully closed. The root budget still has strict
assertions with observer delivery fixed. Complete entry is attached as diagnostic
evidence, without a false passing assertion. This removes an explicitly deferred
requirement's failing test rather than skipping or weakening a claimed guarantee.
Log: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-honest-budget.log`.

VIS-27's first-versus-20th ±20% ratio is also left unclaimed: very small cold and
warmed durations are unstable across host scheduling/JIT. Added a real 20-cycle
public-behavior test for one pass per open/resume, absolute limits and empty DOM
on close. Keep the exact relative timing acceptance deferred, with this reason.


Independent backout regressions now prove HUB-160 (zero Travel groups), HUB-162
(Trade summary live again), HUB-163 (one nested native dialog), and HUB-112
(repeated selected-row hover caused five footer DOM mutations). Each isolated
run used two workers. Restored the exact optimized source in finally before the
next run. Logs: `/var/folders/cw/90shxw3964q2rcs_j_nvt_cc0000gn/T/codex-hub-perf/codex-hub-perf-{160,162,163,112}-independent-red.log`.

The 20-cycle probe initially omitted required HubSource methods. Its successive
runtime errors exposed missing subscribe/setVisible; I then read the complete
contract, supplied its required observation methods, and used satisfies HubSource.
Also checked the actual Hub presenter: resume uses show(), not the guessed toggle().
These were test-harness mistakes, not product regressions. Avoid claiming the
cycle proof until its corrected run passes. The concurrent root timing flake
recurred (43.3ms paint, 22.7ms synchronous typing); its next focused run passed:
27.2ms typing, 30.7ms paint, zero root long tasks. Complete Library remained
101.9ms entry with a 139ms long task, consistent with the recorded deferral.

Stopped the owned 4633 visual preview and closed its tab after both-style compact
inspection. Unrelated browser tabs, services and live game sessions were preserved.


The touched-spec run passed 99 scenarios and exposed five failures. Two are
regressions introduced here: global Settings resume still identified controls by
aria-label after HUB-115 replaced it; added the actual canonical setting label to
the existing focus owner. The content-visibility fallback guessed a 46px content
height for ordinary people rows, changing restored scroll from 400 to 368 pixels.
Removed that speculative optimization. Defer HUB-112's offscreen containment
sub-requirement until accurate heights across styles/fonts/wrapping have proof.
The bounded old/new selection and unchanged-hover fixes remain.

The other failures include legacy fixture assumptions: the canonical Romi row is
friend:romi (not person:...), and complete Library's first group already holds
teams in the base. The template-folder test must select its named folder rather
than press Enter on the first team. No product order was changed for that test.
The new empty-message node is correctly hidden when matches exist; its DOM text
still exists, so the invite test now verifies its visibility rather than raw
textContent of the whole dialog. Further bare-whisper assertions are still being
checked against their actual canonical owner. No failing test was skipped.


Four failed follow-ups now pass after the real focus/scroll fixes and targeted
expectation corrections. The bare whisper case then reached its next stale
assertion: the current canonical continuation explicitly says Reply to Romi
Ranger and opens the existing draft. The base People owner already owns that
behavior; no product code changed it here. Updated the scenario to verify that
honest action and the visible draft, then resume Home for the remaining scope
checks. Test setup sends no whisper. Added the VIS-29 workload with actual build
row 500, 40 incoming fixture events over five seconds, selection identity and
bounded arrows. The supplied team-row-500 story is impossible with this fixture.


The latest touched-spec run passed all 104 existing/new scenarios except the new
burst setup. Its bare `build ` query intentionally offers Browse builds, so no
scale-500 row existed. Read the canonical source and changed the setup to open
the complete Library; no product contract changed. Its workload still needs a
passing run. Also removed the remaining implicit-live whisper opacity output,
keeping the exact existing value typography and using percentage value text on
the native slider. The opacity scenario covers it through the real Chat options.

The final repository gate passed before that last whisper opacity markup edit:
1854 unit, 185 policy, 266 Tools, 82 Launcher, with typecheck/lint/links. Rerun the
relevant gate after the markup change. The previous 104-pass run proves the
corrected twenty-open/resume scenario and every earlier failed scenario.


The final incoming-burst workload passed: deep build identity remained selected,
all ten arrows stayed within four row mutations, and no measured burst long task
exceeded 50ms. The expanded opacity test initially tried Command-D after closing
Settings, which restored a text field in Trade. Corrected the setup to use the
existing explicit whisper row, then inspect Chat options; no shortcut policy
changed. This is another harness setup mistake recorded for review.

I reread the handoff's scratch rule and found these runs used /private/tmp rather
than its required per-branch TMPDIR folder. Moved the owned Perf logs into
$TMPDIR/codex-hub-perf and updated this ledger's paths. No shared scratchpad or
player store was touched. The timing test now writes its generated artifact in
its existing Playwright output directory instead of a fixed global path.


Correction: my initial diagnosis of the Chat options timeout was premature. The
actual browser snapshot exposes its existing summary as a generic named element,
not role=button. Existing tests already use getByLabel('Chat options'). The
explicit conversation route reached the visible draft correctly; changed only
the locator to the real label. I should have read that snapshot before blaming
shortcut routing. No evidence establishes the earlier shortcut hypothesis.


## Finding outcomes before publication

The report assigns complete Library entry <100ms and row containment to HUB-112.
HUB-169 specifically owns quadratic duplicate-name/revision computation. Its
prescribed fixes and independent backout are complete; the earlier assignment
of the full Library render budget to HUB-169 was too broad. Classify HUB-169 as
closed, and retain the measured full-row rendering deficit under HUB-112.

Closed: HUB-110, HUB-111, HUB-169, HUB-170, HUB-171, HUB-254, HUB-113,
HUB-114, HUB-115, HUB-081, HUB-160, HUB-161, HUB-162, HUB-163, HUB-164,
HUB-165, HUB-166, HUB-167, HUB-168.

Deferred: HUB-112's complete Library entry <100ms and content-visibility subpart.
The old/new row selection and unchanged-hover parts are implemented and proved.
A guessed intrinsic height broke scroll restoration, so it was removed. The
remaining 1000-row rich DOM publish exceeds the measured budget; preserve all
bars and existing interaction semantics rather than claim this is resolved.

Extra story limits not claimed: VIS-27's 20th/first ±20% ratio; literal VIS-31
exactly-two-total live regions, which conflicts with required connection and
named action failure feedback. Twenty cycles satisfy one pass per transition
and absolute timing limits. A 40-event/5s complete Library burst passes with
stable deep selection, bounded arrows, and no >50ms task. Build ARIA names keep
the exact player-owned name, so a name itself containing more than twelve words
remains intact; no stored names were rewritten to force a word budget.

Needs design decision: neutral invalid/reserved shortcut wording and unlocked
move-hint wording/placement. Preserve all six handoff section 10 decisions.

Independent review priorities: the remaining complete-Library render task; any
future row containment must prove scroll stability across styles/fonts; the
exact interpretation of D-15; and the test setup mistakes/incorrect early
performance evidence above. This result can be better at scale. I have not
solved the full rendering budget, and these notes must not be mistaken for
acceptance of that missing work.


Final diff review found that a missing saved build reference could produce an
empty cold-picker option. Require the existing canonical build lookup to succeed
before rendering that option; invalid assignments keep their existing issue
feedback. No stored reference is changed. Removed a duplicate test-file header
comment. The final gate must include this guard.


Final touched-spec run: 104 passed, with one root next-frame outlier at 46.4ms.
Reran that scenario alone with --workers=2 and its strict assertions passed.
Keep this repeated wall-clock timing flake visible in the PR. All 105 scenarios
now have passing final-source evidence; no test was skipped. Logs in the branch
scratch directory: touched-browser-final.log and root-budget-final-alone.log.
The passing scale measurement is retained as accepted-root-timings.json; it
continues to record complete Library long tasks rather than assert that they pass.


## HUB-112 complete Library entry (closed)

The deferred complete-Library budget is now met without guessed heights. The
Hub paints the first 50 rows of a list at once and the rest 50 per animation
frame. Selection (End, PageDown, pointer, restored selection) paints through the
row it needs first, and a rebuilt or restored list paints until it reaches its
scroll position. With 1000 builds, three runs measured entry 20.9, 16.2 and
16.4ms with no long task in the next 100ms (before: 110.1, 101.6 and 105.2ms
with long tasks of 140-150ms and 185-207ms). The scale test asserts entry
under 100ms and no library long task over 50ms again. A new regression proves
End selects and shows the last unpainted build, and Back restores a deep scroll
position below the first painted rows.
