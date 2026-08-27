# Development and rollout

This document owns the branch model, agent workflow, release inclusion, and
Stable/Beta rollout decision. [Release verification](release-verification.md)
owns the exact signing, draft QA, and publication procedure.

## Roles

Matthias is the coordinator. He chooses the product outcome, performs live game
QA, approves signing, and decides when to publish.

Coding agents own repository execution. An agent investigates, implements,
tests, reviews the complete diff, opens the pull request when requested, and
diagnoses CI. An agent must give Matthias one clear next action when human input
is required.

Automation cannot claim that live gameplay passed. Only the coordinator can
approve a result that requires an account, visual judgment, or player input.

## Branches

Use these branch types:

| Branch | Purpose | Allowed work |
| --- | --- | --- |
| `main` | Completed future work | Reviewed features, fixes, and maintenance |
| `feat/*`, `fix/*`, `refactor/*` | One pull request | The named change only |
| `release/YYYY.M.PATCH` | One release line | Version changes and release blockers only |

Do not create permanent `develop`, `next`, `beta`, or `stable` branches. A
signed Stable tag is the source for an emergency patch. A release branch is
temporary.

`main` does not have to equal the latest public version. The signed Stable tag
and its immutable assets are production truth.

Keep at most one planned release branch. An emergency patch can temporarily add
one more release branch based on the latest Stable tag.

## Normal development

1. Create one topic branch from `main`.
2. Read the owning document and tests.
3. Implement one complete outcome.
4. Run focused tests and `pnpm run check` before the pull request.
5. Review the complete diff against `origin/main`.
6. Open the pull request and wait for **Application verification**.
7. Diagnose every failure and require the selected CI path to pass.
8. Merge only complete, safe work.

Keep unfinished work on its topic branch. Do not merge incomplete code only to
reduce branch drift. Do not add a hidden feature flag for unfinished code.

A merge to `main` does not require an application release. Several completed
changes can wait for one planned release.

## Planned release

1. Select one green commit on `main`.
2. Create `release/YYYY.M.PATCH` at that commit.
3. Open a version-change pull request against the release branch.
4. Merge it only after **Application verification** passes.
5. Stop adding features to that branch.
6. Fix release blockers through focused pull requests against that branch.
7. Forward-port each release-only fix to `main`.
8. Wait for **Application verification** on the release branch.
9. Run **Versioned release** from the release branch.
10. Complete the exact-draft QA in
   [Release verification](release-verification.md).
11. Publish only after the coordinator records `Passed`.
12. Delete the release branch after every fix is on `main`.

New work can continue on `main` after the release branch is created. It cannot
enter the staged release unless it is deliberately backported.

## Emergency Stable patch

Use this path when `main` contains work that must not ship:

1. Start `release/YYYY.M.PATCH` from the latest Stable tag.
2. Apply the smallest safe fix on a topic branch.
3. Open a pull request against the emergency release branch.
4. Do not backport unrelated work from `main`.
5. Run CI and exact signed-draft QA.
6. Publish the Stable patch.
7. Forward-port the fix to `main` and any active planned release branch.
8. Delete the emergency release branch.

An urgent, narrow compatibility repair does not require a Beta when the exact
draft passes owned live QA. Do not use urgency to include unrelated changes.

## Preview, Beta, and Stable

Use three rollout rings:

| Ring | Audience | Purpose |
| --- | --- | --- |
| Developer Build | Coordinator and one or two technical testers | Test one feature before a release line exists |
| Beta | A small opt-in group | Test the real Release identity, updater, settings, saved login, and gameplay |
| Stable | All players | Publish the accepted release |

A Developer Build is not release evidence. It uses the Preview identity, has no
public updater, and cannot prove saved-login continuity. It also uses the
canonical user-data directory. Back up important player data before testing it.

Beta is a release train, not a build for every feature. Combine completed work
in one release branch, publish `YYYY.M.PATCH-beta.1`, fix blockers on that branch,
then publish another Beta or the matching Stable version.

Use Beta for changes to:

- settings, migrations, or durable player data;
- Multiple Accounts, saved login, or Keychain behavior;
- updater, signing, packaging, or application identity;
- native client certification or WASM transforms;
- input, controllers, cursor, rendering, reload, or live observations;
- behavior enabled by default; or
- several substantial features released together.

A direct Stable release is reasonable for:

- an urgent and narrow ArenaNet compatibility patch;
- a small host-only fix with strong automated evidence;
- a low-risk presentation correction; or
- another isolated change that passed exact signed-draft QA.

RC remains supported but is exceptional. Use it only for a large release that
needs a final code freeze after Beta.

## Version lines

Use one version line for a Beta train and its Stable result:

```text
2026.9.0-beta.1
2026.9.0-beta.2
2026.9.0
```

Keep the current Stable patch line free for emergency fixes:

```text
v2026.8.10 -> release/2026.8.11 -> 2026.8.11
```

Do not use the same future version for an unrelated Beta train and Stable
hotfix. The updater compares versions, not their intended feature contents.

## Agent release checklist

Before an agent calls a commit release-ready, it must confirm:

- the source branch is `release/YYYY.M.PATCH`;
- the version and branch name agree for a release branch;
- the branch head has green Application Verification;
- the diff contains no unrelated feature work;
- every release-only fix has a forward-port path;
- the current ArenaNet generation has not changed unexpectedly;
- the signed draft, not a local build, is ready for coordinator QA; and
- publication still requires explicit coordinator approval.

An agent must not merge, approve signing, mark live QA as passed, publish a
release, or announce it without an explicit coordinator request.

## GitHub enforcement

Repository settings enforce the model outside the codebase:

- `main` requires the `verify / verify` check and linear history;
- the `Protect release branches` ruleset applies the same requirements to
  `release/*` and refuses force-pushes;
- the `release` environment accepts `main` and `release/*`; and
- the `release` environment requires Matthias's approval and does not allow an
  administrator bypass.

The Versioned release workflow accepts only `release/YYYY.M.PATCH`. It reuses
the exact commit's required Application verification result. It does not rerun
that complete macOS gate. The signed build still qualifies the current ArenaNet
client and runs the release-only package, Keychain, and updater checks.
