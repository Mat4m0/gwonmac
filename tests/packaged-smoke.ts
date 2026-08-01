import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { extractFile, listPackage, statFile } from "@electron/asar";
import forgeConfig from "../forge.config.ts";
import { macOSBundleVersions } from "../scripts/macos-version.js";
import {
  assertNoDeveloperPackageFiles,
  assertRequiredPackageFiles,
  forgePackageFiles,
  htmlScriptEntryPoints,
  PRELOAD_ENTRY,
  relativeEsmClosure,
} from "./helpers/package-inventory.ts";
import { stopChildProcess } from "./helpers/child-process.ts";

const root = path.resolve(import.meta.dirname, "..");
const appBundle = path.join(
  root,
  `out/Guild Wars Reforged-darwin-${process.arch}/Guild Wars Reforged.app`,
);
const executable = path.join(appBundle, "Contents/MacOS/Guild Wars Reforged");
const execFileAsync = promisify(execFile);
const resources = path.join(appBundle, "Contents/Resources");
const asarPath = path.join(resources, "app.asar");
const expectsOfficialUpdater = process.env.GW_EXPECT_OFFICIAL_UPDATER === "1";
assert.equal(
  existsSync(path.join(resources, "official-update.json")),
  expectsOfficialUpdater,
  expectsOfficialUpdater
    ? "an official release must carry the updater capability"
    : "ordinary local packages must not carry the official updater capability",
);
const packageVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
const macOSVersion = macOSBundleVersions(packageVersion);

// `isPack: false` is what the omitted argument already meant — asar only
// decorates each path with its pack state when the flag is on — and these are
// compared against archive-rooted paths.
const actualPackageFiles = new Set(
  listPackage(asarPath, { isPack: false }).filter(
    (file) => !("files" in statFile(asarPath, file.slice(1))),
  ),
);
const ignore = forgeConfig.packagerConfig?.ignore;
const expectedPackageFiles = new Set(forgePackageFiles(root, ignore));
assert.deepEqual(
  [...actualPackageFiles].sort(),
  [...expectedPackageFiles].sort(),
  "app.asar inventory differs from Forge's package model",
);
assertRequiredPackageFiles(actualPackageFiles);
assertNoDeveloperPackageFiles(actualPackageFiles);

const nativeArchivePath = "/build/native/keychain.node";
assert.equal(
  statFile(asarPath, nativeArchivePath.slice(1)).unpacked,
  true,
  "native Keychain addon must be unpacked from ASAR",
);
const nativeAddon = path.join(
  resources,
  "app.asar.unpacked/build/native/keychain.node",
);
assert.equal(
  existsSync(nativeAddon),
  true,
  "unpacked native Keychain addon is missing",
);
const { stdout: nativeArchitectures } = await execFileAsync("lipo", [
  "-archs",
  nativeAddon,
]);
assert.equal(nativeArchitectures.trim(), process.arch);
await execFileAsync("codesign", ["--verify", "--strict", nativeAddon]);

const asarText = (file: string) =>
  extractFile(asarPath, file.slice(1)).toString("utf8");
const packagedManifest = JSON.parse(asarText("/package.json"));
const packagedRendererIndex = "/build/renderer/index.html";
const packagedClosure = relativeEsmClosure({
  entryPoints: [
    packagedManifest.main,
    PRELOAD_ENTRY,
    ...htmlScriptEntryPoints(
      packagedRendererIndex,
      asarText(packagedRendererIndex),
    ),
  ],
  inventory: actualPackageFiles,
  readText: asarText,
});
assert.ok(packagedClosure.has("/build/main/core/enhancement-builds.js"));
assert.ok(packagedClosure.has("/build/renderer/enhancement-readout.js"));

const { stdout: bundleInfo } = await execFileAsync("plutil", [
  "-p",
  path.join(appBundle, "Contents/Info.plist"),
]);
assert.match(bundleInfo, /"CFBundleDisplayName" => "Guild Wars Reforged"/);
assert.match(bundleInfo, /"CFBundleExecutable" => "Guild Wars Reforged"/);
assert.match(
  bundleInfo,
  /"CFBundleIdentifier" => "io\.github\.mat4m0\.gwonmac"/,
);
assert.equal(
  existsSync(path.join(appBundle, "Contents/embedded.provisionprofile")),
  expectsOfficialUpdater,
  "only an official release carries its Developer ID provisioning profile",
);
assert.match(
  bundleInfo,
  new RegExp(
    `"CFBundleShortVersionString" => "${macOSVersion.appVersion.replaceAll(".", "\\.")}"`,
  ),
);
assert.match(
  bundleInfo,
  new RegExp(
    `"CFBundleVersion" => "${macOSVersion.buildVersion.replaceAll(".", "\\.")}"`,
  ),
);
assert.deepEqual(
  await readFile(path.join(resources, "electron.icns")),
  await readFile(path.join(root, "assets/AppIcon.icns")),
);
assert.match(
  await readFile(path.join(resources, "LICENSE"), "utf8"),
  /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/,
);
assert.match(
  await readFile(path.join(resources, "THIRD-PARTY-NOTICES.md"), "utf8"),
  /Guild Wars Reforged application[\s\S]*Apple App Store[\s\S]*QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/,
);
assert.match(
  await readFile(path.join(resources, "COPYING-QUALITYPE"), "utf8"),
  /SIL OPEN FONT LICENSE[\s\S]*Version 1\.1/,
);
await execFileAsync("codesign", ["--verify", "--deep", "--strict", appBundle]);
const fuses = await getCurrentFuseWire(executable);
for (const option of [
  FuseV1Options.RunAsNode,
  FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  FuseV1Options.EnableNodeCliInspectArguments,
  FuseV1Options.LoadBrowserProcessSpecificV8Snapshot,
  FuseV1Options.GrantFileProtocolExtraPrivileges,
]) {
  assert.equal(fuses[option], FuseState.DISABLE);
}
for (const option of [
  FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  FuseV1Options.OnlyLoadAppFromAsar,
  FuseV1Options.WasmTrapHandlers,
]) {
  assert.equal(fuses[option], FuseState.ENABLE);
}
assert.equal(fuses[FuseV1Options.EnableCookieEncryption], FuseState.DISABLE);
const userData = await mkdtemp(path.join(tmpdir(), "gw-packaged-smoke-"));
// Packaged builds are update-capable and the check defaults on; a smoke launch
// must not reach GitHub, so the profile opts out before the first boot.
await writeFile(
  path.join(userData, "settings.json"),
  JSON.stringify({ autoCheckUpdates: false }),
  { mode: 0o600 },
);
await writeFile(path.join(userData, "credentials.bin"), "retired-credentials");
await writeFile(path.join(userData, "steam-session.bin"), "retired-steam");
await writeFile(path.join(userData, "preserved.txt"), "preserved");
const diagnostics = path.join(userData, "diagnostics");
const output: string[] = [];
const child = spawn(
  executable,
  [`--user-data-dir=${userData}`, "--gw-volatile-secrets"],
  {
    cwd: root,
    env: {
      ...process.env,
      GW_OFFLINE_SHELL: "1",
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", (data) => output.push(data.toString()));
child.stderr.on("data", (data) => output.push(data.toString()));

// A parsed `events.jsonl` line, described by what this file reads out of it and
// no wider. `JSON.parse` cannot prove membership of the closed union in
// `src/main/diagnostics/schema.ts`; that is the recorder's and the detector's
// job, and claiming `DiagnosticEventRecord` here would assert a certification
// this file does not perform.
interface RecordedLine {
  name?: string;
  fields?: Record<string, unknown>;
}

async function recordedEvents(): Promise<RecordedLine[]> {
  let files;
  try {
    files = (await readdir(diagnostics)).filter((file) =>
      file.endsWith(".jsonl"),
    );
  } catch {
    return [];
  }
  const events: RecordedLine[] = [];
  for (const file of files) {
    const text = await readFile(path.join(diagnostics, file), "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      // The last line of a live recorder file can be half-written.
      try {
        events.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
  }
  return events;
}

let events: RecordedLine[] = [];
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    events = await recordedEvents();
    if (events.some((event) => event.name === "clock.synchronized")) break;
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!events.some((event) => event.name === "clock.synchronized")) {
    throw new Error(
      `packaged renderer did not synchronize with main\n${output.join("").slice(-4_000)}`,
    );
  }
  console.log(
    "packaged app started main, protocol, preload, renderer, and diagnostics IPC",
  );
  // The release check compares app.getVersion() against a release tag, so the
  // running bundle has to report the whole release version. CFBundleShortVersion
  // String cannot carry a prerelease — it is 2026.7.0 for 2026.7.0-alpha.1 — and
  // an app that reported that would tell an alpha install it is on a stable
  // build and quietly stop being offered the next alpha.
  const started = events.find((event) => event.name === "diagnostics.started");
  assert.ok(started, "the packaged app recorded no diagnostics.started event");
  assert.equal(started.fields?.appVersion, packageVersion);
  assert.equal(
    await readFile(path.join(userData, "credentials.bin"), "utf8"),
    "retired-credentials",
  );
  assert.equal(
    await readFile(path.join(userData, "steam-session.bin"), "utf8"),
    "retired-steam",
  );
  assert.equal(
    await readFile(path.join(userData, "preserved.txt"), "utf8"),
    "preserved",
  );
} finally {
  await stopChildProcess(child);
  await rm(userData, { recursive: true, force: true });
}
