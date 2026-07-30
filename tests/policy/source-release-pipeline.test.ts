// Reads repository text, and says so in its filename.
//
// This was most of tests/release/leaks.test.mjs, which was named for behaviour
// it never executed: every assertion below reads package.json, forge.config.ts,
// a workflow or a document. That is a legitimate thing to assert — a release is
// built by those files and by nothing else, so their contents *are* the
// invariant — but it belongs in the suite that owns repository policy, beside
// action pinning and fuses, and it needs no build to run.
//
// What is deliberately not here: the icns bytes (an artifact,
// package-application-icon.test.ts), the credentials surface
// (source-saved-login-surface.test.ts), the security posture (executed against
// a real window in tests/electron/sandbox.spec.ts), and the three assertions
// that still need the compiled build (tests/release/).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

// Only the manifest fields these assertions read. `JSON.parse` returns `any`,
// which would erase the checking of every assertion below; naming the fields
// keeps them checked without pretending to describe the whole file.
type Manifest = {
  productName?: string;
  license?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const json = (file: string): Manifest => JSON.parse(read(file));

// A script the manifest must actually define: a missing one would otherwise
// reach `assert.match` as `undefined` and fail as a type error rather than as
// the invariant it breaks.
const script = (name: string): string => {
  const command = json("package.json").scripts?.[name];
  assert.ok(typeof command === "string", `package.json defines no ${name} script`);
  return command;
};

test("macOS identity uses the Reforged name and configured application icon", () => {
  assert.equal(json("package.json").productName, "Guild Wars Reforged");
  const forge = read("forge.config.ts");
  assert.match(forge, /name: "Guild Wars Reforged"/);
  assert.match(forge, /executableName: "Guild Wars Reforged"/);
  assert.match(forge, /icon: path\.resolve\("assets\/AppIcon\.icns"\)/);
});

test("the public rename keeps the existing profile as its one data home", () => {
  const main = read("src/main/main.ts");
  assert.match(
    main,
    /app\.setPath\("userData", path\.join\(app\.getPath\("appData"\), "Guild Wars"\)\)/,
  );
  assert.match(main, /!app\.commandLine\.hasSwitch\("user-data-dir"\)/);
});

test("package metadata identifies the GPL project and canonical repository", () => {
  const pkg = json("package.json");
  assert.equal(pkg.license, "GPL-3.0-only");
  assert.equal(pkg.repository?.url, "https://github.com/Mat4m0/gwonmac.git");
  assert.equal(pkg.bugs?.url, "https://github.com/Mat4m0/gwonmac/issues");
});

test("packaged releases carry the project and third-party license notices", () => {
  const forge = read("forge.config.ts");
  assert.match(forge, /extraResource:[\s\S]*"LICENSE"/);
  assert.match(forge, /extraResource:[\s\S]*"THIRD-PARTY-NOTICES\.md"/);
  assert.match(forge, /extraResource:[\s\S]*"src\/renderer\/fonts\/COPYING-QUALITYPE"/);
  const notices = read("THIRD-PARTY-NOTICES.md");
  assert.match(notices, /not relicensed under\s+GPL-3\.0-only/);
  assert.match(
    notices,
    /Guild Wars Reforged application[\s\S]*Apple App Store[\s\S]*gwnative project/,
  );
  assert.match(notices, /QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/);
});

// What the mapping produces is proved by executing it, in
// tests/unit/every-release-raises-the-macos-build-number.test.ts. This is the
// wiring: the packaged bundle takes its two numbers from that one function and
// not from a literal somebody edits by hand.
test("the packaged bundle takes its version numbers from the package version", () => {
  const forge = read("forge.config.ts");
  assert.match(forge, /const packageVersion =/);
  assert.match(forge, /macOSBundleVersions\(packageVersion\)/);
  assert.match(forge, /appVersion: macOSVersion\.appVersion/);
  assert.match(forge, /buildVersion: macOSVersion\.buildVersion/);
});

test("the host has one native automatic application replacement path", () => {
  const main = read("src/main/main.ts");
  const updater = read("src/main/app-updater.ts");
  assert.match(main, /import \{[\s\S]{0,80}\bapp,[\s\S]{0,80}\bautoUpdater,/);
  assert.match(main, /new AppUpdater/);
  assert.match(main, /officialUpdaterCapable\(\)/);
  assert.match(main, /autoUpdater\.quitAndInstall\(\)/);
  assert.doesNotMatch(updater, /electron-updater|update-electron-app|Sparkle/);
  assert.deepEqual(json("package.json").dependencies ?? {}, {});
});

test("official releases use Developer ID, notarization, and a scoped marker", () => {
  const workflow = read(".github/workflows/release.yml");
  const forge = read("forge.config.ts");
  assert.match(workflow, /environment: release/);
  for (const secret of [
    "APPLE_DEVELOPER_ID_P12",
    "APPLE_DEVELOPER_ID_PASSWORD",
    "APPLE_API_KEY_P8",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
    "APPLE_TEAM_ID",
  ]) {
    assert.match(workflow, new RegExp(secret));
  }
  assert.match(forge, /osxSign: releaseSigning/);
  assert.match(forge, /osxNotarize: releaseNotarization/);
  assert.match(forge, /GW_OFFICIAL_RELEASE/);
  assert.match(forge, /packaging\/official-update\.json/);
  const dmgVolumeName = forge.match(
    /new MakerDMG\(\{[\s\S]*?\bname: "([^"]+)"/,
  )?.[1];
  assert.equal(dmgVolumeName, "Guild Wars Reforged");
  assert.ok(Buffer.byteLength(dmgVolumeName, "utf8") <= 27);
  assert.match(forge, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(forge, /camera|microphone|location|bluetooth|usb/i);
  assert.match(forge, /\["--force", "--deep", "--sign", "-", appPath\]/);
  assert.match(workflow, /security create-keychain/);
  assert.match(workflow, /gwonmac-release-\$\(openssl rand -hex 16\)/);
  assert.match(workflow, /security delete-keychain/);
  assert.match(
    workflow,
    /name: Delete temporary signing material\n {8}if: always\(\)/,
  );
  assert.ok(
    workflow.indexOf('echo "APPLE_KEYCHAIN=$keychain"')
      < workflow.indexOf("security create-keychain"),
  );
  assert.ok(
    workflow.indexOf('echo "APPLE_CERTIFICATE_PATH=$certificate"')
      < workflow.indexOf("security create-keychain"),
  );
  assert.match(
    workflow,
    /rm -f "\$APPLE_CERTIFICATE_PATH"[\s\S]*rm -f "\$APPLE_API_KEY_PATH"/,
  );
  assert.match(workflow, /xcrun notarytool submit/);
  assert.match(workflow, /xcrun stapler staple/);
  assert.match(workflow, /test "\$TEAM_ID" = "9NN976MFZ4"/);
  assert.match(workflow, /TeamIdentifier=9NN976MFZ4/);
  assert.match(
    forge,
    /Developer ID Application: Matthias Amon \(9NN976MFZ4\)/,
  );
  assert.match(workflow, /Timestamp=/);
  assert.match(workflow, /spctl --assess --type execute/);
  assert.match(workflow, /spctl --assess --type open/);
});

test("release workflow publishes one tested, attested package version", () => {
  const workflow = read(".github/workflows/release.yml");
  const verification = read(".github/workflows/macos-verify.yml");
  assert.match(workflow, /uses: \.\/\.github\/workflows\/macos-verify\.yml/);
  assert.match(verification, /runs-on: macos-15/);
  assert.match(verification, /test "\$\(uname -m\)" = "arm64"/);
  assert.match(workflow, /test "\$\(uname -m\)" = "arm64"/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /git\/ref\/tags\/\$TAG/);
  assert.doesNotMatch(workflow, /pnpm version|date -u/);
  assert.match(workflow, /name: Smoke-test signed release candidate[\s\S]*pnpm test:packaged/);
  assert.match(workflow, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(workflow, /anchore\/sbom-action@/);
  assert.match(workflow, /format: spdx-json/);
  assert.match(workflow, /actions\/attest@/);
  assert.match(workflow, /sbom-path: release-assets\/\*\.spdx\.json/);
  assert.match(workflow, /artifact-metadata: write/);
  assert.match(verification, /actions\/dependency-review-action@/);
  assert.ok(
    verification.indexOf("actions/dependency-review-action@") <
      verification.indexOf("pnpm install --frozen-lockfile"),
  );
  assert.match(verification, /run: pnpm audit --audit-level=high/);
  const releaseBuild = workflow.slice(
    workflow.indexOf("  release-build:"),
    workflow.indexOf("\n  release:"),
  );
  const releasePublish = workflow.slice(workflow.indexOf("\n  release:"));
  assert.match(releaseBuild, /permissions:[\s\S]{0,80}contents: read/);
  assert.doesNotMatch(releaseBuild, /id-token: write|contents: write/);
  assert.match(releaseBuild, /actions\/upload-artifact@/);
  assert.match(releasePublish, /actions\/download-artifact@/);
  assert.doesNotMatch(
    releasePublish,
    /actions\/checkout|pnpm install|pnpm make|pnpm test/,
  );
  assert.match(workflow, /--prerelease --latest=false/);
  assert.match(workflow, /SIGNED_BETA_UPDATE_PROVEN: \$\{\{ vars\.SIGNED_BETA_UPDATE_PROVEN \}\}/);
  assert.match(
    workflow,
    /if \[ "\$prerelease" = "false" \]; then\s+test "\$SIGNED_BETA_UPDATE_PROVEN" = "true"/,
  );
  assert.match(workflow, /--draft --generate-notes/);
  assert.match(workflow, /--json isDraft --jq '\.isDraft'\)" = "true"/);
  assert.match(workflow, /--json targetCommitish --jq '\.targetCommitish'\)" = "\$GITHUB_SHA"/);
  assert.match(
    workflow,
    /name: Create complete draft release\n {8}if: steps\.release-state\.outputs\.create == 'true'/,
  );
  assert.equal(
    workflow.match(/if: steps\.release-state\.outputs\.create == 'true'/gu)?.length,
    3,
  );
  assert.match(workflow, /gh release edit "\$TAG"[\s\S]*--draft=false/);
  assert.match(workflow, /RELEASES\.json/);
  assert.match(workflow, /\*\.zip \*\.dmg RELEASES\.json \*\.spdx\.json/);
  assert.match(workflow, /gh release create "\$TAG" "\$\{args\[@\]\}" release-assets\/\*/);
});

test("tester snapshots are verified, immutable, bounded, and isolated from releases", () => {
  const release = read(".github/workflows/release.yml");
  const pullRequest = read(".github/workflows/pr-package.yml");
  const main = read(".github/workflows/main-snapshot.yml");
  const verification = read(".github/workflows/macos-verify.yml");
  const publisher = read(".github/workflows/publish-snapshot.yml");
  const manual = read(".github/workflows/tester-build.yml");
  const retention = read("scripts/snapshot-retention.ts");
  const feedback = read(".github/ISSUE_TEMPLATE/preview-feedback.yml");

  // One read-only verification path owns PR, main, manual tester, and release
  // gates. PR artifacts are short-lived and no publishing permission reaches
  // that reusable workflow.
  assert.match(verification, /workflow_call:/);
  assert.match(verification, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(
    verification,
    /contents: write|attestations: write|id-token: write/,
  );
  assert.match(verification, /run: pnpm verify/);
  assert.match(verification, /codesign --verify --deep --strict/);
  assert.match(verification, /Signature=adhoc/);
  assert.match(verification, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(verification, /format: spdx-json/);
  assert.match(verification, /SOURCE_COMMIT\.txt/);
  assert.match(verification, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(verification, /retention-days: \$\{\{ inputs\.artifact-retention-days \}\}/);

  assert.match(pullRequest, /on:\n {2}pull_request:/);
  assert.doesNotMatch(pullRequest, /workflow_dispatch:|push:/);
  assert.match(
    pullRequest,
    /gwonmac-pr-\{0\}-\{1\}-\{2\}', github\.event\.pull_request\.number, github\.sha, github\.run_attempt/,
  );
  assert.match(pullRequest, /artifact-retention-days: 3/);
  assert.match(pullRequest, /dependency-review: true/);
  assert.doesNotMatch(
    pullRequest,
    /contents: write|attestations: write|id-token: write/,
  );

  assert.match(main, /on:\n {2}push:\n {4}branches: \[main\]/);
  assert.doesNotMatch(main, /pull_request:|workflow_dispatch:/);
  assert.match(main, /artifact-retention-days: 1/);
  assert.match(main, /snapshot-assets-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(main, /run-number: \$\{\{ github\.run_number \}\}/);
  assert.match(
    main,
    /publish:\n {4}needs: verify[\s\S]*uses: \.\/\.github\/workflows\/publish-snapshot\.yml/,
  );

  assert.match(release, /name: Versioned release[\s\S]*workflow_dispatch:/);
  assert.doesNotMatch(release, /pull_request:|push:/);
  assert.match(
    release,
    /release-build:\n {4}if: github\.ref == 'refs\/heads\/main'\n {4}needs: verify/,
  );

  // Tester dispatch is separate from the versioned release dispatch. Both
  // snapshot callers publish only after the same verification job succeeds.
  assert.match(manual, /name: Tester build[\s\S]*workflow_dispatch:/);
  assert.doesNotMatch(manual, /schedule:|release-build|package\.json'\)\.version/);
  assert.match(manual, /artifact-retention-days: 1/);
  assert.match(manual, /snapshot-assets-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(manual, /run-number: \$\{\{ github\.run_number \}\}/);
  assert.match(manual, /publish:\n {4}needs: verify/);
  assert.match(manual, /uses: \.\/\.github\/workflows\/publish-snapshot\.yml/);

  // The handoff identity and checksums are checked before attestations and
  // release creation. Cleanup runs last and uses an explicit apply switch.
  const handoff = publisher.indexOf("- name: Verify package handoff");
  const attest = publisher.indexOf("- name: Attest snapshot provenance");
  const publish = publisher.indexOf("- name: Publish immutable snapshot prerelease");
  const prune = publisher.indexOf("- name: Prune expired snapshots");
  assert.ok(handoff < attest && attest < publish && publish < prune);
  assert.match(publisher, /test "\$\(tr -d '\\n' < "\$source_commit"\)" = "\$COMMIT_SHA"/);
  assert.match(publisher, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(publisher, /tag="snapshot-\$RUN_NUMBER-\$short"/);
  assert.match(publisher, /type: string/);
  assert.match(
    publisher,
    /if ! \[\[ "\$RUN_NUMBER" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/,
  );
  assert.match(publisher, /group: snapshot-publisher/);
  assert.match(publisher, /if: steps\.assets\.outputs\.prune == 'true'/);
  assert.match(
    publisher,
    /test\(\\"\^snapshot-\[1-9\]\[0-9\]\*-\[0-9a-f\]\{7,40\}\$\\"\)/,
  );
  assert.match(publisher, /--target "\$COMMIT_SHA"/);
  assert.match(publisher, /--prerelease[\s\S]*--latest=false/);
  assert.match(
    publisher,
    /gh release create "\$TAG" "\$ARCHIVE" "\$CHECKSUM" "\$SBOM" "\$SOURCE_COMMIT"/,
  );
  assert.match(publisher, /scripts\/snapshot-retention\.ts[\s\S]*--apply/);
  assert.match(publisher, /only the newest three are retained/);
  assert.match(publisher, /expire after 14 days/);
  assert.match(publisher, /preview-feedback\.yml/);

  // Cleanup's authority is the exact snapshot namespace. It deletes a selected
  // release before its unique tag and cannot match any v* release.
  assert.match(retention, /\/\^snapshot-\[1-9\]\[0-9\]\*-\[0-9a-f\]\{7,40\}\$\//);
  assert.match(retention, /const MAX_SNAPSHOTS = 3/);
  assert.match(retention, /const MAX_AGE_MS = 14 \* 24 \* 60 \* 60 \* 1_000/);
  assert.ok(
    retention.indexOf("repos/${repository}/releases/${release.id}") <
      retention.indexOf("repos/${repository}/git/refs/tags/${release.tagName}"),
  );
  assert.match(retention, /const apply = args\.includes\("--apply"\)/);

  for (const id of [
    "snapshot",
    "macos",
    "hardware",
    "reproduction",
    "expected",
    "actual",
    "versioned-release",
  ]) {
    assert.match(feedback, new RegExp(`id: ${id}[\\s\\S]*?required: true`));
  }
  assert.match(feedback, /id: diagnostics[\s\S]*?required: false/);
});

test("the application ships with no runtime dependency to audit", () => {
  assert.equal(json("package.json").dependencies, undefined);
  assert.equal(json("apps/website/package.json").dependencies, undefined);
  assert.match(
    read("pnpm-workspace.yaml"),
    /auditConfig:\n {2}ignoreGhsas:\n {4}- GHSA-mh99-v99m-4gvg\n$/,
  );
});

test("packaging cleans its output first, and builds the renderer program", () => {
  assert.match(script("make"), /scripts\/clean-output\.mjs/);
  assert.match(script("package"), /scripts\/clean-output\.mjs/);
  assert.match(read("scripts/build.mjs"), /tsconfig\.renderer\.json/);
});

test("release verification tells the player to check, never to disable a check", () => {
  const verification = read("docs/release-verification.md");
  assert.match(verification, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(verification, /gh attestation verify/);
  assert.doesNotMatch(verification, /xattr|spctl --master-disable/);
});

test("the website suite runs on its own path-filtered workflow", () => {
  const workflow = read(".github/workflows/website.yml");
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /run: pnpm test:website/);
  assert.match(workflow, /paths:[\s\S]*apps\/website\/\*\*/);
  assert.equal(workflow.match(/- "src\/shared\/\*\*"/gu)?.length, 2);
  assert.equal(workflow.match(/- "package\.json"/gu)?.length, 2);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|issues: write/);
  assert.doesNotMatch(script("verify"), /test:website/);
});

test("the scheduled canary exercises the latest ArenaNet client conservatively", () => {
  const workflow = read(".github/workflows/client-canary.yml");
  assert.match(workflow, /schedule:[\s\S]*cron:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /GW_LIVE_SMOKE: "1"/);
  assert.match(workflow, /tests\/electron\/live\.spec\.ts/);
  assert.doesNotMatch(workflow, /upload-artifact|issues: write/);
});
