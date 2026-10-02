# Hub polish — Legibility review ledger

Reviewed 2026-09-30. Base: `feat/hub-actions-and-footer` (`28fd27a2`).
Starting HEAD: `4c48df05`; six inherited commits, clean worktree.

## Outcome and evidence

- Reused the one appearance owner and existing neutral fallback. Added actual default structural paint, all opaque gradient stops, and composited wells. Customized gradient stops are measured too.
- CSS owns paint. The existing appearance test now pins the measured structural facts to CSS, alongside the inks. No stored settings or palette change.
- Built-in Classic and Modern pass the 65–100% unit matrix against panels and actual control backgrounds. Unchanged raised controls required lifting Classic faint ink even at 100%.
- `pnpm check` passed: 1,837 unit, 185 policy, 259 Tools and 82 Launcher tests, plus type checks, lint and Markdown links.
- Appearance browser spec: 13/13 passed with two workers. This covers composed text contrast in the selected worst cases, reduced transparency, narrow footers and all six Settings fonts. It is not the full VIS-04 cross-product.
- Public regressions failed with only their relevant behavior removed: default surfaces (unit), unguarded Modern headings, Classic secondary header ink, reduced-transparency backdrop, footer wrapping, and effective-opacity guard. Exact source bytes were restored in `finally`; no stash or concurrent browser suite.
- Default Settings Appearance inspected before and after in the real fixture. This is not live-game evidence.
- HUB-039 reduction blackout, HUB-106, HUB-249 and HUB-252 are covered within the tested built-in/default/custom-accent cases. HUB-253 is already resolved by the Settings layer; all six fonts retain equal navigation heights here.
- HUB-238 footer wrapping closes. Minimum height remains the explicit handoff section 10 decision. The minimum-size test does not prove three visible rows.

## Deferred and needs design decision

- Scrim policy remains unchanged: Classic dims; Modern does not. VIS-10 is intentionally deferred by the handoff.
- Arbitrary opposing custom surfaces cannot reach AA with one shared ink. For white and the unchanged Classic raised stop `#353739`, even the optimal shared neutral is only about 3.45:1. The real translucent well adds another intermediate background.
- In the required white-window case, the existing neutral fallback now returns `#5F5F5F`. On white / translucent well / raised stop / opaque recess it measures 6.39 / 1.83 / 1.87 / 3.12:1. Previously muted ink measured 4.80 / 1.37 / 2.49 / 4.15:1. The minimum improves, but some individual surfaces worsen. This is a compromise, not an AA fix.
- A better design needs separate surface inks or palette constraints. Neither is specified. Preserve the saved palette and use the existing neutral fallback; defer full custom-palette AA. Review this tradeoff before acceptance.
- Keep all six handoff section 10 decisions open in the integration PR. Live game, input feel, VoiceOver and AZERTY require Matthias.

## Difficulties and review weaknesses

- I struggled with the shared-ink constraint: merely adding the default palette seeds would satisfy the handoff superficially but would still omit actual gradient and translucent paint. The final model measures those paints; it cannot resolve the product choice needed for opposing palettes. A later reviewer should examine a surface-scoped ink approach rather than trust the fallback as finished legibility.
- The first custom-case expected neutral was a provisional guess and was corrected from measured output. The first temporary full-file regression reversal removed a newly imported export, so it did not establish behavioral failure. Repeated the proof by reversing only the background-model block; it failed on the intended ink assertion.
- One initial read used the nonexistent `src/renderer/ui/appearance.ts`; corrected to the repository owner. No file was changed by that mistake.
- Inherited browser tests use the old search accessible name because this sibling starts before Search. Integration must reconcile names through the shared selector; do not weaken assertions.
- Search PR #471 hosted Application verification stopped at dependency audit: high advisories in unchanged fast-uri, Electron, undici and brace-expansion. Runtime tests did not run. Evidence is in `/private/tmp/codex-hub-search/ci-failed.log`; carry the blocker to integration rather than silently claim CI passed.

## Handoff corrections

- Default palette seeds are not actual unchanged control paint. Classic opaque recess is `#090907`, not the seed `#080807`; the well fill is translucent black. Modern has translucent title and well paint.
- Including actual defaults alone cannot guarantee AA for the white-window case. The handoff omits the required palette/surface-ink decision.

Publication pending at this ledger commit. Final restored-source checks and draft PR follow.
