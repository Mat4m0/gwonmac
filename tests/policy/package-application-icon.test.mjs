// Inspects a shipped asset rather than the source that names it. The forge
// config's reference to this path is repository text and is asserted in
// source-release-pipeline.test.mjs; what that cannot tell anyone is whether the
// file the packager will embed is a usable icon. A truncated or placeholder
// .icns produces an application with a generic Finder icon and a green build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the bundled application icon is a real icns with every size in it", () => {
  const icon = readFileSync(path.join(root, "assets/AppIcon.icns"));
  assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
  // The header carries the file's own length, so a truncated copy is caught
  // rather than assumed from the size below.
  assert.equal(icon.readUInt32BE(4), icon.length);
  assert.ok(icon.length > 100_000, "application icon is unexpectedly small");
});
