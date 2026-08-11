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
An install running a stable release is never offered a prerelease. The current
website selector is `SITE_RELEASE_CHANNEL` in
`apps/website/server/utils/release-select.ts`. Its launch-phase `beta` value
currently accepts every parsed prerelease stage, including any alpha candidate.
That is current behavior, not the desired public-Beta contract: the accepted
refactor plan requires the website and application selectors to exclude alpha
before public Stable/Beta updates are advertised.

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

Automatic checks remain user-controlled and on by default. A release-identity
stable version receives stable releases only; a release-identity prerelease may
advance to a later eligible prerelease or stable. The separately signed Preview
tester app cannot use AppUpdater. See [Updates](user-guide.md#updates).

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
- `SHA256SUMS.txt`, covering the release assets actually published;
- an SPDX SBOM describing the packaged application.

GitHub also stores signed build-provenance attestations for the DMG and ZIP and
an SBOM attestation for the ZIP.
These establish that the file was produced from this repository by the
published release workflow. They do not replace macOS Gatekeeper or make an
untrusted repository safe.

The approval-gated `release` environment must contain the G2 Developer ID
certificate/private key as `APPLE_DEVELOPER_ID_P12`, its export password as
`APPLE_DEVELOPER_ID_PASSWORD`, and the Developer ID distribution profile for
`io.github.mat4m0.gwonmac` as `APPLE_DEVELOPER_ID_PROFILE`. The P12 and profile
are base64-encoded secret values, not repository files. Before it builds, the
workflow rejects a profile with the wrong team, application identifier,
distribution type, certificate fingerprint, certificate count, or remaining
lifetime. It blocks below two years and warns below five. After signing, it
compares the embedded profile byte-for-byte and checks the top-level app's
exact three entitlements.

Those post-signing checks are `scripts/verify-signed-app.ts` rather than
workflow text, so the release path is reproducible off CI:
`pnpm verify:signed-app` runs every one of them against a notarized
application, and its optional second argument against the disk image that
carries it. The script's header states what it needs.

## Historical identity correction and saved-login rollout

`2026.7.0-beta.2` was the first Developer ID package, but it inherited the
unrelated `com.gwdevhub.guildwars` bundle identifier and Chromium Safe Storage
path. The following rollout made the deliberate one-time correction to
`io.github.mat4m0.gwonmac` and the Data Protection Keychain. Crossing that
identity boundary required a manual DMG replacement; the explicit
`~/Library/Application Support/Guild Wars` path preserved ordinary profile
data while both login routes required one new sign-in.

`SIGNED_BETA_UPDATE_PROVEN` belongs only to that historical bundle-identity
and Keychain cutover. It records that a corrected-identity beta installed over
another corrected-identity build and retained the profile and secrets. Do not
reuse it for the planned recurring Stable/Beta data-compatibility gate. Every
future public beta/RC instead proves an actual latest-stable → candidate →
latest-stable semantic round-trip as specified by
`plans/full-refactor-optimization.md`.

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
