# Hub polish: handoff

Written 2026-09-30 by Claude (Opus) for Codex, which finishes this work on its own.
Read all of it before touching code. Where this file and a story disagree, this file wins.
Where this file and the code disagree, trust the code and report the mismatch.

## 1. Goal and end state

The Hub is the Raycast-like command palette drawn over Guild Wars (⌘R). The goal is a Hub that
feels best in class: a player can do every Hub job by keyboard or by mouse without surprises.
Nothing that changes the game runs by accident. Every state is honest. It looks and behaves
the same in every view.

"Done" means all of these hold. Each is already true on the finished branches; keep it true.

1. **One keyboard model.** ↑↓ Home End PageUp PageDown ⌃N ⌃P move the one selection and never
   wrap (`src/shared/ui/list-keys.ts`). ↵ runs the named primary. A modified ↵ never runs the primary.
   Esc closes the innermost level first: menu, disclosure, prompt, typed query, then the page,
   then the Hub. ⌘⌫ is Back from any focus, text fields included. Plain ⌫ only edits text.
   ⌘J opens Actions. → opens a row that has a page (`row.navigate`).
2. **One direct-shortcut rule.** ⌘E Characters, ⌘T Travel, ⌘B Build Library and Settings go
   through `direct()` in `src/renderer/hub.ts`:
   - If the page is on top, focus it.
   - If the page is lower in the path, go back to it.
   - If a suspended Hub holds it, resume that.
   - Otherwise open it.

   A direct shortcut never stacks history and never closes the Hub. ⌘R on an open Hub goes Home.
   A page left for another window resumes within 90 s, with its query selected.
3. **Focus is never on `<body>` or the `<dialog>`** after any transition. Use `focusable()` and
   `focusableElements()` from `src/renderer/surface-controller.ts`, and `firstControl()` in hub.ts.
4. **One footer, always present, never shifting.**
   - The primary names verb and target ("Travel to Kamadan, Jewel of Istan · Any district ↵").
   - The primary stays on one line; a long name ends in … and keeps its full label as title and accessible name.
   - The Actions slot has one fixed width.
   - Slots disable in place; they never hide.
   - Views set the footer through `HubViewFooter` (`footer.primary()`/`footer.secondary()`). Travel and Characters already do.
5. **Actions menu (⌘J, right-click, the footer button).**
   - A compact `role=menu` over the footer. It is not a page.
   - Its entries come from `menuEntries(row)` in hub.ts:
     - the primary (↵);
     - a named second way in, only when the row sets `actionsLabel`;
     - Pin to Hub / Unpin from Hub, and Set search phrase….
   - A row with nothing beyond its primary keeps Actions disabled. It never opens a dead-end page.
6. **Pointer safety.** A single click on a consequential row only selects it. A double-click
   runs once, and only on the row where both clicks landed. The trailing clicks of a closing
   double-click never reach the game. A resting pointer never moves a selection; only real
   movement does (`src/shared/ui/hover-selection.ts`).
7. **Session-bound actions.** A running action belongs to the page session that started it
   (`startTask()`). After the player moves on, it never navigates. It ends with a receipt or a failure receipt.
8. **Search answers with its best row.** One shared tier, `hubTier()` in `src/shared/hub.ts`:
   - 0: exact name or alias;
   - 1: the name starts with the query;
   - 2: every query word starts a word of the name;
   - 3: only keywords match.

   Sections order by their best row, then by the fixed group order. A saved phrase always wins, and so does a query that is a row's whole name.
   A typed query starts on its best *available* row. Scope words and aliases are handled by `parseHubQuery()`.
   The full list for search is in section 4.
9. **Settings: one name per setting.** Labels, descriptions and "when it applies" notes come
   from `src/shared/setting-copy.ts`, used by both the launcher and Hub Settings.
   Hub Settings has Game · Appearance · Tools · Shortcuts · Maps, plus "Open in launcher" links for what only the launcher keeps.
   See `docs/settings.md`.
10. **Legible everywhere.** Every text role is ≥ 4.5:1 at every style, opacity (65–100 %) and
    custom palette (the legibility branch; `apps/tools/DESIGN.md` "legibility model").
11. **Calculator.** Exact math. Every result is labelled with its source and age. Nothing is guessed.
    The live currency icons in the search bar are specified in section 6.

## 2. Where everything is

- Repository: `/Users/matthias/Git/games/guild-wars-mac/gwonmac`, the main checkout.
  **Do not work there.** It sits on an old branch that belongs to the user.
- Rules: `AGENTS.md` in the repo. Read it. Key points:
  - every `src/` module starts with a block comment saying what it owns;
  - prefer delete > simplify > add;
  - one owner per behaviour;
  - never claim live-game results.
- The audit: `/Users/matthias/Git/games/guild-wars-mac/hub-audit-2026-09-26/REPORT.md`. Every
  finding HUB-### lives there with observed behaviour, fix and acceptance, and decisions D-1…D-30 are in its decisions table.
- User stories per branch: `…/hub-audit-2026-09-26/polish/state/stories/<branch-with-dashes>.md`
  (steps plus expected result, for example `feat-calculator-inline-icons.md`).
- The plan, mapping each branch to its finding IDs: `…/hub-audit-2026-09-26/polish/state/plan.json`.
- Test fixture: `apps/tools/src/hub-fixture.ts`, served at `/?hub` by `apps/tools` Vite. Useful query flags:
  - `lifecycle=`, `library=N`
  - `travel-load-ms=`, `accounts-load-ms=`, `accounts-ms=`, `settings-ms=`, `characters-ms=`
  - `double-click-ms=`, `market-empty`

  Pins and phrases seed through `localStorage['hub-fixture-shortcuts']`.

### Branches and worktrees (state on 2026-09-30)

Everything is stacked on `main`. All the draft PRs below are open and not merged. #459 is merged.

| Branch | Worktree | State | PR base |
|---|---|---|---|
| fix/hub-invite-followups | – | draft PR #461 | main |
| test/hub-fixture-lifecycle | – | draft PR #462 | #461 |
| fix/hub-pointer-safety | – | draft PR #463 | #462 |
| fix/hub-input-safety | – | draft PR #464 | #463 |
| fix/hub-session-bound-runs | – | draft PR #465 | #464 |
| feat/hub-keyboard-model | – | draft PR #466 | #465 |
| fix/hub-focus-and-shortcuts | – | draft PR #468 | feat/hub-keyboard-model |
| feat/settings-in-game | – | draft PR #469 | fix/hub-focus-and-shortcuts |
| feat/hub-actions-and-footer | – | draft PR #470 | feat/settings-in-game |
| fix/hub-search-and-discovery | `../gwonmac-hub-polish` | 1 commit, done, **not pushed**, not reviewed | feat/hub-actions-and-footer |
| fix/hub-appearance-legibility-v2 | `../gwonmac-legibility` | 6 commits, done, **not pushed**; the review found one P2 (section 3) | feat/hub-actions-and-footer |
| fix/hub-native-layout | `../gwonmac-native` | 4 commits (HUB-014, 037, 038, 134), clean, **not pushed**, not reviewed | feat/hub-actions-and-footer |
| fix/travel-characters-lifecycle | `../gwonmac-travel` | 6 commits, work was stopped mid-branch; untracked `apps/tools/probe/` (scratch: delete it) | feat/hub-actions-and-footer |
| fix/hub-pins-and-phrases | `../gwonmac-pins` | 5 commits and **7 uncommitted files** (stopped mid-branch) | feat/hub-actions-and-footer |
| fix/trade-keyboard-and-identity | `../gwonmac-trade` | **0 commits, 28 uncommitted files** (stopped mid-branch) | feat/hub-actions-and-footer |
| feat/calculator-inline-icons | `../gwonmac-calc` | empty (branched from the search branch) | fix/hub-search-and-discovery |
| fix/custom-modern-frame-mask | `../gwonmac-frame-mask` | draft PR #460 | main |
| fix/hub-appearance-legibility (old) | `../gwonmac-hub-visual` | **obsolete**; superseded by -v2. Do not use. Leave it alone. | – |

Not started: `fix/people-builds-feedback`, `perf/hub-scale-and-a11y`, `fix/hub-visual-consistency`,
`chore/hub-polish-sweep`. Their finding IDs are in `plan.json`.

## 3. Work queue, in order

Finish in-flight work before starting anything new. Work on one branch at a time, and commit each before moving on.

1. **Search** (`gwonmac-hub-polish`, branch fix/hub-search-and-discovery). Done. Review your own diff
   (`git diff feat/hub-actions-and-footer`), push, and open a draft PR on base feat/hub-actions-and-footer.
   In the PR body, list the findings from the commit message, and list HUB-061, 062, 065, 066, 090, 091, 092, 095, 144, 152, 177, 186 and 189 as moved to other branches or deferred (section 8).
2. **Legibility v2.** Fix the review finding first:
   - `src/renderer/appearance.ts` ~114–116: the contrast model drops unchanged control surfaces.
   - Example: a custom window of white at 100 % gives muted ink `#767268` on the default recess `#080807`, which is 4.18:1.
   - The guard must include the actual painted default surfaces (titlebar, raised, recessed), not only recoloured ones.
   - Add a unit test for that case.

   Then push and open a draft PR.
3. **Native layout.** Review the 4 commits against HUB-014, 037, 038 and 134, then push and open a draft PR.
4. **Travel and Characters.**
   - Read the 6 commits.
   - Check each finding of the branch (`plan.json` plus HUB-065, 066, 189 and the Travel side of HUB-061, which were added to it) against the code.
   - Finish what is missing, with one regression test each. Push and open a draft PR.
5. **Pins and phrases.** Read the 5 commits and the 7 uncommitted files, finish them, and commit. Findings:
   - HUB-062: phrases that collide with names;
   - HUB-090: pin order across the two stores, plus Move down;
   - HUB-091: pin and phrase on every page;
   - HUB-092: confirm Remove and Reset;
   - HUB-152: the phrase form;
   - HUB-177: a pinned row equals its search row.

   Keep build/team pins in the library and global pins in settings. **Never** migrate or move stored pins.
   Store only an order key if one is needed, and keep old data readable.
6. **Trade.** 28 uncommitted files: inspect them with `git diff`. The earlier agent had started HUB-013, 118,
   121, 024, 025, 131, 230, 117, 119, 122, 123, 124, 125, 126, 127, 129, 132, 108, 225, 226, 227, 229.
   Keep what is correct and finished, drop anything half-done, then complete the rest. Commit in atomic commits.
7. **Calculator** (`gwonmac-calc`). Two parts:
   - the logic findings: HUB-022, 098, 099, 101, 103, 104, 159, 178, 211–222, and D-7 default targets;
   - the live icons exactly as specified in section 6.
8. **people-builds-feedback**, 9. **perf/hub-scale-and-a11y**, 10. **visual-consistency**,
   11. **chore/hub-polish-sweep**. Start each in a new worktree from the tip of the latest finished branch (or from
   feat/hub-actions-and-footer if it doesn't depend on another), with its own port (section 7).
12. **Integration** (section 9).

## 4. Code owners: reuse them, never add a second one

| Concern | Owner |
|---|---|
| List movement keys | `src/shared/ui/list-keys.ts` (`listKeyStep`, `listIndexAfter`) |
| Hover selection only on real movement | `src/shared/ui/hover-selection.ts` |
| Focusable controls, dialogs, backdrop, armed confirmation | `src/renderer/surface-controller.ts` (`focusable`, `focusableElements`, `registerDialog`, `armConfirmation`, `closeDisclosure`) |
| Hub pages, history, direct shortcuts, resume, footer, Actions menu, search ranking | `src/renderer/hub.ts` (`showRows`, `showView`, `direct`, `resumePage`, `menuEntries`, `openMenu`, `refresh`) |
| Row and presenter types, match tier, query grammar | `src/shared/hub.ts` (`HubRow`, `HubPresenter`, `HubDestination`, `hubTier`, `hubMatch`, `matchHubRows`, `parseHubQuery`, `normaliseHubQuery`) |
| Places on Home, Guild Hall row, the "All N places" row | `apps/tools/src/hub-travel.ts` `source.search`, plus `page(query)` for a Travel page opened with a search |
| Travel view | `apps/tools/src/components/TravelPalette.vue` (it takes a `footer` prop in the Hub) |
| Characters | `src/renderer/character-switch-palette.ts` (`hubFooter`) |
| Settings copy | `src/shared/setting-copy.ts`; Hub Settings: `src/renderer/hub-settings.ts` (`FINDABLE_SETTINGS`, `focusHubSetting`) |
| Save-as-you-edit forms | `src/renderer/trailing-save.ts` |
| Launcher Settings deep link | `app.openSettings(section)`, validated in main by `parseLauncherSettingsSection` |
| Pins and phrases | `shortcuts()`, `saveShortcuts()` in hub.ts; `src/renderer/hub-preferences.ts` |
| Calculator | `src/renderer/hub-calculator.ts` (rows), `src/shared/hub-calculator.ts` (grammar, aliases, math) |
| Keyboard shortcuts | `src/shared/keyboard-shortcuts.ts`; main-process claiming in `src/main/window-shortcuts.ts` |

## 5. UX and copy rules

Codex is weak at design. Follow these literally, and never invent beyond them.

- **Copy:**
  - Start with a verb and name the target ("Remove Kamadan from Hub?", "Switch to Toefte", "Open in launcher").
  - Keep it short and plain.
  - Never name the data model.
  - The product name in player text is **gwonmac**, lower case; never "GWonMac" or "Guild Wars Reforged" in Hub text.
  - Refusals say why and what to do ("Enter an outpost to apply this team.").
  - Never claim more than happened: "Sent /invite X. Guild Wars answers in chat.", not "Invited".
- **If a visible string, layout, colour, size or icon is not given** by this file, the story or the finding's
  Fix text: keep the current look, pick the most neutral option, and list it under
  "Needs design decision" in the PR. Do not restyle anything outside a finding.
- **Tokens only:** colours and sizes come from `src/shared/ui/tokens.css`. Text that uses the accent colour uses
  `--ui-accent-text`, not `--ui-accent` (legibility branch). Never hard-code colours.
- **Footer slots never hide.** A slot without an action is `disabled` in place. The Actions slot keeps its fixed width.
- **Anything that changes the game or the account** (travel, character switch, apply build or team,
  invite, account replace, resign):
  - it is `consequential: true`: a click selects it, and only ↵, the footer primary or a double-click on the same row runs it;
  - a fresh Home never preselects it in an explorable area (`leavesArea`);
  - a destructive primary uses `armed` or `armConfirmation`.
- **No fuzzy matching** (D-21). Deterministic tiers only. Zero results may offer at most three fill-only rows,
  which only fill the search (`searchQuery`) and run nothing (D-6).
- **Status is local and true.** Progress shows in the status line of the page that started it.
  Failures stay until the next report.

## 6. Spec: live currency icons in the Hub search (feat/calculator-inline-icons)

**What the user wants:** while typing `10 ectos in p`, the ecto icon appears beside `ectos` and the
platinum icon beside `p`, live, keystroke by keystroke. Stories: `feat-calculator-inline-icons.md`
(CALC-01…35). The text must never be rewritten, and the caret, selection, IME and undo stay native.

**Design** (decided; implement exactly this):

- Keep the native `<input role=combobox>`. It keeps its own visible text and caret. Nothing about value, focus, undo or IME changes.
- Add one sibling overlay, `<div class="hub-search-glyphs" aria-hidden="true">`:
  - It is positioned exactly over the input's text box, with the same font, size, letter-spacing, padding and `white-space: pre`.
  - It has `pointer-events: none`, and its `scrollLeft` is synced with `input.scrollLeft` on input, scroll, select and resize.
  - Its text is `color: transparent`. It holds the same characters as the input, split into spans per token, only to measure where tokens end.
- **Calculation mode:** while the query is a calculator query (Home root or calculator scope, starting with an amount),
  the input and the overlay both get the same class, which sets `word-spacing: 1.25em`.
  - Because both layers use the same spacing, the caret, selection and glyphs stay aligned.
  - Each recognised unit's icon is absolutely positioned **in the space gap right after its token**, or right after the text end for the last token.
  - The icon is vertically centred on the text line, with height `1.15em`.
  - Outside calculation mode there is no extra spacing and no icons.
- **Recognition** is a pure function, `recogniseCurrencyTokens(text)` in a new `src/shared/hub-currency-tokens.ts`:
  - It reads the calculator's own alias table from `src/shared/hub-calculator.ts`. Export that table; no second list.
  - Result: `{ start, end, unit }[]`. An exact alias wins. A prefix resolves only if every alias it prefixes maps to one unit; otherwise no icon (CALC-10, CALC-11).
  - Amounts, `in`, `to`, `each`, `stacks` and operators never get an icon (CALC-12).
  - Glued forms (`10e`, `1k`, `5plat`) get the icon after the token (CALC-13).
  - A multi-word alias (`armbrace of truth`, `zaishen keys`) gets one icon, anchored after the longest
    phrase recognised so far, with no flicker while typing (CALC-14).
  - Names, places, builds and scoped queries never get icons (CALC-15).
- **Icons** come from `src/shared/currency-assets.ts` (`currencyIcon`), the same art as the conversion card.
  - Each icon is an `img` with `alt=""` in the aria-hidden overlay.
  - Reduced motion: no transition at all. Better: never animate the icons (CALC-20).
- **Performance:** recognition runs per keystroke with no network. It must not trigger market or trader requests
  (CALC-21, CALC-22). Keep it O(length of the text).
- **IME:** do not re-render the overlay during `compositionstart`…`compositionend`; render once on end (CALC-16).
- **Tests:**
  - unit tests for `recogniseCurrencyTokens`, as a table with CALC-10…14 as rows;
  - one Playwright spec that types `10 ectos in p` key by key and asserts the icons and the exact value, plus a caret check
    (compare `input.selectionStart` glyph boundaries with the overlay span rects, ±1 px) in Classic and Modern.
- If the gap approach cannot pass CALC-03 (caret within 1 px), stop and report the measurements.
  **Do not** switch to `contenteditable`.

**D-7 default targets** (calculator logic):
- `10 ecto` → platinum; `1k` (gold) → platinum; platinum → gold; armbrace or zkey → ecto.
- Each is a labelled card, e.g. "10 ecto = 60 platinum" with "default target" in its detail.
- Units without a default (e.g. `10 iron`) keep the fill row "Add a target: …", which already exists as `conversion:complete`.

## 7. Testing and the machine: read this, it cost a day

- **Never run more than one Playwright suite at a time on this machine.** Five in parallel pushed the load average
  to 150, and tests then failed at random from timeouts.
- **Per branch**, run:
  - `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm tools:test`, and `pnpm test:policy` if you touched `src/`;
  - only the Playwright specs for files you changed: `cd apps/tools && npx playwright test -c playwright.config.ts tests/<spec> --workers=2`.
- **Do not** run the full browser suite per branch. It runs once, at integration (section 9).
- **Timing flakes:** these fail under load and pass alone. Rerun them alone before treating them as real:
  - held keys and double-click gaps;
  - `hub-navigation-window.spec.ts:441` (PPL-29 scrollTop);
  - `hub-pointer` double-click cases;
  - `hub-keyboard-contract` owned-press cases.
- **Ports:**
  - `apps/tools/playwright.config.ts` hard-codes 4179 (baseURL and webServer).
  - In a worktree other than gwonmac-hub-polish, change both to a free port (4183…4190) while you work, and **revert the change before every commit**. Never commit it.
  - Never touch other worktrees' dev servers.
- **Keyboard golden** (`apps/tools/tests/keyboard-contract.golden.json`):
  - regenerate with `KEYBOARD_GOLDEN=update npx playwright test -c playwright.config.ts tests/hub-keyboard-contract.spec.ts`
    **only while no file in that worktree is changing** (a Vite reload mid-run writes wrong cells);
  - then `git diff` it and confirm that **only** the cells you meant to change changed.
- **Regression tests:**
  - one per bug fix, through the public UI (the fixture) or the public function, that fails without the fix;
  - prove it by temporarily reverting only the fix, running the test (it must fail), and restoring; never use `git stash` for this;
  - use a table for input matrices;
  - no tests for what the framework already guarantees.
- **Tests that locate the Hub search** use `page.locator('.hub-search input')`, not its accessible name. The name
  changes per page ("Search in Heroes").
- **Scratch files:** write them only under `$TMPDIR/codex-hub-<branch>/`. The shared scratchpad was clobbered once.

## 8. Traps: what went wrong before, and what you are likely to get wrong

1. **A "duplicate" that isn't.** A person row's `actions` looked like it duplicated `run`. But in `whisper` and `invite`
   scopes the primary changes, and `actions` is the only way to the person page. Before removing anything,
   grep every scope and remap that spreads the row (`{ ...entry, run: … }`).
2. **Group order.** A group missing from the `groups` array in `refresh()` sorts *first* (indexOf −1 was the old
   bug; it now sorts last). When you add a group, put it in the list deliberately.
3. **Pins resolve through `lookup()` → `commands(true)`.** If you hide a command on the empty Home, pins must still resolve.
4. **An unavailable row is never the default selection** for a typed query (HUB-056). Example: the player is in Lion's
   Arch, so `la` correctly selects the next place. Don't "fix" tests by picking a place the fixture is in.
5. **The footer:** never hide it or a slot. Never let a label change the Actions slot width. A primary never wraps.
6. **Double-click and held keys:**
   - every new clickable that runs something must ignore `event.detail > 1` unless it is the defined double-click runner;
   - every key handler must ignore `event.repeat` for actions.
7. **Escape and ⌘⌫ order:** close the menu (`closeMenu()`), then disclosures, then the query, then the page.
   The menu's own keydown uses `stopPropagation` on Escape.
8. **Focus after a DOM rebuild:** re-focus by `aria-label` or selector (see `repaint()` in hub-settings.ts and
   `restoreFocus` in hub.ts), and never leave focus on a removed node.
9. **Direct shortcuts:** pass `destination` to `showView`/`showRows` for Travel, Characters, Build Library and Settings
   (and Accounts). Do not reintroduce the removed "opening" side-channel.
10. **Travel page state:** each Travel page gets its own `page()` closure. Never share `resume` state across pages.
11. **Settings:** never write a new visible settings label in only one surface. Add it to `setting-copy.ts`.
12. **Stored data:** pins, phrases, settings and library files are the player's data. No migration may drop or rewrite them.
    Keep old shapes readable.
13. **Policy tests** (`tests/policy/*`) pin exact source lines for storage and security. If you refactor such a line,
    update the policy proof without widening what it allows.
14. **Electron and live game:** you cannot verify input feel or live-game behaviour. Say so in every PR.
    Never claim it.
15. **Don't touch:** `main`, merges, release branches, prod, secrets. Never merge a PR. Never force-push a branch that
    already has an open PR, except to rebase it within the stack, and then say so in the PR.

## 9. Integration: the last step

When the queue is done:

1. Create `integration/hub-polish` from `main` in a new worktree.
2. Merge the stack in PR order (#461 → … → #470 → search → the siblings → calculator → the remaining branches).
3. Resolve conflicts:
   - `keyboard-contract.golden.json`: regenerate it at the end, and don't hand-merge it;
   - `hub.ts`, `hub-fixture.ts`, `hub.css`: keep both sides' intent.
4. Run once, alone on the machine: `pnpm check` and the full tools browser suite (`npx playwright test -c
   playwright.config.ts`). Rerun failures alone, and fix only the real ones.
5. Open one draft PR `integration/hub-polish` → `main`. Its body contains:
   - every finding ID closed, and those deferred with their reason;
   - the "Needs design decision" list;
   - the live checks only Matthias can do (in the game, VoiceOver, AZERTY keyboard).

## 10. Open decisions for Matthias

Do not decide these. List them in the relevant PR and move on.

- **Scrim policy.** Classic dims the game about 61 % behind the Hub; Modern doesn't dim. Should it be the same in both? The legibility agent recommends no dim in both.
- **D-9:** ⌘R (Hub) should be rebindable. It touches persistence and the native claim, so it waits for a decision.
- **⌘↵ secondary action (KEY-05).** Not built. Add it only once a row family (accounts: open vs replace) models a named second action.
- **HUB-238 minimum Hub height.** It should be 380 instead of 300 (`src/renderer/hub-window.ts` lines 35 and 79, plus the policy test).
- **Travel's "⌘1–9 save" hint** left with Travel's own footer. Should the Hub legend show view-specific keys?
- **HUB-186:** order Continue by recency. It needs timestamps across sources.

## 11. PR body template

```
## Outcome
<what the player can now do, in plain words; before → after for the main case>

## Findings closed
HUB-…, D-…

## Deferred, with reasons
- HUB-… — <why, where it goes>

## Needs design decision
- <every visible choice not specified by the handoff, story or finding>

## Tests
- <spec/unit — what it proves; "fails without the fix: yes">

Checks run: <exact commands and pass counts>. Full browser suite: runs at integration.

## What automation could not prove
Live game, input feel, VoiceOver, AZERTY. Needs Matthias.
```
