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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
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
  assert.ok(
    typeof command === "string",
    `package.json defines no ${name} script`,
  );
  return command;
};

test("macOS identity uses the Reforged name and configured application icon", () => {
  assert.equal(json("package.json").productName, "Guild Wars Reforged");
  const forge = read("forge.config.ts");
  const channels = read("src/shared/distribution-channel.ts");
  assert.match(channels, /release: \{[\s\S]{0,100}productName: "Guild Wars Reforged"/);
  assert.match(forge, /name: channelConfig\.productName/);
  assert.match(forge, /executableName: channelConfig\.productName/);
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
  assert.match(
    forge,
    /extraResource:[\s\S]*"src\/renderer\/fonts\/COPYING-QUALITYPE"/,
  );
  const notices = read("THIRD-PARTY-NOTICES.md");
  assert.match(notices, /not relicensed under\s+GPL-3\.0-only/);
  assert.match(
    notices,
    /Guild Wars Reforged application[\s\S]*Apple App Store[\s\S]*gwnative project/,
  );
  assert.match(notices, /QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/);
});

test("packaged releases carry the pinned certificate-feed key", () => {
  // Read from the bundle's Resources at runtime, where the code signature
  // seals it. Left out of the package, `certificateFeedTrust` would see no
  // pinned key at all and every fetched feed would be refused — a failure that
  // is safe, silent, and would survive a release.
  assert.match(
    read("forge.config.ts"),
    /extraResource:[\s\S]*"certificates\/public-key\.txt"/,
  );
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
  assert.match(main, /packagedDistributionChannel\(\)/);
  assert.match(main, /capable: distribution\.automaticUpdates/);
  assert.match(main, /autoUpdater\.quitAndInstall\(\)/);
  // The periodic re-check must run through the one audited predicate; a
  // deleted tick or a bypassed gate stays green in unit tests, not here.
  assert.match(main, /setInterval\([\s\S]{0,600}periodicCheckDue\(/);
  assert.match(main, /PERIODIC_CHECK_TICK_MS/);
  assert.doesNotMatch(updater, /electron-updater|update-electron-app|Sparkle/);
  assert.deepEqual(json("package.json").dependencies ?? {}, {});
});

test("distribution channels use preflighted signing and a scoped marker", () => {
  const workflow = read(".github/workflows/release.yml");
  const forge = read("forge.config.ts");
  const signing = read("scripts/apple-signing.ts");
  const verifier = read("scripts/verify-signed-app.ts");
  assert.match(workflow, /environment: release/);
  for (const secret of [
    "APPLE_DEVELOPER_ID_P12",
    "APPLE_DEVELOPER_ID_PASSWORD",
    "APPLE_DEVELOPER_ID_PROFILE",
    "APPLE_API_KEY_P8",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER_ID",
    "APPLE_TEAM_ID",
  ]) {
    assert.match(workflow, new RegExp(secret));
  }
  assert.match(forge, /osxSign: distributionSigning/);
  assert.match(forge, /osxNotarize: releaseNotarization/);
  assert.match(forge, /GW_PACKAGE_INTENT/);
  assert.doesNotMatch(forge, /GW_PACKAGE_CHANNEL|GW_SIGN_DISTRIBUTION/);
  assert.match(forge, /distribution-channel\.json/);
  assert.match(forge, /if \(packageMode\.kind === "signed"\)/);
  assert.doesNotMatch(forge, /official-update\.json|GW_OFFICIAL_RELEASE/);
  assert.match(forge, /appBundleId: channelConfig\.bundleId/);
  assert.match(signing, /provisioningProfile: input\.profile/);
  assert.match(signing, /preAutoEntitlements: false/);
  assert.match(signing, /preEmbedProvisioningProfile: true/);
  assert.match(signing, /ignore: ignoreRedundantSigningTarget/);
  assert.match(signing, /Electron Framework\\\.framework\\\//);
  assert.match(signing, /entitlements\.\$\{channel\}\.plist/);
  assert.match(signing, /verifyAppleSigningConfiguration/);
  assert.match(signing, /selected signing identity is not authorized by the profile/);
  assert.match(signing, /provisioning profile is expired/);
  const dmgVolumeName = forge.match(
    /new MakerDMG\(\{[\s\S]*?\bname: "([^"]+)"/,
  )?.[1];
  assert.equal(dmgVolumeName, "Guild Wars Reforged");
  assert.ok(Buffer.byteLength(dmgVolumeName, "utf8") <= 27);
  assert.match(signing, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(signing, /camera|microphone|location|bluetooth|usb/i);
  assert.match(forge, /\["--force", "--deep", "--sign", "-", appPath\]/);
  assert.match(workflow, /security create-keychain/);
  assert.match(workflow, /gwonmac-release-\$\(openssl rand -hex 16\)/);
  assert.match(workflow, /security delete-keychain/);
  assert.match(
    workflow,
    /name: Delete temporary signing material\n {8}if: always\(\)/,
  );
  assert.ok(
    workflow.indexOf('echo "APPLE_KEYCHAIN=$keychain"') <
      workflow.indexOf("security create-keychain"),
  );
  assert.ok(
    workflow.indexOf('echo "APPLE_CERTIFICATE_PATH=$certificate"') <
      workflow.indexOf("security create-keychain"),
  );
  assert.match(
    workflow,
    /rm -f "\$APPLE_CERTIFICATE_PATH"[\s\S]*rm -f "\$APPLE_API_KEY_PATH"/,
  );
  assert.match(workflow, /xcrun notarytool submit/);
  assert.match(workflow, /xcrun stapler staple/);
  assert.match(workflow, /test "\$TEAM_ID" = "9NN976MFZ4"/);
  assert.match(workflow, /7F9A56793C16683742AA7818FE65221A884FA108/);
  assert.match(workflow, /remaining <= 2 \* 365 \* 86400000/);
  assert.match(workflow, /remaining <= 5 \* 365 \* 86400000/);
  assert.match(
    workflow,
    /rm -f "\$APPLE_PROVISIONING_PROFILE"[\s\S]*rm -f "\$APPLE_PROFILE_PLIST"/,
  );

  // The signed-package assertions are the script's, and the workflow's only
  // job is to run it. A release path that can only be exercised by cutting a
  // release is one nobody can reproduce when it breaks, so an assertion that
  // creeps back inline fails here.
  assert.match(script("verify:signed-app"), /scripts\/verify-signed-app\.ts/);
  assert.match(workflow, /GW_SIGNED_CHANNEL: release\n {8}run: \|\n {10}pnpm verify:signed-app/);
  assert.match(workflow, /pnpm verify:signed-app "\$unzip_dir\//);
  assert.doesNotMatch(
    workflow,
    /codesign -dv|codesign --verify|codesign -d --entitlements|spctl|stapler validate/,
  );
  assert.match(verifier, /TeamIdentifier=\$\{APPLE_TEAM_ID\}/);
  assert.match(verifier, /Authority=\$\{distributionAuthorityName\(channel\)\}/);
  assert.match(verifier, /embedded\.provisionprofile/);
  assert.match(verifier, /"Timestamp="/);
  assert.match(verifier, /const HELPERS = 4/);
  assert.match(verifier, /const PLUGIN_HELPERS = 1/);
  assert.match(verifier, /"--assess", "--type", "execute"/);
  assert.match(verifier, /"--assess",\s*"--type",\s*"open"/);
  assert.match(verifier, /approvedDistributionEntitlements\(channel\)/);
  assert.match(verifier, /distributionOptionsForFile\(channel, helper\)/);
  // The workflow passes the disk image as a `find` result. An empty one is a
  // lookup that found nothing, not a package without an image, so it must not
  // resolve to the form that skips every disk image assertion.
  assert.match(verifier, /args\.length > 1 && !diskImage/);
});

test("release entitlements are an exact three-key allowlist", () => {
  const entitlements = read("packaging/entitlements.release.plist");
  const keys = [...entitlements.matchAll(/<key>([^<]+)<\/key>/gu)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(keys, [
    "com.apple.application-identifier",
    "com.apple.developer.team-identifier",
    "com.apple.security.cs.allow-jit",
  ]);
  assert.match(
    entitlements,
    /<key>com\.apple\.application-identifier<\/key>\s*<string>9NN976MFZ4\.io\.github\.mat4m0\.gwonmac<\/string>/,
  );
  assert.match(
    entitlements,
    /<key>com\.apple\.developer\.team-identifier<\/key>\s*<string>9NN976MFZ4<\/string>/,
  );
  assert.doesNotMatch(
    entitlements,
    /keychain-access-groups|application-groups|app-sandbox|get-task-allow/,
  );
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
  assert.match(
    workflow,
    /name: Refuse a version that already shipped[\s\S]*?already published; bump the version in package\.json[\s\S]*?- run: pnpm install --frozen-lockfile/,
  );
  assert.doesNotMatch(workflow, /pnpm version|date -u/);
  assert.match(
    workflow,
    /name: Smoke-test signed release candidate[\s\S]*?GW_PACKAGE_INTENT: release[\s\S]*?run: pnpm test:packaged/,
  );
  assert.match(
    workflow,
    /name: Prove signed Data Protection Keychain continuity[\s\S]*?GW_SIGNED_APP_PATH="\$app" GW_SIGNED_CHANNEL=release[\s\S]*?pnpm test:signed-keychain/,
  );
  assert.match(
    json("package.json").scripts?.["test:signed-keychain"] ?? "",
    /tests\/signed-keychain-runtime\.ts/,
  );
  assert.match(workflow, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(workflow, /anchore\/sbom-action@/);
  assert.match(workflow, /format: spdx-json/);
  assert.match(workflow, /actions\/attest@/);
  assert.match(
    workflow,
    /id: release-state[\s\S]*echo "sbom=\$sbom" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    workflow,
    /sbom-path: \$\{\{ steps\.release-state\.outputs\.sbom \}\}/,
  );
  assert.doesNotMatch(workflow, /sbom-path: [^\n]*\*/);
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

  // A dry run is only evidence about the real release if it is the real
  // release minus its publishing: the flag is read once, by the job that tags,
  // attests, and uploads, and no step that builds or verifies may consult it.
  // What the run produced is recorded where a skipped release cannot record
  // it.
  assert.match(workflow, /workflow_dispatch:\n {4}inputs:\n {6}dry_run:/);
  assert.match(
    workflow,
    /description: Build and verify the release, then publish nothing\.\n {8}default: false\n {8}type: boolean/,
  );
  assert.match(
    releasePublish,
    /release:\n {4}if: github\.ref == 'refs\/heads\/main' && !inputs\.dry_run/,
  );
  assert.equal(workflow.match(/if: [^\n]*dry_run/gu)?.length, 1);
  assert.match(
    releaseBuild,
    /name: Summarize built and verified assets[\s\S]*?cat "\$ASSET_DIR\/SHA256SUMS\.txt"[\s\S]*?>> "\$GITHUB_STEP_SUMMARY"/,
  );

  assert.match(workflow, /--prerelease --latest=false/);
  assert.match(
    workflow,
    /SIGNED_BETA_UPDATE_PROVEN: \$\{\{ vars\.SIGNED_BETA_UPDATE_PROVEN \}\}/,
  );
  assert.match(
    workflow,
    /if \[ "\$prerelease" = "false" \]; then\s+test "\$SIGNED_BETA_UPDATE_PROVEN" = "true"/,
  );
  assert.match(workflow, /--draft --generate-notes/);
  assert.match(workflow, /--json isDraft --jq '\.isDraft'\)" != "true"/);
  assert.match(
    workflow,
    /--json targetCommitish --jq '\.targetCommitish'\)" = "\$GITHUB_SHA"/,
  );
  assert.match(
    workflow,
    /name: Create complete draft release\n {8}if: steps\.release-state\.outputs\.create == 'true'/,
  );
  assert.equal(
    workflow.match(/if: steps\.release-state\.outputs\.create == 'true'/gu)
      ?.length,
    3,
  );
  assert.match(workflow, /gh release edit "\$TAG"[\s\S]*--draft=false/);
  assert.match(workflow, /RELEASES\.json/);
  assert.match(workflow, /\*\.zip \*\.dmg RELEASES\.json \*\.spdx\.json/);
  assert.match(
    workflow,
    /gh release create "\$TAG" "\$\{args\[@\]\}" release-assets\/\*/,
  );
});

test("tester snapshots are verified, immutable, bounded, and isolated from releases", () => {
  const release = read(".github/workflows/release.yml");
  const pullRequest = read(".github/workflows/pr-package.yml");
  const main = read(".github/workflows/main-snapshot.yml");
  const verification = read(".github/workflows/macos-verify.yml");
  const publisher = read(".github/workflows/publish-snapshot.yml");
  const signer = read(".github/workflows/sign-preview.yml");
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
  assert.match(verification, /run: pnpm verify:runtime/);
  assert.match(
    verification,
    /if: inputs\.artifact-name != ''\n {8}run: pnpm package:built && pnpm test:packaged/,
  );
  assert.match(verification, /codesign --verify --deep --strict/);
  assert.match(verification, /Signature=adhoc/);
  assert.match(verification, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(verification, /format: spdx-json/);
  assert.match(verification, /SOURCE_COMMIT\.txt/);
  assert.match(verification, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(
    verification,
    /retention-days: \$\{\{ inputs\.artifact-retention-days \}\}/,
  );

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
  assert.match(
    main,
    /snapshot-assets-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(main, /run-number: \$\{\{ github\.run_number \}\}/);
  assert.match(main, /signer-sha: \$\{\{ github\.sha \}\}/);
  assert.equal((main.match(/signer-sha:/gu) ?? []).length, 2);
  assert.match(main, /package-intent: preview-handoff/);
  assert.match(
    main,
    /sign:\n {4}needs: verify[\s\S]*uses: \.\/\.github\/workflows\/sign-preview\.yml[\s\S]*publish:\n {4}needs: sign[\s\S]*uses: \.\/\.github\/workflows\/publish-snapshot\.yml/,
  );

  assert.match(release, /name: Versioned release[\s\S]*workflow_dispatch:/);
  assert.doesNotMatch(release, /pull_request:|push:/);
  assert.match(
    release,
    /release-build:\n {4}if: github\.ref == 'refs\/heads\/main'\n {4}needs: verify/,
  );

  // Tester dispatch is possible only from the trusted main workflow. The
  // selected source is an exact commit and publishing waits for signing.
  assert.match(manual, /name: Tester build[\s\S]*workflow_dispatch:/);
  assert.doesNotMatch(
    manual,
    /schedule:|release-build|package\.json'\)\.version/,
  );
  assert.match(manual, /artifact-retention-days: 1/);
  assert.match(
    manual,
    /snapshot-assets-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(manual, /run-number: \$\{\{ github\.run_number \}\}/);
  assert.match(manual, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(manual, /checkout-ref: \$\{\{ inputs\.commit-sha \}\}/);
  assert.match(manual, /signer-sha: \$\{\{ github\.sha \}\}/);
  assert.equal((manual.match(/signer-sha:/gu) ?? []).length, 2);
  assert.match(manual, /package-intent: preview-handoff/);
  assert.match(manual, /environment: snapshot-signing-approval/);
  assert.match(manual, /sign:\n {4}needs: \[verify, approve\]/);
  assert.match(manual, /publish:\n {4}needs: sign/);
  assert.match(manual, /uses: \.\/\.github\/workflows\/publish-snapshot\.yml/);

  // The verification job has no secrets. The trusted signer verifies the
  // artifact before importing protected-environment credentials, removes the
  // keychain, and only then executes the signed applications.
  assert.match(signer, /environment: snapshot-signing/);
  assert.match(signer, /ref: \$\{\{ inputs\.signer-sha \}\}/);
  assert.match(signer, /test "\$\(git rev-parse HEAD\)" = "\$SIGNER_SHA"/);
  assert.match(signer, /Verify handoff without executing artifact code/);
  assert.ok(
    signer.indexOf("Verify handoff without executing artifact code")
      < signer.indexOf("Import protected Preview signing material"),
  );
  assert.match(
    signer,
    /test ! -e "\$app\/Contents\/Resources\/distribution-channel\.json"/,
  );
  assert.ok(
    signer.indexOf("Remove signing material before runtime tests")
      < signer.indexOf("Prove signed Preview Keychain continuity"),
  );
  assert.match(signer, /GW_SIGNED_REPLACEMENT_APP_PATH/);
  assert.match(signer, /GW_SIGNED_CHANNEL: preview/);
  assert.equal(
    signer.match(/pnpm test:signed-keychain/gu)?.length,
    1,
    "one continuity run already covers relaunch, move, replacement and cleanup",
  );
  assert.match(signer, /APPLE_PREVIEW_DEVELOPER_ID_PROFILE/);
  assert.match(signer, /xcrun notarytool submit/);
  assert.match(signer, /xcrun stapler staple/);
  assert.match(signer, /SIGNER_COMMIT\.txt/);
  assert.match(publisher, /SIGNER_COMMIT\.txt/);
  assert.match(
    publisher,
    /test "\$\(tr -d '\\n' < "\$signer_commit"\)" = "\$SIGNER_SHA"/,
  );
  assert.doesNotMatch(verification, /secrets\.|APPLE_DEVELOPER_ID_P12/);
  assert.match(publisher, /Developer ID signed and notarized by Apple/);

  // The handoff identity and checksums are checked before attestations and
  // release creation. Cleanup runs last and uses an explicit apply switch.
  const handoff = publisher.indexOf("- name: Verify package handoff");
  const attest = publisher.indexOf("- name: Attest snapshot provenance");
  const publish = publisher.indexOf(
    "- name: Publish immutable snapshot prerelease",
  );
  const prune = publisher.indexOf("- name: Prune expired snapshots");
  assert.ok(handoff < attest && attest < publish && publish < prune);
  assert.match(
    publisher,
    /test "\$\(tr -d '\\n' < "\$source_commit"\)" = "\$COMMIT_SHA"/,
  );
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
    /gh release create "\$TAG" "\$ARCHIVE" "\$CHECKSUM" "\$SBOM"[\s\S]{0,80}"\$SOURCE_COMMIT" "\$SIGNER_COMMIT"/,
  );
  assert.match(publisher, /scripts\/snapshot-retention\.ts[\s\S]*--apply/);
  assert.match(publisher, /only the newest three are retained/);
  assert.match(publisher, /expire after 14 days/);
  assert.match(publisher, /preview-feedback\.yml/);

  // Cleanup's authority is the exact snapshot namespace. It deletes a selected
  // release before its unique tag and cannot match any v* release.
  assert.match(
    retention,
    /\/\^snapshot-\[1-9\]\[0-9\]\*-\[0-9a-f\]\{7,40\}\$\//,
  );
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
  assert.deepEqual(
    read("pnpm-workspace.yaml").match(/GHSA-[a-z0-9-]+/gu),
    [
      "GHSA-mh99-v99m-4gvg",
      "GHSA-w3rx-r6r6-pgpr",
      "GHSA-5p2g-fcmc-qvqq",
    ],
  );
});

test("packaging cleans its output first, and builds the renderer program", () => {
  assert.match(script("make"), /scripts\/clean-output\.mjs/);
  assert.match(script("package"), /pnpm build && pnpm package:built/);
  assert.match(script("package:built"), /scripts\/clean-output\.mjs/);
  assert.match(script("verify"), /verify:runtime && pnpm package:built/);
  assert.match(read("scripts/build.mjs"), /tsconfig\.renderer\.json/);
});

test("the default gate is deterministic and certifies every shipped test layer", () => {
  const verification = read(".github/workflows/macos-verify.yml");
  assert.doesNotMatch(script("test:unit"), /coverage|GW_CLIENT_WASM/);
  assert.match(script("test:client-artifact"), /tests\/client-artifact\/\*\.ts/);
  assert.match(script("verify:runtime"), /tools:test:e2e/);
  assert.match(script("verify:runtime"), /test:electron/);
  assert.match(script("verify"), /package:built && pnpm test:packaged/);
  assert.match(verification, /pnpm exec playwright install chromium/);
  assert.doesNotMatch(verification, /unit-coverage/);
});

test("release verification tells the player to check, never to disable a check", () => {
  const verification = read("docs/release-verification.md");
  assert.match(verification, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(verification, /gh attestation verify/);
  assert.doesNotMatch(verification, /xattr|spctl --master-disable/);
});

test("the website suite runs on its own path-filtered workflow", () => {
  const workflow = read(".github/workflows/website.yml");
  const website = json("apps/website/package.json");
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /run: pnpm test:website/);
  assert.match(workflow, /paths:[\s\S]*apps\/website\/\*\*/);
  assert.equal(workflow.match(/- "src\/shared\/\*\*"/gu)?.length, 2);
  assert.equal(workflow.match(/- "package\.json"/gu)?.length, 2);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(
    workflow,
    /contents: write|id-token: write|issues: write/,
  );
  assert.doesNotMatch(script("verify"), /test:website/);
  assert.match(script("test:website"), /gw-website certify/);
  assert.match(website.scripts?.certify ?? "", /assert-release-output\.mjs/);
  assert.equal(
    existsSync(path.join(root, "apps/website/pnpm-lock.yaml")),
    false,
    "the workspace root lockfile is the website's dependency truth",
  );
});

test("the patch detector is cheap, secretless, and only ever proposes", () => {
  const workflow = read(".github/workflows/client-recertification.yml");
  // Blanked rather than dropped, so a reported offset is the one an editor
  // shows. A job's prose sits above its key and would otherwise be scanned as
  // part of the job before it.
  const body = workflow
    .split("\n")
    .map((line) => (/^\s*#/u.test(line) ? "" : line))
    .join("\n");
  const detect = body.slice(body.indexOf("\n  detect:"), body.indexOf("\n  derive:"));
  const derive = body.slice(body.indexOf("\n  derive:"), body.indexOf("\n  publish:"));
  const publish = body.slice(body.indexOf("\n  publish:"));
  assert.ok(detect && derive && publish, "the three jobs are not all present");

  // No secret of any kind reaches this workflow. `github.token` is the run's
  // own credential and is what keeps `secrets.` absent rather than merely
  // narrow, so the scan can be exact.
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.match(workflow, /schedule:[\s\S]*cron: "\*\/15 \* \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: arenanet-client-recertification/);

  // The unchanged path runs ninety-six times a day. It reads one manifest:
  // no packages, no compiler, no client bytes, and nothing out of the
  // certification command line, which builds the companion kernel first.
  assert.match(detect, /runs-on: ubuntu-latest/);
  // Node runs the script, not `pnpm <script>`: the run wrapper resolves this
  // repository's dependency tree before the script starts, so the word `pnpm`
  // anywhere in this job is the install the cheap path exists to avoid. That
  // makes the absence the assertion rather than the absence of one spelling
  // of it — `pnpm/action-setup` and `pnpm install` are the same defect here.
  assert.match(
    detect,
    /run: node --import \.\/scripts\/ts-hook\.mjs --experimental-strip-types scripts\/official-client\.ts$/mu,
  );
  assert.doesNotMatch(detect, /pnpm|rustup|certification\.js|--download/);
  assert.match(detect, /permissions:\n {6}contents: read\n {6}issues: write/);
  assert.match(
    detect,
    /if: steps\.published\.outputs\.changed == 'false'[\s\S]*gh issue close/,
  );
  // A generation with a branch or an open issue is already proposed, and
  // re-deriving it every quarter hour costs a macOS job and buries the
  // fetch-failure heartbeat under a run that fails on the push it repeats.
  assert.match(detect, /changed: \$\{\{ steps\.unproposed\.outputs\.changed \}\}/);
  assert.match(
    detect,
    /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/client-recertification\/\$short"/,
  );
  assert.match(detect, /gh issue list --state open --label client-recertification[\s\S]*?changed=false/);

  // Derivation is macOS, on change only, and installs the pinned toolchain
  // before the compiler runs. tests/policy/toolchain-floors.test.ts scans every
  // workflow for that ordering; this pins the job's reason to exist beside it.
  assert.match(derive, /if: needs\.detect\.outputs\.changed == 'true'/);
  assert.match(derive, /runs-on: macos-15/);
  assert.ok(
    derive.indexOf("run: rustup toolchain install") < derive.indexOf("run: pnpm build"),
    "the kernel is compiled on the runner's own toolchain",
  );
  assert.match(derive, /permissions:\n {6}contents: read/);
  assert.doesNotMatch(derive, /contents: write|issues: write|pull-requests: write/);
  assert.match(derive, /pnpm client:official --download "\$RUNNER_TEMP\/official"/);
  assert.match(derive, /certification\.js template "\$WASM" --emit-ts --write/);
  assert.match(derive, /certification\.js recertify "\$WASM"/);
  assert.match(
    derive,
    /name: Verify the recorded client artifact[\s\S]*GW_CLIENT_WASM: \$\{\{ steps\.official\.outputs\.wasm \}\}[\s\S]*pnpm test:client-artifact/,
  );
  // The report is printed before `--write` edits the table, so the exit code is
  // the only thing that separates a written entry from one that threw on the
  // way to disk. Dropping it lets the branch claim a certificate it lacks.
  assert.match(derive, /template_exit=\$\?/);
  assert.match(
    derive,
    /if \[ "\$status" = "derived" \] && \[ "\$template_exit" -eq 0 \]/,
  );
  assert.match(
    derive,
    /elif \[ "\$status" = "certified" \] && \[ "\$template_exit" -eq 1 \]/,
  );
  // One fetch per derivation: the recorded generation is the one whose bytes
  // were downloaded and certified, never whatever a later fetch would return.
  assert.match(derive, /FINGERPRINT: \$\{\{ steps\.official\.outputs\.fingerprint \}\}/);
  assert.match(derive, /pnpm client:official --record "\$FINGERPRINT"/);

  // Evidence only: the sole upload path is the evidence directory, and the
  // downloaded client artifacts live somewhere no upload names.
  const uploaded = [...derive.matchAll(/^ {10}path: (.+)$/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(uploaded, ["${{ runner.temp }}/evidence"]);
  assert.doesNotMatch(derive, /path:[^\n]*(?:Gw\.|official)/);

  // Stage one only. It pushes a branch and proposes; a rejected pull request
  // still leaves the branch and an issue naming it.
  assert.match(publish, /permissions:\n {6}actions: read\n {6}contents: write/);
  assert.doesNotMatch(publish, /pnpm install|pnpm build|pnpm certification/);
  assert.match(publish, /if: always\(\) && needs\.derive\.result != 'skipped'/);
  assert.equal(body.match(/persist-credentials: true/gu)?.length, 1);
  assert.match(publish, /persist-credentials: true/);
  assert.match(
    publish,
    /test "\$\(tr -d '\\n' < evidence\/SOURCE_COMMIT\.txt\)" = "\$GITHUB_SHA"/,
  );
  assert.match(publish, /git apply evidence\/tables\.patch/);
  // The branch and the issue name the generation the deriver certified, not the
  // one the detector saw a job earlier; those differ when ArenaNet republishes.
  assert.match(
    publish,
    /FINGERPRINT: \$\{\{ needs\.derive\.outputs\.fingerprint \|\| needs\.detect\.outputs\.fingerprint \}\}/,
  );
  assert.match(
    publish,
    /if gh pr create[\s\S]*?opened=true[\s\S]*?else[\s\S]*?opened=false/,
  );
  assert.match(publish, /continue-on-error: true/);
  // A pull request opened by the run's own token starts no workflow, so the
  // proposal has to say how its gate gets run rather than imply it already is.
  assert.match(publish, /Close and reopen this pull request/);
  assert.match(publish, /auto-derived, PR ready/);
  assert.match(publish, /layout changed, investigation needed/);
  assert.match(publish, /gh issue create --label client-recertification/);

  // The record the detector compares against is data with no authority: one
  // format version and one digest, and no field a decision could hide in.
  const record: unknown = JSON.parse(read("certificates/certified-client.json"));
  assert.ok(record !== null && typeof record === "object");
  assert.deepEqual(Object.keys(record).sort(), ["codeGeneration", "formatVersion"]);
});

test("the feed publication reproduces twice and signs in isolation", () => {
  const workflow = read(".github/workflows/certificate-feed-publication.yml");
  // Blanked rather than dropped, for the reason the detector's scan gives: a
  // job's prose sits above its key and would be read as part of the job before.
  const body = workflow
    .split("\n")
    .map((line) => (/^\s*#/u.test(line) ? "" : line))
    .join("\n");
  const target = body.slice(body.indexOf("\n  target:"), body.indexOf("\n  reproduce:"));
  const reproduce = body.slice(body.indexOf("\n  reproduce:"), body.indexOf("\n  agree:"));
  const agree = body.slice(body.indexOf("\n  agree:"), body.indexOf("\n  sign:"));
  const sign = body.slice(body.indexOf("\n  sign:"));
  assert.ok(target && reproduce && agree && sign, "the four jobs are not all present");

  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.match(workflow, /group: certificate-feed-publication/);
  // The tables a feed is derived from, and the pin that decides whether one is
  // believed. A trigger wider than that publishes on commits that cannot have
  // changed a single byte of the document.
  assert.match(
    workflow,
    /paths:\n {6}- src\/main\/certification\/template-save-compat\.ts\n {6}- src\/main\/certification\/enhancement-builds\.ts\n {6}- certificates\/public-key\.txt\n/,
  );

  // Transitional publication still runs the application's own trust rule and
  // refuses an explicitly disabled or malformed pin.
  assert.match(target, /certificateFeedTrust\(pinned\)\.remote/);
  assert.match(target, /refusing transitional publication/);

  // Two runners, and they have to be two different machines for the comparison
  // to be evidence about this repository rather than about one runner.
  const runners = reproduce.match(/runner: \[(.+)\]/u)?.[1] ?? "";
  assert.deepEqual(runners.split(", "), ["ubuntu-latest", "macos-15"]);
  assert.match(reproduce, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.match(reproduce, /fail-fast: false/);
  // The derivation is the tree plus a Node and nothing else. A package manager
  // here would make two runners agree about a registry as much as about the
  // tables, and would put a thousand install scripts in the reproduction.
  assert.match(
    reproduce,
    /scripts\/generate-certificate-feed\.ts \\\n {12}--sequence "\$SEQUENCE" --out candidate\/certificate-feed\.json/,
  );
  assert.doesNotMatch(reproduce, /pnpm|rustup|pnpm build/);
  assert.match(reproduce, /cp certificates\/public-key\.txt candidate\/public-key\.txt/);

  // A disagreement blocks and files itself with both answers. Without the
  // hashes in the issue, the run that found it is the only place they exist.
  assert.match(agree, /permissions:\n {6}contents: read\n {6}issues: write/);
  // Two hashes that were never computed compare equal, so the gate needs the
  // pipeline's exit code rather than only its last command's.
  assert.match(agree, /set -o pipefail\n {10}legs=\(reproduced\/\*\/\)/);
  assert.match(agree, /if \[ "\$left" = "\$right" \]; then continue; fi/);
  assert.match(agree, /gh issue create --label certificate-feed/);
  assert.match(agree, /\$\(basename "\$first"\)[\s\S]*\$left[\s\S]*\$\(basename "\$second"\)[\s\S]*\$right/);
  assert.match(agree, /--title "Certificate feed reproduction disagreed on \$file"\n {12}exit 1\n/);
  assert.match(agree, /digest=\$digest/);

  // The tier is computed from the candidate against the feed already in force,
  // so an entry decides its own tier. Template-save facts are re-derived on the
  // machine that receives them; Enhancement facts are not, and reach the
  // approval gate only on a run a person dispatched saying so.
  assert.match(agree, /moved\.some\(\(entry\) => entry\.enhancement !== null\)/);
  assert.match(
    sign,
    /if: >-\n {6}github\.ref == 'refs\/heads\/main'\n {6}&& \(needs\.agree\.outputs\.tier == 'template' \|\| inputs\.enhancement_facts\)/,
  );

  // The job that holds the key checks nothing out. A working tree beside a
  // signing key is every script in it running beside a signing key, and an
  // artifact is data this job reads rather than code it runs.
  assert.doesNotMatch(sign, /actions\/checkout|persist-credentials|pnpm|scripts\//);
  assert.match(sign, /environment: certificate-publishing/);
  assert.match(sign, /permissions:\n {6}contents: write/);
  const actions = [...sign.matchAll(/uses: ([^@]+)@/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)], ["actions/download-artifact"]);

  // One secret, named in one job of one workflow. Its absence everywhere else
  // is the assertion, because a second naming is a second job that can read it.
  const secret = "secrets.CERTIFICATE_FEED_SIGNING_KEY";
  assert.equal(workflow.split(secret).length - 1, 1);
  assert.ok(sign.includes(secret));
  for (const file of readdirSync(path.join(root, ".github/workflows"))) {
    if (file === "certificate-feed-publication.yml") continue;
    assert.doesNotMatch(read(`.github/workflows/${file}`), /CERTIFICATE_FEED_SIGNING_KEY/);
  }

  // The bytes signed are the bytes two runners agreed on, and the key that
  // signs them is the key installations pin. Neither is taken on trust.
  assert.match(sign, /shasum -a 256 candidate\/certificate-feed\.json[\s\S]*= "\$DIGEST"/);
  assert.match(
    sign,
    /openssl pkey -in "\$key" -pubout -outform DER \| tail -c 32 \| base64\)" \\\n {12}= "\$\(tr -d '\\n' < candidate\/public-key\.txt\)"/,
  );
  assert.match(sign, /openssl pkeyutl -verify -pubin/);
  assert.match(sign, /name: Delete the signing key\n {8}if: always\(\)/);

  // Sequence enforcement. The floor a candidate must beat is resolved in one
  // place, by the one job that can see both numbers: a release may ship a
  // snapshot that has overtaken the published feed, and `published + 1` there
  // names a sequence the generator's own floor refuses on both reproduction
  // legs, with no in-band way to publish again.
  assert.equal(body.match(/echo "sequence=\$\(\(current \+ 1\)\)"/gu)?.length, 1);
  assert.match(target, /echo "sequence=\$\(\(current \+ 1\)\)"/);
  assert.match(
    target,
    /current="\$bundled"\n {10}if \[ -n "\$published" \] && \[ "\$published" -gt "\$bundled" \]; then\n {12}current="\$published"/,
  );
  // What is left for the moment after the approval is that nothing published in
  // the gap: any feed that reached these assets came through this workflow and
  // carries at least this candidate's sequence.
  assert.match(sign, /test "\$SEQUENCE" -gt "\$current"/);
  // Both scans stop at the newest release carrying a feed rather than at the
  // newest release: an application release publishes no feed assets, and
  // restarting the sequence there would publish one every installation refuses.
  // Which release carries one is asked of the release list, over every release
  // rather than a window, because `gh release download` exits the same way for
  // "carries no feed" and "the download failed" — and reading the second as the
  // first walks the scan past the feed in force, in the signing job disabling
  // the gate exactly when it cannot see what it guards against.
  assert.equal(
    body.match(
      /gh api --paginate "repos\/\$GITHUB_REPOSITORY\/releases" \\\n {12}--jq '\.\[\]\n {14}\| select\(\.draft == false and \.prerelease == false\)\n {14}\| select\(\[\.assets\[\]\.name\] \| index\("certificate-feed\.json"\)\)\n {14}\| \.tag_name'/gu,
    )?.length,
    2,
  );
  assert.doesNotMatch(body, /--limit \d+|> \/dev\/null 2>&1/u);
  assert.match(sign, /gh release upload "\$RELEASE" --repo "\$GITHUB_REPOSITORY" --clobber/);
  assert.match(sign, /cmp candidate\/certificate-feed\.json "\$fetched\/certificate-feed\.json"/);

  // Only the signing job may write to a release, and nothing in this workflow
  // may push a branch or open a pull request.
  assert.equal(body.match(/contents: write/gu)?.length, 1);
  assert.doesNotMatch(workflow, /pull-requests: write|id-token: write|git push/);

  // The two asset names are the ones the application fetches. A rename here is
  // a feed published where nothing looks for it.
  const delivery = read("src/main/certification/certificate-feed-delivery.ts");
  for (const asset of ["certificate-feed.json", "certificate-feed.json.sig"]) {
    assert.ok(sign.includes(`candidate/${asset}`), `${asset} is never published`);
    assert.ok(delivery.includes(`"${asset}"`), `${asset} is not what the app fetches`);
  }
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
