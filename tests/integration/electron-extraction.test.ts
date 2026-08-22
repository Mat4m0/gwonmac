import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);
const localRequire = createRequire(import.meta.url);
const forgeRequire = createRequire(
  localRequire.resolve("@electron-forge/cli/package.json"),
);
const packagerRequire = createRequire(
  forgeRequire.resolve("@electron/packager/package.json"),
);

interface PackagerExtractor {
  extractElectronZip(zipPath: string, targetDir: string): Promise<void>;
}

function isPackagerExtractor(value: unknown): value is PackagerExtractor {
  return (
    typeof value === "object" &&
    value !== null &&
    "extractElectronZip" in value &&
    typeof value.extractElectronZip === "function"
  );
}

const extractor: unknown = packagerRequire("./dist/unzip.js");
assert.ok(isPackagerExtractor(extractor));

async function zipSymlink(target: string, archiveName: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gwonmac-extract-refusal-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await symlink(target, path.join(source, "link"));
  const archive = path.join(root, archiveName);
  await run("zip", ["-qy", archive, "link"], { cwd: source });
  return archive;
}

test("Electron packaging refuses relative and absolute symlink escapes", async () => {
  for (const [target, archiveName] of [
    ["../../outside", "relative.zip"],
    [path.join(os.tmpdir(), "outside"), "absolute.zip"],
  ] as const) {
    const archive = await zipSymlink(target, archiveName);
    const output = await mkdtemp(path.join(os.tmpdir(), "gwonmac-extract-output-"));
    await assert.rejects(
      extractor.extractElectronZip(archive, output),
      /symlink|outside|escape|path/iu,
    );
    await assert.rejects(lstat(path.join(output, "link")), { code: "ENOENT" });
  }
});

test("Electron packaging preserves ordinary files and internal symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gwonmac-extract-control-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source);
  await writeFile(path.join(source, "ordinary-file"), "owned fixture\n");
  await symlink("ordinary-file", path.join(source, "ordinary-link"));
  const archive = path.join(root, "legitimate.zip");
  await run("zip", ["-qy", archive, "ordinary-file", "ordinary-link"], {
    cwd: source,
  });

  await extractor.extractElectronZip(archive, output);

  assert.equal(await readFile(path.join(output, "ordinary-file"), "utf8"), "owned fixture\n");
  assert.equal(await readlink(path.join(output, "ordinary-link")), "ordinary-file");
});
