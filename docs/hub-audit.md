# Hub audit — 7 September 2026

**Verdict: the Hub is a useful, recognizably Guild Wars command interface, but it is not ready to call one consistently polished interaction system. Fix the task and focus defects before adding more commands.**

Scope: current uncommitted `feat/hub-builds` implementation, including the new two-pane Whispers UI. This is an Impeccable technical audit with a user-story and interaction review, not a standalone scored Impeccable critique run. No production behavior was changed during this audit.

## Follow-up status

The original findings and score below describe the audited snapshot. All fourteen
findings now have implemented fixes; this is a closure record, not a new score.

| Finding | Implemented fix and evidence |
| --- | --- |
| H01 | Unknown-name whisper keeps the exact recipient; browser journey checks draft preservation. |
| H02 | Mounted tools recheck availability; unrelated settings do not dismiss them. Browser checks Maps disable/update. |
| H03 | Price-basis controls retain identity and focus across feed updates; view entry restores meaningful focus. |
| H04 | Selected secondary text uses the readable text token; measured contrast exceeds 8.8:1 in both appearances. |
| H05 | Trade toolbar and Library/team editors adapt to their container; desktop and 390px screenshots inspected without resizing Hub. |
| H06 | Back restores the immediate parent, query, selection and scroll. Account and Trade-to-Whisper browser journeys pass. |
| H07 | Build/team reviews show actual eight-skill bars, targets and compact attribute disclosure. |
| H08 | Embedded controls and Maps/settings surfaces share Hub styling. Desktop/narrow visual checks completed. |
| H09 | Discoverable command examples fill the query without executing actions; disabled tools are omitted. |
| H10 | Alias validation rejects reserved grammar and calculator expressions; focused unit checks pass. |
| H11 | Character hints use the canonical resolved shortcut, including custom modifiers and cleared bindings. |
| H12 | Account actions refresh identity/state before execution; changed accounts require a fresh selection. Unit check confirms no stale action. |
| H13 | Trade offers open an addressed composer when Whispers is enabled; Back restores the offer and filter. |
| H14 | Compact estimate evidence opens full provenance through Details; copied results preserve the evidence. |

Additional polish: direct pop-out/dock controls, session-owned floating-icon toggles,
character-first switch results, icon-led settings, disabled shortcut controls and
shared individual keycaps. Shortcut capture and matching support Command, Control,
Option and Shift combinations, function/navigation/punctuation/numpad keys.

Verification limits remain: VoiceOver, real-game focus/hit testing, actual account
launches and gameplay actions have not been exercised in this browser fixture.
Those native acceptance checks remain release work, not implied by browser passes.

## Evidence and limits

- Explored the browser fixture at `http://127.0.0.1:4193/?hub` with disposable Chromium sessions.
- Captured 15 states at each of 1280, 640 and 390px viewport widths: Home, Travel, Characters, Whispers, build results, build review, team command, account actions, account list, conversion, title calculation, Maps, preferences, Trade and Library. The Hub itself remains approximately 780px wide on the large viewport.
- Inspected representative screenshots across these flows, plus Modern appearance and reduced-motion Travel. Captured geometry and overflow for all 45 states. Additional keyboard/mouse probes reproduced the defects below and exercised switching between whisper conversations with preserved drafts.
- The latest 31 Hub browser journeys and 172 Tools component tests passed on the interrupted chat implementation. Their green results do **not** cover every edge below. The new persistent-sidebar draft journey was explored manually through automation; it was not added as a committed regression test before the audit.
- Fresh checks during the audit: 30 targeted command/calculator/market/title/account tests passed, Tools TypeScript checking passed, and lint passed for the reviewed Hub/Whispers/library files.
- Ran the Impeccable mechanical detector on Hub shell/CSS, preferences, accounts, library presentation and Whispers. It returned `[]`. That means no detector findings, not no defects: browser interaction exposed issues the detector cannot detect.
- Synthetic names, party state, messages, accounts and sample prices only. No real whisper was sent and no game/account was opened, closed, travelled or modified.
- Live native shortcut interception, game focus restoration, actual character/account switching, native apply completion, current Kamadan inference accuracy, VoiceOver announcements, real 200% browser zoom and high-volume libraries remain unverified in this audit. Narrow fixtures are desktop-window stress tests; this is a Mac product, not a mobile release.

## Technical health

Scores are an assessment of this tested surface, not a WCAG certification or production performance benchmark.

| Dimension | Score / 4 | Basis |
| --- | --- | --- |
| Accessibility | 2 | Good labels and basic keyboard flows; focus loss and selected-text contrast failures remain. |
| Performance | 3 | Bounded quote demand and existing owners; unnecessary control replacement during updates. Large real libraries not profiled. |
| Responsive design | 2 | Home, Travel, Characters and chat adapt; embedded Trade and Library overflow even the standard Hub. |
| Theming | 2 | Home has coherent charcoal/gold identity; nested controls retain a different visual language. |
| Implementation integrity | 2 | Reuses canonical owners, but navigation, feature invalidation and recipient routing have verified gaps. |
| **Total** | **11 / 20** | **Significant work remains before release.** |

**Integrity verdict: partial pass on architecture, fail on end-to-end consistency.** Keeping one whisper session, one account launcher and the existing build/team runners is correct. The next work should simplify their presentation and navigation contracts, not create replacement services or another tool framework.

14 findings: **0 P0, 5 P1, 9 P2**. P1 means fix before release; P2 means meaningful usability work with an available workaround. Product opportunities below are not counted as defects.

## Release fixes

### H01 — P1: unknown-name whisper commands resolve the wrong recipient

- **Location:** `src/renderer/hub-people.ts:89–96`.
- **Reproduce:** enter `whisper Foo`, then Enter. The conversation heading becomes **Whisper to foo**, rather than **foo**. A longer valid name such as `whisper Zed Example` instead fails name-length validation after the prefix is added.
- **Cause:** the fallback already captures the correct recipient, but the final scoped mapping replaces its `run` function with `whisper(row.keywords || row.title)`.
- **Impact:** a central player story fails; a short display label becomes a different recipient. Typing still does not send a message, but the addressed composer is wrong.
- **Fix / acceptance:** carry the recipient independently of display text or preserve the fallback action. Test unknown short and maximum-length names, friend aliases and existing conversations. The composer must show exactly the validated character name. Never derive identity from a translated action label.
- **Category / command:** implementation integrity; `$impeccable harden`.

### H02 — P1: disabling Maps does not remove its open view

- **Location:** `src/renderer/hub.ts:283–288`; `src/renderer/hub-maps.ts`.
- **Reproduce:** open Maps, dispatch the existing fixture setting change with `cartographyEnabled: false`. The caption and controls remain Maps.
- **Cause:** invalidation tracks enabled sources, whereas Maps is a built-in command/view and has no source in that set.
- **Impact:** violates the explicit “disabled tools disappear” contract. Old controls remain available after their feature is disabled. This observation concerns UI availability; it does not prove a native authorization bypass.
- **Fix / acceptance:** associate the mounted view with its actual feature dependency and dismiss only that invalidated view. Recheck availability when invoking its controls. Test disabling Maps, disabling the master Tools switch, and disabling an unrelated feature while another view is open.
- **Category / command:** implementation integrity; `$impeccable harden`.

### H03 — P1: focus ownership breaks during view entry and unrelated updates

- **Location:** `src/renderer/hub.ts:108–109,308–321`; `src/renderer/hub-preferences.ts`, `manageHubShortcuts`.
- **Reproduce A:** open `1zkey in a`, focus Price basis, trigger `hub-fixture-incoming`. The picker loses focus even though the conversion did not change.
- **Reproduce B:** open Hub preferences. `document.activeElement` is BODY rather than a meaningful control inside the view.
- **Cause:** selection repaint replaces the rate selector; mounted views must each remember to set focus themselves.
- **Impact:** an incoming chat can interrupt a keyboard price selection. New views can open without a usable keyboard starting point. Relevant to WCAG 2.4.3 and the modal focus contract.
- **Fix / acceptance:** update an existing rate control only when needed. Give view mounting a defined focus destination/fallback. Preserve focus and editing state through unrelated feeds. Tab/Shift-Tab must stay in the active dialog and Escape must work from every child view.
- **Category / command:** accessibility; `$impeccable harden`.

### H04 — P1: selected-row secondary text is too faint

- **Location:** `src/renderer/hub.css`, `.hub-row > .hub-detail` and selected-row fill.
- **Evidence:** computed foreground/background compositing in Classic Home gives approximately **3.41:1** for “Recently visited · Any district” on the selected row, versus **5.24:1** on an unselected row. Selected primary titles remain strong at approximately 9.78:1. Material rendering can change exact pixels; the selected secondary token needs correction regardless.
- **Impact:** the context that explains an action becomes harder to read precisely when selected. Ordinary 13px text should meet WCAG 1.4.3's 4.5:1 AA target.
- **Fix / acceptance:** define readable selected secondary text, then measure both appearances and account-action descriptions. Preserve muted hierarchy without relying on opacity alone. Do not globally brighten all text.
- **Category / command:** accessibility/theming; `$impeccable colorize`.

### H05 — P1: embedded Trade and Library do not fit the standard Hub

- **Location:** `apps/tools/src/TradeChatApp.vue`, `.trade-toolbar`; `apps/tools/src/components/TeamDetail.vue`, `.team-mode` / `.team-slots`; Hub embedded-host layout.
- **Evidence:** at a 1280px viewport the Trade toolbar has 766px client width and 940px scroll width. At 390px it has 352px client width and 448px scroll width. Library mode controls have 219px available for 250px content; team slots have 460px available for 534px content.
- **Impact:** Trade actions are clipped; Library controls overlap or extend outside the available pane. Keeping the outer frame fixed currently hides parts of the inner tool.
- **Evidence images:** [Trade](hub-audit-evidence/trade-overflow.png), [Library](hub-audit-evidence/library-overflow.png).
- **Fix / acceptance:** adapt each existing component to its actual container width. Wrap/compact the Trade toolbar and use a single-pane Library browse → detail flow inside Hub when needed. Preserve the same owner and offer Detach for long editing. All controls must be visible or intentionally scrollable at the standard frame and narrow widths. Do not solve this by enlarging Hub.
- **Category / command:** responsive design; `$impeccable adapt`.

## Interaction and design fixes

### H06 — P2: Back skips nested account navigation and loses list context

- **Location:** `src/renderer/hub.ts`, `home`, `back`, `showRows`.
- **Reproduce:** Switch Account → Second → Back. Actual destination is root search `switch account`, not the Accounts list.
- **Impact:** the player must reopen the list to compare another account. The same single-scope design cannot reliably restore parent selection and scroll in deeper row-based flows.
- **Fix / acceptance:** retain the immediate parent query, selected identity and scroll for each supported navigation step. Accounts → Second → Back must restore Accounts with Second selected; a second Back returns Home. Use a small navigation history, not a generic workflow engine.
- **Command:** `$impeccable harden`.

### H07 — P2: build/team review loses the scannable skill presentation

- **Location:** `apps/tools/src/hub-library.ts:26–40,90–119`; `.hub-preview`.
- **Evidence:** `build monk` has excellent eight-icon rows; entering Review replaces them with plain skill-name text. The team preview repeats a full skill/attribute block for every hero in a short scroll area. Target text says “Your character”, not the active character name requested by the spec.
- **Impact:** verifying a team before Apply requires reading a long repeated transcript instead of checking a roster. Missing current-character context matters in a multi-account tool.
- **Evidence image:** [Build review](hub-audit-evidence/build-review.png).
- **Fix / acceptance:** review uses the same skill bar, a compact hero roster and a visible target. Show difficulty, roster/build/behavior changes first; expand individual slots for attributes. Only display a character name when provided by the canonical observed owner. Partial application must retain the runner's real completed/remaining details.
- **Command:** `$impeccable layout`.

### H08 — P2: nested utility controls still speak a different visual language

- **Location:** `src/renderer/hub-maps.ts`, `src/renderer/hub-preferences.ts`, `apps/tools/src/hub-library.ts` review controls; scoped Hub CSS.
- **Evidence:** Maps uses broad beveled blue buttons and browser sliders, while Home uses flat gold selection and compact rows. The fonts are substantially unified, but control treatment, density and footer conventions are not.
- **Impact:** moving deeper feels like opening a separate older tool. Users must relearn where actions and state live.
- **Evidence image:** [Maps](hub-audit-evidence/maps.png).
- **Fix / acceptance:** use the existing Hub tokens for inline toggle rows, range rows, primary actions and consistent focus rings. Keep the intentional profession/item art. Share only repeated presentation; do not build another general component framework.
- **Command:** `$impeccable polish`.

### H09 — P2: useful grammar is difficult to discover

- **Location:** Home command registry in `src/renderer/hub.ts`; title examples in `src/renderer/hub-calculator.ts`.
- **Evidence:** the placeholder mentions people, places and builds. Title examples exist, but currency syntax, account choices and profession filtering have no equivalent central command help. Many rows repeat “Open tool”.
- **Impact:** a returning player will see a launcher and miss the capabilities that make it useful. This is especially relevant to the user's tester who does not use Raycast.
- **Fix / acceptance:** an explicit `help` or `commands` result shows a short list of executable/editable examples grouped by task. Include `travel kamadan`, `char <name>`, `build monk`, `team <saved name>`, `whisper <name>`, `1p in g`, `10e in p`, `titles` and `acc <name>`. Only include enabled tools. No tutorial popup, rotating placeholder or noisy default suggestions.
- **Command:** `$impeccable onboard`.

### H10 — P2: accepted search phrases can collide with account grammar

- **Location:** `src/shared/hub-preferences.ts`, reserved-word expression; scoped filtering in `src/renderer/hub.ts`.
- **Evidence:** `isHubShortcuts([{id:'travel', phrase:'acc second', pinned:false}])` returns true. Searching that phrase is parsed as an account scope and filters out the Travel reference.
- **Impact:** the UI can save a shortcut that cannot work as described. The validator's reserved grammar predates the account scope and wider unit catalogue.
- **Fix / acceptance:** share the parser's reserved scope vocabulary with phrase validation. Define and test conflicts with canonical commands and calculator expressions. A saved phrase must resolve its intended stable object or be rejected inline before saving.
- **Command:** `$impeccable harden`.

### H11 — P2: the character shortcut hint is hard-coded

- **Location:** `src/renderer/hub.ts:71`, `Choose another character · ⌘E`.
- **Impact:** players with a custom or cleared binding are shown a shortcut that does not represent their settings.
- **Fix / acceptance:** use the existing resolved shortcut owner for labels. A custom binding is displayed; a cleared binding has no hint. Apply that policy to every Hub shortcut label without making a second key map.
- **Command:** `$impeccable clarify`.

### H12 — P2: account-change recovery says “search again” but does not reload accounts

- **Location:** `src/renderer/hub-accounts.ts`, `setVisible`, `actions().run`.
- **Evidence:** account snapshots refresh when visibility changes from false to true. The action reads fresh accounts and rejects a renamed/deleted target with “Search again”, but typing another query does not reload that snapshot.
- **Impact:** the correct native rejection can leave the player repeatedly searching stale choices until Hub is closed and reopened. This is code-confirmed; the normal fixture does not model live profile renaming.
- **Fix / acceptance:** invalidate and reload the existing snapshot on this specific rejection, or give an explicit Refresh action. Test rename/delete/opening transitions. Avoid a background polling service.
- **Command:** `$impeccable harden`.

### H13 — P2: Trade lacks the promised direct Whisper handoff

- **Location:** `apps/tools/src/TradeChatApp.vue`, selected-offer inspector around lines 770–810.
- **Evidence:** the inspector offers Save, Follow, Copy name, Copy offer and Open feed. It does not offer an addressed Hub composer.
- **Impact:** a player finding a useful offer must copy the name, navigate elsewhere and start a conversation manually. This breaks a high-value central-Hub journey described in the spec.
- **Fix / acceptance:** add **Whisper <seller>** through the existing session, available only when Whispers is enabled. Open an addressed composer without sending or inventing a message. Back restores the chosen offer and filters. No listing publication or automated trading.
- **Command:** `$impeccable shape`.

### H14 — P2: price evidence is accurate in intent but too dense to scan

- **Location:** `src/renderer/hub-calculator.ts`, inferred-market detail string; `.hub-conversion > .hub-detail`.
- **Evidence:** the narrow card has several lines of small text containing sample status, inference, side, advertiser counts, full item names, timestamps and equivalent-value wording.
- **Impact:** the player must parse a paragraph to answer “is this a buying or selling estimate, and how recent is it?” Tiny estimates also look deceptively precise when only two decimals are visible.
- **Fix / acceptance:** keep `~`, buy/sell meaning and age on the card; put full median evidence and counts behind an explicit Details action. Preserve all provenance in copied output. Display sufficient significant digits for small ratios and verify reciprocal/stack conversions. Always retain the prominent sample marker in the browser fixture.
- **Command:** `$impeccable clarify`.

## User-story coverage

“Verified” below refers to fixture behavior and/or the existing tests, not a claim of live game certification.

| Player story | Current assessment | Required next acceptance |
| --- | --- | --- |
| Open Hub, type without affecting the game | Local search and no-auto-apply behavior verified | Test physical Mac shortcut/input routing against a logged-in disposable session. |
| Find a frequent tool without memorizing shortcuts | Priority order is correct; recents and pins are present | Discoverable examples and real configured shortcut hints (H09/H11). |
| Travel from recent/favorite entries | Compact carousel/grid and keyboard navigation verified | Retain district semantics; test native acceptance/focus restoration. |
| Search an outpost name or explicit alias | Deterministic matching, no fuzzy correction | Keep canonical destination visible; never promise exact friend district. |
| Find a friend and travel to their outpost | Explicit actions; offline/withdrawn location guards tested | Live friend changes must continue to require a fresh choice. |
| Whisper an unknown player | **Broken through root command** | H01. |
| Open an existing chat, switch chats, retain drafts | Two-pane fixture flow works; send failures keep drafts | Commit persistent-sidebar and narrow Back regression coverage. |
| Notice unread messages without interruptions | Existing session counts and unread marker work | Incoming messages must not steal focus elsewhere (H03). |
| Close a chat with a draft | Inline discard/keep guard tested | Keep it accessible from the selected chat's options. |
| Switch to `char Toefte` | Explicit action and compact carousel verified | Current-character guard, live switching and custom shortcut label. |
| Open another account or replace the current one | Explicit two choices, owner launch-before-close tests | Native window/sign-in behavior; parent navigation and recovery (H06/H12). |
| Find all saved Monk builds | Primary-profession search and eight icons verified | Reuse icons during review (H07). |
| Apply a named build to player/hero | Exact-name action and target selection tested | Keep observed target identity clear; live applicability check. |
| Apply `team gom afk` | Exact/prefix/duplicate/refusal/interruption fixtures tested | Scannable change review and native partial-apply proof (H07). |
| Edit/import/export a team or build | Existing owner embedded and detachable | Fix container overflow without duplicating the editor (H05). |
| Convert gold/platinum offline | Exact arithmetic and attached/spaced syntax tested | Keep this independent of Trade availability. |
| Estimate ecto/armbrace/ZKey value | Sources and sample labeling present; bounded inference tested | Focus continuity and concise evidence (H03/H14); validate live source separately. |
| Plan Sweet Tooth/Drunkard/Party/Zaishen progress | Explicit entered progress and exact-point planning tested | Help examples; never imply progress was read from the game. |
| Find an offer and contact its author | Feed search works, contact step missing | H13 plus toolbar fit. |
| Toggle map helpers without leaving Hub | Inline controls work | Disabled view must disappear; consistent controls (H02/H08). |
| Open Xunlai Storage quietly | Silent-failure behavior verified | Preserve it; no popup or “enable this tool” result. |
| Pin an action or give it a name | Basic save/reload/reset tests pass | Reserved grammar, focus and parent-state restoration (H03/H06/H10). |
| Disable a tool and stop seeing it | Most source-backed results/actions tested | Cover built-in mounted views, especially Maps (H02). |
| Use Resign/Reload deliberately | Explicit search-only entries call existing confirmation owners | Verify native confirmation and return focus; no home recents. |
| Navigate any section with arrows, Enter, Escape, Tab | Major paths work; three focus/history defects found | One documented per-context key contract, screen-reader and zoom checks. |

## Improvements with the most value for Guild Wars players

These are proposals, not implemented capabilities. Keep the deterministic command model and quiet default surface.

| Priority | Opportunity and proposed flow | Why it helps | Boundary |
| --- | --- | --- | --- |
| First | `commands` → editable task examples | Exposes existing investment before adding more systems | No onboarding popup; only enabled capabilities. |
| First | Trade offer → Whisper seller → Back to offer | Removes copy/paste from a common player task | Address only; player writes and sends. |
| First | Compact team review with eight skill icons per selected slot | Makes applying a whole party fast and reviewable | Existing model/runner remains authoritative. |
| Next | `today` / `zaishen today` → activity → relevant outpost action | A useful daily starting point | Show date/reset basis, source and last update. Never assume quests are accepted or completed. |
| Next | `nick` → weekly requested item, quantity and location → closest supported outpost | Turns repeated external lookup into a useful Hub answer | Do not promise direct travel to an explorable-area NPC. |
| Next | Obsidian armor shopping planner | Connects shards/ecto conversion with a concrete goal | Select profession/pieces, calculate reviewed material counts, separate fixed recipe from estimated price. No assumed inventory. |
| Next | Title shopping: “I need X points, I already have Y items” | Reduces overbuying using existing exact-point catalogue | User-entered quantities, whole-item rounding, explicit event assumptions. |
| Later | Paste a skill template → inspect eight skills → choose target | Makes shared builds easier to check and load | Validate with the existing decoder; no loading just because something was pasted. |

Zaishen challenges rotate and their reset is documented as 16:00 UTC: [Guild Wars Wiki — Zaishen Challenge Quest](https://wiki.guildwars.com/wiki/Zaishen_Challenge_Quest). Nicholas requests and weekly bonuses have their own Monday 15:00 UTC boundary: [Weekly activities](https://wiki.guildwars.com/wiki/Weekly_activities). These are source-backed opportunities, not a claim that the currently cached wiki snippet is the live schedule.

Obsidian armor recipes vary by piece and profession; use the reviewed per-piece data rather than one universal total: [Obsidian armor](https://wiki.guildwars.com/wiki/Obsidian_armor). Keep the recipes static and reviewed, and market prices separately timestamped and labelled as estimates.

Do not add generic natural-language interpretation, macros, automated chat, account-wide completion guesses, price predictions, automatic consumable use, or a new database for these flows. Do not offer Invite until a named supported native action exists. “Shards” needs one documented exact alias in the currency catalogue, not fuzzy inference over every item containing that word.

## Work sequence and verification criteria

1. **`$impeccable harden`: H01–H03, H06, H10, H12.** Fix the existing direct functions and define parent/focus/availability ownership. Tests must reproduce the precise failure, including unrelated feed updates. No new global service.
2. **`$impeccable adapt`: H05.** Keep the fixed outer frame. Fit existing editors to their container and preserve their draft/filter state on detachment.
3. **`$impeccable colorize` and `$impeccable layout`: H04/H07.** Measure contrast, share skill presentation, make the team change review scannable.
4. **`$impeccable clarify`, `$impeccable onboard`, `$impeccable shape`: H09/H11/H13/H14.** Make existing functionality discoverable and complete the seller-to-whisper journey.
5. **`$impeccable polish`: H08 and final cross-surface alignment.** One bounded desktop/narrow/appearance pass, then a confirmation pass on fixes.

Release acceptance:

- Exact intended recipient for every whisper entry path, with no sending from navigation or typing.
- No hidden-feature results, aliases, actions or open views after a feature is disabled.
- Back restores the immediate parent, query, selected identity and scroll; opening a section and observing live updates never loses meaningful focus.
- Every primary/secondary control fits or scrolls intentionally at the standard Hub size and smaller desktop windows. Frame geometry remains stable across tools.
- Normal text contrast is at least 4.5:1 in both appearances, with visible focus and a VoiceOver walk through the main stories.
- Build/team review states actual targets and changes; interruption cannot look like completion.
- Price answers distinguish fixed values, manual rates, NPC observations, inferred advertisements and fixture samples.
- Browser regressions cover the newly found defects; native checks cover game focus, shortcuts, account switching and representative gameplay actions separately.

## What to preserve

The exact command grammar, deterministic identities, profession filtering, actual skill/item artwork, compact Travel/Character layouts, fixed Hub geometry, clear account choices, silent Storage failure, draft protection, and bounded quote owners are the right foundation. The audit recommends completing and simplifying that foundation, not replacing it.
