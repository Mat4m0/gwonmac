import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertNativeTarget } from "../../scripts/assert-native-target.ts";
import { writeDistributionChecksums } from "../../scripts/prepare-preview-artifact.ts";

test("native target assertions refuse runner and architecture drift", () => {
  assert.doesNotThrow(() => assertNativeTarget("windows-x64", "win32", "x64"));
  assert.throws(
    () => assertNativeTarget("windows-x64", "linux", "x64"),
    /requires win32\/x64, got linux\/x64/u,
  );
  assert.throws(
    () => assertNativeTarget("macos-arm64", "darwin", "x64"),
    /requires darwin\/arm64, got darwin\/x64/u,
  );
});

test("preview checksums are portable, sorted, and self-excluding", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gw-preview-checksums-"));
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "b.zip"), "b");
  await writeFile(path.join(root, "a.txt"), "a");
  await writeDistributionChecksums(root);
  const first = await readFile(path.join(root, "SHA256SUMS.txt"), "utf8");
  assert.match(first, /^[0-9a-f]{64} {2}a\.txt\n[0-9a-f]{64} {2}b\.zip\n$/u);
  await writeDistributionChecksums(root);
  assert.equal(await readFile(path.join(root, "SHA256SUMS.txt"), "utf8"), first);
});
