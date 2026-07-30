# Verify a release

## Release numbering

Releases are numbered by date: `YYYY.M.PATCH`, so `2026.7.0` is the first
release cut in July 2026 and `2026.7.1` the next one that month. The point of
the scheme is staleness at a glance — in November, `2026.7.1` tells you the app
is four months behind, where `0.4.2` would tell you nothing.

The numbers are written in SemVer syntax because npm, the packaging tools, and
the release workflow all parse them that way, and SemVer forbids leading zeroes
in a number. July is `7`, never `07`: `2026.07.01` is not a valid version, and
`src/shared/release.ts` — the one parser this app compares versions with —
refuses to read it rather than guessing what was meant.

Prereleases append a channel and a sequence — `2026.7.0-alpha.1`,
`-beta.1`, `-rc.1` — and order `alpha` < `beta` < `rc` < the release itself.
An install running a stable release is never offered a prerelease. During the
initial launch phase, the website download button offers the newest release,
including previews; `WEBSITE_RELEASE_CHANNEL` in
`apps/website/app/composables/useLatestRelease.ts` is the single switch back to
stable-only downloads once the first stable release is available.

**What the number does not mean.** It is not a compatibility promise, and in
particular it says nothing about which Guild Wars client build the release
works with. ArenaNet ships client builds on its own schedule. The app first
checks an unknown build locally against its shipped structural baseline and
uses the untouched official client if that proof refuses; no version number
can encode that outcome. The app tells you directly instead — see
[When the client build is not certified](user-guide.md#when-the-client-build-is-not-certified).
A newer app version fixes an uncertified client build only if it contains a
baseline for the changed structure, so a higher number on its own is not the
answer.

Automatic checks remain opt-in, and stable installations are never offered a
preview — see
[Updates](user-guide.md#updates).

Temporary `snapshot-<run>-<commit>` prereleases are tester builds, not
application versions. Their tags deliberately do not parse as one of the
version shapes above, so neither the website nor the in-app release check
offers them. They remain available as public downloads on GitHub while their
bounded retention window is open; pull-request packages instead live as
signed-in-only GitHub Actions artifacts for three days.

Versions published before this scheme, including the public alpha
`0.0.1-alpha.1`, used a plain `0.x` number and are older than everything above.
The macOS bundle also carries a `CFBundleVersion` derived from the release
version, which is monotonic but not the number you read anywhere in the UI;
`scripts/macos-version.ts` owns that mapping and `tests/packaged-smoke.ts`
checks it.

## Signing and evidence

Guild Wars Reforged releases are signed with Developer ID, use the hardened
runtime, and are notarized and stapled by Apple. Each GitHub release also
publishes independently useful evidence:

- the notarized DMG for installation;
- the notarized application ZIP used by automatic updates;
- `RELEASES.json`, naming that exact ZIP;
- `SHA256SUMS.txt`, covering the DMG, ZIP, feed, and SBOM;
- an SPDX SBOM describing the packaged application.

GitHub also stores signed build-provenance attestations for the DMG and ZIP and
an SBOM attestation for the ZIP.
These establish that the file was produced from this repository by the
published release workflow. They do not replace macOS Gatekeeper or make an
untrusted repository safe.

## First signed release rollout

The first Developer ID beta is a manual DMG bootstrap. An ad-hoc installation
cannot securely replace itself with an application carrying a different code
identity. Publish a second beta from the same Developer ID identity and prove
automatic updating on both a clean profile and an existing profile before
shipping a stable release.

The `release` environment variable `SIGNED_BETA_UPDATE_PROVEN` is deliberately
unset during this rollout. After the second beta has installed automatically,
retained the profile, and the one-time saved-login re-entry has been verified,
set it to exactly `true`. The release workflow refuses every stable version
until that evidence gate is opened; preview releases do not depend on it.

## Verify the downloaded files

Download the DMG, ZIP, `RELEASES.json`, `SHA256SUMS.txt`, and `.spdx.json` from the same
GitHub release into one folder. In Terminal, change to that folder and run:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Every entry must report `OK`. A mismatch means the files do not belong
together or were changed; delete them and download the release again.

If the [GitHub CLI](https://cli.github.com/) is installed, also verify the
repository-bound attestations:

```bash
zip="$(find . -maxdepth 1 -name 'Guild-Wars-Reforged-*-macOS-arm64.zip' -print -quit)"
gh attestation verify "$zip" --repo Mat4m0/gwonmac
```

The command must identify `Mat4m0/gwonmac` as the source repository and
successfully verify the artifact. The release’s provenance and SBOM
attestations are both attached to that exact ZIP digest.

## Install without disabling Gatekeeper

After verification, open the DMG and drag `Guild Wars Reforged.app` to
Applications. Gatekeeper verifies the Developer ID signature and stapled Apple
notarization ticket.

Do not disable Gatekeeper globally or run a blanket quarantine-removal
command.
