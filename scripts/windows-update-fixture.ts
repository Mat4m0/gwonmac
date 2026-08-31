/** Build one older signed Squirrel package without leaving source changes. */
import { spawn } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseReleaseVersion } from "../src/shared/release.js";

export function windowsQualificationBaseline(version: string): string {
  const parsed = parseReleaseVersion(version);
  if (!parsed || parsed.channel !== "stable" || parsed.patch === 0) {
    throw new Error("Windows update qualification requires a stable version with patch > 0");
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}`;
}

function runMake(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["make", "--", "--platform=win32", "--arch=x64"],
      { cwd: root, env: process.env, stdio: "inherit", shell: false },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`baseline package build failed: ${code ?? signal}`));
    });
  });
}

export async function buildWindowsUpdateFixture(
  root: string,
  destination: string,
): Promise<string> {
  if (
    process.platform !== "win32"
    || process.arch !== "x64"
    || process.env.GITHUB_ACTIONS !== "true"
    || process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    throw new Error("Windows update fixtures run only on a fresh hosted Windows x64 runner");
  }
  const manifestPath = path.join(root, "package.json");
  const original = await readFile(manifestPath);
  const manifest = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
  if (typeof manifest.version !== "string") {
    throw new Error("package.json has no version");
  }
  const baseline = windowsQualificationBaseline(manifest.version);
  try {
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, version: baseline }, null, 2)}\n`,
    );
    await runMake(root);
    await rm(destination, { recursive: true, force: true });
    await cp(
      path.join(root, "out", "make", "squirrel.windows", "x64"),
      destination,
      { recursive: true },
    );
  } finally {
    await writeFile(manifestPath, original);
  }
  return baseline;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length > 0) {
    throw new Error("usage: windows-update-fixture <destination>");
  }
  globalThis.console.log(await buildWindowsUpdateFixture(
    path.resolve(import.meta.dirname, ".."),
    path.resolve(destination),
  ));
}
