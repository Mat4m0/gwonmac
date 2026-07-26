// Repository-contents, font-licence, action-pinning and fuse policy live in
// tests/policy/. This file keeps the release-shape assertions that need the
// compiled build under build/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { macOSBundleVersions } from "../../scripts/macos-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file && existsSync(path.join(root, file)));

test("macOS identity uses the Guild Wars name and configured application icon", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.productName, "Guild Wars");
  const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
  assert.match(forge, /name: "Guild Wars"/);
  assert.match(forge, /executableName: "Guild Wars"/);
  assert.match(forge, /icon: path\.resolve\("assets\/AppIcon\.icns"\)/);
  const icon = readFileSync(path.join(root, "assets/AppIcon.icns"));
  assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
  assert.ok(icon.length > 100_000, "application icon is unexpectedly small");
});

test("every canonical IPC channel is wired through preload and main", async () => {
  const { IPC } = await import(
    new URL("../../build/shared/contracts.js", import.meta.url)
  );
  const preload = readFileSync(path.join(root, "src/preload/preload.cjs"), "utf8");
  const main = tracked
    .filter((file) => file.startsWith("src/main/"))
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  for (const [key, channel] of Object.entries(IPC)) {
    assert.ok(
      preload.includes(JSON.stringify(channel)),
      `${key} is missing from the preload`,
    );
    assert.match(main, new RegExp(`\\bIPC\\.${key}\\b`), `${key} is missing from main`);
  }
});

test("saved login has one encrypted owner-only persistence surface", () => {
  const productionFiles = [
    "src/main/ipc.ts",
    "src/main/core/credentials.ts",
    "src/main/paths.ts",
    "src/main/core/paths.ts",
    "src/preload/preload.cjs",
    "src/shared/contracts.ts",
    "src/renderer/harness.js",
  ];
  const source = productionFiles
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  assert.match(source, /safeStorage/);
  assert.match(source, /gw:credentials:load/);
  assert.match(source, /credentials\.bin/);
  assert.match(source, /encryptString/);
  assert.match(source, /writeAtomic\(this\.path, ciphertext, 0o600\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /plaintext|fallbackKey|masterPassword/);
  assert.match(source, /secureStorage:[\s\S]*getCredentials[\s\S]*storeCredentials[\s\S]*clearCredentials/);
  const main = readFileSync(path.join(root, "src/main/main.ts"), "utf8");
  assert.match(main, /appendSwitch\("use-mock-keychain"\)/);
  assert.match(
    main,
    /clearStorageData\(\{ storages: \["cookies"\] \}\)/,
  );
  assert.ok(
    main.indexOf('appendSwitch("use-mock-keychain")') <
      main.indexOf("app.whenReady()"),
    "mock keychain switch must be installed before Electron becomes ready",
  );
});

test("renderer and main process use the same histogram boundaries", async () => {
  const renderer = readFileSync(path.join(root, "src/renderer/diagnostics.js"), "utf8");
  const literal = renderer.match(/const histogramLimitsUs = \[([\s\S]*?)\];/)?.[1];
  assert.ok(literal, "renderer histogram boundaries are missing");
  const rendererBuckets = [
    ...literal.matchAll(/Number\.MAX_SAFE_INTEGER|\d[\d_]*/g),
  ].map(([token]) =>
    token === "Number.MAX_SAFE_INTEGER"
      ? Number.MAX_SAFE_INTEGER
      : Number(token.replaceAll("_", "")),
  );
  const { DIAGNOSTIC_BUCKETS_US } = await import(
    new URL("../../build/shared/diagnostics.js", import.meta.url)
  );
  assert.deepEqual(rendererBuckets, [...DIAGNOSTIC_BUCKETS_US]);
});

test("renderer and main process use the same diagnostic event allowlist", async () => {
  const renderer = readFileSync(path.join(root, "src/renderer/diagnostics.js"), "utf8");
  const literal = renderer.match(
    /const rendererEventNames = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  assert.ok(literal, "renderer event allowlist is missing");
  const rendererNames = [...literal.matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  const { RENDERER_EVENT_NAMES } = await import(
    new URL("../../build/shared/diagnostics.js", import.meta.url)
  );
  assert.deepEqual(rendererNames, [...RENDERER_EVENT_NAMES].sort());
});

test("the host has one manual application replacement path", () => {
  assert.equal(existsSync(path.join(root, "src/main/updater.ts")), false);
  const main = readFileSync(path.join(root, "src/main/main.ts"), "utf8");
  assert.doesNotMatch(main, /startAppUpdater|autoUpdater/);
});

test("package metadata identifies the GPL project and canonical repository", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.0.2");
  assert.equal(pkg.license, "GPL-3.0-only");
  assert.equal(
    pkg.repository?.url,
    "https://github.com/Mat4m0/gwonmac.git",
  );
  assert.equal(
    pkg.bugs?.url,
    "https://github.com/Mat4m0/gwonmac/issues",
  );
});

test("packaged releases carry the project and third-party license notices", () => {
  const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
  assert.match(forge, /extraResource:[\s\S]*"LICENSE"/);
  assert.match(forge, /extraResource:[\s\S]*"THIRD-PARTY-NOTICES\.md"/);
  assert.match(forge, /extraResource:[\s\S]*"src\/renderer\/fonts\/COPYING-QUALITYPE"/);
  const notices = readFileSync(
    path.join(root, "THIRD-PARTY-NOTICES.md"),
    "utf8",
  );
  assert.match(notices, /not relicensed under GPL-3\.0-only/);
  assert.match(notices, /QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/);
});

test("macOS derives numeric bundle versions from the package prerelease", () => {
  const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
  assert.match(forge, /const packageVersion =/);
  assert.match(forge, /macOSBundleVersions\(packageVersion\)/);
  const alpha1 = macOSBundleVersions("1.2.3-alpha.1");
  const alpha2 = macOSBundleVersions("1.2.3-alpha.2");
  const stable = macOSBundleVersions("1.2.3");
  assert.equal(alpha1.appVersion, "1.2.3");
  assert.notEqual(alpha1.buildVersion, alpha2.buildVersion);
  assert.ok(
    Number(alpha2.buildVersion.split(".").at(-1)) <
      Number(stable.buildVersion.split(".").at(-1)),
  );
});

test("renderer permissions and embedded webviews fail closed", () => {
  const windowSource = readFileSync(path.join(root, "src/main/window.ts"), "utf8");
  const ipcSource = readFileSync(path.join(root, "src/main/ipc.ts"), "utf8");
  const protocolSource = readFileSync(
    path.join(root, "src/main/protocol.ts"),
    "utf8",
  );
  assert.match(windowSource, /nodeIntegration: false/);
  assert.match(windowSource, /contextIsolation: true/);
  assert.match(windowSource, /sandbox: true/);
  assert.match(windowSource, /webviewTag: false/);
  assert.match(windowSource, /setPermissionRequestHandler/);
  assert.match(windowSource, /permission === "pointerLock"/);
  assert.match(windowSource, /webContents === win\.webContents/);
  assert.match(windowSource, /isCanonicalRendererUrl\(webContents\.getURL\(\)\)/);
  assert.match(windowSource, /will-attach-webview[\s\S]*preventDefault/);
  assert.match(ipcSource, /event\.senderFrame !== event\.sender\.mainFrame/);
  assert.match(ipcSource, /isCanonicalRendererUrl\(event\.senderFrame\.url\)/);
  assert.match(protocolSource, /frame-src 'none'/);
  assert.match(protocolSource, /form-action 'none'/);
  assert.match(protocolSource, /isProxyFetchDestination\(destination\)/);
});

test("official releases have one honest ad-hoc signing path", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
  assert.doesNotMatch(workflow, /APPLE_|Developer ID|notary|stapler/);
  assert.doesNotMatch(forge, /APPLE_|osxSign|osxNotarize/);
  assert.match(forge, /\["--force", "--deep", "--sign", "-", appPath\]/);
  assert.match(workflow, /codesign --verify --deep --strict/);
  assert.match(workflow, /Signature=adhoc/);
  assert.match(workflow, /ad-hoc signed, not notarized/);
});

test("release workflow publishes one tested, attested package version", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
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
  assert.match(
    workflow,
    /gh release create "\$TAG" "\$ASSET" "\$CHECKSUM" "\$SBOM"/,
  );
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const websitePkg = JSON.parse(
    readFileSync(path.join(root, "apps/website/package.json"), "utf8"),
  );
  assert.equal(pkg.dependencies, undefined);
  assert.equal(websitePkg.dependencies, undefined);
  const workspace = readFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "utf8",
  );
  assert.match(
    workspace,
    /auditConfig:\n {2}ignoreGhsas:\n {4}- GHSA-mh99-v99m-4gvg\n$/,
  );
  assert.match(pkg.scripts.make, /scripts\/clean-output\.mjs/);
  assert.match(pkg.scripts.package, /scripts\/clean-output\.mjs/);
  assert.match(
    readFileSync(path.join(root, "scripts/build.mjs"), "utf8"),
    /tsconfig\.renderer\.json/,
  );
  const verification = readFileSync(
    path.join(root, "docs/release-verification.md"),
    "utf8",
  );
  assert.match(verification, /shasum -a 256 -c SHA256SUMS\.txt/);
  assert.match(verification, /gh attestation verify/);
  assert.doesNotMatch(verification, /xattr|spctl --master-disable/);
});

test("the website suite runs on its own path-filtered workflow", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/website.yml"),
    "utf8",
  );
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /run: pnpm test:website/);
  assert.match(workflow, /paths:[\s\S]*apps\/website\/\*\*/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|issues: write/);
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.doesNotMatch(pkg.scripts.verify, /test:website/);
});

test("the scheduled canary exercises the latest ArenaNet client conservatively", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/client-canary.yml"),
    "utf8",
  );
  assert.match(workflow, /schedule:[\s\S]*cron:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /GW_LIVE_SMOKE: "1"/);
  assert.match(workflow, /tests\/electron\/live\.spec\.mjs/);
  assert.doesNotMatch(workflow, /upload-artifact|issues: write/);
});
