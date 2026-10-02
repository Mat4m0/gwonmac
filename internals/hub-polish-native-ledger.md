# Hub polish — Native layout review ledger

Reviewed 2026-09-30. Base: `feat/hub-actions-and-footer` (`28fd27a2`).
Starting HEAD: `e09782ee`; four inherited commits, clean worktree.

## Findings and owner review

- HUB-014: shared shortcut matching names Latin letter chords by the typed letter; main still claims and releases the physical pressed key. Unit layout cases cover AZERTY, Dvorak, Colemak, QWERTZ and the intended non-Latin fallback. This is synthetic model evidence, not physical layout QA.
- HUB-037: main retains every assigned chord and separately gates its action through the existing feature-activation owner. Disabled chords cannot run or forward their base key. No saved bindings are rewritten.
- HUB-038: Settings disposal cancels capture through the small no-argument bridge capability. Main cancels only the sender's window capture. Extended the existing native capture matrix for explicit cancellation, idempotence, listener cleanup and the next W. Added an offline Electron IPC test that leaves another window's capture active.
- HUB-134: main and Edit-menu clicks share semantic Undo/Redo. Ordinary fields decline to Chromium's native edit; hidden game proxies consume a no-op so their history cannot diverge. The game-edit request boundary still rejects undo. The changed Electron test uses main's `sendInputEvent` route, not Playwright's injected editing command.
- KEY-24 was already implemented by the upstream `isHubBackKey` and composition guard. Added one fixture regression for Enter/Backspace during composition and named Command-Backspace with a different code; no second key matcher was added.

## Verification

- Initial and final `pnpm check` passed: 1,835 unit, 185 policy, 259 Tools and 82 Launcher tests, plus type checks, lint and links.
- Focused native shortcut/capture unit files: 24 passed after restoring the red proofs.
- Rebuilt the dedicated worktree because Undo/Redo and the new IPC capability require real Electron boundary evidence. The build uses repository fixtures; no live game or player profile was used.
- Touched offline Electron specs: initial 9/9 passed. Follow-up native edit and capture ownership: 2/2 passed; restored capture ownership: 1/1 passed. Ten distinct Electron tests now pass, including malformed game-edit refusals.
- Rebuilt preload behavior: initially 14/15; corrected a stale Settings invocation table, then 15/15 passed. The API requires a valid section, so the test now sends `game` instead of no argument.
- Touched keyboard fixture spec: 16/16 passed before the added KEY-24 story; final restored-source run passed 17/17. Browser suites run sequentially with `--workers=2`; the full suite remains for integration.
- Red proofs: physical-position matching selects Quit instead of Select All; disabled chords forward; explicit native cancellation leaves capture active; Settings disposal takes the next W; removing only native Undo leaves `travel` instead of `sw`; removing only native cancellation fails the real window-bound IPC test. The KEY-24 composition and named-key guards also each failed when only that guard was removed. Restored exact source or built bytes in `finally` without stash.
- Capture IPC proves refusal to change another window's capture. Existing sender/origin predicates and policy wiring remain unchanged. The bridge has no target-window argument.

## Cleanup and handoff corrections

- Inherited commit `e09782ee` also committed `final.tar`, a generated archive of Legibility source files. It is unrelated to Native layout and violates repository artifact containment. Preserved it in `/private/tmp/codex-hub-native/inherited-final.tar` and removed it from the branch outcome. Git history retains the original.
- The handoff did not mention that archive or the stale preload Settings table.
- Other branch ledgers: Search draft #471; Legibility draft #473. Both hosted gates stop at unchanged dependency audit failures, before runtime tests. Legibility failure was independently diagnosed from run `36750248940`; no hosted success is claimed.
- `gh stack` accepts the sibling branches locally; remote `link` needs at least two PRs and cannot create a one-PR sibling stack. Do not change an existing stack's bases just to satisfy that command.

## Difficulties and review limits

- Initial reads guessed `.mjs` / `.ts` fixture files; the actual Electron fixture is `fixtures.mts`. Those reads changed nothing.
- I initially described the Settings section as optional while diagnosing the stale table. The parser and public contract make it required; corrected the test to a real valid section and corrected the commentary.
- The existing module-routing and window-ownership tests prove boundaries. They do not prove live Guild Wars reactions, input feel, VoiceOver, AZERTY hardware or every non-Latin macOS layout. A later reviewer should inspect those model assumptions and perform the named live checks.
- Existing saved shortcut shapes remain readable and untouched. Letter semantics intentionally change on non-US layouts; review old custom bindings on hardware before accepting a combined release.
- No unresolved Native design choice was needed. Keep all six handoff section 10 decisions open in the integration PR. Recommend Developer Build QA and Beta consideration for the combined native input change.

Publication pending at this ledger commit.
