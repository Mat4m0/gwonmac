# Hub polish calculator ledger

## Intake — 2026-09-30

- Read the handoff, repository instructions, calculator story, findings and current calculator owners.
- Worktree: `gwonmac-calc`; branch: `feat/calculator-inline-icons`; base: completed Search `c9f6c371`.
- Rebased the empty calculator branch onto its required base. No player stores changed.
- The unlisted `gwonmac-calc-logic` worktree is clean and has no branch-specific commits. Left it intact.
- Scope: HUB-022, 104, 101, 098, 099, 103, 159, 178, 211–222; D-7/D-8 and native currency glyph stories.
- `1k` is already the parser's platinum alias. The handoff calls it gold for its default target, while the story expects platinum → gold. Preserve canonical alias semantics and record this conflict in the PR.
- Trade draft #478 now records its actual CI failure: unchanged dependency audit, 45 vulnerabilities, before runtime tests.

## Review limits and difficulties

- Two shell searches failed because zsh expanded unmatched globs. Reissued targeted searches; no code conclusions came from their empty output.
- A combined owner read truncated. The calculator and its unit tests were separately available; remaining Hub sections need smaller reads before edits there.
- No live game, input feel, VoiceOver or AZERTY checks can be claimed.

## In progress

- Exported the parser's completed alias catalogue and added the pure glyph-span recogniser.
- Regression matrix covers exact aliases, ambiguous prefixes, compact amounts and multiword spans. Not yet verified.
- Native input overlay, calculator logic changes, full branch checks and PR remain outstanding.

## First implementation and targeted evidence

- Initial recogniser invocation used Node's strip-types flag instead of the repository TS loader and failed module resolution. Re-ran with `--import ./scripts/ts-hook.mjs`.
- The first prefix matrix incorrectly expected `pla` to mean platinum. The canonical Plant Fiber alias makes that prefix ambiguous. Corrected the expectation; exact `plat` remains platinum. Both recogniser tests pass, including every catalogue alias.
- Cache regression failed on unchanged code: editing `10e` to `11e` replaced the answer with Loading. Fresh source snapshots now survive quantity edits and Hub hide/show, with response-generation refusal preserved.
- Market cards now retain `market:result` across buyer/seller basis choices. Independent reversal proof still required.
- Before/after Classic visual inspection found the transparent layer inherited black text shadows, which painted over native input text. Removed shadows; reinspection shows legible native text and both icons.
- Typecheck passed before the latest logic additions; rerun needed for final delivery.
- Native glyph browser spec passed both styles and all six supported fonts. It checks each ArrowLeft selection offset against the transparent layer boundary and an independent canvas measurement using native font/word spacing, within 1 px. This is layout evidence, not a screenshot measurement of the painted caret or live input feel.
- First browser run failed because its test used End to move the caret; Hub owns End for list navigation. Replaced that test action with native horizontal arrows. This was a test mistake, not a timing flake.
- Ordinary arithmetic now uses the existing conversion-card layout. `each` is echoed on the question side. Tiny values extend precision to three significant digits; retaining those trailing zeros is a neutral unspecified formatting choice for PR design review.
- Default targets preserve existing `k = platinum`; incomplete explicit `in`/`to` and unsupported material defaults stay fill-only.
- Remaining calculator work includes persistent rates, rate-form parsing/copy, unavailable and stale states, metadata, named copy receipt and accessible question-first cards. None is claimed closed yet.

## Settings and release boundary

- Real temporary-file settings test passes: save `5k`/manual, reload `5000`, preserve a literal pin/phrase and render scale, reject invalid mode, negative rates and extra fields.
- Its first run exposed an incomplete test pin (missing mandatory phrase) and the expected saved-key inventory needing the new field. Corrected both; 45 settings/calculator tests passed.
- Typecheck caught the real renderer snapshot projection missing the new field. Added it to the harness and its existing global contract; no bridge or second store.
- Typecheck also caught the release-only candidate settings fixture missing the now-required field. Added automatic/manual values to its existing domain matrix. Did not run signed bundles or claim Stable rollback.
- The settings module comment says Stable must own every additive key; the release-only executable explicitly permits additive preferences to be discarded when returning to an older Stable. Preserve the executable projection and report this disagreement and possible new-rate loss; existing player data is untouched. Do not publish anything.
- The disposable browser fixture persists only this new choice under its own fixture key. Its Reset fixture removes that test key; no player profile is involved.

## Browser workflow checks and review corrections

- Six calculator workflow journeys pass: stable market basis focus, rate shorthand and one pending save, persisted choice after browser reload, named material retry, loading-refusal removal and sourced copy, stale Refresh, labelled median evidence, default named copy and wrapping questions.
- Three first-run workflow failures came from installing the test service before the asynchronous fixture mounted. Added a visible-input readiness check; all six passed.
- A later three-spec run passed 51/53. Two old calculator cases were reset to Home while a watched source file was changed during the suite. Their snapshots show an empty Home after navigation, and both passed in the next isolated two-case run. This was my verification interference, not established product flakiness. Do not edit watched files during browser runs.
- Removed a duplicate NPC expiry scheduling path found in source review. The visible search now owns the single timer, including cached resumes.
- Removed the mutable manual-rate mirror. Every calculation and editor now reads the existing settings authority; no save capability means a truthful refusal, never “Saved”.
- Lint caught a field-label wrapper that lost its caught error cause. Added the cause and retained the player-facing field message.
- Corrected the stale settings module comment to match the existing signed-bundle compatibility proof. No runtime compatibility policy changed.
- The handoff refers to calculator scope, but `parseHubQuery` currently has no calculator scope. Implemented glyphs in the existing root amount grammar; scoped people/places/builds queries remain untouched. This missing scope needs an explicit design decision rather than inventing a new reserved word.

- Final source review captured the exact market snapshot used by Price details, so a retained view cannot mix its original evidence with a later fetch timestamp. Removed its non-null assertion.
- Currency artwork uses the specified height and its natural aspect ratio. Removed an unnecessary width clamp after checking the existing image dimensions; no new assets.
- Updated the old fill-row comment for D-7 and kept both incomplete `in` and `to` directions fill-only.
- The latest steady-source run passed all 54 tests in the three touched browser specs (1.2 min), including native undo, composition freeze, scroll/resize sync and late save refusal. Small final review corrections need their targeted recheck before delivery.

- Final state review found two honest-state gaps adjacent to HUB-101/103/104: disabled automatic prices returned No matches for a valid conversion, and returning from a source change with missing manual rates left its named prompt unselected. Reused the existing rates editor and Calculator group to make both reachable; no network or game action runs automatically. Added refusal/no-demand and browser prompt regressions.
- Same-unit/stack conversions previously cited the unrelated platinum/gold fact. They now cite the relevant fixed stack size. This neutral provenance copy is an unspecified choice for design review.
- Item-equivalence limitation is retained in both the visible card and the common copy formatter, with a real-source regression.
- First complete repository gate passed before these final state corrections. Repeat the relevant gate because product behavior changed; do not reuse that result as exact-delivery evidence.


## Regression reversal proof — 2026-10-01

- Each temporary mutation restored the exact original file bytes in a `finally` block. No simultaneous Playwright suites ran.
- Unit reversals failed, then restored tests passed: HUB-022 (market identity), 104 (snapshot retention), 098 (old query/reset demand), 211 (each), 214 (precision), 212 (question/provenance copy), 215 (item equivalence), 099 (ad age), 216 (grouped/k rates), 217 (real settings boundary), 220 (track aliases), 103 (absent material field), 219 (unsupported market route), 178 (arithmetic card), 101 (default target), and the pure glyph recogniser.
- The first HUB-098 mutation changed only the key and passed because cached evidence still prevented demand. Restoring the complete old reset behavior failed. This weak first attempt is not counted as proof.
- Browser reversals failed at the intended assertion: HUB-213 (loading receipt), 221 (Refresh label), 218 (median metadata), 222 (question-first accessible name), 159 (status wrapping), and HUB-104's missing-rate return selection.
- Restored final source passed all 55 tests across three touched browser specs. After adding the status-wrap assertion, the two new specs passed all 11 tests again. All browser commands used `--workers=2`.
- Final CUA inspection covered both styles at the default viewport and 500×650. Native text and icons remained legible; questions wrapped and the footer stayed visible. This is fixture inspection, not live-game QA.
- The interrupted preview session handle and old tab ID disappeared. Confirmed port 4631 had no listener, started a new preview, used the current tab inventory, then closed the tab, reset the viewport and stopped only that preview.
- Final gate caught another old empty-result assertion in `market-rates.test.ts`. Updated it to the honest disabled-price prompt; it still refuses a late result. Repeat the gate; do not claim this failed attempt passed.
- Restored the temporary browser port from 4186 to the repository's 4179 before staging.


## Delivery evidence

- Exact repository gate passed: `pnpm check` includes typecheck, lint, Markdown links, 1,847 unit tests, 185 policy tests, 259 Tools Vitest tests and 82 launcher tests. Log: `/private/tmp/codex-hub-calc-check-delivery.log`.
- Closed: HUB-022, 098, 099, 101, 103, 104, 159, 178, 211–222. D-7 follows canonical defaults; D-8's allowed named status receipt remains. No calculator finding is left without code inspection or regression evidence.
- Deferred requirement: calculator-scope glyphs, because this scope does not exist. Root amount glyphs are implemented. No stored phrase is reinterpreted.
- Needs design decision: conflicting `1k` description; scope name; extended trailing-zero formatting; neutral disabled/material/unsupported copy; labelled median metadata and relevant stack provenance.
- Public rollout needs the older-Stable additive-field decision. No signed, packaged, live game, input feel, VoiceOver or AZERTY claim is made. Recommend Beta consideration with the completed train, not a feature-specific publication.
- Source and complete Search-base diff reviewed. The temporary browser port is restored; temporary mutation scripts/logs remain outside the repository. Preview process and tab are closed; unrelated sessions are preserved.
- Maintainability concern for later review: the pre-existing calculator source still combines compact card construction, rate routing and editor presentation. I kept its existing owner and avoided a second abstraction. A later reviewer should inspect cross-source return selection and real native IME behavior during integration/live QA; current fixture checks cannot establish those live boundaries.
