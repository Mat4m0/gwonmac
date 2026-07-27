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

test("macOS identity uses the Guild Wars name and the configured application icon", () => {
  assert.equal(json("package.json").productName, "Guild Wars");
  const forge = read("forge.config.ts");
  assert.match(forge, /name: "Guild Wars"/);
  assert.match(forge, /executableName: "Guild Wars"/);
  assert.match(forge, /icon: path\.resolve\("assets\/AppIcon\.icns"\)/);
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
});

test("official releases have one honest ad-hoc signing path", () => {
  const workflow = read(".github/workflows/release.yml");
  const forge = read("forge.config.ts");
  assert.doesNotMatch(workflow, /APPLE_|Developer ID|notary|stapler/);
  assert.doesNotMatch(forge, /APPLE_|osxSign|osxNotarize/);
  assert.match(forge, /\["--force", "--deep", "--sign", "-", appPath\]/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /Signature=adhoc/);
  assert.match(workflow, /ad-hoc signed, not notarized/);
});

test("release workflow publishes one tested, attested package version", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /git\/ref\/tags\/\$TAG/);
  assert.doesNotMatch(workflow, /pnpm version|date -u/);
  assert.match(workflow, /name: Smoke-test release candidate[\s\S]*pnpm test:packaged/);
  assert.match(workflow, /shasum -a 256 -c "\$\(basename "\$CHECKSUM"\)"/);
  assert.match(workflow, /anchore\/sbom-action@/);
  assert.match(workflow, /format: spdx-json/);
  assert.match(workflow, /actions\/attest@/);
  assert.match(workflow, /sbom-path: \$\{\{ steps\.assets\.outputs\.sbom \}\}/);
  assert.match(workflow, /artifact-metadata: write/);
  assert.match(workflow, /actions\/dependency-review-action@/);
  assert.ok(
    workflow.indexOf("actions/dependency-review-action@") <
      workflow.indexOf("pnpm install --frozen-lockfile"),
  );
  assert.match(workflow, /run: pnpm audit --audit-level=high/);
  const releaseBuild = workflow.slice(
    workflow.indexOf("  release-build:"),
    workflow.indexOf("\n  release:"),
  );
  const releasePublish = workflow.slice(workflow.indexOf("\n  release:"));
  assert.match(releaseBuild, /permissions:\s+contents: read/);
  assert.doesNotMatch(releaseBuild, /id-token: write|contents: write/);
  assert.match(releaseBuild, /actions\/upload-artifact@/);
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
  assert.match(workflow, /gh release create "\$TAG" "\$ASSET" "\$CHECKSUM" "\$SBOM"/);
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
