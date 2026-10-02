# Hub polish integration ledger

## Starting state and authorization

- Worktree: gwonmac-hub-integration; branch integration/hub-polish starts at origin/main eae3eed6 (#459).
- Read this worktree AGENTS.md and docs/README.md completely. Handoff section 9 explicitly authorizes local integration merges. No GitHub PR merge, main checkout edit or release action is authorized.
- Sweep draft #484 is published, attached and confirmed on base fix/hub-visual-consistency; tip 62b89311de83b8adcfde433ded059b407c23c0f2. Its required checks passed; Classic bitmap hatch deferred.
- gh stack init initially ran from the Sweep worktree and refused its already tracked branch. No history changed. Repeat from the integration worktree, with main as trunk.
- Merge finished branches in handoff PR order; stop on conflicts, preserve both owners, regenerate keyboard golden at the end if conflicted.
- Full Tools browser suite will run once, alone with explicit --workers=2. Rerun failures alone; no source edits during browser runs.
- All player stores remain in place. Live game, input feel, VoiceOver and AZERTY remain unverified.

## Merge resolution: Travel and Characters

- Travel keeps Search's hubTier ranking, full catalogue and best-eight/more rows, plus Travel's LeaveArea callback, PvP checks, guild-hall location names and withdrawal handling. No second ranking implementation survives.
- Characters keeps Travel's removal of unreachable vertical/standalone footer selectors, with Legibility's accent-text token on both current-character text selectors. The remaining Visual typography will merge later.
- Large minified CSS reads exceeded output limits. Resolve from the exact staged incoming file and narrowly preserve both identified accent-text changes; recheck final computed UI and tests.

## Merge resolution: Pins

- Keep two existing stores and Pins' canonical shortcutStore, phrase validation, group order and same-row lookup; no migration.
- Combine Search commands(every) with Pins' explicit query for collision checks; every lookup still resolves hidden Home commands.
- Travel ranking reads preferences.searchSynonyms(query), so global exact phrases retain priority without bypassing hubTier. Reuse toolRow for search and lookup and preserve current refusal.
- Phrase editor retains Travel's availability predicate with Pins' store/form owner. Later People ownership must remain attached.

## Merge resolution: Trade, Calculator and People

- Trade keeps its market-independent raw query text/icon and the cancelable Whisper handoff. A caller cannot queue an unaccepted conversation.
- Calculator glyph painting coexists with current mounted-view navigation facts.
- People keeps source-lifetime withdrawal and closes view-menu snapshots when footer actions update; Pins keeps store validation and same-row pin variants on all pages. Phrase editing uses the Pins store plus the existing availability predicate.
- One Actions DOM menu remains. People viewMenuEntries supplies live view actions; Pins openActions capability calls that same owner for its context menu. Retain the capability because its preferences list is a real consumer.
- Team partial-receipt assertions retain completed/remaining detail and the captured footer primary; fixture footer gains the existing openActions capability.

## Merge resolution: Performance and accessibility

- Trade preserves its submitted-versus-typed history action and existing summary copy, alongside Perf's feed announcement changes.
- Travel keeps its small-catalogue/favorites visibility rule and adds the accessible group role; no spelling restyle.
- Characters retains Travel's sole Hub path, width-based carousel and switching veil. Uses Perf's embedded div (no nested dialog), full-list aria-setsize and absolute aria-posinset. Removed the auto-merged duplicate hub declaration and old standalone-layout branches.
- Settings retains Native's pending-capture cancellation while adopting the explicit reserved-shortcut refusal from Perf.

## Merge resolution: Visual

- Preserve Pins' phrase-save receipt assertion and Trade's Polar Bear query assertion.
- Keep Travel's resign icon alongside Visual's distinct command/person/account/invite glyphs.
- Preferences keeps the canonical shared reservation/store owner and gains Visual's icons. No duplicate calculator/grammar reservation tables return.
- Remove obsolete Maps import with Visual's direct Settings cutover.
- CSS combines Visual's type ramp with Legibility's accent-text ink, removes the deleted Characters private-footer selector and preserves hiding empty numeric cues.

## Merge resolution: Sweep

- Settings retry retains Native's disposal cancellation of a pending shortcut capture.
- Keep both Native's layout/Undo/disabled-chord unit scenarios and Sweep's sanitized Hub trace regression.

## Final merge and first compiler pass

- Frame-mask conflict only joined independent appearance tests. Keep both Legibility's composed pixel/hover proofs and Frame-mask's Modern border cut-out proofs; no keyboard golden conflict occurred.
- The final merge command continued to dependency installation/typecheck after its conflict. Those operations do not resolve conflict markers; the premature compiler found an auto-merged duplicate import. Complete merge, then fix compiler findings before any browser test.

- First complete Tools compiler pass caught an automatic duplicate teamRow (People's function and an older Perf const), one fixture footer missing Pins' openActions capability, and a Pins Travel test missing Travel's required confirmation callback. Deleted the obsolete const; the surviving function retains partial-result review, workspace action and lazy apply revision. Updated only fixture contracts.

## Integration behavior proof

- Search added the root Guild Hall row; Travel's later explorable-area confirmation only wrapped ordinary destination rows. The integrated root hall path still called host.guildHall directly.
- Added a public Travel-source test: reject the existing LeaveArea callback, then assert zero hall travel and unchanged explorable state. It failed with the unwrapped root action; reuse LeaveArea for that action, without a second prompt owner.

- The first repository gate passed compiler, lint, links, unit and policy, then failed two Tools tests. Pins' phrase test expected only the custom alias; Search correctly retains official aliases too. Expected literal is now kc, kaineng, home.
- The small-catalogue Travel test exposed my incorrect conflict choice: Perf's old v-if hid Favorites, but Travel's requirement keeps saved favorites beside available places. Removed the hide condition while retaining the accessible group role. This was a real integration regression caught before browser testing.
- Both loaded and lazy Travel tool rows now consume TOOL_PRESENTATION, completing the same label source at their real owner.

- Keyboard regeneration passed all 312 cases. Reviewed the 31 changed cells: final Library ordering/actions, Settings labels, Actions availability and Calculator clipboard format. The new calculator receipt embeds a wall-clock observation time; the matrix would compare different timestamps on every run. Normalize that bounded receipt field in the observer and regenerate only the affected calculator/Enter cell, preserving all action, focus and game-input evidence.
- Pins' deferred calculator alias integration exposed a real refusal gap: k, a, materials and full currency names were not reserved. Extended the existing legacy-data/editor test (red for k), then derive the existing unit list from Calculator's completed CURRENCY_ALIASES. All stored aliases still load; no store migration.
- Pins' deferred cross-store collision proof exposed another real safety gap: detailed Travel auto-selected Kamadan when both stored home phrases named different places. A public component test failed on that active descendant. Detailed Travel now uses the same combined aliases for exact ranking and initial selection; multiple actionable exact destinations require an explicit arrow/mouse choice. Both stores remain intact. The focused 41-test component suite passed.
- My new collision fixture supplied only hubShortcuts and failed the next typecheck. Reuse DEFAULT_SETTINGS in the test rather than casting an incomplete external settings value.


## Full browser run and isolated reconciliation

- Ran the full Tools suite once with explicit --workers=2: 748 cases, 708 passed, 40 failed. Preserved its result tree before isolated reruns cleared the output directory. Never ran the full suite again.
- Four initially suspected flakes reproduced alone: account completion, build-target hover geometry, blank-space geometry and an unfocused workspace selector. They were deterministic test-contract or interaction mismatches, not flakes.
- Reran all 40 failed cases separately, each with --workers=2. Every case now passes. The rerun driver checks that exactly one case ran and stops on a failure.
- Updated stale accessible Hub names, scoped search names, hidden-status assertions, old private footer hints, explicit Library folder selection, the Maps-to-Settings cutover, locked placement label, partial-team copy and Calculator's existing default conversion.
- Updated two pointer paths to use current visible geometry, without force clicks. The crossed build-target row must scroll into view; blank panel clicks stay within the panel, away from the shared footer.
- The workspace selector creates its choices on real focus. Focus it before selecting a build rather than inventing an unfocused user interaction.

## Additional red/green owner proofs

- HUB-004: delayed Show Launcher and Project website promises closed a newly reopened Hub. Public browser regression failed, then passed when both actions used the existing HubTask.done session guard.
- HUB-035: a late character failure omitted the attempted name and remained in private palette state on reopening. The existing public regression now checks the named receipt, attempted card and one shared outcome. Reset only the completed attempt; preserve upfront unavailable-path refusals.
- The character receipt's first green attempt still failed: direct page mounting erased the replayed shared receipt. Keep an existing receipt while mounting a direct view or rows; the attempted-card regression then passed.
- KEY-19: reopening a running team review showed an Enter keycap and lost its view busy state. Extended the existing public regression; it failed before HubViewAction.running fed the existing footer and busy owner. It now passes.
- HUB-061: both existing phrase stores could name different places with home. The component regression passed first, but the root regression exposed another gap: legacy lookup rows omit the custom alias, so counting hubTier exact names alone missed the tie. Count the same derived phrase identities in the existing selection decision. Home, scoped Home and detailed Travel now choose nothing until explicit input; both stores are preserved.
- The new collision browser test briefly raced the destination disclosure's asynchronous focus handoff. Wait for its search to be focused before filling it. This is test setup, not a claim of a product fix.
- HUB-242: Clear search could reuse a prior Travel destination click and execute a trip. The new public double-click regression failed. Query, mode and visibility changes now invalidate the existing pressed identity and modal click run; first presses on other controls clear the prior row identity. The regression passes with zero trips.
- HUB-072: extending the existing source test proved a resolved Travel notice remained carried. The existing notify capability now accepts a matching cleared outcome. A new public regression failed when that guard was removed: clearing Travel replaced a newer invite receipt. Restoring the guard passes and preserves the newer receipt.
- HUB-079/selection identity: a real WhisperSession feed update inserted a conversation ahead of the selected friend. The new component regression opened the wrong friend before the fix. Keep the canonical whisperPersonKey rather than a list index, and clear selection on return. The real component tests pass.
- The Whispers listbox now owns only person options through aria-owns, leaving headings and cleanup controls in their existing visual layout. Chromium's actual ariaSnapshot shows six options and no heading or button inside that listbox. This proves its browser accessibility tree, not VoiceOver speech.
- HUB-163: the merge had omitted Characters' horizontal list orientation while retaining absolute positions. The isolated public accessibility regression passes after restoring that attribute.
- The old native disabled-tool shortcut regression was still marked fixme despite the completed native claim fix. Enabled it for the final Electron boundary verification; do not claim it passed before that run.

## Review difficulty and limitations

- Conflict resolution was difficult across the Hub, Travel, Characters and CSS owners. I made one wrong Favorites visibility choice and initially missed horizontal orientation. Tests caught both. These sections deserve focused review.
- I twice used a repository-root relative path from apps/tools; those edits failed before changing files. One unnecessary character regression reran unchanged. Later commands use explicit worktree roots.
- Two narrow grep expressions selected no intended new case. Corrected the exact titles and verified test counts; neither empty run is counted as evidence.
- I initially chose the team-only Open in Build Library menu item from a build-target page. The existing workspace action belongs to the root build row; corrected the test interaction without adding a product route.
- The root collision's first proposed fix was incomplete. Derived phrase identity, not only alias ranking, owns its tie. Keep this distinction in future reviews.
- Arbitrary custom-palette AA, full 1000-build entry cost and Classic bitmap hatch remain areas where a better design decision is needed. I could not make a correct authorized replacement from the supplied rules; they remain explicitly deferred.
- No uncertainty is hidden as a successful live check. Live game, input feel, VoiceOver, physical AZERTY and signed exact-draft behavior require Matthias.


## Native verification and final review

- Touched eight Electron specs, 40 cases, with --workers=2: 17 passed initially and 23 failed. Preserved the first result tree; reran each failure alone. All 23 now pass, and the final Core Hub rerun passes without temporary stage markers.
- The existing confirmation test exposed a real Visual CSS regression: the rule hiding redundant Characters headings also hid the required confirmation question. Narrowed the selector to h2.ui-sr-only. The native regression failed before and passes after. Extended the existing Tools case at 1280 and 390 pixels; inspected both screenshots with Stay focused, the named danger action and common footer present.
- Reconciled old native dialog/search names, removed standalone Characters expectations and updated Command-R to the final Home contract. Native editing, clipboard, claim refusal and capture assertions retain their boundary checks.
- The Toolbox Escape test now waits for the real asynchronous focus handoff. The Resign test previously took a screenshot before its unarmed Enter assertion; that screenshot consumed the arming delay. Moved it after the zero-command assertion. These were test sequencing mistakes, not product changes or flakes.
- Updated the eleven older draft bodies that omitted explicit input-feel, VoiceOver or AZERTY limits. Freshly confirmed all 21 remain open drafts on their intended bases.
- gh stack tracks integration/hub-polish against main. Its stored local trunk tip is older than the fetched remote base. Actual git merge-base with origin/main is eae3eed6742fbbd151b8154dabb0ef31c2df61b2. Do not rewrite protected main or rebase these authorized local integration merges to change extension metadata.
- pnpm build and both reproducible kernel integrity checks pass. Integration tests: 112 passed; release tests: 30 passed. No signed/packaged/live-client verification is claimed.
- Full Tools ran once: 708 initial passes plus 40 isolated passes. Touched Electron ran once: 17 initial passes plus 23 isolated passes. New targeted tests pass separately. This is reconciled evidence, not a claim that the untouched original full command was green.
- Hosted topic checks are blocked by the existing dependency audit. Upgrading dependencies or weakening its policy is outside Hub polish. The integration PR must disclose its own current run.
- Final review artifacts account for 255 unique plan IDs: 244 closed at the offline boundary, 11 deferred with reasons. Non-ID story gaps and all six handoff decisions are separate open requirements; they are not hidden in the closed count.

- Final pnpm check passed after the confirmation CSS/test and final owner documentation: typechecks, lint, links, 1872 unit tests, 186 policy tests, 278 Tools tests and 82 Launcher tests.
- Fetched origin and proved all 21 published topic tips are ancestors of integration HEAD. Compared the complete branch with origin/main and reviewed the integration owner changes, tests and native/IPC/settings boundaries. No player-store move, migration or deletion, release change or unrelated checkout work is included.
- Restored Tools port 4179 before delivery. Local scratch logs retain first-run failures and individual rerun evidence; tracked ledgers retain results and limitations without diagnostics or private player data.
