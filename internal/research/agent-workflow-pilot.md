# Agent feature workflow pilot — 12 September 2026

Decision: the discovery tools are verified and the small workflow diff is ready
for review. Faster delivery and reliable autonomous feature completion remain
unproven; additional evaluation is on hold. The second trial passed the frozen
behavioral checks but left a visible presentation defect. This is not an
unqualified pilot success or a reason to reject WASM development.

## Delivered boundary

The repository-local `gwonmac-feature` skill routes work to current feature
owners. [Client research](../../docs/client-research.md) links existing examples,
reference revisions and limitations. [World-rendering evidence](world-rendering.md)
preserves the previous probe's findings and rejected approaches.

Certification now runs from source using the existing TypeScript loader.
`certification inspect` inventories bounded local WASM bytes without executing
them or asserting official provenance. `enhancements:live --list` and
`--describe` read the execution scenario definitions without building or
launching a game. Actual live execution retains its opt-in, build and preflight.
No new runtime reader, agent runner, updater, benchmark platform or service.

One local sample measured cached-module inspection at 892 ms, listing 16
scenarios at 746 ms and describing one at 735 ms. No build directory was
created. The old package entry points unconditionally built first; removal of
that prerequisite is verified. These samples are not a delivery speedup ratio.
Source-run `certification template --expect-certified` also passed on the cached
8,206,417-byte artifact with SHA-256
`1eb07332632e2fca8aabf5baa14fa1a1e6a2a59ec7134dfb8f6231d924c9fd7b`.
This does not establish that the cache is the latest official release.

## Two isolated trials

Both used product base `70a51d6bbbdbd408bfc337e737d69d88c52fdf7a`, the same
Effect Timers request and inherited model settings. B additionally received the
workflow snapshot. The request changed durations above 99 seconds to upward-
rounded `m:ss` while preserving observation, suppression, color and lifecycle.
Neither trial received the other's solution. Trial patches are evaluation-only
and excluded from this workflow diff.

| Evidence | A: existing workflow | B: new workflow |
| --- | --- | --- |
| Frozen independent production-consumer checks | 5/5 pass | 5/5 pass |
| Full repository check | Pass | Pass |
| Builds / user interventions | 0 / 0 | 0 / 0 |
| Offline rendering inspection | Labels fitted; agent adjusted font sizing | Correct text/colors/lifecycle; long labels overflow small icons |
| Agent's final time estimate | About 6 minutes | About 7 minutes |

Those times are agent estimates, not instrumented comparable measurements; B's
earlier progress estimate also differed. Neither establishes a speed benefit.
Both completed below the 20-minute cap. Offline fixtures used real renderer
modules with synthetic observations/icons; they prove no live game behavior.

B's `10:10` label visibly extends left of a 32-pixel icon. Its final report
disclosed this, and executor screenshot review confirmed it. Do not ship that
prototype as visually accepted. The one allowed workflow repair adds an explicit
longest-label/smallest-geometry check to the skill. This wording was validated,
but has not received another cold-agent trial. No third trial was started.

## Integrity and cost controls

The executor froze checks before A, outside both checkouts; SHA-256
`6e4e159eff128ed2f26a66a898a19fe5ec5b64b950c0af105876c34c3fc96f0f`.
They exercise the existing production consumer and non-example boundaries. The
unmodified base failed the two changed-format cases and passed the other three.
The same unchanged checks then passed both final trial artifacts. Diff review
found no weakened preservation tests, disconnected replacement or hardcoded
example-only solution. All 13 workflow file hashes supplied to B were unchanged.

This environment permits access to sibling files. The evaluator was separate
by instruction, not a security sandbox; no claim of blindness or tamper-proof
evaluation is made. No evidence of evaluator tampering was found.

Exactly two fresh implementation agents were used. No recursive delegation,
trial restart, scheduled retry or metering harness. Collaboration exposes no
per-run token usage or hard token ceiling here: tokens are **unmetered**, not
zero. Run, time and output limits bounded this execution. The ledger outside
the checkout retains consumed allowances; a resume must not reset them.

## Verification and limits

Workflow `pnpm run check` passed: type checks, lint, Markdown links, 1,699 unit,
182 policy, 196 Tools and 81 launcher tests. Seven focused discovery tests also
exercise forbidden build/network/launch boundaries, malformed inputs, explicit
provenance and failed-build refusal. Skill validation and final Markdown links
passed after the wording repair. No successful live Electron launch was run.

The refreshed base had a pre-existing Application verification CI failure in
`tests/electron/multiple-accounts.spec.ts:594`: renderer recovery timed out
waiting for a replacement account window. Local workflow checks do not clear
that separate failure. Existing client features were not comprehensively
revalidated, and this pilot does not prove update survival or new native actions.

Local evidence is retained beside the checkout in `.gwonmac-workflow-evidence/`:
frozen checks, negative control, both evaluated outputs, workflow snapshot hashes,
command timings and check logs. Trial diffs and offline screenshots remain in
`gwonmac-workflow-pilot-a/test-results/workflow-pilot/` and the matching `-b/`
location. Logs are local evidence, not game artifacts to commit. No commit,
publication or product rollout was performed; trial browsers were closed and
existing game sessions and other worktrees were preserved.

## Hold and resume conditions

- **Autonomous delivery claim:** on hold. Both trial starts are spent and a
  visual quality miss remains in B. Resume only under a newly authorized bounded
  evaluation or through an already requested real feature with frozen acceptance
  criteria, including longest-label fit. Count any further agent use explicitly;
  do not retroactively call the repaired guidance cold-tested.
- **World-space rendering:** on hold, not disproven. Existing evidence shows an
  inline screen-space marker with depth disabled; stable attachment and terrain
  occlusion remain unproved. Resume with an isolated live scene and the one
  attachment/transform experiment specified in the rendering record. No existing
  gameplay session was commandeered for it.
- **Ghidra/ReVa adoption:** deferred. The next rendering question concerns the
  active render target and depth, not an identified missing decompilation fact.
  A tool installation or full-module analysis loop is not justified by this pilot.

## Authorized workflow refinement — 12 September 2026

After reviewing the alcohol-timer and native-UI investigations and the personal
skill refactor, the user authorized a targeted refinement. The implementation
branch was fast-forwarded to `7683601c`, which already includes Alcohol Timer
PR #438's typed verifier fixture and offline Electron test corrections. Those
fixes were reused, not duplicated.

The skill now routes to contextual documentation. Universal task checklists
were shortened; the label-fit check from the pilot moved into the existing
verification guide. That guide distinguishes presentation checks from native
semantic proof and points to the canonical capability fixture. Startup guidance
retains profile identity and describes cache readiness and durable log paths.
The rendering record links the separate native-UI investigation's known limits.

A reproduced startup bug was fixed in the existing path owner: equivalent
symlink paths, including macOS `/var` aliases, now match the same profile.
Explicitly empty, missing, dangling and different expected paths refuse client
preparation. The extracted previous comparator failed both added regression
tests; the fixed code passed. The focused paths/discovery run passed 17 tests.

Final `pnpm run check` passed type checks, lint, Markdown links, 1,706 unit,
182 policy, 196 Tools and 81 launcher tests. Skill validation also passed.
Evidence logs are `profile-identity-before.tap`, `workflow-refinement-focused.tap`
and `workflow-refinement-check.log` in the existing evidence directory.
No live app relaunch, new agent trial or benchmark was run. The historical pilot
results above do not evaluate this revised guidance, and its spent trial
allowance remains spent. Faster feature delivery remains unproven. Changes are
local and uncommitted; unrelated tasks and game sessions were preserved.
