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
const packageVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version;
const macOSVersion = packageVersion.split("-", 1)[0];
const { stdout: bundleInfo } = await execFileAsync("plutil", [
  "-p",
  path.join(appBundle, "Contents/Info.plist"),
]);
assert.match(bundleInfo, /"CFBundleDisplayName" => "Guild Wars"/);
assert.match(bundleInfo, /"CFBundleExecutable" => "Guild Wars"/);
assert.match(
  bundleInfo,
  new RegExp(`"CFBundleShortVersionString" => "${macOSVersion.replaceAll(".", "\\.")}"`),
);
assert.match(
  bundleInfo,
  new RegExp(`"CFBundleVersion" => "${macOSVersion.replaceAll(".", "\\.")}"`),
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

async function hasClockSync() {
  let files;
  try {
    files = (await readdir(diagnostics)).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return false;
  }
  for (const file of files) {
    if ((await readFile(path.join(diagnostics, file), "utf8")).includes("clock.synchronized")) {
      return true;
    }
  }
  return false;
}

let passed = false;
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await hasClockSync()) {
      passed = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!passed) {
    throw new Error(
      `packaged renderer did not synchronize with main\n${output.join("").slice(-4_000)}`,
    );
  }
  console.log("packaged app started main, protocol, preload, renderer, and diagnostics IPC");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(userData, { recursive: true, force: true });
}
