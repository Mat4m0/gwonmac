# Hub polish execution ledger

Started 2026-09-30. The handoff owns scope and order. This ledger records evidence, uncertainty, and review weaknesses; it does not claim live QA.

## Run constraints

- One branch at a time; each in its own worktree. Never edit the main checkout.
- Draft PRs only. No PR merge, release, production action, or stored player-data migration.
- Browser suites run sequentially with two workers. Full suite only at integration.
- Live game, input feel, VoiceOver, and AZERTY remain unverified.
- Keep all six handoff section 10 decisions open.

## Search — in progress

- Starting HEAD: `8a9de0b4`; base: `feat/hub-actions-and-footer`.
- Clean worktree at intake. Existing implementation commit: `eaaa56ed`.
- Handoff correction: Search has two commits, including the handoff documentation, rather than one.
- Handoff correction: `gwonmac-calc-logic` exists on `fix/calculator-logic`; preserve it until its contents and ownership are inspected at the calculator step.
- `gh stack view --json` reports Search is not locally tracked. Existing draft PR bases were verified through GitHub: #461 → #462 → #463 → #464 → #465 → #466 → #468 → #469 → #470.
- Initial sandbox prevented remote-ref writes and GitHub access. Elevated read/fetch succeeded; authentication was not changed.
- Review and verification pending. No finding claimed closed by this run yet.

## Review weaknesses and difficulties

- No implementation difficulty assessed yet. Large tool outputs were truncated; reread relevant sections in smaller chunks before relying on them.
- The inherited search tests cover multiple fixes in one test. Check finding-specific assertions and demonstrate failures without the corresponding fixes before publication.

## Jobs used for UX review

| Player job | Frequency / situation | Must | Target |
| --- | --- | --- | --- |
| Find and open a tool | Frequent, over the game, keyboard or mouse | Footer names the selected action | Exact title wins |
| Find and travel to an outpost | Frequent, often abbreviated | Never choose a different target by guess | Shared deterministic tiers and explicit activation |
| Find a saved build or phrase | Frequent, personal library | Preserve data and intended target | Phrase wins; duplicate exact names do not run |
| Learn available commands | Occasional, unfamiliar feature | Examples stay honest | Fill-only examples and current shortcuts |

### Search review follow-up

- Confirmed HUB-094 gap: inherited Commands had only Search, Calculate, Keys; `?` returned no selection. New public UI regression failed on that input before the correction (`discovery-red.log`).
- Corrected `?` via the existing row alias field; grouped existing examples by their jobs and named Keys & shortcuts as specified.
- Corrected HUB-096 labels to the story examples (`Search heroes…`, `Search commands…`); placeholder and accessible name now agree exactly.
- Corrected HUB-093 example fill selection: only the argument is selected; an empty argument places the caret after the scope. No native action runs.
- Neutral visible choices to review: Commands group names Places, Characters, Builds, People, Trade, Accounts, Calculate; dynamic personal/folder pages use `Search <page title in lowercase>…`. No extra style changes.
- Focused Search suite: inherited 5/5 passed; corrected 6/6 passed. Initial required checks passed: typecheck, lint, 1831 unit, 259 Tools, 185 policy. Final-head checks pending.
- Execution mistakes: first test-write command used a repository-relative path from the Tools directory and wrote nothing; a later test command used the root directory with the Tools-relative configuration. Both corrected. These were command-location errors, not product failures.

### Independent walkthrough and broad browser run

- Inspected Commands in Classic and Modern through the actual browser, then verified Back and `toa` / `trade chat` search. Focus stayed in search. Closed the owned tab and stopped the owned 4190 server.
- Found exact Trade Chat still displayed a scope chip and generic example footers omitted their target. Both focused regressions failed before the corresponding fix.
- The changed-spec browser run finished: 576 passed, 2 failed, 8.2 minutes, two workers. No second browser suite ran concurrently.
- Pointer failure: the inherited test targets Show Launcher on empty Home after HUB-185 removes it. Adapted the setup to typed search; retained all no-activation assertions.
- Handoff correction: PPL-29 also fails alone on this branch. Revised ranking puts People first, so selecting Kai Mo Bearer no longer implies a nonzero scroll offset. Updated test setup to scroll explicitly; retained exact scroll restoration, selection, caret, focus and input-isolation assertions.
- Review limitation: profession matching is additive, but source ordering still needs scrutiny against the story's profession-first acceptance. Do not claim that subcriterion from the existing additive test alone.
- Current fixture zero-result `kmaadan` shows No matches; no fill fallback was observed. Check the scope of HUB-179 / D-6 at integration; do not assume that earlier Actions layer implements every story.

### Final Search follow-up

- 117/117 follow-up browser checks passed, including explicit PPL-29 scroll restoration and the Launcher drag refusal.
- Confirmed an additional HUB-059 gap through the existing real fixture/library source test: `build mo` selected a Mesmer template named Moon pressure ahead of actual Monk builds. The added assertion failed before the sort fix (`profession-red.log`). Exact names remain first; actual profession matches lead additive name matches for a short profession query.
- Root search still obeys the handoff's one shared tier; the scoped source keeps its meaningful profession order. No second root ranker was added.
- Preserve personal/folder page title spelling in the inherited `Search in <page>…` labels. Only Heroes, Accounts, Commands and Build Library adopt the specified noun labels. This replaces the earlier lowercase-page neutral choice.
- Repeated a wrong-working-directory mutation attempt while extending the unit test; it wrote nothing. Switched mutation scripts to absolute paths. Future runs should keep this constraint.

### Exact-alias refusal review

- Confirmed HUB-008 gap: a build named Toa and Temple of the Ages' exact `toa` alias produced two exact matches but still selected the build. The public regression failed on selection count before the fix.
- Corrected the existing ambiguity count to use `hubTier(...) === 0`, including aliases. Saved phrases retain their explicit priority.
- Test-tool limitation: importing browser `fixtures.ts` directly into Playwright fails because it uses Vite's `import.meta.glob`. Replaced that setup with one minimal disposable library record; no production fixture owner or stored player data changed.
- Added public table regressions for HUB-142 and HUB-143. Each failed while only its own matching fix was temporarily removed; exact source bytes were restored in `finally`, without stash. The complete Hub unit file then passed 9/9.

## Search publication evidence

- Final `pnpm check` passed: type checks, lint, Markdown links, 1833 unit tests, 185 policy tests, 259 Tools tests, 82 Launcher tests.
- Changed browser specs were all exercised: initial 576 passes and two stale-setup failures; corrected follow-up 117/117; library/scoped-label follow-up 29/29; final search activation/refusal follow-up 49/49. Full browser suite remains reserved for integration.
- Regression red proofs in this run: Commands discovery; exact-title scope chip; target-naming footer; profession ordering; exact alias/name ambiguity; scope aliases; typographic punctuation. Inherited best-row, cap, phrase and pin tests pass; their original isolated red runs were not retained in the handoff. A later reviewer should distinguish inherited evidence from the newly reproduced red proofs.
- Closed in this branch: HUB-008, 010 (root), 056, 057, 058, 059, 060, 063, 093, 094, 096, 102, 141, 142 (scope aliases), 143, 185, 224.
- Moved: HUB-061, 065, 066, 189 → Travel; HUB-062, 090, 091, 092, 152, 177 → Pins; HUB-144 → People. HUB-064 already belongs to Settings PR #469. HUB-142 friend travel remains on Travel.
- Deferred decisions: HUB-095 / D-9 and HUB-186, per handoff section 10. All other section 10 decisions also remain open for the combined PR.
- Needs design decision: neutral Commands subgroup names; retained `Search in <page title>…` for personal/folder pages; inherited All N places wording differs between finding and story.
- Owned browser tabs and ports 4179/4190 are closed. Main checkout and other worktrees were not edited.
- Publication and GitHub CI pending at this ledger commit. Next queue item is Legibility v2; do not start it until Search has its draft PR.
