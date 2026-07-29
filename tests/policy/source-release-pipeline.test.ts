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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const filesUnder = (directory: string): string[] =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(relative) : [relative];
    },
  );

// Only the manifest fields these assertions read. `JSON.parse` returns `any`,
// which would erase the checking of every assertion below; naming the fields
// keeps them checked without pretending to describe the whole file.
type Manifest = {
  main?: string;
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

test("macOS identity uses the Guild Wars name and the configured application icon", () => {
  assert.equal(json("package.json").productName, "Guild Wars");
  const forge = read("forge.config.ts");
  assert.match(forge, /name: "Guild Wars"/);
  assert.match(forge, /executableName: "Guild Wars"/);
  assert.match(forge, /const packageIcon = path\.resolve\(/);
  assert.match(forge, /"assets\/AppIcon\.icns"/);
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
  assert.match(notices, /not relicensed under GPL-3\.0-only/);
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

test("the host has one manual application replacement path", () => {
  assert.doesNotMatch(read("src/main/main.ts"), /startAppUpdater|autoUpdater/);
  assert.doesNotMatch(read("src/main/entry.ts"), /startAppUpdater|autoUpdater/);
});

test("native makers use one early Windows installer path and no extra ZIP", () => {
  const forge = read("forge.config.ts");
  const pkg = json("package.json");
  assert.equal(pkg.main, "build/main/entry.js");
  assert.match(forge, /new MakerZIP\(\{\}, \[macOSReleaseTarget\.platform\]\)/);
  assert.match(forge, /new MakerSquirrel\(/);
  assert.match(forge, /\[windowsReleaseTarget\.platform\]/);
  assert.match(forge, /new MakerDeb\(/);
  assert.match(forge, /\[linuxReleaseTarget\.platform\]/);
  assert.match(forge, /section: "games"/);
  assert.match(forge, /categories: \["Game"\]/);
  assert.match(read("src/main/entry.ts"), /handleSquirrelStartup\(\)/);
  assert.match(read("src/main/entry.ts"), /await import\("\.\/main\.js"\)/);
});

test("official releases have one honest ad-hoc signing path", () => {
  const workflow = read(".github/workflows/release.yml");
  const verification = read(".github/workflows/native-verify.yml");
  const forge = read("forge.config.ts");
  assert.doesNotMatch(workflow, /APPLE_|Developer ID|notary|stapler/);
  assert.doesNotMatch(forge, /APPLE_|osxSign|osxNotarize/);
  assert.match(forge, /\["--force", "--deep", "--sign", "-", appPath\]/);
  assert.match(verification, /codesign --verify --deep --strict/);
  assert.match(verification, /Signature=adhoc/);
  assert.match(workflow, /ad-hoc signed, not notarized/);
});

test("release workflow publishes one tested, attested package version", () => {
  const workflow = read(".github/workflows/release.yml");
  const verification = read(".github/workflows/native-verify.yml");
  assert.match(workflow, /uses: \.\/\.github\/workflows\/native-verify\.yml/);
  assert.match(verification, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /git\/ref\/tags\/\$TAG/);
  assert.doesNotMatch(workflow, /pnpm version|date -u/);
  assert.match(verification, /run: pnpm test:packaged/);
  assert.match(verification, /scripts\/prepare-preview-artifact\.ts/);
  assert.match(verification, /anchore\/sbom-action@/);
  assert.match(verification, /format: spdx-json/);
  assert.match(workflow, /actions\/attest@/);
  assert.match(workflow, /sbom-path: \$\{\{ steps\.assets\.outputs\.sbom \}\}/);
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
  assert.match(releaseBuild, /permissions:\s+contents: read/);
  assert.doesNotMatch(releaseBuild, /id-token: write|contents: write/);
  assert.match(releaseBuild, /actions\/download-artifact@/);
  assert.match(releaseBuild, /scripts\/artifact-manifest\.ts distribution/);
  assert.doesNotMatch(releaseBuild, /run: pnpm (?:install|make|test)/);
  assert.match(releasePublish, /actions\/download-artifact@/);
  assert.doesNotMatch(
    releasePublish,
    /actions\/checkout|pnpm install|pnpm make|pnpm test/,
  );
  assert.match(workflow, /--prerelease --latest=false/);
  assert.doesNotMatch(workflow, /This is an alpha build/);
  assert.match(
    workflow,
    /if \[ "\$PRERELEASE" = "true" \]; then[\s\S]*This is a prerelease build/,
  );
  assert.match(
    workflow,
    /gh release create "\$TAG" "\$ASSET" "\$CHECKSUM" "\$MANIFEST" "\$SBOM" "\$SOURCE_COMMIT"/,
  );
});

test("tester snapshots are verified, immutable, bounded, and isolated from releases", () => {
  const release = read(".github/workflows/release.yml");
  const pullRequest = read(".github/workflows/pr-package.yml");
  const main = read(".github/workflows/main-snapshot.yml");
  const verification = read(".github/workflows/native-verify.yml");
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
  assert.match(verification, /fromJSON\(needs\.static\.outputs\.matrix\)/);
  assert.match(verification, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.match(verification, /scripts\/assert-native-target\.ts/);
  assert.match(verification, /xvfb-run --auto-servernum pnpm test:electron/);
  assert.doesNotMatch(verification, /--no-sandbox/);
  for (const command of [
    "pnpm build",
    "pnpm test:unit",
    "pnpm test:integration",
    "pnpm test:electron",
    "pnpm test:release",
    "pnpm package",
    "pnpm test:packaged",
    "pnpm make",
    "pnpm test:artifact",
  ]) {
    assert.match(verification, new RegExp(command.replaceAll(":", "\\:")));
  }
  assert.match(verification, /format: spdx-json/);
  assert.match(verification, /scripts\/prepare-preview-artifact\.ts/);
  assert.match(verification, /scripts\/finalize-preview-checksums\.ts/);
  assert.match(verification, /inputs\.artifact-name \}\}-\$\{\{ matrix\.targetId/);
  assert.match(verification, /retention-days: \$\{\{ inputs\.artifact-retention-days \}\}/);

  assert.match(pullRequest, /on:\n {2}pull_request:/);
  assert.doesNotMatch(pullRequest, /workflow_dispatch:|push:/);
  assert.match(
    pullRequest,
    /gwonmac-pr-\{0\}-\{1\}', github\.event\.pull_request\.number, github\.sha/,
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
    /publish:[\s\S]*artifact-name: snapshot-assets-\$\{\{ github\.run_id \}\}-macos-arm64/,
  );
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
  assert.match(
    manual,
    /publish:[\s\S]*artifact-name: snapshot-assets-\$\{\{ github\.run_id \}\}-macos-arm64/,
  );
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
  assert.match(publisher, /scripts\/artifact-manifest\.ts snapshot-assets/);
  assert.match(publisher, /tag="snapshot-\$RUN_NUMBER-\$short"/);
  assert.match(
    publisher,
    /test\(\\"\^snapshot-\[1-9\]\[0-9\]\*-\[0-9a-f\]\{7,40\}\$\\"\)/,
  );
  assert.match(publisher, /--target "\$COMMIT_SHA"/);
  assert.match(publisher, /--prerelease[\s\S]*--latest=false/);
  assert.match(
    publisher,
    /gh release create "\$TAG" "\$ARCHIVE" "\$CHECKSUM" "\$MANIFEST" "\$SBOM" "\$SOURCE_COMMIT"/,
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

test("native tests keep Chromium sandboxed and fail when their build is missing", () => {
  const config = read("tests/electron/playwright.config.ts");
  const fixture = read("tests/electron/fixtures.mts");
  const application = read("tests/electron/app.spec.ts");
  const workflow = read(".github/workflows/native-verify.yml");
  assert.match(config, /build\/main\/main\.js/);
  assert.match(config, /build\/preload\/preload\.cjs/);
  assert.match(config, /build\/renderer\/index\.html/);
  assert.match(config, /developmentElectronExecutable\(root\)/);
  assert.match(config, /Electron test prerequisites are missing/);
  assert.match(fixture, /chromiumSandbox: true/);
  assert.match(application, /chromiumSandbox: true/);
  assert.match(workflow, /kernel\.unprivileged_userns_clone/);

  const launchSurfaces = [
    ...filesUnder("tests/electron"),
    "tests/packaged-smoke.ts",
    "tests/final-artifact-smoke.ts",
    "scripts/electron-layout.ts",
    ".github/workflows/native-verify.yml",
  ];
  for (const file of launchSurfaces) {
    assert.doesNotMatch(
      read(file),
      /--no-sandbox/,
      `${file} disables Chromium's sandbox`,
    );
  }
  for (const file of filesUnder("tests/electron").filter((name) =>
    name.endsWith(".spec.ts"),
  )) {
    assert.doesNotMatch(
      read(file),
      /test\.skip\(!existsSync\((?:main|electronBin)\)/,
      `${file} turns a missing required build into a skip`,
    );
  }
});

test("stable Electron failures carry closed evidence and isolate the real crash", () => {
  const stable = read("tests/electron/playwright.config.ts");
  const fault = read("tests/electron/playwright.fault.config.ts");
  const fixture = read("tests/electron/fixtures.mts");
  const electronFiles = filesUnder("tests/electron");
  const crashCalls = electronFiles.flatMap((file) =>
    [...read(file).matchAll(/forcefullyCrashRenderer\(\)/g)].map(() => file),
  );

  assert.deepEqual(crashCalls, [
    "tests/electron/faults/renderer-crash.spec.ts",
  ]);
  assert.match(stable, /testIgnore: \/faults\\/);
  assert.match(fault, /testMatch: \/faults\\/);
  assert.match(script("test:electron:fault"), /playwright\.fault\.config\.ts/);
  assert.match(fixture, /diagnosticSummary\(\)/);
  assert.match(fixture, /electron-evidence-/);
  assert.match(fixture, /mode: 0o600/);
  assert.doesNotMatch(
    fixture,
    /console|page\.content|textContent/,
    "failure evidence must not copy open renderer text",
  );
});

test("the application ships only the reviewed portable ZIP dependency", () => {
  assert.deepEqual(json("package.json").dependencies, {
    "@zip.js/zip.js": "2.8.34",
  });
  assert.equal(json("apps/website/package.json").dependencies, undefined);
  assert.match(
    read("THIRD-PARTY-NOTICES.md"),
    /zip\.js[\s\S]*BSD 3-Clause\s+License/,
  );
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
  assert.match(workflow, /release-targets\.json/);
  assert.match(workflow, /src\/shared\/release-targets\.ts/);
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
