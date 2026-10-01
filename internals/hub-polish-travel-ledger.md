# Hub polish: Travel and Characters ledger

Date: 2026-09-30. Branch: `fix/travel-characters-lifecycle`.
Base: `feat/hub-actions-and-footer`. No player data was migrated, moved, or dropped.

## Intake and ownership

Read the complete handoff, repository instructions, branch stories, and branch findings.
Reviewed the six inherited commits before editing. Preserved inherited scratch in
`/private/tmp/codex-hub-travel/inherited-probe`, then removed it from the worktree.
Used the existing Travel preferences, shared search, hover, list-key, confirmation,
Hub footer, and certified character-action owners. Deleted the unreachable standalone
Characters path after checking its sole installer and both fixture installation orders.

## Findings and limits

- Closed: HUB-011, 012, 017, 027, 065, 066, 067, 068, 070, 073, 076,
  188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 245,
  247, 250, 251. HUB-142 friend prefixes are covered with HUB-065.
- HUB-069: spatial grid movement and no-wrap boundaries are fixed. The audit asks
  Up on the first row to go Back. The handoff requires the shared no-wrap model.
  Kept the handoff behavior; defer that escape choice.
- HUB-061: Travel phrases and official aliases now rank through the existing Travel
  search owner in both detailed Travel and root results. Global Hub phrases still
  need to work inside Travel. Carry that part to Pins and integration. Preserve both stores.
- HUB-051: temporary map changes retain the Travel and People sources, Home query,
  and phrase draft. Explicit Travel disposal now withdraws its mounted view and
  returns focus to Home. Unrelated row scopes and suspended Library subpages still
  require their owner predicates; carry that part to People/Builds and integration.
- HUB-135: Travel/People/Characters refuse with the current reason before Enter and
  their owners remain installed during temporary map states. The Library launch
  availability part needs the People/Builds branch. Do not claim the entire finding closed.
- HUB-231: Travel phrase-editor withdrawal is tested. Library and other tool scopes
  need the remaining ownership work with HUB-051.

## Proof boundaries

The native Play change checks the actual bounded Selector immediately before the
Play message. It does not mistake the last entered account index for Selector state.
A unit test compiles the real generated executor into WebAssembly. Imported game
callbacks supply external Selector observations. Changing that observation after
Select refuses Play and dispatches zero Play messages. Restoring it sends once.
The renderer rechecks the account and target after its delay, then sends the target index.
Its request counter counts enqueue requests, including refused requests. It cannot
promise zero enqueues when only the native Selector can prove the refusal.

Mutation checks fail for the repaired native Play guard, default Travel identity,
friend substring matching, Travel phrase ranking, Shift-Enter, spatial grid, resting
pointer, Travel close-on-success, Customize focus, Guild Hall exact matching,
number deduplication, leading-space highlight, disposed Travel page withdrawal,
pre-activation character refusal,
secondary metadata, dead alphabetical Characters path, and Resign arming.
The disposal mutation initially removed only the detailed-page predicate and
still passed through the lazy entry path. Restoring both original predicates
reproduced the stale page; the complete fix then passed.
Not every inherited finding has a separate mutation proof. Green journey assertions
cover the remaining inherited behaviors; this is a limit, not a red-test claim.

## Difficulties and corrections

- Some minified templates and large diff reads truncated tool output. Reviewed owners
  in smaller chunks. Wrong relative globs caused failed reads only; edits use absolute paths.
- An initial pointer test did not seed a real pointer move; corrected the setup before
  establishing its mutation failure. An initial grid test waited too little for readiness.
- Two Tools assertions expected stale current-outpost copy and omitted secondary profession.
  Their isolated reruns reproduced failure. Updated the assertions; these were not flakes.
- Electron assertions still expected toggle-to-close, a private Characters footer,
  and an action error after activating a disabled row. Updated them to the handoff.
  A trace located the disabled-row double-click timeout; the corrected journey passed alone.
- The token check did not count the existing Characters stylesheet. Added it to the
  existing not-yet-tokenised reader list; it still has an inherited icon-outline literal.
  This does not certify that stylesheet as fully tokenised. Replaced an undefined
  font-size token with the existing effective interface size.
- The source branches have separate search implementations until integration brings
  in Search's `hubTier()`. Integration must preserve one shared ranking owner.

## Needs design decision

Keep the inherited running-switch veil: 18 percent black, bottom-aligned at 18vh.
Its paint now comes from shared tokens. The handoff specifies containment and copy,
but not these visual values. No discretionary redesign was made.
Keep first-row Up as no movement, as required by the handoff; see HUB-069 above.
Travel's view-specific save legend remains an open handoff decision.

## Verification and delivery

`pnpm check` passed: type checks, lint, links, 1835 unit tests, 185 policy tests,
263 Tools Vitest tests, and 82 launcher tests. The three touched Tools specs passed:
`hub.spec.ts` and `hub-intent.spec.ts` (93), then `hub-fixture-lifecycle.spec.ts` (14),
always with `--workers=2` and no overlapping browser runs. `pnpm build` passed.
The restored final offline Electron run passed all four Travel/Characters journeys.
The disposal mutation failed with the original predicates and passed after restoration. An initial command
named a nonexistent Characters spec; Playwright ignored it. Corrected the coverage
list from the actual branch diff and ran the omitted lifecycle spec separately. Full Tools browser suite
runs only at integration. Offline Electron uses disposable profiles and synthetic
observations; it does not verify live game, input feel, VoiceOver, or AZERTY.
The native transform and combined input changes need Beta consideration and Matthias's
live acceptance. No signing, publication, production change, or PR merge is authorized.
Hosted Application verification on the previous three branches stopped at the unchanged
high-severity dependency audit before runtime tests. Carry this integration blocker;
do not weaken the audit or silently claim hosted verification passed.
