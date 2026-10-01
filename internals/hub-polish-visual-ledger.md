# Hub visual consistency ledger

Base: perf/hub-scale-and-a11y at 1e58d684 (#482). Dedicated worktree: gwonmac-visual-consistency.

## Inspection

Read AGENTS.md, docs/README.md, the handoff, all assigned findings and the complete story. Existing source confirms the separate Maps renderer, literal type sizes, inconsistent focus, broken folder URL, mismatched Price basis label, variable preview geometry and tall Home build rows. No player data was changed.

Before preview: own fixture port 4634, Classic 1280×720. Home has 46 px rows; calculator shows Quote basis above the card and capitalized item names.

Initial report extractor expected Markdown headings, but findings use bold headings or table rows. It found nothing; then all assigned report sections were read directly. Some combined read outputs were truncated; targeted source reads followed. No finding was classified from those truncated outputs.

Open handoff section 10 decisions remain open. Live game, input feel, VoiceOver and AZERTY cannot be verified.

## Early corrections

The first CSS edit used a nonexistent half-spacing token; source inspection caught it before testing. It now derives 2 px from the existing 4 px token. A broad type-ramp replacement also touched whisper popout rules outside the finding; those lines were restored. Reserved blank comparison geometry uses visibility:hidden, so it remains inaccessible and existing hidden-preview assertions stay true.

First targeted browser run: five passed; folder setup failed because it clicked the navigational template row (which already opens it), then pressed Enter and opened the first folder. Removed the extra Enter; not product failure evidence.

Perf draft #482 CI failed before runtime at Audit dependencies (run 36811015348, job 110205929307), the same existing dependency blocker as earlier drafts.

Text-size typecheck initially found the release roundtrip candidate's complete AppSettings literal lacked the new field. Added its unchanged 100% value, then typecheck passed. The new preference uses existing settings parsing/default merging and does not migrate player files. Older application writers may discard this preference, as with calculator rates; retain Beta consideration and verify compatibility boundaries at integration.

Seven new UI scenarios pass. Six independent backout runs fail: folder image URL, footer keycap class, Price basis label, 2 px row outline, currency capitalization, and appearance scaling. Logs are under $TMPDIR/codex-hub-visual/red-*.log. Every run used --workers=2, sequentially, and finally restored source. The Maps backout needs the real original Maps owner; no fabricated substitute was run.

The searchQuery runner still preserved duplicate Home breadcrumbs. It now calls the existing home() owner before filling the query and selecting the argument. Reserved comparison height is restricted to full build rows; compact Home builds do not reserve a blank preview.

The compact Home regression caught a real CSS defect: bars are inside hub-build-info, not direct row children. Hide the owning info wrapper. The example story names travel kamadan, but current Commands offers travel <place> and fills travel plus a trailing space. Preserve the current catalogue; the regression uses that real example and verifies the argument insertion point at 7 instead of inventing an extra example.

Latest new spec: 9 passed (4.8 s), --workers=2, log $TMPDIR/codex-hub-visual/navigation-density-corrected.log. Real original Maps renderer backout failed at the missing Settings Maps heading; original current source restored. No browser suite is running.

## Queue recorded midway through this branch

Finish/check HUB-145 shared search geometry, HUB-147 token/heading consistency, HUB-148 Travel/Characters selection, HUB-151 preferences/nav anatomy, HUB-155 overflow cues, HUB-156 distinct action icons, HUB-157 remaining grouping/plurals/copy art, HUB-158 header geometry. Add regression proofs for HUB-153 and HUB-187, reserve-preview geometry, selection and header. Update old Maps tests to the new Settings owner (checkboxes/status/Settings breadcrumb; preserve settings even when tool disabled), and old Esc legend assertions to glyph notation. Run only touched specs with two workers; then pnpm check, diff review, restore port, commit/push/draft on perf/hub-scale-and-a11y before Sweep.

No findings are finally classified yet. Header context border, 144 px preview reserve, token mapping, chosen icon variants and any unspecified text-size control placement need explicit design-choice entries. Do not change legibility projection.

Shared search geometry uses a shared glyph module with three real consumers and one scoped CSS primitive. Each feature retains its native input, query, focus and history logic. Removed duplicate feature geometry, preserved the calculator gap override. First geometry run found Characters inherited ui-input min-height 34px, making its field 54px instead of 48px. CUA computed geometry confirmed it; the primitive now removes that inherited minimum. Three currency-icon scenarios passed during that run.

Calculator grouping uses a separate display formatter; parser decimals stay canonical. Unit expectations now protect grouped gold and 1 stack, with an added single remaining point case. Footer currency targets use their canonical art. The latest combined visual/calculator/currency run passed 22 scenarios (10.7 s).

The first full gate stopped at typecheck: centralizing text-size imports accidentally inserted the new constants in the existing opacity validator argument list. Removed those two extra arguments before rerunning; no opacity boundary change is intended.

The second gate passed typecheck/lint/link checks, then five unit checks failed: four exact settings snapshots/key lists omitted the added 100% default, and the UI token inventory required the --ui-text-scale declaration. Updated their literal expectations and declared scale 1. CUA inspected Settings at 200%; it found the Appearance nav label overlapping the body, so the column now fits max-content and the browser regression checks its overflow.

Touched-owner run: 64 passed, nine failed. One failure is the intentional named Copy target change. Several tests still required the old exact dialog name Hub or an unqualified heading/status; the Perf branch now names the page and persistent status regions. Updated those precise locators. The preflight test expected a withdrawn selection to return automatically; it must explicitly select again after availability changes, preserving the earlier safety fix.

Two existing regressions found a real discoverability gap: commandExamples only used builtin command ids, but Build Library is supplied by its canonical source. Reused lookup('builds') to include its existing examples only when that owner is available. Existing disabled-capability and Home hint tests are the regression evidence; the failing pre-fix run is recorded above. No new source search or cache was added.

Selection/overflow/icon spec: 12 passed, two setup failures. The overflow case sent the direct shortcut before fixture readiness; it now awaits data-ready. The person action case tried Right Arrow on a row whose existing primary is View actions and has no navigate; it now uses Enter. No product behavior was changed for these setup errors.

Type/header/preference run: 16 passed; the literal visible-text ramp test found the Close Hub × glyph used a 22px inherited component size. Mapped it to the existing 20px title role, with its hit target growing only when text scaling needs it. This neutral role choice needs design review. No test exclusion was added.

The final gate passed typecheck/lint/links, then one exact sorted saved-field list failed: I inserted uiTextSize before uiStyle. Corrected lexical ordering. No saved data or validation behavior changed. The close button fix first targeted .ui-button, but the actual button uses .ui-window-close; the repeated regression caught this incorrect selector. The #hub .hub-close rule now passes all 17 scenarios.

CUA at 1280×720, 200% Classic Settings: the nav fits and the body scrolls inside the fixed frame. Text-size input caused rerender; a subsequent Tab sent to its obsolete AX index failed, while fresh state confirmed 200% was saved in the disposable fixture. Standalone Travel/Characters retain their existing magnifier glyph.

Backout round two: Home routing and compact-bar regressions failed as expected. Shared-search backout unexpectedly passed because all three fields became equally oversized; the geometry test compared them with a changed baseline. Added the literal 48 px expected height, so it proves both parity and the decided size. All mutated source was restored before this test correction.

VIS-19 missing regression failed before the fix: first group moved 42 px across k/trade/1p in a/10 ecto in p. Moved the existing grammar hint into one reserved status strip and the existing Price basis control inside the selected conversion card. The picker is retained by its owner, with focused-control restoration after a result repaint. No new settings or quote authority. Reserved status height derives from caption line height plus 8 px; this neutral geometry needs design review. Team/build reserved-preview geometry passes the same regression.

Touched run: 79 passed, one settings scenario failed. Isolated rerun passed. Investigation found it injected an external memory setting before the optimistic checkbox's pending save settled, letting that save overwrite the injection. Added a wait for the existing aria-busy save state to clear before the independent external change. This is test synchronization, not a product fix or blanket retry.

The first full material matrix exposed a real cross-style geometry mismatch: Modern search width 750 px versus Classic 724 px, with a 13 px horizontal shift. The frame art tokens use 7 px versus 20 px padding. Scoped the Hub content inset to the existing Classic 20 px value; artwork remains material-owned. This visible choice implements VIS-14, with the baseline choice listed for design review.

The expanded typography check passes every named view at default size. The mixed-selection regression initially used gom, which has no standalone build, so it could not prove team/build transitions. It now uses m and explicitly requires both row families. One late quote replaced the group between a visibility assertion and boundingBox, returning null. Atomic DOM geometry reads avoid that fixture race.

Material matrix then caught a 4 px Modern header jump on Commands. Raising the Back selector specificity did not fix it. CUA measured Home header 42 px and Commands 46 px: the breadcrumb button's 28 px minimum plus nav padding made the nav 36 px. Set only the Hub breadcrumb to the existing 24 px minimum target, and reverted the ineffective Back selector change. An initial CUA inspection called checkVisibility on SVG; it failed read-only, then a bounded button/span/nav inspection established the actual cause. Removed obsolete feature selection paints and old hint/status rules after the new owners passed.

The breadcrumb correction reduced the Modern shift from 4 px to 2 px. The remaining cause was also the Back button: Modern's actual shared control minimum is 34 px, not the 32 px I assumed. Both Hub breadcrumb minimum (24 px) and the existing Back target (28 px) must win over material defaults. Final diff review also found two unrelated Whisper header/composer rules still changed by the earlier broad restoration. Restored every Whisper-only rule from its matching original occurrence, preserving repeated selectors correctly.

Repository gate passed before these final CSS corrections: 1,856 unit, 185 policy, 266 Tools, 82 Launcher. A final gate and touched browser run will cover the completed source.

The full VIS-14 matrix now passes: both styles × six fonts × two opacity values × 13 named states. A final row review found the guessed 72 px cue slot could not fit four supported keycaps. A first test looked only at the aligned right edge and falsely passed. The corrected test checks both edges and fails with a 32 px overlap. It also supplies the complete typed appearance fixture. The slot now derives 108 px at 100% (nine caption-size units), scaling with text. Record this neutral width choice for design review.

Final boundary checks exposed three real gaps: Preferences icons plus 8 px padding produced 44 px rows; Settings shortcut recorder created 14 kbd nodes without the shared class; the moved Price basis inherited the list's unconditional mousedown cancellation and row click action. Their regressions failed before each fix. Preferences uses 4 px block padding. The recorder uses ui-kbd. List mouse/context actions explicitly exclude the retained native rate controls; their keyboard primary behavior stays unchanged. Reserved status, lifecycle and hint text has its complete string in the native hover title when visually ellipsized.

Final touched run before these corrections: 81 passed, one preflight selection race failed. The test sent ArrowDown before the coalesced availability refresh and then lost that selection as required by the safety rule. It now awaits the row's aria-disabled=false before explicitly selecting it. No implicit selection behavior was restored.

Final source gate passes: 1,856 unit, 185 policy, 266 Tools, 82 Launcher, plus typecheck/lint/links. Browser run: 81 passed; the mouse regression's cleanup Escape intentionally cleared the Hub query, then its next step waited for a vanished picker. Mouse focus itself now passes. Replaced that incorrect cleanup with normal Tab, preserving the decided Escape model. No product Escape behavior changed.

## Final classification

| Finding | Status and evidence |
|---|---|
| HUB-089 | Closed: native folder glyph; image-URL backout fails. |
| HUB-107 | Closed: removed separate Maps owner; real old-owner backout fails. Settings keeps disabled child values and handles external/failing saves. |
| HUB-116 | Closed: 100–200% token scale, default reset, fixed frame, no document zoom; main/IPC backouts fail. D-16 implemented. |
| HUB-145 | Closed: one field primitive/glyph, literal 48 px geometry, and 312 style/font/opacity/view combinations. Geometry backout fails. |
| HUB-146 | Partial: footer/row/menu/Settings keycaps use glyphs and ui-kbd. Deferred literal treatment of native title tooltips and shared prose instructions; see below. |
| HUB-147 | Closed: visible text in all named views uses token roles and readable line heights. Close-glyph backout fails; token inventory passes. |
| HUB-148 | Closed: shared selected fill/rail and 2 px row/chrome/breadcrumb focus. Selection and focus backouts fail. |
| HUB-149 | Closed: one Price basis label, aligned native controls inside card, retained selection/focus and mouse boundary. Label and mouse regressions fail without fixes. |
| HUB-150 | Closed: 40 px flat rows, one-line accounts, aligned icon/cue columns and four-key cues at 100/200%. Old density and insufficient cue width fail. |
| HUB-151 | Closed: nav selection/rail, intrinsic controls, canonical preference glyphs and 40 px preference rows. Missing icon and old 44 px height fail. |
| HUB-153 | Closed: real Home owner before example fill, argument selection and fresh input. Old route backout fails. |
| HUB-155 | Closed: padded recent destination edge cue/top alignment. Characters keeps its existing pagination arrows. Mask backout fails. |
| HUB-156 | Closed: distinct Character/account/invite/action glyphs; old kind backout fails. |
| HUB-157 | Closed: grouped display values, unified sides, original item case, singular stack/point, named copy art and accurate digit errors. Prior Calc fixed same-unit detail/duplicate error text already. Grouping/case/error/plural backouts fail. |
| HUB-158 | Closed: separated context and one visible Characters page heading; separator backout fails. |
| HUB-187 | Closed: compact pinned/recent build presentation on empty Home, full bars in explicit search. Wrapper backout fails. |
| HUB-105 follow-up | Closed: reserved hint/status and comparison geometry, card-contained Price basis. Before fix first group shifted 42 px; preview backout fails on a real mixed team/build query. |
| HUB-093 follow-up | Closed: Commands includes canonical Build Library examples; existing regressions failed before lookup fix. |

HUB-146 residual: native browser title tooltips are plain text and cannot contain DOM keycaps. Shared setting descriptions also contain existing prose such as Enter confirms; Escape cancels. Converting these into rich keycap copy needs a defined presentation/copy contract across Hub and Launcher. Kept their current wording rather than introducing that contract or restyling unrelated prose. The PR explicitly defers this literal part of VIS-23 and asks design to define its boundary. Actual keycap hints are corrected.

## Final evidence and limitations

- pnpm check: passed typecheck, lint, Markdown links, 1,856 unit, 185 policy, 266 Tools and 82 Launcher tests.
- Touched browser set: 82 passed, 29.3 s, --workers=2. Includes 20 new Visual scenarios, the 312-combination matrix, calculator/currency icons, Hub polish and Hub owner regressions. No completed full browser suite on this branch.
- Regression backouts: six initial, real original Maps owner, eleven second-round cases and five final cases all fail. Corrected weak geometry/right-edge tests are documented above; every mutated file was restored. Logs stay under $TMPDIR/codex-hub-visual.
- CUA inspected Classic Home/currency at 1280×720, Classic Settings at 200%, and Modern header geometry. Browser specs cover the existing 390×650/640×480 preview cases and 800×600 native picker. These are synthetic fixtures.
- Real player pins, phrases, settings and library were not moved, migrated or dropped. uiTextSize is an additive validated preference, default 100; older writers may discard it. This requires Beta consideration and compatibility QA, not an automatic migration or fallback.
- Final review restored every unrelated Whisper-only CSS rule, removed the old Maps file/CSS and duplicate selection rules, and restored canonical browser port 4179. Remote base equals 1e58d684a11ef90369b81663db9434bdc62a9ebc.
- Live game, input feel, VoiceOver and AZERTY remain unverified. Handoff section 10 remains open: scrim parity, D-9, KEY-05, HUB-238 minimum height, Travel save hints and HUB-186 recency.

## Needs design decision

Neutral visible choices: subtitle role for page h2; title role for calculator sides/close glyph; 108 px scaled trailing slot; 144 px comparison reserve; caption-line-plus-8 px status reserve; existing Classic 20 px content inset in both materials; 24 px breadcrumb minimum; context divider; drawn Character/account/invite/prompt variants; 8 px recent edge fade; Text size control placement. No legibility math or palette projection changed.

Handoff mismatch: Commands offers travel <place> and inserts travel plus a trailing space, not the story's travel kamadan example. Preserve the existing catalogue. VIS-23's all-tooltips/all-prose ui-kbd reading is incompatible with native plain-text tooltip formatting; kept that residual deferred.
