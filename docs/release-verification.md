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

The parser recognizes the historical prerelease shapes `-alpha.N`, `-beta.N`,
and `-rc.N`, ordered alpha < beta < RC < the release itself. Public versioned
releases refuse alpha. Stable is the website and application default; the
explicit Beta path additionally admits beta and RC builds. Tag syntax and
GitHub's prerelease flag must agree, and snapshots never parse as application
versions.

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

Automatic checks remain user-controlled and on by default. Stable/Beta is one
preference inside the release identity; Beta keeps the same profile, Keychain,
and updater. A matching final Stable is a forward update. An older Stable is a
manual DMG return through the fixed Releases page, never a native downgrade.
The separately signed Preview tester app cannot use AppUpdater. See
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

`SIGNED_BETA_UPDATE_PROVEN` belonged only to that historical bundle-identity
and Keychain cutover and has been removed from the active release workflow.
Every public beta/RC now proves an actual latest signed Stable → exact signed
candidate → the same Stable semantic round-trip. Both binaries must read,
modify, and rewrite settings, Builds/Teams with tags and references, window
state, and profile-origin browser storage without quarantine or reset. A beta
therefore cannot be the first build carrying its own selector: a Stable
enabler must already be published. The browser-store probe establishes origin
continuity only. When Electron, Chromium, or the filesystem/persistence
contract changes, the release also round-trips a real template through the
production Emscripten IDBFS boundary.

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
