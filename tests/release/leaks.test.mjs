import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file && existsSync(path.join(root, file)));

test("no downloaded game artifacts or generated output are tracked", () => {
  const forbidden = [
    /\.key$/i,
    /\.apk$/i,
    /\.wasm$/i,
    /(^|\/)Gw\.js$/i,
    /(^|\/)Gw\.jspi\.js$/i,
    /(^|\/)Gw\.snapshot$/i,
    /(^|\/)(manifest|version)\.json$/i,
    /\.gwdiag$/i,
    /\.dmp$/i,
    /(^|\/)credentials\.bin$/i,
    /^(build|out|node_modules|gwpatch-cache)\//i,
  ];
  const hits = tracked.filter((file) => forbidden.some((pattern) => pattern.test(file)));
  assert.deepEqual(hits, []);
});

test("the only bundled font is the pinned OFL-licensed QT Friz Quad", () => {
  const fontDirectory = path.join(root, "src/renderer/fonts");
  assert.deepEqual(
    readdirSync(fontDirectory).sort(),
    ["COPYING-QUALITYPE", "QTFrizQuad.otf"],
  );
  const font = readFileSync(path.join(fontDirectory, "QTFrizQuad.otf"));
  assert.equal(
    createHash("sha256").update(font).digest("hex"),
    "ecde72ff2f34841942c2043837310cac9354713e28e854e3938eaef16d6d39b2",
  );
  const license = readFileSync(
    path.join(fontDirectory, "COPYING-QUALITYPE"),
    "utf8",
  );
  assert.match(license, /Copyright \(c\) 1992 QualiType/);
  assert.match(license, /SIL OPEN FONT LICENSE[\s\S]*Version 1\.1/);
  const css = readFileSync(path.join(root, "src/renderer/loading.css"), "utf8");
  assert.match(css, /font-family: "QT Friz Quad"/);
  assert.match(css, /url\("fonts\/QTFrizQuad\.otf"\)/);
});

test("no second production runtime remains", () => {
  for (const file of [
    "gw.py",
    "gw.command",
    "gwpatch.py",
    "getsnapshot.py",
    "harness/index.html",
  ]) {
    assert.equal(tracked.includes(file), false, `${file} is still tracked`);
  }
});

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

test("only the public client access key is UUID-shaped", () => {
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  const allowed = new Set([
    "2043FE79-F32D-4FD7-8C27-0D47231C4F03",
    "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
  ]);
  const hits = [];
  for (const file of tracked) {
    if (file === "tests/release/leaks.test.mjs") continue;
    let text;
    try {
      text = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(uuid)) {
      if (!allowed.has(match[0].toUpperCase())) hits.push(`${file}:${match[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("sandboxed preload and main process declare the same IPC channels", () => {
  const contracts = readFileSync(path.join(root, "src/shared/contracts.ts"), "utf8");
  const preload = readFileSync(path.join(root, "src/preload/preload.cjs"), "utf8");
  const channels = (text) =>
    [...text.matchAll(/"gw:[^"]+"/g)].map((match) => match[0]).sort();
  assert.deepEqual(channels(preload), channels(contracts));
});

test("saved login has one encrypted owner-only persistence surface", () => {
  const productionFiles = [
    "src/main/ipc.ts",
    "src/main/core/credentials.ts",
    "src/main/paths.ts",
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
  assert.equal(pkg.version, "0.0.1-alpha.1");
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
  assert.match(forge, /const macOSVersion = packageVersion\.split\("-", 1\)\[0\]/);
  assert.match(forge, /appVersion: macOSVersion/);
  assert.match(forge, /buildVersion: macOSVersion/);
});

test("release fuses keep Node and inspection disabled", () => {
  const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
  assert.match(forge, /hardenedRuntime: true/);
  assert.match(forge, /\[FuseV1Options\.RunAsNode\]: false/);
  assert.match(forge, /\[FuseV1Options\.EnableNodeOptionsEnvironmentVariable\]: false/);
  assert.match(forge, /\[FuseV1Options\.EnableNodeCliInspectArguments\]: false/);
  assert.match(forge, /\[FuseV1Options\.EnableEmbeddedAsarIntegrityValidation\]: true/);
  assert.match(forge, /\[FuseV1Options\.OnlyLoadAppFromAsar\]: true/);
  assert.match(forge, /\[FuseV1Options\.GrantFileProtocolExtraPrivileges\]: false/);
  assert.match(forge, /\[FuseV1Options\.WasmTrapHandlers\]: true/);
});

test("renderer permissions and embedded webviews fail closed", () => {
  const windowSource = readFileSync(path.join(root, "src/main/window.ts"), "utf8");
  assert.match(windowSource, /nodeIntegration: false/);
  assert.match(windowSource, /contextIsolation: true/);
  assert.match(windowSource, /sandbox: true/);
  assert.match(windowSource, /webviewTag: false/);
  assert.match(windowSource, /setPermissionRequestHandler/);
  assert.match(windowSource, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(windowSource, /will-attach-webview[\s\S]*preventDefault/);
});

test("official releases import, verify, and remove a stable signing identity", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  // Signing is conditional until the Apple Developer account exists, but the
  // signed path must still verify the full Developer ID + notarization chain,
  // and the unsigned path must be detected — never silently assumed.
  for (const secret of [
    "APPLE_IDENTITY",
    "APPLE_TEAM_ID",
    "APPLE_CERTIFICATE_P12",
    "APPLE_CERTIFICATE_PASSWORD",
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
    assert.match(workflow, new RegExp(`-n "\\$${secret}"`));
  }
  assert.match(workflow, /steps\.signing\.outputs\.signed == 'true'/);
  assert.match(workflow, /security create-keychain/);
  assert.match(workflow, /security import/);
  assert.match(workflow, /security set-key-partition-list/);
  assert.match(workflow, /Authority=Developer ID Application/);
  assert.match(workflow, /TeamIdentifier=\$APPLE_TEAM_ID/);
  assert.match(workflow, /flags=\.\*runtime/);
  assert.match(workflow, /spctl --assess --type execute/);
  assert.match(workflow, /xcrun stapler validate/);
  // The unsigned fallback must verify the ad-hoc signature explicitly and
  // label the release as not notarized.
  assert.match(workflow, /Signature=adhoc/);
  assert.match(workflow, /ad-hoc signed, not notarized/);
  assert.match(workflow, /if: always\(\)[\s\S]*security delete-keychain/);
});

test("release workflow publishes one tested, attested package version", () => {
  const workflow = readFileSync(
    path.join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  assert.match(workflow, /runs-on: macos-15/);
  assert.doesNotMatch(workflow, /uses: [^\n]+@v\d/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /git\/ref\/tags\/\$tag/);
  assert.doesNotMatch(workflow, /pnpm version|date -u/);
  assert.match(workflow, /name: Smoke-test release candidate[\s\S]*pnpm test:packaged/);
  assert.match(workflow, /shasum -a 256/);
  assert.match(workflow, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(workflow, /--prerelease --latest=false/);
  assert.match(workflow, /gh release create "\$TAG" "\$ASSET" "\$CHECKSUM"/);
});
