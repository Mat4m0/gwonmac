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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
type VercelConfig = {
  git?: { deploymentEnabled?: boolean | Record<string, boolean> };
  ignoreCommand?: string;
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
  assert.match(
    main,
    /const explicitUserData = app\.commandLine\.hasSwitch\("user-data-dir"\)/,
  );
  assert.match(
    main,
    /if \(!explicitUserData && process\.platform === "darwin"\)/,
  );
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
  assert.match(
    forge,
    /extraResource:[\s\S]*"build\/renderer\/fonts\/COPYING-INTER"/,
  );
  const notices = read("THIRD-PARTY-NOTICES.md");
  assert.match(notices, /not relicensed under\s+GPL-3\.0-only/);
  assert.match(
    notices,
    /Guild Wars Reforged application[\s\S]*Apple App Store[\s\S]*gwnative project/,
  );
  assert.match(notices, /QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/);
  assert.match(notices, /## Inter[\s\S]*?SIL\s+Open Font License 1\.1/);
  assert.match(notices, /## Inter[\s\S]*?@fontsource-variable\/inter/);
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
  // Startup, client-ready events, and the periodic tick share one scheduler.
  // That scheduler owns the audited due-time and client-readiness gates, so a
  // timer cannot bypass them and an initial client preparation does not race
  // a launcher update request.
  assert.match(main, /const maybeCheckForAppUpdates = async[\s\S]{0,800}periodicCheckDue\(/);
  assert.match(main, /setInterval\([\s\S]{0,300}maybeCheckForAppUpdates\(/);
  assert.equal(
    [...main.matchAll(/periodicCheckDue\(/g)].length,
    1,
    "all automatic checks must use one persisted due-time gate",
  );
  assert.match(main, /PERIODIC_CHECK_TICK_MS/);
  assert.doesNotMatch(updater, /electron-updater|update-electron-app|Sparkle/);
  assert.doesNotMatch(updater, /api\.github\.com|\/releases\?per_page/);
  const identity = read("src/shared/project-identity.ts");
  assert.match(identity, /GITHUB_OWNER = "Mat4m0"/);
  assert.match(identity, /GITHUB_REPOSITORY = "gwonmac"/);
  assert.match(identity, /GITHUB_OWNER\.toLowerCase\(\).*github\.io/);
  assert.match(identity, /stable: `\$\{UPDATE_FEED_ROOT\}\/stable\/darwin\/arm64\/RELEASES\.json`/);
  assert.match(identity, /beta: `\$\{UPDATE_FEED_ROOT\}\/beta\/darwin\/arm64\/RELEASES\.json`/);
  assert.deepEqual(json("package.json").dependencies, {
    ws: "^8.21.3",
  });
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
  assert.match(
    forge,
    /\(platform === "darwin" \|\| platform === "win32"\)[\s\S]*packageMode\.kind === "signed"/,
  );
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
    /rm -f "\$APPLE_CERTIFICATE_PATH" "\$APPLE_API_KEY_PATH"[\s\S]*"\$APPLE_PROVISIONING_PROFILE" "\$APPLE_PROFILE_PLIST"/,
  );
  assert.match(workflow, /xcrun notarytool submit/);
  assert.match(workflow, /xcrun stapler staple/);
  assert.match(workflow, /test "\$TEAM_ID" = "9NN976MFZ4"/);
  assert.match(workflow, /7F9A56793C16683742AA7818FE65221A884FA108/);
  assert.match(workflow, /remaining <= 2 \* 365 \* 86400000/);
  assert.match(workflow, /remaining <= 5 \* 365 \* 86400000/);
  // The signed-package assertions are the script's, and the workflow's only
  // job is to run it. A release path that can only be exercised by cutting a
  // release is one nobody can reproduce when it breaks, so an assertion that
  // creeps back inline fails here.
  assert.match(script("verify:signed-app"), /scripts\/verify-signed-app\.ts/);
  assert.match(
    workflow,
    /GW_SIGNED_CHANNEL: release[\s\S]{0,700}pnpm verify:signed-app/,
  );
  assert.match(workflow, /pnpm verify:signed-app[\\\s]+"\$unzip_dir\//);
  assert.match(
    workflow,
    /codesign --verify --deep --strict --verbose=2 "\$replacement"/,
  );
  const workflowWithoutFixtureVerification = workflow.replace(
    / {10}codesign --verify --deep --strict --verbose=2 "\$replacement"\n/,
    "",
  );
  assert.doesNotMatch(
    workflowWithoutFixtureVerification,
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


test("the Stable rollback proof respects the Build Library feature gate", () => {
  const roundTrip = read("scripts/verify-stable-beta-roundtrip.ts");
  const stableCreation = roundTrip.indexOf(
    'console.log("stable/beta compatibility: latest Stable creates canonical state")',
  );
  const legacyOptOut = roundTrip.indexOf(
    "stableInitialSettings.buildLibrary",
    stableCreation,
  );
  const stableEnable = roundTrip.indexOf("buildLibrary: true", legacyOptOut);
  const baselineRead = roundTrip.indexOf(
    "const stableTools = await readToolsCanonical(running.page)",
    stableEnable,
  );
  const firstLibraryWrite = roundTrip.indexOf(
    "api.buildLibrary.set(library)",
    baselineRead,
  );
  const candidatePhase = roundTrip.indexOf(
    'console.log("stable/beta compatibility: candidate reads, modifies, and writes")',
  );
  const candidateLibraryWrite = roundTrip.indexOf(
    "api.buildLibrary.set(library)",
    candidatePhase,
  );
  const candidateOptOut = roundTrip.indexOf(
    'tool: "build-management"',
    candidateLibraryWrite,
  );
  const rollbackPhase = roundTrip.indexOf(
    'console.log("stable/beta compatibility: the same Stable reads and writes again")',
  );
  const rollbackOptOut = roundTrip.indexOf("returnedSettings.buildLibrary", rollbackPhase);
  const rollbackEnable = roundTrip.indexOf(
    "updateStableSettings(running, { buildLibrary: true })",
    rollbackOptOut,
  );
  const rollbackLibraryRead = roundTrip.indexOf(
    "const returned = await readToolsCanonical(running.page)",
    rollbackEnable,
  );

  assert.ok(stableCreation >= 0);
  assert.ok(legacyOptOut > stableCreation);
  assert.ok(stableEnable > legacyOptOut);
  assert.ok(baselineRead > stableEnable);
  assert.ok(firstLibraryWrite > baselineRead);
  assert.ok(candidatePhase > firstLibraryWrite);
  assert.ok(candidateLibraryWrite > candidatePhase);
  assert.ok(candidateOptOut > candidateLibraryWrite);
  assert.ok(rollbackPhase > candidateOptOut);
  assert.ok(rollbackOptOut > rollbackPhase);
  assert.ok(rollbackEnable > rollbackOptOut);
  assert.ok(rollbackLibraryRead > rollbackEnable);
  assert.match(roundTrip, /saveWindowState\(cohort\.windowStatePath/);
  assert.doesNotMatch(
    roundTrip,
    /Browser\.getWindowForTarget|Browser\.setWindowBounds/,
  );
});

test("the Stable domain proof writes through the candidate rollback serializer", () => {
  const roundTrip = read("scripts/verify-stable-beta-roundtrip.ts");
  const domainProof = roundTrip.slice(
    roundTrip.indexOf("async function proveStableAcceptsCandidateSettingDomains"),
    roundTrip.indexOf("const sortedKeys"),
  );

  assert.match(
    domainProof,
    /await saveSettings\(path\.join\(cohort\.userData, "settings\.json"\), settings\)/,
  );
  assert.doesNotMatch(
    domainProof,
    /JSON\.stringify\(\{ formatVersion: 1, \.\.\.settings \}\)/,
  );
});

test("the Stable rollback proof preserves unified-launcher cutover documents", () => {
  const roundTrip = read("scripts/verify-stable-beta-roundtrip.ts");

  assert.match(roundTrip, /launcher-mode\.json/);
  assert.match(roundTrip, /multi\/workspace\.json/);
  assert.match(roundTrip, /launcher-state\.json/);
  assert.match(roundTrip, /assertCandidateAdoptedWithoutChangingStableOwners/);
  assert.match(roundTrip, /assertRollbackIgnoredCandidateLauncherDocuments/);
  assert.match(
    roundTrip,
    /returned\.launcherMode,[\s\S]*candidateDocuments\.launcherMode/,
  );
  assert.match(
    roundTrip,
    /returned\.workspace,[\s\S]*candidateDocuments\.workspace/,
  );
  assert.match(
    roundTrip,
    /returned\.launcherState,[\s\S]*candidateDocuments\.launcherState/,
  );
});

test("application verification routes conservatively through one required result", () => {
  const workflow = read(".github/workflows/pr-package.yml");
  const classifier = read("scripts/ci-impact.ts");

  assert.match(workflow, /name: Application verification/);
  assert.match(
    workflow,
    /pull_request:\n {2}push:\n {4}branches:\n {6}- main\n {6}- "release\/\*\*"/,
  );
  assert.match(workflow, /workflow_dispatch:[\s\S]*checkout_ref:[\s\S]*pr_number:/);
  assert.doesNotMatch(workflow, /paths:|paths-ignore:/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git diff --name-only --no-renames -z "\$range" --/);
  assert.match(workflow, /scripts\/ci-impact\.ts/);
  assert.match(workflow, /test "\$WORKFLOW_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /if \[ "\$EVENT_NAME" = "workflow_dispatch" \]/);
  assert.match(workflow, /echo "runtime=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo "website=false" >> "\$GITHUB_OUTPUT"/);

  assert.match(
    workflow,
    /fast:[\s\S]*needs\.impact\.outputs\.runtime == 'false'[\s\S]*run: pnpm run check/,
  );
  assert.doesNotMatch(
    workflow.match(/fast:[\s\S]*?\n {2}runtime:/u)?.[0] ?? "",
    /verify:runtime|package:built|test:packaged|artifact-name:/,
  );
  assert.match(
    workflow,
    /runtime:[\s\S]*if: needs\.impact\.result == 'success' && needs\.impact\.outputs\.runtime == 'true'/,
  );
  assert.match(workflow, /packaged-smoke: true/);
  assert.match(workflow, /package-intent: developer-build/);
  assert.match(
    workflow,
    /dependency-review: \$\{\{ github\.event_name == 'pull_request' \}\}/,
  );
  assert.match(
    workflow,
    /artifact-name: \$\{\{ github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(workflow, /artifact-retention-days: 3/);

  assert.match(
    workflow,
    /website:[\s\S]*needs\.impact\.outputs\.website == 'true'[\s\S]*run: pnpm test:website/,
  );
  assert.match(workflow, /website:[\s\S]*timeout-minutes: 20/);

  assert.match(workflow, /verify:\n {4}name: verify \/ verify/);
  assert.match(
    workflow,
    /if: always\(\)\n {4}needs: \[impact, fast, runtime, website\]/,
  );
  assert.match(workflow, /test "\$IMPACT_RESULT" = "success"/);
  assert.match(workflow, /test "\$FAST_RESULT" = "success"/);
  assert.match(workflow, /test "\$RUNTIME_RESULT" = "success"/);
  assert.match(workflow, /test "\$WEBSITE_RESULT" = "success"/);
  assert.match(workflow, /test "\$WEBSITE_RESULT" = "skipped"/);

  assert.match(classifier, /paths\.length === 0/);
  assert.match(classifier, /!isWellFormedRepositoryPath\(path\)/);
  assert.match(classifier, /!isFastOnlyPath\(path\)/);
  assert.match(classifier, /apps\/website\//);
  assert.match(classifier, /WEBSITE_MANIFESTS/);
  assert.match(classifier, /src\/shared\/release\.ts/);
  assert.match(classifier, /src\/shared\/project-identity\.ts/);
  assert.match(classifier, /requiresWebsiteVerification/);
  assert.match(classifier, /tests\/helpers\/child-process\.ts/);
  assert.match(classifier, /scripts\/ts-hook\.mjs/);
  assert.match(classifier, /scripts\/ts-resolve\.mjs/);
});

test("developer builds are exact, ad-hoc, bounded, and isolated from releases", () => {
  const release = read(".github/workflows/release.yml");
  const verification = read(".github/workflows/macos-verify.yml");
  const manual = read(".github/workflows/tester-build.yml");
  const feedback = read(".github/ISSUE_TEMPLATE/preview-feedback.yml");
  const developerFeedback = read(
    ".github/ISSUE_TEMPLATE/developer-build-feedback.yml",
  );

  // One read-only verification path owns PR and manual developer gates. The
  // release workflow reuses its exact-commit result. No publishing permission
  // reaches the reusable workflow.
  assert.match(verification, /workflow_call:/);
  assert.match(verification, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(
    verification,
    /contents: write|attestations: write|id-token: write/,
  );
  assert.match(verification, /run: pnpm verify:runtime/);
  assert.match(
    verification,
    /base-ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.repository\.default_branch \}\}/,
  );
  assert.match(
    verification,
    /head-ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| inputs\.checkout-ref \|\| github\.sha \}\}/,
  );
  assert.match(
    verification,
    /if: inputs\.packaged-smoke \|\| inputs\.artifact-name != ''\n {8}run: pnpm package:built && pnpm test:packaged/,
  );
  assert.match(verification, /codesign --verify --deep --strict/);
  assert.match(verification, /grep "Signature=adhoc"/);
  assert.match(verification, /grep "TeamIdentifier=not set"/);
  assert.match(
    verification,
    /GW_PACKAGE_INTENT" = "developer-build"[\s\S]*Guild Wars Reforged Preview\.app[\s\S]*io\.github\.mat4m0\.gwonmac\.preview/,
  );
  assert.match(
    verification,
    /test ! -e "\$app\/Contents\/Resources\/distribution-channel\.json"/,
  );
  assert.match(
    verification,
    /test ! -e "\$app\/Contents\/embedded\.provisionprofile"/,
  );
  assert.match(verification, /External app symlink:/);
  assert.match(verification, /archive_product="Guild-Wars-Reforged-Preview"/);
  assert.match(verification, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(verification, /format: spdx-json/);
  assert.match(verification, /SOURCE_COMMIT\.txt/);
  assert.match(verification, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(
    verification,
    /retention-days: \$\{\{ inputs\.artifact-retention-days \}\}/,
  );

  for (const removed of [
    ".github/workflows/main-snapshot.yml",
    ".github/workflows/main-verification.yml",
    ".github/workflows/sign-preview.yml",
    ".github/workflows/publish-snapshot.yml",
  ]) {
    assert.equal(existsSync(path.join(root, removed)), false);
  }

  assert.match(release, /name: Versioned release[\s\S]*workflow_dispatch:/);
  assert.doesNotMatch(release, /pull_request:|push:/);
  assert.match(
    release,
    /name: Resolve and validate the release source[\s\S]*\^release\/\[0-9\]\{4\}[\s\S]*name: Require green Application verification for this commit[\s\S]*release-build:\n {4}needs: source/,
  );
  assert.doesNotMatch(release, /uses: \.\/\.github\/workflows\/macos-verify\.yml/);

  // Developer dispatch is possible only from the trusted main workflow. The
  // selected source is an exact commit, and the workflow stops at an ad-hoc
  // Actions artifact with no Apple credentials or GitHub release mutation.
  assert.match(manual, /name: Developer build[\s\S]*workflow_dispatch:/);
  assert.match(manual, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(
    manual,
    /schedule:|pull_request:|push:|release-build|package\.json'\)\.version/,
  );
  assert.match(manual, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(manual, /if ! \[\[ "\$COMMIT_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(manual, /verify:\n {4}needs: validate/);
  assert.match(manual, /artifact-retention-days: 7/);
  assert.match(
    manual,
    /developer-build-\$\{\{ inputs\.commit-sha \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(manual, /checkout-ref: \$\{\{ inputs\.commit-sha \}\}/);
  assert.match(manual, /package-intent: developer-build/);
  assert.doesNotMatch(
    manual,
    /environment:|secrets:|APPLE_|notarytool|stapler|sign-preview|publish-snapshot|gh release|attestations: write|contents: write|id-token: write/,
  );
  assert.doesNotMatch(verification, /secrets\.|APPLE_DEVELOPER_ID_P12/);

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
  for (const id of [
    "commit",
    "run",
    "macos",
    "hardware",
    "reproduction",
    "expected",
    "actual",
    "versioned-release",
  ]) {
    assert.match(
      developerFeedback,
      new RegExp(`id: ${id}[\\s\\S]*?required: true`),
    );
  }
  assert.match(
    developerFeedback,
    /id: diagnostics[\s\S]*?required: false/,
  );
});

test("runtime package entries and audit exceptions stay explicit", () => {
  const rootPackage = json("package.json");
  const workspace = read("pnpm-workspace.yaml");
  const lockfile = read("pnpm-lock.yaml");
  assert.deepEqual(rootPackage.dependencies, {
    // The main process owns the bounded public trade-feed connection. Keeping
    // this exact allowlist makes any further runtime dependency an intentional
    // policy change.
    ws: "^8.21.3",
  });
  assert.equal(
    rootPackage.devDependencies?.["@electron-forge/shared-types"],
    "^7.11.2",
  );
  assert.equal(json("apps/website/package.json").dependencies, undefined);
  assert.match(
    workspace,
    /publicHoistPattern:\n {2}- "@intlify\/core"\n {2}- "@intlify\/core-base"\n {2}- "@intlify\/message-compiler"\n {2}- "@intlify\/shared"\n {2}- "@intlify\/utils"\n {2}- "vue-i18n"/u,
  );
  assert.doesNotMatch(
    workspace,
    /publicHoistPattern:\s*\n\s*-\s*["']?\*["']?/u,
  );
  assert.deepEqual(
    workspace.match(/GHSA-[a-z0-9-]+/gu),
    [
      "GHSA-w3rx-r6r6-pgpr",
      "GHSA-5p2g-fcmc-qvqq",
      "GHSA-g7r4-m6w7-qqqr",
    ],
  );
  assert.match(
    workspace,
    /extract-zip: "npm:@electron-internal\/extract-zip@1\.0\.4"/u,
  );
  assert.doesNotMatch(lockfile, /(?:^|\n) {2}extract-zip@2\.0\.1:/u);
});

test("packaging cleans its output first, and builds the renderer runtime", () => {
  assert.match(script("make"), /scripts\/clean-output\.mjs/);
  assert.match(script("package"), /pnpm build && pnpm package:built/);
  assert.match(script("package:built"), /scripts\/clean-output\.mjs/);
  assert.match(script("verify"), /verify:runtime && pnpm package:built/);
  assert.match(read("scripts/build.mjs"), /scripts\/build-renderer\.mjs/);
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
  assert.match(verification, /pnpm release:test <tag>/);
  assert.doesNotMatch(verification, /xattr|spctl --master-disable/);
});

test("the maintainer tests a temporary exact draft without replacing Applications", () => {
  const command = read("scripts/test-draft-release.ts");
  assert.match(script("release:test"), /scripts\/test-draft-release\.ts/);
  assert.match(command, /mkdtempSync/);
  assert.match(command, /verifyCandidate: \(application\) => verifySignedApplication\("release", application\)/);
  assert.match(command, /dependencies\.run\("open", \["-n", candidate\]\)/);
  assert.match(command, /gh\(dependencies, \["attestation", "verify", zip\]\)/);
  assert.match(command, /replaceVerificationRecord/);
  assert.match(command, /finally \{[\s\S]*rmSync\(temporary, \{ recursive: true \}\)/);
  assert.match(command, /isPrerelease !== releaseTag\.prerelease/);
  assert.match(command, /\(beta\|rc\)/);
  assert.doesNotMatch(command, /alpha\|beta\|rc/);
  assert.doesNotMatch(command, /renameSync|\/\.release-test-backup|--rollback|sudo|xattr/);
});

test("the required application gate owns website certification", () => {
  const workflow = read(".github/workflows/pr-package.yml");
  const website = json("apps/website/package.json");
  const vercel: VercelConfig = JSON.parse(read("apps/website/vercel.json"));
  assert.equal(existsSync(path.join(root, ".github/workflows/website.yml")), false);
  assert.match(
    workflow,
    /website:[\s\S]*needs\.impact\.outputs\.website == 'true'[\s\S]*run: pnpm test:website/,
  );
  assert.match(workflow, /website:[\s\S]*timeout-minutes: 20/);
  assert.match(workflow, /needs: \[impact, fast, runtime, website\]/);
  assert.match(workflow, /test "\$WEBSITE_RESULT" = "success"/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(
    workflow,
    /contents: write|id-token: write|issues: write/,
  );
  assert.match(script("test:website"), /gw-website certify/);
  assert.match(website.scripts?.certify ?? "", /assert-release-output\.mjs/);
  assert.equal(
    existsSync(path.join(root, "apps/website/pnpm-lock.yaml")),
    false,
    "the workspace root lockfile is the website's dependency truth",
  );
  assert.deepEqual(
    vercel.git?.deploymentEnabled,
    {
      "**": false,
      main: true,
      "preview/*": true,
    },
    "only main and deliberately named preview branches may spend a Vercel build",
  );
  assert.equal(
    vercel.ignoreCommand,
    '[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1; git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1; git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ../../src/shared ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml',
  );
  assert.ok(
    vercel.ignoreCommand.length <= 256,
    "the root Vercel ignoreCommand schema caps commands at 256 characters",
  );
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(head.status, 0);
  const runIgnore = (previousSha: string): number | null => spawnSync(
    "sh",
    ["-c", vercel.ignoreCommand ?? "exit 2"],
    {
      cwd: path.join(root, "apps/website"),
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previousSha },
      stdio: "ignore",
    },
  ).status;
  assert.equal(runIgnore(""), 1, "a first deployment must build");
  assert.equal(
    runIgnore("0000000000000000000000000000000000000000"),
    1,
    "a rebased-away previous commit must build instead of failing",
  );
  assert.equal(
    runIgnore(head.stdout.trim()),
    0,
    "an unchanged website may skip its build",
  );
});

test("Vercel Previews are explicit, exact-head, and collaborator-only", () => {
  const workflow = read(".github/workflows/vercel-preview.yml");
  assert.match(workflow, /issue_comment:\n {4}types: \[created\]/);
  assert.match(workflow, /pull_request:\n {4}types: \[closed\]/);
  assert.match(
    workflow,
    /permissions:\n {2}contents: write\n {2}issues: write\n {2}pull-requests: read/,
  );
  assert.match(workflow, /github\.event\.comment\.body == '\/vercel'/);
  assert.match(workflow, /"OWNER", "MEMBER", "COLLABORATOR"/);
  assert.match(workflow, /pullRequest\.head\.repo\?\.full_name !== `\$\{owner\}\/\$\{repo\}`/);
  assert.match(workflow, /const headSha = pullRequest\.head\.sha/);
  assert.match(workflow, /const ref = `heads\/preview\/pr-\$\{issueNumber\}`/);
  assert.match(workflow, /github\.rest\.git\.(?:createRef|updateRef)/);
  assert.match(workflow, /github\.rest\.git\.deleteRef/);
  assert.match(workflow, /\[404, 422\]\.includes\(error\.status\)/);
  assert.match(
    workflow,
    /actions\/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd/,
  );
  assert.doesNotMatch(workflow, /pull_request_target|actions\/checkout|VERCEL_TOKEN/);
});

test("client recertification reports evidence but cannot grant authority", () => {
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
  assert.match(workflow, /schedule:[\s\S]*cron: "17 \* \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: arenanet-client-recertification/);

  // The unchanged path runs hourly. It reads one manifest:
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
    /run: node --import \.\/scripts\/ts-hook\.mjs scripts\/official-client\.ts$/mu,
  );
  assert.doesNotMatch(detect, /pnpm|rustup|certification\.js|--download/);
  assert.match(detect, /permissions:\n {6}contents: read\n {6}issues: write/);
  assert.doesNotMatch(detect, /gh issue close/);
  // An open refusal or a closed proved-evidence issue deduplicates expensive
  // derivation for the exact generation plus verifier ABI. A new verifier ABI
  // requalifies even when ArenaNet's generation itself is unchanged.
  assert.match(detect, /needed: \$\{\{ steps\.unreported\.outputs\.needed \}\}/);
  assert.match(detect, /gh issue list --state open --label client-recertification[\s\S]*?needed=false/);
  assert.match(detect, /gh issue list --state all --label client-recertification-proved[\s\S]*?needed=false/);
  assert.doesNotMatch(detect, /CHANGED|published\.outputs\.changed/);
  assert.match(detect, /VERIFIER_ABI: \$\{\{ steps\.published\.outputs\.verifier_abi \}\}/);
  assert.match(detect, /--search "\$short v\$VERIFIER_ABI in:title"/);
  assert.doesNotMatch(detect, /git\/ref\/heads|client-recertification\/\$short/);

  // Derivation is macOS, for an unindexed generation/ABI only, and installs the pinned toolchain
  // before the compiler runs. tests/policy/toolchain-floors.test.ts scans every
  // workflow for that ordering; this pins the job's reason to exist beside it.
  assert.match(derive, /if: needs\.detect\.outputs\.needed == 'true'/);
  assert.match(derive, /runs-on: macos-15/);
  assert.ok(
    derive.indexOf("run: rustup toolchain install") < derive.indexOf("run: pnpm build"),
    "the kernel is compiled on the runner's own toolchain",
  );
  assert.match(
    derive,
    /permissions:\n {6}attestations: write\n {6}contents: read\n {6}id-token: write/,
  );
  assert.doesNotMatch(derive, /contents: write|issues: write|pull-requests: write/);
  assert.match(derive, /pnpm client:official --download "\$RUNNER_TEMP\/official"/);
  // The existing real-client suite has this one explicit execution owner. It
  // receives the exact path emitted by the downloader, runs only in the
  // changed-generation job, and can veto a proved report without becoming
  // launch authority itself.
  assert.equal(
    [...derive.matchAll(/pnpm test:client-artifact/g)].length,
    1,
    "the changed-generation job must qualify the artifact exactly once",
  );
  assert.match(
    derive,
    /name: Qualify the exact published client artifact[\s\S]*continue-on-error: true[\s\S]*GW_CLIENT_WASM: \$\{\{ steps\.official\.outputs\.wasm \}\}/,
  );
  assert.match(derive, /client-artifact\.json/);
  assert.match(derive, /client-artifact\.txt/);
  assert.match(
    derive,
    /official_sha256="\$\(shasum -a 256 "\$GW_CLIENT_WASM" \| awk '\{print \$1\}'\)"/,
  );
  assert.match(derive, /officialSha256: \$officialSha256/);
  assert.match(derive, /certification\.js template "\$WASM" --emit-ts/);
  assert.match(derive, /certification\.js recertify "\$WASM"/);
  assert.match(derive, /certification\.js verify "\$WASM"/);
  assert.match(derive, /certification\.js double-click "\$WASM"/);
  assert.match(derive, /scripts\/qualify-extended-memory\.ts/);
  assert.match(derive, /scripts\/client-recertification-evidence\.ts/);
  assert.doesNotMatch(derive, /--write|tables\.patch|SOURCE_COMMIT/);
  // The typed, privacy-safe record is the one readiness decision. The workflow
  // must not independently reinterpret feature verdicts in shell or jq.
  assert.match(derive, /runtime-verdicts\.json/);
  assert.match(derive, /echo "outcome=\$\(jq -er '\.outcome\.status' "\$EVIDENCE\/generation\.json"\)"/);
  assert.match(derive, /echo "summary=\$\(jq -er '\.outcome\.reason' "\$EVIDENCE\/generation\.json"\)"/);
  assert.match(derive, /echo "build=\$\(jq -er '\.artifacts\.wasm\.sha256' "\$EVIDENCE\/generation\.json"\)"/);
  assert.doesNotMatch(derive, /to_entries \| all|QUALIFICATION_OUTCOME|TRANSFORM_OUTCOME/);
  assert.doesNotMatch(derive, /status="\$\(jq|template_exit/);
  assert.doesNotMatch(derive, /client:official --record|git diff|git apply/);
  assert.match(derive, /carry-forward\.json/);
  assert.match(derive, /carry-forward\.md/);
  assert.match(derive, /uses: actions\/attest@[0-9a-f]{40} # v4\.2\.2/);
  assert.match(derive, /subject-digest: sha256:\$\{\{ steps\.record\.outputs\.build \}\}/);
  assert.match(derive, /predicate-path: \$\{\{ runner\.temp \}\}\/evidence\/generation\.json/);

  // Evidence only: the upload is an explicit privacy-safe allowlist. Detailed
  // locator output and downloaded client artifacts stay in runner temporary
  // storage and cannot be included by adding another file to the directory.
  const uploaded = [...derive.matchAll(/^ {10}path: (.+)$/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(uploaded, ["|"]);
  assert.match(
    derive,
    /path: \|\n {12}\$\{\{ runner\.temp \}\}\/evidence\/generation\.json\n {12}\$\{\{ runner\.temp \}\}\/evidence\/carry-forward\.md/,
  );
  assert.doesNotMatch(derive, /path:[^\n]*(?:Gw\.|official)/);
  assert.doesNotMatch(derive, /^ {12}\$\{\{ runner\.temp \}\}\/evidence\/(?:template-save|enhancement|runtime-verdicts|client-artifact|double-click|extended-memory)/mu);
  assert.match(derive, /retention-days: 90/);

  // Reporting can write issues only. It has no checkout credentials, source
  // write permission, branch command, pull-request command, or workflow token.
  assert.match(publish, /permissions:\n {6}contents: read\n {6}issues: write/);
  assert.match(publish, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.doesNotMatch(publish, /actions\/checkout/);
  assert.doesNotMatch(publish, /pnpm install|pnpm build|pnpm certification/);
  assert.match(publish, /if: always\(\) && needs\.derive\.result != 'skipped'/);
  assert.doesNotMatch(workflow, /persist-credentials: true/);
  assert.doesNotMatch(
    workflow,
    /contents: write|pull-requests: write|actions: write|git push|git apply|gh pr create|gh workflow run/,
  );
  // A failed macOS job or artifact transfer still leaves the generation with
  // reportable metadata and an assigned issue. Missing evidence may never turn
  // into a branch, but it must not prevent the issue step from running.
  assert.match(
    publish,
    /name: Receive the verification evidence\n {8}id: evidence\n {8}continue-on-error: true/,
  );
  assert.match(
    publish,
    /name: Ensure failure evidence is reportable\n {8}if: always\(\)[\s\S]*Evidence collection did not complete/,
  );
  assert.match(
    publish,
    /name: Open the tracking issue\n {8}if: always\(\) && \(needs\.derive\.result != 'success' \|\| needs\.derive\.outputs\.outcome != 'ready' \|\| steps\.evidence\.outcome != 'success' \|\| steps\.proved\.outcome == 'failure'\)/,
  );
  assert.match(
    publish,
    /name: Record a proved generation\n {8}id: proved\n {8}if: needs\.derive\.result == 'success' && needs\.derive\.outputs\.outcome == 'ready'\n {8}continue-on-error: true/,
  );
  assert.match(publish, /gh issue close "\$issue" --reason completed/);
  assert.match(publish, /semantic proof passed/);
  assert.match(publish, /exact-artifact qualification passed/);
  assert.match(publish, /retained evidence: privacy-safe `generation\.json` and `carry-forward\.md`/);
  assert.match(publish, /v\$VERIFIER_ABI: invariant refused/);
  assert.match(
    publish,
    /DERIVE_OUTCOME: \$\{\{ needs\.derive\.outputs\.outcome \}\}[\s\S]*EVIDENCE_OUTCOME: \$\{\{ steps\.evidence\.outcome \}\}[\s\S]*PROVED_OUTCOME: \$\{\{ steps\.proved\.outcome \}\}/,
  );
  assert.match(
    publish,
    /\[ "\$DERIVE_RESULT" = success \] && \[ "\$DERIVE_OUTCOME" = ready \][\s\S]*\[ "\$EVIDENCE_OUTCOME" != success \][\s\S]*\[ "\$PROVED_OUTCOME" = failure \][\s\S]*semantic proof completed, but evidence publication failed; review workflow[\s\S]*evidence publication failed/,
  );
  assert.match(
    publish,
    /FINGERPRINT: \$\{\{ needs\.derive\.outputs\.fingerprint \|\| needs\.detect\.outputs\.fingerprint \}\}[\s\S]*short=unknown/,
  );
  // The branch and the issue name the generation the deriver certified, not the
  // one the detector saw a job earlier; those differ when ArenaNet republishes.
  assert.match(
    publish,
    /FINGERPRINT: \$\{\{ needs\.derive\.outputs\.fingerprint \|\| needs\.detect\.outputs\.fingerprint \}\}/,
  );
  assert.match(publish, /continue-on-error: true/);
  assert.match(publish, /invariant refused, investigation needed/);
  assert.match(publish, /source branch: none; this workflow cannot grant capabilities/);
  assert.match(
    publish,
    /if \[ -s evidence\/generation\.json \]; then[\s\S]*generation record unavailable; review the failed workflow steps/,
  );
  // Backticks in issue Markdown are passed as single-quoted data, never shell
  // substitutions. This preserves the evidence names in generated issues.
  assert.match(publish, /jq -c \. evidence\/generation\.json/);
  assert.match(publish, /printf '%s\\n' '`internal\/upstream\/recertify\.md`/);
  assert.match(
    publish,
    /gh issue create --label client-recertification[\s\S]*--assignee mat4m0/,
  );

  // The record the detector compares against is data with no authority: one
  // format version and one digest, and no field a decision could hide in.
  const record: unknown = JSON.parse(read("certificates/certified-client.json"));
  assert.ok(record !== null && typeof record === "object");
  assert.deepEqual(Object.keys(record).sort(), ["codeGeneration", "formatVersion"]);
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
