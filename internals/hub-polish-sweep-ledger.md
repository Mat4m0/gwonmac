# Hub polish sweep ledger

## Scope and starting evidence

- Branch: `chore/hub-polish-sweep`; base: Visual `c334c3a2c7764a9de342216ab3348c9613de34a7` (draft #483).
- Findings: HUB-139, 180, 181, 236, 237, 240, 241; story VIS-33 (reduced motion).
- Read the complete handoff, this worktree AGENTS.md, assigned report rows and story. No player data changes are authorized.
- Current code confirms initial Settings failure loses its message on section selection and offers no retry; native View lacks Whispers; Hub claiming omits the trace down event.
- Whispers documentation already describes the floating owner correctly. Trade documentation still says detachable Hub content.
- HUB-181 report suggests Guild Wars Reforged; handoff section 5 explicitly requires `gwonmac` in Hub copy. The handoff wins. Existing packaged product names remain unchanged.
- The Classic resize hatch is painted into the canonical frame bitmap. Inspect its art before deciding how to suppress it without damaging the frame.
- Visual CI run 36816994480 failed at inherited Audit dependencies. Runtime/package jobs cannot establish their boundary. Do not weaken the audit or add unrelated dependency upgrades here.
- Installation used the frozen lockfile, offline, without scripts. Its log was initially outside the task scratch directory and moved into `$TMPDIR/codex-hub-sweep/install.log`; subsequent scratch stays there.

## Decisions and limits

- Live game, input feel, VoiceOver and AZERTY remain unverified.
- Handoff section 10 decisions remain open.
- Tool names will reuse TOOL_PRESENTATION; preserve Hub names where practical and list the naming decision for review.

## Finding results and proof

| Finding | Outcome | Evidence |
| --- | --- | --- |
| HUB-139 | Closed | User guide and Trade owner now describe floating windows, native menu label, Travel caret keys and actual PvE/chat/focus resign conditions. Whispers owner was already correct. Markdown links checked by repository gate. |
| HUB-180 | Closed | Hub rows/examples, library source and shortcut labels consume TOOL_PRESENTATION. Existing Hub Travel/Switch Character names win; Xunlai Storage is the shared noun, Open Xunlai Storage remains its verb and search alias. Browser regression failed on old storage title and passes after consolidation. No IDs or saved bindings change. |
| HUB-181 | Closed within Hub | Existing Hub source already uses gwonmac. Added a narrow source policy to prevent either competing product name in Hub modules. Fixed GWonMac spelling in the touched Trade document. Packaged identity remains unchanged. Handoff contradicts report; handoff wins. |
| HUB-236 | Closed | Footer offers Retry settings; loading disables it. Section changes keep initial failure and identify the selected section. Same owner reloads in place and restores focus. Browser regression failed when section cleared the error, then passed. |
| HUB-237 | Deferred | Canonical body.png includes the hatch inside its bottom-right border. Suppression requires replacement or masking of frame artwork. No neutral artwork treatment is specified; preserve frame fidelity until Matthias chooses it. Actual resize control already hides while locked. |
| HUB-240 | Closed | Existing trace producer now records the Hub down event. Unit regression failed with only repeat/release emitted; passes with one down, one repeat, one release and only sanitized printable key classification. |
| HUB-241 | Closed | Native View Whispers uses existing toggleWhispers, withGameOwner and featureActivationRequested. Offline Electron checks its label, omitted accelerator and setting enable/disable. Restoring old menu made the regression fail on absent Whispers. |
| VIS-33 | Already correct, verified | Reduced motion browser story covers Home, Travel, Actions, long team progress and close: no animations, zero transition durations, static progress. No new motion owner or CSS required. |

## Needs design decision

- Confirm Travel and Switch Character as the shared tool names. This preserves Hub/menu names and changes Settings' former Quick Travel/Character Switch labels.
- Confirm Xunlai Storage as the tool noun; its primary still says Open Xunlai Storage. The old query remains an alias.
- Retry settings lives in the common footer; failed-load copy says Settings could not load. Try again.
- Choose whether and how to replace the Classic bitmap hatch while locked (HUB-237).

## Struggles and corrections

- A multiline documentation replacement missed Trade's wrapped Detach sentences. A targeted grep found them; corrected both before final checks.
- The offline install omits Electron's downloaded runtime. Native test initially refused missing prerequisites. Reused the existing same-version local Native runtime through an ignored dependency symlink and path.txt; no network download or other worktree modification.
- One batched read truncated output. Re-read the relevant sections; no conclusion depends on unseen text.
- Found the library root row also owned a literal tool label after initial typecheck. Replaced it with the same shared label and extended the UI matrix to all six tool rows; run latest checks again.
- No asset surgery attempted: I cannot choose a better locked frame corner from the unspecified art contract. Deferred rather than claim the painted hatch is solved.

- First repository gate reached the Launcher tests, where the existing label expectation still said Quick Travel. Updated the expected shared name to Travel; this failure confirms the Launcher consumes the canonical owner.

## Final verification and handoff

- `pnpm check`: pass. Typecheck, lint, Markdown links, 1,857 unit tests, 186 policy tests, 266 Tools Vitest tests and 82 Launcher tests.
- Tools browser: `pnpm exec playwright test -c playwright.config.ts tests/hub-sweep.spec.ts --workers=2`: 3 passed. Only the touched spec ran; the full suite waits for integration.
- Offline native: `pnpm build`, then `pnpm exec playwright test --config=tests/electron/playwright.config.ts tests/electron/input-clipboard.spec.ts --workers=2`: 5 passed, including native menu, text editing and IPC refusals. The spec is internally serial and used one worker despite the explicit ceiling of two.
- Settings retry, tool naming and native trace regressions failed before their fixes. Native menu regression also failed with its original owner restored. Exact fixes restored after each proof.
- Temporary browser port 4190 restored to canonical 4179 before staging. Verification-owned fixture processes exited; no live session was restarted.
- `git diff --check`: pass. No stored player data, package identity, release files or frame assets changed.
- Recommend a Developer Build for the native/input and settings changes, then consider the complete group within the Beta train. Only Matthias can choose or publish a release.
