import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
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
import { extractFile } from "@electron/asar";
import releaseTargetsJson from "../release-targets.json" with { type: "json" };
import { platformPackageVersions } from "../scripts/platform-version.ts";
import {
  parseReleaseTargets,
  releaseTargetFilename,
} from "../src/shared/release-targets.ts";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const packageVersion = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
).version as string;
const targets = parseReleaseTargets(releaseTargetsJson);
const matches = targets.targets.filter((target) =>
  target.platform === process.platform && target.arch === process.arch
);
assert.equal(
  matches.length,
  1,
  `no final-artifact target for ${process.platform}/${process.arch}`,
);
const target = matches[0]!;
const expectedFilename = releaseTargetFilename(target, packageVersion);

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const artifacts = (await filesBelow(path.join(root, "out", "make"))).filter(
  (file) => path.basename(file) === expectedFilename,
);
assert.equal(
  artifacts.length,
  1,
  `expected one final artifact named ${expectedFilename}`,
);
const artifact = artifacts[0]!;
const temporary = await mkdtemp(path.join(tmpdir(), "gw-final-artifact-"));

async function assertPackagedRuntime(
  executable: string,
  resources: string,
): Promise<void> {
  await access(executable);
  const executableStat = await lstat(executable);
  assert.ok(
    process.platform === "win32" || (executableStat.mode & 0o111) !== 0,
    "packaged executable is not executable",
  );
  const asar = path.join(resources, "app.asar");
  await access(asar);
  const manifest = JSON.parse(
    extractFile(asar, "package.json").toString("utf8"),
  ) as { main?: unknown; version?: unknown };
  assert.equal(manifest.main, "build/main/entry.js");
  assert.equal(manifest.version, packageVersion);
  const fuses = await getCurrentFuseWire(executable);
  assert.equal(fuses[FuseV1Options.RunAsNode], FuseState.DISABLE);
  assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], FuseState.ENABLE);
  assert.equal(
    fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
    process.platform === "linux" ? FuseState.DISABLE : FuseState.ENABLE,
  );
}

try {
  if (process.platform === "darwin") {
    await execFileAsync("ditto", ["-x", "-k", artifact, temporary]);
    const application = path.join(temporary, "Guild Wars.app");
    await assertPackagedRuntime(
      path.join(application, "Contents", "MacOS", "Guild Wars"),
      path.join(application, "Contents", "Resources"),
    );
    await execFileAsync("codesign", [
      "--verify",
      "--deep",
      "--strict",
      application,
    ]);
  } else if (process.platform === "linux") {
    const versions = platformPackageVersions(packageVersion);
    const { stdout: fields } = await execFileAsync("dpkg-deb", [
      "--field",
      artifact,
      "Package",
      "Version",
      "Architecture",
      "Depends",
    ]);
    assert.match(fields, /^Package: guild-wars$/mu);
    assert.match(fields, new RegExp(`^Version: ${versions.debian.replace(".", "\\.")}$`, "mu"));
    assert.match(fields, /^Architecture: amd64$/mu);
    assert.match(fields, /^Depends: .*libnss3/mu);
    await execFileAsync("dpkg-deb", ["--extract", artifact, temporary]);
    const application = path.join(temporary, "usr", "lib", "guild-wars");
    await assertPackagedRuntime(
      path.join(application, "Guild Wars"),
      path.join(application, "resources"),
    );
    const desktop = await readFile(
      path.join(temporary, "usr", "share", "applications", "guild-wars.desktop"),
      "utf8",
    );
    assert.match(desktop, /^Exec=guild-wars %U$/mu);
    assert.match(desktop, /^Icon=guild-wars$/mu);
    assert.match(desktop, /^Categories=Game;$/mu);
    assert.ok(
      (await lstat(path.join(temporary, "usr", "bin", "guild-wars"))).isSymbolicLink(),
    );
  } else if (process.platform === "win32") {
    // Squirrel resolves Windows' LocalApplicationData known folder rather than
    // honoring an overridden LOCALAPPDATA environment variable. Native CI runs
    // as an ephemeral user, while this guard makes a local invocation refuse
    // to touch an installation the developer already has.
    const localAppData = process.env.LOCALAPPDATA;
    assert.ok(localAppData, "Windows did not provide LOCALAPPDATA");
    const application = path.join(localAppData, "GuildWars");
    await assert.rejects(
      access(application),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
      "refusing to replace an existing Guild Wars installation",
    );
    try {
      await execFileAsync(artifact, ["--silent"]);
      const versions = (await readdir(application)).filter((entry) =>
        entry.startsWith("app-")
      );
      assert.equal(versions.length, 1, "Squirrel installed an ambiguous app version");
      const installed = path.join(application, versions[0]!);
      await assertPackagedRuntime(
        path.join(installed, "Guild Wars.exe"),
        path.join(installed, "resources"),
      );
    } finally {
      const updater = path.join(application, "Update.exe");
      if (await access(updater).then(() => true, () => false)) {
        await execFileAsync(updater, ["--uninstall", "--silent"]);
      }
    }
  } else {
    assert.fail(`unsupported final artifact platform: ${process.platform}`);
  }
  console.log(`final artifact verified: ${expectedFilename}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
