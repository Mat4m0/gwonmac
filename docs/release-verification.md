# Verify a release

Guild Wars for macOS releases are ad-hoc signed and are not notarized by
Apple. The project deliberately does not require a paid Apple Developer
membership. Each GitHub release instead publishes three independently useful
pieces of evidence:

- the application ZIP;
- `SHA256SUMS.txt`, covering the ZIP and SBOM;
- an SPDX SBOM describing the packaged application.

GitHub also stores signed build-provenance and SBOM attestations for the ZIP.
These establish that the file was produced from this repository by the
published release workflow. They do not replace macOS Gatekeeper or make an
untrusted repository safe.

## Verify the downloaded files

Download the ZIP, `SHA256SUMS.txt`, and the `.spdx.json` file from the same
GitHub release into one folder. In Terminal, change to that folder and run:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Both entries must report `OK`. A mismatch means the files do not belong
together or were changed; delete them and download the release again.

If the [GitHub CLI](https://cli.github.com/) is installed, also verify the
repository-bound attestations:

```bash
zip="$(find . -maxdepth 1 -name 'Guild Wars-darwin-arm64-*.zip' -print -quit)"
gh attestation verify "$zip" --repo Mat4m0/gwonmac
```

The command must identify `Mat4m0/gwonmac` as the source repository and
successfully verify the artifact. The release’s provenance and SBOM
attestations are both attached to that exact ZIP digest.

## Install without disabling Gatekeeper

After verification, unzip the application and move `Guild Wars.app` to
Applications. Try to open it once, choose **Done** when macOS blocks it, then
open **System Settings → Privacy & Security**, scroll to **Security**, choose
**Open Anyway**, and confirm the second prompt.

Do not disable Gatekeeper globally and do not run a blanket quarantine-removal
command. The one-time System Settings approval is scoped to this application.
