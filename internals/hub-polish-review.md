# Hub polish integration review

244 findings are closed and 11 are deferred. Every one of the 255 plan IDs appears exactly once in [the machine-readable ledger](hub-polish-findings.json). Closure refers to the implemented offline boundary, never live game QA.

All 21 topic PRs remain drafts. #459 is the already merged Wave 0 base. The integration branch locally merges each topic tip; no GitHub PR or protected branch was merged.

## Findings and PRs by branch

| Branch | PR | Closed findings | Deferred findings |
| --- | --- | --- | --- |
| feat/party-invite | [#459](https://github.com/Mat4m0/gwonmac/pull/459) | HUB-006, HUB-007, HUB-015, HUB-030, HUB-031, HUB-082, HUB-203 | None |
| test/hub-fixture-lifecycle | [#462](https://github.com/Mat4m0/gwonmac/pull/462) | HUB-228, HUB-239, HUB-255 | None |
| fix/hub-pointer-safety | [#463](https://github.com/Mat4m0/gwonmac/pull/463) | HUB-242, HUB-244, HUB-246, HUB-248 | None |
| fix/hub-input-safety | [#464](https://github.com/Mat4m0/gwonmac/pull/464) | HUB-001, HUB-002, HUB-003, HUB-009, HUB-033, HUB-034, HUB-048, HUB-075, HUB-130, HUB-133 | None |
| fix/hub-session-bound-runs | [#465](https://github.com/Mat4m0/gwonmac/pull/465) | HUB-004, HUB-016, HUB-035, HUB-072, HUB-083 | None |
| feat/hub-keyboard-model | [#466](https://github.com/Mat4m0/gwonmac/pull/466) | HUB-005, HUB-044, HUB-045, HUB-046, HUB-047, HUB-053, HUB-054, HUB-079, HUB-088, HUB-120, HUB-136, HUB-137, HUB-138, HUB-140, HUB-234 | None |
| fix/hub-focus-and-shortcuts | [#468](https://github.com/Mat4m0/gwonmac/pull/468) | HUB-018, HUB-019, HUB-020, HUB-021, HUB-023, HUB-036, HUB-049, HUB-050, HUB-052, HUB-055, HUB-071, HUB-074, HUB-109, HUB-128, HUB-172, HUB-223 | None |
| feat/hub-actions-and-footer | [#470](https://github.com/Mat4m0/gwonmac/pull/470) | HUB-040, HUB-041, HUB-042, HUB-043, HUB-084, HUB-100, HUB-105, HUB-174, HUB-175, HUB-179, HUB-184, HUB-232, HUB-233, HUB-235 | None |
| fix/hub-search-and-discovery | [#471](https://github.com/Mat4m0/gwonmac/pull/471) | HUB-008, HUB-010, HUB-056, HUB-057, HUB-058, HUB-059, HUB-060, HUB-061, HUB-062, HUB-063, HUB-064, HUB-065, HUB-066, HUB-090, HUB-091, HUB-092, HUB-093, HUB-094, HUB-096, HUB-102, HUB-141, HUB-142, HUB-143, HUB-144, HUB-152, HUB-177, HUB-185, HUB-189, HUB-224 | HUB-095, HUB-186 |
| fix/travel-characters-lifecycle | [#475](https://github.com/Mat4m0/gwonmac/pull/475) | HUB-011, HUB-012, HUB-017, HUB-027, HUB-067, HUB-068, HUB-070, HUB-073, HUB-076, HUB-188, HUB-190, HUB-191, HUB-192, HUB-193, HUB-194, HUB-195, HUB-196, HUB-197, HUB-198, HUB-199, HUB-231, HUB-245, HUB-247, HUB-250, HUB-251 | HUB-051, HUB-069, HUB-135 |
| feat/calculator-inline-icons | [#479](https://github.com/Mat4m0/gwonmac/pull/479) | HUB-022, HUB-098, HUB-099, HUB-101, HUB-103, HUB-104, HUB-159, HUB-178, HUB-211, HUB-212, HUB-213, HUB-214, HUB-215, HUB-216, HUB-217, HUB-218, HUB-219, HUB-220, HUB-221, HUB-222 | None |
| fix/trade-keyboard-and-identity | [#478](https://github.com/Mat4m0/gwonmac/pull/478) | HUB-013, HUB-024, HUB-025, HUB-117, HUB-118, HUB-119, HUB-121, HUB-122, HUB-123, HUB-124, HUB-125, HUB-126, HUB-127, HUB-129, HUB-131, HUB-132, HUB-225, HUB-226, HUB-227, HUB-229, HUB-230 | HUB-108 |
| fix/people-builds-feedback | [#481](https://github.com/Mat4m0/gwonmac/pull/481) | HUB-026, HUB-028, HUB-029, HUB-032, HUB-077, HUB-078, HUB-080, HUB-085, HUB-086, HUB-087, HUB-097, HUB-154, HUB-173, HUB-176, HUB-182, HUB-183, HUB-200, HUB-201, HUB-202, HUB-204, HUB-205, HUB-206, HUB-207, HUB-208, HUB-209, HUB-210 | None |
| fix/hub-native-layout | [#474](https://github.com/Mat4m0/gwonmac/pull/474) | HUB-014, HUB-037, HUB-038, HUB-134 | None |
| perf/hub-scale-and-a11y | [#482](https://github.com/Mat4m0/gwonmac/pull/482) | HUB-081, HUB-110, HUB-111, HUB-113, HUB-114, HUB-115, HUB-160, HUB-161, HUB-162, HUB-163, HUB-164, HUB-165, HUB-166, HUB-167, HUB-168, HUB-169, HUB-170, HUB-171, HUB-254 | HUB-112 |
| fix/hub-visual-consistency | [#483](https://github.com/Mat4m0/gwonmac/pull/483) | HUB-089, HUB-107, HUB-116, HUB-145, HUB-147, HUB-148, HUB-149, HUB-150, HUB-151, HUB-153, HUB-155, HUB-156, HUB-157, HUB-158, HUB-187 | HUB-146 |
| chore/hub-polish-sweep | [#484](https://github.com/Mat4m0/gwonmac/pull/484) | HUB-139, HUB-180, HUB-181, HUB-236, HUB-240, HUB-241 | HUB-237 |
| fix/hub-appearance-legibility | [#473](https://github.com/Mat4m0/gwonmac/pull/473) | HUB-106, HUB-249, HUB-252, HUB-253 | HUB-039, HUB-238 |
| fix/custom-modern-frame-mask | [#460](https://github.com/Mat4m0/gwonmac/pull/460) | HUB-243 | None |
| fix/hub-invite-followups | [#461](https://github.com/Mat4m0/gwonmac/pull/461) | HUB-006, HUB-007, HUB-030, HUB-031, HUB-082 | None |
| feat/settings-in-game | [#469](https://github.com/Mat4m0/gwonmac/pull/469) | HUB-064, HUB-116, HUB-236 | None |
| fix/hub-pins-and-phrases | [#477](https://github.com/Mat4m0/gwonmac/pull/477) | HUB-061, HUB-062, HUB-064, HUB-090, HUB-091, HUB-092, HUB-152, HUB-177 | None |

Extra Invite, Settings and Pins rows identify later owners of the same findings. They do not increase the 255-finding total. The Legibility plan name is replaced by the actual v2 branch.

## Deferred, with reasons

- HUB-039 — Reduce Transparency blackout is fixed. Matching Classic and Modern scrims remains handoff section 10's explicit product decision.
- HUB-051 — Fixture source withdrawal, refusal and page ownership are fixed. Live installation and lifecycle behavior requires Matthias; no live proof is claimed.
- HUB-069 — Spatial Travel navigation is fixed. Up from its first row holds under the handoff's no-wrap contract; changing that edge to Back needs a decision.
- HUB-095 — Rebinding Command-R needs persistence and the native claim decision D-9; explicitly deferred by handoff section 10.
- HUB-108 — Preserve the existing floating composer placement and fallback. The finding does not specify a replacement placement or collision policy.
- HUB-112 — Selection and unchanged-hover work is bounded. Complete 1000-build Library entry measured 107.5ms with long tasks. Guessed containment heights broke scroll restoration and were removed.
- HUB-135 — Loading refusals and fixture source lifetimes are covered. Live client installation and map-transition behavior remains unverified.
- HUB-146 — Visible shortcut keycaps are consistent. Native tooltip and free prose formatting cannot use DOM keycaps; a replacement copy/tooltip policy remains open.
- HUB-186 — Cross-source Continue recency needs timestamps and remains an explicit handoff section 10 decision.
- HUB-237 — The apparent locked resize hatch belongs to a shared Classic bitmap frame. An authorized replacement asset or corner masking policy is unspecified.
- HUB-238 — Narrow footer wrapping is fixed. Raising the minimum height from 300 to 380 remains handoff section 10's explicit decision; three rows at minimum height are not claimed.

## Needs design decision

The following sections retain each draft PR's disclosed visible choices. A choice recorded here is not an approval or a new product requirement.

### [#469](https://github.com/Mat4m0/gwonmac/pull/469)

- Settings still opens on **Tools**, the most frequent in-game change, then on the last-used section in the session. Game is first in the list and reached by search.
- The launcher keeps its current sections. The deep editors (custom theme colors, map styles, skill labels) stay in the launcher, one click away.

### [#471](https://github.com/Mat4m0/gwonmac/pull/471)

- Neutral Commands group names: Places, Characters, Builds, People, Trade, Accounts, Calculate. “Keys & shortcuts” follows the story.
- Personal and folder list pages keep “Search in <page title>…”, preserving name spelling. Named lists use the specified “Search heroes…”, “Search commands…” and “Search builds…”.
- The inherited show-all entry says “All N places”; the finding and story use different wording. Keep the existing label pending design review.

### [#473](https://github.com/Mat4m0/gwonmac/pull/473)

- Choose separate surface inks or custom-palette constraints for opposing colours. Current white-window fallback is #5F5F5F and remains sub-AA on controls; do not treat this as finished custom legibility.
- Scrim policy and minimum height remain open, as instructed. No new visible names or styles are introduced outside these findings.

### [#474](https://github.com/Mat4m0/gwonmac/pull/474)

- None introduced by Native layout. Existing saved letter bindings intentionally follow named letters on non-US layouts; inspect older custom bindings on physical hardware before acceptance.

### [#475](https://github.com/Mat4m0/gwonmac/pull/475)

- Keep the inherited switch veil: 18% black and bottom alignment at 18vh. The handoff specifies containment and copy, but not those visual values. Its paint now uses shared tokens.
- First-row Up behavior: see HUB-069 above.
- Travel's view-specific ⌘1–9 save hint remains the open handoff decision; no legend policy was invented.

### [#477](https://github.com/Mat4m0/gwonmac/pull/477)

- Mounted view secondaries reuse the existing menu group `Details`; its group label was unspecified.
- SRC-29 asks for cross-owner ordering, while the handoff and HUB-090 require two labelled groups. Kept the specified groups and existing stores.
- Handoff section 10 stays open: scrim policy, D-9 Command-R rebinding, KEY-05 named secondary Command-Enter actions, HUB-238 minimum height, Travel's Command-1–9 legend, and HUB-186 cross-source recency.

### [#478](https://github.com/Mat4m0/gwonmac/pull/478)

- Choose the HUB-108 composer placement and narrow fallback while preserving saved placement.
- Review neutral inline clipboard-refusal wording and the stale-row warning edge.
- Review neutral bright ink for the menu check after the legibility branch is integrated; its `--ui-accent-text` token is absent on this branch’s base.
- All six handoff section 10 decisions remain open: scrim policy; persistent native Command-R claiming/rebinding; a named Command-Return secondary; Hub minimum height; Travel Command-1–9 save legend; cross-source recency timestamps.

### [#479](https://github.com/Mat4m0/gwonmac/pull/479)

- `1k`: the handoff calls it gold, while the parser and calculator story define it as platinum. Preserve `k = platinum` and default `1k` to `1000 gold`; no alias reinterpretation.
- No calculator scope name is invented. Specify whether to add one later.
- Tiny nonzero values retain three significant digits, including trailing zeros when precision extends past six decimals.
- Neutral new copy: `Calculation` → `Result`, `Default target`, `Newest ad …`, named material/unsupported-route explanations and the disabled automatic-price prompt. Existing title/basis/editor labels remain.
- Price details uses neutral labelled rows: Source, Price basis, Median rate, Advertisers, Ads since, Newest ad, Last fetched. Fixed stack conversions cite their actual stack size.
- The six unresolved handoff §10 decisions remain open for integration; this PR does not resolve unrelated appearance, shortcut, height, Travel legend or recency policy.

### [#481](https://github.com/Mat4m0/gwonmac/pull/481)

- Hero build/behaviour changes use counts, matching the existing workspace assessment; removal names, roster rebuilding and mode remain explicit. Listing every changed hero clipped the first skill bar at 940×500; the count presentation passes that viewport proof.
- Mercenary labels use generic English fallbacks (`Mercenary 1`–`Mercenary 8`); actual account-specific names need observation. Stored IDs/names remain untouched.
- Cancel stops the pending invite and does not undo accepted Travel. PPL-18's proposed “Travel was cancelled” would make a false claim.
- Receipt uses the existing opaque dark material beneath success/error tint, independent of panel opacity. This keeps its text legible over bright scenes; custom-palette-wide contrast remains the Legibility branch's separate limitation.
- Existing Apply terminology remains “apply this build”; BLD-18's “load this build” wording is not a second operation.
- Handoff section 10 remains open: Classic/Modern scrim policy, D-9 Hub rebinding, KEY-05 named secondary ⌘↵, HUB-238 minimum height, Travel's ⌘1–9 legend, HUB-186 cross-source recency.

### [#482](https://github.com/Mat4m0/gwonmac/pull/482)

- Neutral invalid/reserved shortcut feedback wording.
- Unlocked move-hint wording and header placement.

### [#483](https://github.com/Mat4m0/gwonmac/pull/483)

- Existing subtitle role for page headings; title role for calculator sides and Close glyph.
- Nine caption-size units for the trailing cue slot: 108 px at 100%, scaled with text. It fits four supported keycaps.
- 144 px comparison reserve and caption-line-plus-8 px reserved footer status. Long status text keeps its complete native hover title.
- Existing Classic 20 px content inset in both materials; 24 px breadcrumb minimum prevents Modern navigation jumps.
- Context divider, drawn Character/account/invite/prompt glyph variants and 8 px destination edge fade.
- Text size placement in Appearance; it uses the existing settings persistence owner. Older application writers may discard this additive preference. Recommend Beta consideration and compatibility QA before release.
- Define whether VIS-23 includes native tooltip/prose instructions, since those cannot use inline keycaps without a new copy contract.

### [#484](https://github.com/Mat4m0/gwonmac/pull/484)

- Confirm Travel and Switch Character as shared labels, preserving Hub names and replacing Settings' Quick Travel/Character Switch names.
- Confirm Xunlai Storage as the noun; Open Xunlai Storage remains its action and old search alias.
- Retry settings occupies the common footer; failure copy says Settings could not load. Try again.
- Choose the locked Classic corner artwork treatment (HUB-237).

### Integration choices

- Character failure prefix: `Switch to <name> stopped.` It names the attempted action and retains the owner's failure explanation.
- A carried failure uses the existing 90-second Hub resume lifetime and is consumed once. The handoff does not specify another lifetime.
- Resolved Travel notices clear only their own matching receipt. They cannot erase a newer outcome from another owner.

## Handoff section 10: still open

- Scrim policy: Classic currently dims the game about 61%; Modern does not.
- D-9: Command-R rebinding must include persistence and the native claim.
- KEY-05: generic Command-Enter secondary actions need a real named row-family action. Command-Enter never runs the primary.
- HUB-238: decide whether the minimum Hub height becomes 380 instead of 300.
- Travel: decide whether the shared legend names view-specific Command-1–9 save shortcuts.
- HUB-186: Continue recency requires timestamps across sources.

## Other unresolved requirements

- Arbitrary custom-palette AA needs separate surface inks or palette constraints. The neutral fallback is sub-AA on opposing custom control surfaces.
- No calculator scope exists. Adding one needs a reserved scope word decision; current root amount input displays live currency icons without rewriting text.
- Existing parser/story k means platinum. 1k defaults to 1000 gold; the handoff's unit name disagrees.
- Public rollback: old Stable writers can drop new additive calculatorRates and uiTextSize fields on a later settings write. Resolve before a public Beta; existing stored data was not migrated.
- Cold/warm +/-20% timing ratios are unstable at small durations. Absolute twenty-cycle limits are the reported proof.
- Exactly two total announcements conflicts with named failures and connection honesty. Passive offer/slider noise is removed; required outcomes remain announced.
- Preserve full player-supplied build names, including names longer than twelve words.

- BLD-27's external template editor import/save interface is not specified. Existing import persistence remains; no new editor path was invented.
- Held Enter for Team and Invite has browser proof. Native coverage for those two flows remains incomplete; native Travel proof does not establish them.

## Verification

- `pnpm check`: typecheck, lint, Markdown links, 1872 unit tests, 186 policy tests, 278 Tools tests and 82 Launcher tests pass.
- Full Tools browser suite ran once with `--workers=2`: 748 cases; 708 passed initially. All 40 failed cases pass when rerun alone after owner fixes and stale assertion reconciliation. No failure is silently skipped or described as a flake.
- Additional targeted regressions pass for delayed completion, receipt lifetime and ownership, phrase collisions, Travel double-click identity, running review, Whispers accessibility structure and confirmation visibility at 1280 and 390 pixels.
- Touched Electron specs: 40 cases; 17 passed initially and all 23 failures pass individually after reconciliation and the confirmation visibility fix. The disabled-tool shortcut regression is enabled and passes.
- `pnpm build`, both kernel integrity checks, 112 integration tests and 30 release tests pass. Signed packaging, the complete untargeted Electron suite and `pnpm verify` were not run. The latter would repeat the full Tools suite.
- Hosted topic application checks stop at the existing dependency audit before runtime verification. Dependency upgrades are outside this change. Inspect the integration PR's current checks before merge.

See [the integration ledger](hub-polish-integration-ledger.md) for red/green evidence, merge resolutions and mistakes.

## What automation could not prove

Matthias must check live gameplay, graphics and input feel; VoiceOver speech; physical AZERTY/QWERTZ input; live client installation and transitions; signed exact-draft QA and rollback behavior. Automation did not perform or pass these checks.

Use a Developer Build for this combined change and consider one Beta train after those checks. Only Matthias can accept the exact draft and authorize publication.

## Handoff corrections

- Pins had six dirty files, not the seven listed in the handoff.
- The integrated Visual heading rule hid the required character confirmation question. Narrowing it to the redundant screen-reader-only heading fixes the visible question.
- The supplied done branches still had review gaps and conflicting owners. The integration ledger names concrete resolutions and remaining limits.
- Contrast must use composed surfaces, not just palette seed colors. Classic recess, translucent wells and raised gradient stops differ from seed assumptions.
- Calculator scope is absent. The parser and story define k as platinum, unlike the handoff's gold description.
- The Classic resize hatch is shared bitmap artwork, not a separate resize control.
- SRC-29's cross-owner ordering conflicts with the required two pin-store groups. The handoff wins and both stores stay.
- The report's HUB-181 product rename conflicts with the handoff's lower-case gwonmac rule. Hub copy follows the handoff; packaged identity stays.
- A fixed exactly-two announcement count, literal twelve-word names and cold/warm timing ratios conflict with honest outcomes or measured behavior.
- Port 4179 was occupied by an unrelated session. Verification used isolated port 4190 and restores the checked-in port before commit.
- Hosted dependency audits changed advisory counts during the run. The current run is reported by its own evidence, not an earlier PR's count.
