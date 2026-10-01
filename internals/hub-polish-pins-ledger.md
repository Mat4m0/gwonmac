# Hub polish: Pins and phrases ledger

Date: 2026-09-30. Branch: `fix/hub-pins-and-phrases`.
Base: `feat/hub-actions-and-footer`. Draft PR preparation follows final review.

## Intake and handoff corrections

Read all five inherited commits and the six modified files before editing.
The handoff says seven modified files; there were six. No separate Pins branch
or story file exists in plan.json or stories. The assigned findings remain
under Search. Read that story file and the individual audit findings.
SRC-29 asks movement across storage owners. The handoff and HUB-090 require
two labelled groups, so the handoff wins. No stored pins moved across owners.

## Changes and findings

- HUB-061: existing global place phrases now resolve in Home, travel scope,
  and detailed Travel. Read the global references through the existing Travel
  preferences owner. Keep global phrases exact. No migration or mirrored write.
  Keep Travel's stored phrases and global phrases in their existing stores.
- HUB-062: the unfinished exact-name check now rejects Maps and friend names,
  existing saved phrases, and stored Travel phrases inline, by target name.
- HUB-090: the inherited groups and Move down preserve owner boundaries. Fixed
  edits that moved a pin to the end. Each store retains its own 64-entry limit;
  the previous aggregate check refused valid lists with 64 global and 1 library
  entry. The existing owner predicate now has one shared definition.
- HUB-091: scoped keepable rows retain Pin and Set search phrase in Actions.
  Mounted views now use the same Actions menu, including Command-J, instead of
  replacing the slot with Remove or Keep. Right-click selects the named preference
  and calls the same footer-owned menu. No new menu owner or navigation state.
- HUB-092: inherited named, armed Remove/Remove-all confirmation keeps data on
  Cancel. Late confirmed mutations cannot navigate a later page.
- HUB-152: inherited form labels, inline errors, draft restoration and Command-Enter
  are retained. Save uses the existing task boundary. A late result becomes a receipt.
- HUB-177: canonical lookup rows retain the source row's presentation and navigation.
  The specified Commands, Settings, and Switch Account utility pins now pass the
  closed validator and persist through reload. Account search and lookup share one row.

## Proof and difficulties

Cross-surface place phrase, fixed view Actions, delayed phrase save/order, utility
pins, and per-owner limit regressions failed on the old behavior, then passed.
The delayed-save test initially failed a broad combobox locator that also matched
fixture controls. Narrowed it to the Hub input; the product assertions already passed.
An arrow-function object needed parentheses; its syntax error prevented fixture
startup. Fixed it before continuing. Exact optional property types required actual
booleans for menu metadata. No casts or widened application types were added.
A reload initially raced the final fixture save. Wait for the stored order, then
reload. Utility Commands and Settings have no arrow cue in their search rows;
the pin test now preserves that actual behavior rather than inventing a cue.

The phrase policy moved from renderer presentation to shared preferences because
both the editor and Travel read it. Updated its only test import and removed the
old definition. Integration must use Search's parser for grammar aliases such as
`tp`, and Calculator's exported unit aliases; do not add a second alias table.
Pre-existing phrase conflicts between the two stores must remain readable and must
require deliberate selection. Their cross-source priority needs integration proof.
No stored data can be rewritten to make that proof easier.

## Visual inspection and design decisions

Inspected the real fixture at 1280 by 720 and 500 by 700. The phrase field's label
stands above it; Command-Enter returns to Home and restores search focus. Preferences
uses the same compact Actions menu with a named primary and existing secondary.
The older base footer wraps at 500 pixels; carry this observed defect to integration,
which must include the Legibility footer fix. Do not claim the narrow footer passed.
The existing menu groups are reused. A view's secondary appears under Details;
its group label was not specified, so list that neutral choice for design review.
The missing separate story and SRC-29 conflict are handoff errors, not new product choices.
The six open handoff decisions remain for Matthias.

## Verification and delivery

`pnpm check` passed after the implementation. Final counts and targeted browser
results are recorded after their completion. Only four touched Tools browser specs
run here, with two workers and no overlapping suites. The full suite runs once at
integration. The temporary port must be restored before committing.
The temporary UI tab was closed, its viewport reset, and its preview server stopped.
Live game, input feel, VoiceOver, and AZERTY remain unverified. Persistence changes
need Beta consideration in the combined train. No publication or PR merge occurred.
Travel PR 475 also failed before runtime tests at the unchanged dependency audit;
its body now links the actual run. Carry that hosted integration blocker.

Final repository gate: type checks, lint, links, 1,832 unit tests, 185 policy tests,
260 Tools Vitest tests and 82 Launcher tests passed. The four touched browser specs
passed all 196 tests with two workers. The first 196-test run passed 195; Settings'
Actions-disabled expectation predated utility pinning. Corrected it to test the
pinnable result and the mounted Settings page's disabled Actions separately.
Right-click initially failed to open Kaineng's Actions; its new regression now passes.
While extending that regression, the test used an abbreviated Kamadan name. Another
test sent Escape to an unfocused search input instead of the focused menu. Fixed
both test mistakes; these were reproducible locator/input errors, not flakes.

Mutation checks separately restored the old scoped-pin guard (091), crossed owner
neighbours (090), reset without confirmation (092), and refused Command-Enter (152).
Every targeted regression failed at its relevant behavior. Each source was restored
in a finally block before continuing. Earlier red/green checks cover 061, 062, 177,
per-owner limits and pin-edit order. These fixture tests do not certify the native game.

Use `gh stack view`, not `gh stack status`: the installed extension has no status
subcommand. Its help response did not modify the stack; init adopted this sibling
with the exact Actions base. Remote references were refreshed before diff review.

The delayed-save mutation was tested independently of order preservation: removing
only `task.live()` returned Commands to Home after the save. The regression failed
at that exact page assertion; source restoration keeps the same pin order and page.

All five restored mutation regressions passed together. Restored the temporary
Playwright port to 4179 before staging.
