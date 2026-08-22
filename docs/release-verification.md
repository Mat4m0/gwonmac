# Verify and publish a release

This document gives the release procedure for `gwonmac`.

Audience: the maintainer who builds, tests, approves, publishes, or recovers a
versioned release.

This document owns operator decisions and evidence. The release workflow and
verification scripts own exact credentials, assets, entitlements, and machine
checks.

## Release versions

Use `YYYY.M.PATCH`. The first release in August 2026 is `2026.8.0`. The next is
`2026.8.1`.

Use no leading zero. The version must be valid SemVer because npm, packaging,
and the updater parse it.

The supported prerelease suffixes are:

- `-beta.N` for a public Beta;
- `-rc.N` for a public release candidate.

Alpha versions and `snapshot-*` tags are not public application-update
candidates.

The version does not describe ArenaNet client compatibility. The app checks the
official client separately. A higher `gwonmac` version helps only when it ships
the required client certificate or host fix.

## One Release identity

Stable, Beta, and release-candidate builds use the same Release application
identity. They use the same profile, Keychain authority, updater, Developer ID
certificate, and notarization credentials.

Use the existing protected `release` GitHub environment. Do not create a Beta
environment or copy the Apple secrets.

Manual developer builds are ad-hoc Actions artifacts. They install beside the
Release application but have no updater or saved-login authority. A developer
build does not replace a versioned release check.

Historical `snapshot-*` prereleases remain as records. No workflow publishes a
new public snapshot.

The workflow produces a notarized and stapled DMG, an application-update ZIP,
`RELEASES.json`, `SHA256SUMS.txt`, and an SPDX SBOM. It creates separate
repository-bound provenance and SBOM attestations for the ZIP and a provenance
attestation for the DMG.

## Developer build without Apple setup

Use this only to test a trusted exact commit. Developer builds share the
canonical `Guild Wars` user-data directory with Release, so back up important
builds, templates, and game data first.

1. On `main`, manually run **Developer build** with a lowercase 40-character
   commit SHA.
2. Download the uniquely named Actions artifact within seven days.
3. Check that `SOURCE_COMMIT.txt` is the requested SHA, then run
   `shasum -a 256 -c SHA256SUMS.txt` inside the extracted artifact directory.
4. Extract and test `Guild Wars Reforged Preview.app`. It is ad-hoc signed, not
   Apple notarized, and has no saved-login or updater authority.

After the first refused launch, a tester who has verified the commit and
checksums can use **System Settings → Privacy & Security → Open Anyway**, then
confirm **Open**. Apple documents this temporary per-app exception in
[Open apps safely on your Mac](https://support.apple.com/102445). Never disable
Gatekeeper globally.

## Before you start

Complete this checklist:

- [ ] The release commit is on `main`.
- [ ] `package.json` contains the intended new version.
- [ ] The version stage matches Stable, Beta, or RC intent.
- [ ] The current ArenaNet client canary passed within the workflow age limit.
- [ ] CI for the release commit is green.
- [ ] Release notes use short player language. Internal refactors need no long
      explanation.
- [ ] No active incident makes publication unsafe.

Do not publish a new version only to test the release system. Use the dry run.

## Safe dry run

Manually run **Versioned release** on `main` with `dry_run` set to `true`.

This path runs the real verification, build, signing, notarization, stapling,
and package checks. It skips the GitHub mutation jobs.

A dry run does not create a tag, draft release, public release, or attestation.
It can create normal private GitHub Actions logs and artifacts.

Treat a dry-run failure as a release blocker. Fix the cause and run it again.
Do not change secrets or add another signing path to bypass the failure.

## Real release flow

Run **Versioned release** on `main` with `dry_run` set to `false`.

The workflow has two decisions:

```text
approval 1
  -> build, sign, notarize, staple, and verify
  -> create or resume one checksum-pinned draft
  -> workflow writes the machine-owned Verification record
  -> maintainer tests the exact draft ZIP
approval 2
  -> re-download and verify the same draft
  -> publish by removing the draft flag
```

The first approval exposes the existing Apple material only to the signed build
job. The job removes its temporary signing material before later test and upload
steps.

The staging job creates or resumes a complete GitHub draft. The website and
`AppUpdater` cannot select a draft.

The final job does not rebuild or replace an asset. It downloads the draft,
checks its commit, release stage, asset inventory, and checksum digest, and then
removes the draft flag.

After publication, the workflow rebuilds the small Stable and Beta update
channel files from all published GitHub Releases. It validates their exact
release-owned `RELEASES.json` and ZIP assets, deploys both files together as one
GitHub Pages artifact, and compares the public files with the generated hashes.
GitHub Releases remain canonical; Pages contains only this rebuildable pointer.
After this mechanism first reaches `main`, dispatch **Update feeds** once with
**bootstrap** enabled to publish the initial channel pair. Bootstrap is only
valid while both public feeds are absent. Later release runs invoke the workflow
without it and fail closed if either published feed disappears.
If feed deployment fails, the previous Pages deployment remains valid. Dispatch
the standalone **Update feeds** workflow before announcing the release; it
repairs discovery without rebuilding or republishing application assets.

If any staged asset changes, start a new staging run and repeat approval. Never
replace a published asset in place.

## Test the exact draft

Close the installed application, then run:

```bash
pnpm release:test <tag>
```

The command downloads every exact draft asset, verifies its checksums, GitHub
attestations, versions, Release identity, signature, entitlements,
notarization, and Gatekeeper assessment. It extracts the updater ZIP into a
temporary directory and launches that signed candidate directly.

The command never changes `/Applications`. If the candidate fails, close it and
reopen the installed version. There is no backup or rollback state to manage.
Failed checks before launch remove their downloads automatically. A failure
after launch retains the temporary candidate and prints its path for diagnosis.
The command accepts Stable, Beta, and RC drafts; Alpha remains internal.

On the maintainer Mac:

1. Confirm the exact version.
2. Start the current official client and reach a playable character.
3. Enter an outpost and an explorable area.
4. Play for ten minutes and check rendering, input, audio, templates, and saved
   login.
5. Confirm current Core certification.
6. Test template save/load and confirm native double-click and the Guild Wars
   cursor.
7. If the release claims Tools support, test Target Distance, party and map
   transitions, Travel, eligible and restricted Xunlai states plus aliases, and
   one minimal reversible Team Apply operation.
8. If 4 GB mode is requested, confirm it is effective. Also confirm that a
   refused pair keeps the game playable in normal 2 GB mode.

A 16 GB Apple Silicon MacBook Pro is sufficient for this owned check. Record the
actual model, memory, and macOS version. Do not imply that this one device proves
all supported hardware.

The run fails if it has an authentication loop, black game surface, GPU-process
crash, context loss, persistent-file loss, or incorrect client-certification
status.

## Complete the Verification record

The workflow writes the technical fields and checksum rows. After testing,
close the candidate and type `pass` or `fail`. A pass records the time, Mac
model, memory, macOS version, and SHA-256 calculated directly from the active
official ArenaNet module. It changes only the marked Verification block.

Never record a credential, account identifier, token, or game traffic.

The final workflow parses the record and requires an exact-draft result of
`Passed`. The protected reviewer must still assess the human observation.
Automation cannot decide whether the game looked and behaved correctly.
The record is also tied to the original staging workflow URL. Re-run failed
jobs on that workflow instead of starting another release run.

Approve publication only when every applicable result passes and belongs to the
exact draft assets.

## Stable release checks

For every Stable, run the exact-draft checklist. Confirm the Release identity,
saved login, current client, and claimed Core or Tools behavior. Stable remains
the default track.

A normal Stable release does not need a new Stable-to-Beta-to-Stable round-trip
when no public candidate depends on it. The release workflow owns the exact
condition.

If this Stable is the final version for a public Beta or RC, complete the
post-publication forward-update check below.

## Beta and RC checks

Before every public Beta or RC, the signed workflow must run this exact sequence
with a disposable test profile:

```text
latest published Stable
  -> exact signed candidate
  -> the same Stable
```

Each launch must report its exact version. Settings, Builds, Teams, window state,
and profile-origin browser storage must remain readable and writable. No profile
or chunk-directory reset can occur. The candidate must use only settings keys
and values already owned by Stable. Returning Stable must preserve untouched
values.

This proof prevents a hidden compatibility store. A public candidate cannot be
the first release that introduces a durable settings key that it writes.

A feature-owned document is allowed only when the published Stable never reads,
rewrites, or deletes that path. Travel uses this rule for
`travel-preferences.json`; `settings.json` keeps the released shortcut shape so
a manual Stable return remains safe. The round-trip matrix includes empty,
default, and nine-slot district-bearing shortcut values. It does not pretend an
older Stable can preserve keys added to `settings.json` by a candidate.

When Electron, Chromium, Keychain identity, or the persistence contract changes,
also run the affected real boundary. For example, save and reload a real Guild
Wars template through production IDBFS.

## Post-publication updater checks

A production updater check cannot happen before publication. First confirm the
`publish-update-feeds / deploy` job passed, then perform the check within 30
minutes after publication.

For a Beta or RC, start from latest signed Stable, select Beta, and install the
exact candidate through the production updater. Confirm the same identity,
profile, and saved login. Record the version and release URL.

For the matching final Stable, update the installed candidate to the exact
newer Stable. Confirm the same profile, player data, and saved login. Record the
version and release URL.

These checks certify announcement and promotion. They are not a false
pre-publication gate.

## Failure and recovery

Before publication, stop. Leave the candidate as a draft. Fix the defect and
stage new immutable assets.

If a published Beta or RC fails before any known install, return it to draft and
stop announcement and promotion.

If a failed build can already be installed, publish a higher corrective version.
Do the same for a failed Stable. Do not replace assets and do not reuse the
version.

The updater never installs an older Stable automatically. A player who returns
from a newer candidate to an older Stable must install the signed Stable DMG
manually.

Use `Not applicable` only when you name the unchanged boundary. It cannot replace
the recurring candidate round-trip or post-publication updater check.

## Verify downloaded assets

Put the files from one release in one directory. Run:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Every listed file must report `OK`. A mismatch means that the files do not
belong together or have changed. Delete the local copies and download them
again.

If GitHub CLI is installed, verify the repository-bound attestation for the ZIP:

```bash
gh attestation verify "Guild-Wars-Reforged-<version>-macOS-arm64.zip" \
  --repo Mat4m0/gwonmac
```

The command must identify `Mat4m0/gwonmac` and verify the artifact digest.

## Install with Gatekeeper

CI builds, signs, notarizes, staples, mounts, and assesses every DMG. It also
proves that the DMG and updater ZIP contain the same signed application.

Manually install the exact DMG when Electron, Forge, signing, notarization,
entitlements, bundle identity, DMG layout, or installation behavior changed.
Open the verified DMG, drag the application to Applications, and start it
normally. When the change is application-only, the temporary ZIP test is the
owned human check.

Do not disable Gatekeeper. Do not use a blanket quarantine-removal command.
