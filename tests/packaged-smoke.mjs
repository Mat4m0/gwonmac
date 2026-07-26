import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} from "@electron/fuses";
import { extractFile, listPackage, statFile } from "@electron/asar";
import forgeConfig from "../forge.config.ts";
import { macOSBundleVersions } from "../scripts/macos-version.mjs";
import {
  assertNoDeveloperPackageFiles,
  assertRequiredPackageFiles,
  forgePackageFiles,
  htmlScriptEntryPoints,
  PRELOAD_ENTRY,
  relativeEsmClosure,
} from "./helpers/package-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
const appBundle = path.join(
  root,
  `out/Guild Wars-darwin-${process.arch}/Guild Wars.app`,
);
const executable = path.join(
  appBundle,
  "Contents/MacOS/Guild Wars",
);
const execFileAsync = promisify(execFile);
const resources = path.join(appBundle, "Contents/Resources");
const asarPath = path.join(resources, "app.asar");
const packageVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
const macOSVersion = macOSBundleVersions(packageVersion);

const actualPackageFiles = new Set(
  listPackage(asarPath).filter((file) => !("files" in statFile(asarPath, file.slice(1)))),
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

const asarText = (file) => extractFile(asarPath, file.slice(1)).toString("utf8");
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
assert.ok(packagedClosure.has("/build/main/core/toolbox-builds.js"));
assert.ok(packagedClosure.has("/build/renderer/toolbox-readout.js"));

const { stdout: bundleInfo } = await execFileAsync("plutil", [
  "-p",
  path.join(appBundle, "Contents/Info.plist"),
]);
assert.match(bundleInfo, /"CFBundleDisplayName" => "Guild Wars"/);
assert.match(bundleInfo, /"CFBundleExecutable" => "Guild Wars"/);
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
  /QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/,
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
  FuseV1Options.EnableCookieEncryption,
  FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  FuseV1Options.OnlyLoadAppFromAsar,
  FuseV1Options.WasmTrapHandlers,
]) {
  assert.equal(fuses[option], FuseState.ENABLE);
}
const userData = await mkdtemp(path.join(tmpdir(), "gw-packaged-smoke-"));
const diagnostics = path.join(userData, "diagnostics");
const output = [];
const child = spawn(executable, [`--user-data-dir=${userData}`], {
  cwd: root,
  env: { ...process.env, GW_OFFLINE_SHELL: "1", ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => output.push(data.toString()));
child.stderr.on("data", (data) => output.push(data.toString()));

async function recordedEvents() {
  let files;
  try {
    files = (await readdir(diagnostics)).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const events = [];
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

let events = [];
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
  console.log("packaged app started main, protocol, preload, renderer, and diagnostics IPC");
  // The release check compares app.getVersion() against a release tag, so the
  // running bundle has to report the whole release version. CFBundleShortVersion
  // String cannot carry a prerelease — it is 2026.7.0 for 2026.7.0-alpha.1 — and
  // an app that reported that would tell an alpha install it is on a stable
  // build and quietly stop being offered the next alpha.
  const started = events.find((event) => event.name === "diagnostics.started");
  assert.ok(started, "the packaged app recorded no diagnostics.started event");
  assert.equal(started.fields?.appVersion, packageVersion);
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(userData, { recursive: true, force: true });
}
