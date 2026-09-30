# Hub polish: Trade ledger

Date: 2026-09-30. Branch: `fix/trade-keyboard-and-identity`.
Base: `feat/hub-actions-and-footer`. Draft PR pending completion.

## Intake

Read AGENTS.md, the Trade story, its 22 plan findings, the audit fix text,
the current Trade owner and all inherited modifications before making changes.
The handoff says 28 uncommitted files. Intake found 26 tracked modifications
and one untracked browser spec, 27 total. No branch commit existed beyond its base.
The new popout spec passed all 18 tests, and the inherited code passed `pnpm check`.
These passes did not establish completion: visual inspection found mouse-opened
Actions left focus on the game canvas. The prior tests covered keyboard opening only.

Read large diffs in smaller sections after combined output was truncated. This
was a review-efficiency weakness; do not treat truncated output as a completed read.
The new keyboard story explicitly chooses Trade Return = prepare whisper and
Command-Return = listings. It takes precedence over older audit text which says
Return opens a narrow detail sheet. No message is sent by preparing a composer.

## Fixes and proof

Mouse Actions now uses the same opener as Command-J and focuses its first item.
Right-click selects the named offer, then opens that same menu without contacting
any seller. Extended the existing HUB-131 browser regression; it failed at the
mouse-focus assertion on the old behavior and passed after the fix.
An AX button locator did not find the native summary. Inspected the DOM snapshot
and used the observed summary selector. No product behavior was inferred from that
locator failure. Inspected wide Classic and 608-pixel Trade before changing the UI.
The temporary browser tab was closed and its viewport reset.

The inherited copy toast contradicts HUB-122's instruction for inline feedback.
One existing notice owner now shows copy outcomes on their menu action and preserves
focus and footer/list geometry. Clipboard refusals use the error tone and stay until
the next report. Saving and following use their existing selected state, not a toast.
A delayed copy names its original author after the selection changes. Both new unit
regressions failed without their respective fixes and passed together (23 Trade tests).

## Hosted verification and limits

Pins draft PR 477 is verified on its exact base. Its actual Application verification
run 36771373466 failed before runtime tests at the unchanged dependency audit:
45 findings, 14 high with one ignored. Updated its draft body with that run link.
This remains an integration blocker; do not weaken the audit or mix unrelated
upgrades into this UI branch. Live game, input feel, VoiceOver and AZERTY remain
unverified. All six handoff section 10 decisions remain open.


Mouse copy initially passed its inline-label check but left focus in the canvas.
The next Back press then bypassed the menu. Focus the clicked copy control before
awaiting the clipboard; the complete existing copy journey passed after this repair.
The primary Whisper button now ignores trailing double-clicks. Its regression
recorded three composer requests instead of two before the guard, and two after it.
The extended focus-return regression failed after a mouse-started Whisper: closing
its composer did not return to its button. Focus the trigger before dispatch, so the
existing Whispers return owner captures the real opener. Keyboard and mouse pass.

The 122-test touched-spec run first had one stale expectation in HUB-120: mouse
Actions was expected to keep the game focused. The story explicitly requires focus
on the menu, then its trigger on Escape. Corrected that assertion; all 122 passed.
This was not a timing flake. Classic wide (1280 × 720), Classic narrow (672 × 552),
and Modern wide previews preserve the original look and show the menu over the
ledger. Closed the temporary browser tab, reset its viewport and stopped its server.

The local gate caught my use of `--ui-accent-text`, which does not exist on this
branch's Actions base. Use the existing neutral bright-ink token for the menu check.
Integration must review that choice against the legibility branch's actual token.
Replaced only newly introduced numeric sizes with equivalent existing spacing and
control tokens. Removed inherited stale-row opacity: a warning edge marks stale
rows while their text retains full contrast. The exact warning-edge treatment
needs design review; it does not introduce a new colour.

The offline Electron test exposed a real production-only first-open focus race.
The browser fixture mounts Trade immediately; production loads its bundle lazily.
The old one-frame focus request ran before an input existed. The existing lifecycle
now keeps that pending request through mounting and cancels it on subsequent input,
close, disposal or another tool activation. Extended the existing HUB-225 test with
late mounting and game/Hub cancellation. It passed all three routes. The new fixture
flag is `trade-load-ms`. No stored placement or preferences are written by this fix.
The initial Electron failure is retained as red evidence; its isolated final rerun
passed (one test, 8.4 seconds).

## Finding disposition

Closed within the tested offline boundaries: HUB-013, 118, 121, 024, 025, 131,
230, 117, 119, 122, 123, 124, 125, 126, 127, 129, 132, 225, 226, 227 and 229.
HUB-108: stacking is closed; automatic side-by-side composer placement is deferred.
Trade fills most of a 1280-pixel viewport, and small viewports have no spare column.
Neither the story nor the finding defines which saved position to override, how to
restore it, or what should happen when both windows cannot fit. Preserve placement
and defer that material choice rather than silently moving the player's windows.

## Needs design decision

- HUB-108: choose placement and narrow fallback for a composer opened from Trade,
  while preserving the player's stored placements.
- Review the neutral inline clipboard refusal wording and the stale-row warning edge.
- Review neutral bright ink for the menu check after legibility integration.
- All six handoff section 10 decisions stay open.

## Limits and review weaknesses

No live Guild Wars, input feel, VoiceOver or AZERTY check was performed. The real
Electron fixture proves physical shortcut claiming and renderer ownership only.
The browser uses offline messages and cannot prove market freshness or seller presence.
I missed the mouse focus path until expanding the complete copy journey. I also
assumed the preloaded fixture represented lazy production mounting. The extra
Electron proof disproved that assumption; review deferred focus cancellation closely.
Large output truncation and incorrect fixture filenames cost additional inspection.
The handoff's count of 28 uncommitted files was incorrect: intake had 27.


## Regression reversal record

Each reversal uses an exact file backup and a `finally` restoration; no stash or
player data is involved. Browser reversals run one suite at a time with two workers.
Confirmed failures: 013 seller replacement; 118 saved-offer owner; 121 navigation;
230 prices search; 129 refusal; 108 stacking; 225 entry; delayed focus; 125 hidden
count; 124 query icon; 229 accessible name; 126 actual prior row layout; 127 actual
prior ledger sizing; 123 menu flow; 119 reconnect label; 226 highlighting; 117 local
Slash. Existing clipboard-error test now advances the mocked clock past 3 seconds:
it fails with the old unconditional timeout, and passes with persistent failures.

Two first attempts were insufficient: removing only `runSearch`'s saved flag clear
still passed because new-result selection also fixes the stale inspector. Reversed
both parts of that one owner, and the existing saved-offer journey failed correctly.
The first 229 attempt ran a test that checked inspector buttons rather than row
names and passed. Ran the existing journey that locates its row by its full public
name; that failed correctly. An exaggerated row-height mutation caught density,
but was not a reversion of the fix; replaced it with the actual previous three-row
layout. These attempts are not counted as proof of the corresponding fixes.


## Final verification

Six touched Tools browser specs pass together: 122 tests, 2.7 minutes, two workers,
no concurrent Playwright suite. The earlier stale HUB-120 assertion was corrected;
no failure in the final run required a flake rerun. Offline Electron Trade input
passes alone (one test); development build passes. The full Tools browser suite
has not run and remains reserved for integration.

The preceding complete local gate passed 1831 unit, 185 policy, 263 Tools and
82 Launcher tests, plus types, lint and links. The repeat after the lazy-focus fix and clock assertion also passed with those
counts. A final review then caught missing trailing-click guards on the new
Show listings button and menu actions, requiring another delivery gate. Its result
is recorded below.
The temporary browser port was restored from 4185 to 4179 before committing.
The five-cell inherited keyboard golden diff matches Trade entry, Command-J and
Whispers returning to canvas. It will be regenerated at integration, as directed.


Final review missed the handoff's literal trailing-click rule on two new paths:
Show listings and the generic Actions runner. Extended the existing listings test
with second-click refusal at both public buttons; it failed when a second click
started another feed search. Added the inline listings guard and one guard in the
existing action runner. All 23 Trade unit tests pass, including that extended
journey. This late catch caused another gate run; it is a review-efficiency weakness,
not a reason to claim the earlier passing gate covers the new guards. At that point, the final
18-test Trade popout run and delivery gate were pending; their results follow.


The complete staged review caught further new search/history/retry controls that
needed the same trailing-click guard. Audited all new click handlers together and
applied the rule to each action boundary; kept existing idempotent source/filter
controls and row selection unchanged. The Trade search form also submitted on
Shift-Enter. Extended the existing loaded-filter browser journey with all four
modifier chords; it failed on the actual Shift-Enter submission, then the search
keydown now refuses modified Enter. Held Enter remains owned by the existing
surface controller; no second repeat guard was added to the form.

Review weakness: I gated before finishing one complete input-contract review.
That led to several additional full checks after late catches. This is avoidable
review cost; a later reviewer should inspect the final guards as a whole and the
lazy-mount cancellation rather than rely on the initial green fixture run.


Delivery gate on the final guarded source passed: type checks, lint, links,
1831 unit, 185 policy, 263 Tools and 82 Launcher tests. Final development build
passed. The final Trade popout run passed all 18 tests in 14.7 seconds after the
modified-Enter guard. The six-spec 122-test run passed before those final guards;
the changed Trade spec was rerun afterward. No full browser suite ran here.
The final code was restored exactly after each regression reversal. Port 4179
is restored for delivery. Publication remains a draft on the exact Actions base.


Final exact-build offline Electron input rerun passed (one test, 3.2 seconds).
The independent Actions trailing-click reversion also failed at its menu search
assertion, then passed after exact restoration. This proves both entry paths in
the extended listings regression rather than relying only on the primary-button
failure. Core outcome commit is `fix(trade): preserve seller identity and keyboard ownership`.
