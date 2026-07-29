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
import { macOSBundleVersions } from "../scripts/macos-version.js";
import {
  assertNoDeveloperPackageFiles,
  assertRequiredPackageFiles,
  forgePackageFiles,
  htmlScriptEntryPoints,
  PRELOAD_ENTRY,
  relativeEsmClosure,
} from "./helpers/package-inventory.ts";
import {
  packagedElectronLayout,
  terminateTestChild,
} from "../scripts/electron-layout.js";

const root = path.resolve(import.meta.dirname, "..");
const layout = packagedElectronLayout(root);
const execFileAsync = promisify(execFile);
const packageVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;

// `isPack: false` is what the omitted argument already meant — asar only
// decorates each path with its pack state when the flag is on — and these are
// compared against archive-rooted paths.
const actualPackageFiles = new Set(
  listPackage(layout.asar, { isPack: false }).filter(
    (file) => !("files" in statFile(layout.asar, file.slice(1))),
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

const asarText = (file: string) =>
  extractFile(layout.asar, file.slice(1)).toString("utf8");
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

if (process.platform === "darwin") {
  const macOSVersion = macOSBundleVersions(packageVersion);
  const { stdout: bundleInfo } = await execFileAsync("plutil", [
    "-p",
    path.join(layout.application, "Contents", "Info.plist"),
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
    await readFile(path.join(layout.resources, "electron.icns")),
    await readFile(path.join(root, "assets/AppIcon.icns")),
  );
  await execFileAsync("codesign", [
    "--verify",
    "--deep",
    "--strict",
    layout.application,
  ]);
}
assert.match(
  await readFile(path.join(layout.resources, "LICENSE"), "utf8"),
  /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/,
);
assert.match(
  await readFile(path.join(layout.resources, "THIRD-PARTY-NOTICES.md"), "utf8"),
  /QT Friz Quad[\s\S]*SIL Open Font\s+License 1\.1/,
);
assert.match(
  await readFile(path.join(layout.resources, "COPYING-QUALITYPE"), "utf8"),
  /SIL OPEN FONT LICENSE[\s\S]*Version 1\.1/,
);
const fuses = await getCurrentFuseWire(layout.executable);
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
  FuseV1Options.WasmTrapHandlers,
]) {
  assert.equal(fuses[option], FuseState.ENABLE);
}
for (const option of [
  FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  FuseV1Options.OnlyLoadAppFromAsar,
]) {
  assert.equal(
    fuses[option],
    process.platform === "linux" ? FuseState.DISABLE : FuseState.ENABLE,
  );
}
const userData = await mkdtemp(path.join(tmpdir(), "gw-packaged-smoke-"));
const diagnostics = path.join(userData, "diagnostics");
const output: string[] = [];
const child = spawn(layout.executable, [`--user-data-dir=${userData}`], {
  cwd: root,
  env: { ...process.env, GW_OFFLINE_SHELL: "1", ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
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
    files = (await readdir(diagnostics)).filter((file) => file.endsWith(".jsonl"));
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
  await terminateTestChild(child);
  await rm(userData, { recursive: true, force: true });
}
