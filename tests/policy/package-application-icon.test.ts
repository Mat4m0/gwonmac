// Inspects a shipped asset rather than the source that names it. The forge
// config's reference to this path is repository text and is asserted in
// source-release-pipeline.test.ts; what that cannot tell anyone is whether the
// file the packager will embed is a usable icon. A truncated or placeholder
// .icns produces an application with a generic Finder icon and a green build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The representations macOS asks for across Finder, Get Info, the Dock and
// Launchpad. `ic10` is the 1024px one whose absence is invisible until someone
// opens Get Info on the shipped application.
const REQUIRED = ["ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"];

/** The icon types the file actually carries, with each one's payload size. */
function iconEntries(icon: Buffer): Map<string, number> {
  const entries = new Map<string, number>();
  let offset = 8;
  while (offset + 8 <= icon.length) {
    const type = icon.subarray(offset, offset + 4).toString("ascii");
    const length = icon.readUInt32BE(offset + 4);
    assert.ok(
      length >= 8 && offset + length <= icon.length,
      `icns entry ${type} declares a length the file cannot hold`,
    );
    entries.set(type, length - 8);
    offset += length;
  }
  assert.equal(offset, icon.length, "icns has trailing bytes after its last entry");
  return entries;
}

test("the bundled application icon carries every representation macOS renders", () => {
  const icon = readFileSync(path.join(root, "assets/AppIcon.icns"));
  assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
  // The header carries the file's own length, so a truncated copy is caught
  // rather than assumed from the sizes below.
  assert.equal(icon.readUInt32BE(4), icon.length);
  // Walked, not assumed: a well-formed icns holding one oversized small icon
  // passes a magic-and-length check and still ships a blurry Get Info icon.
  const entries = iconEntries(icon);
  for (const type of REQUIRED) {
    const size = entries.get(type);
    assert.ok(size !== undefined, `application icon has no ${type} representation`);
    assert.ok(size > 0, `application icon's ${type} entry is empty`);
  }
});

test("generated Windows and Linux icons are pinned release assets", () => {
  const linux = readFileSync(path.join(root, "assets/AppIcon-linux.png"));
  assert.equal(linux.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(linux.readUInt32BE(16), 512);
  assert.equal(linux.readUInt32BE(20), 512);
  assert.equal(
    createHash("sha256").update(linux).digest("hex"),
    "9f63144576505559a0d8845ca5a4c9b3fa4f6c7ef5f7068429bdf462c94ccd42",
  );

  const windows = readFileSync(path.join(root, "assets/AppIcon.ico"));
  assert.equal(windows.readUInt16LE(0), 0);
  assert.equal(windows.readUInt16LE(2), 1);
  assert.equal(windows.readUInt16LE(4), 1);
  // ICO encodes a 256-pixel side as zero.
  assert.equal(windows.readUInt8(6), 0);
  assert.equal(windows.readUInt8(7), 0);
  assert.equal(
    createHash("sha256").update(windows).digest("hex"),
    "910b4f9f2270cb06b6468495132d00bc75fc121b3fb88edb3023dd301ffd767b",
  );

  const forge = readFileSync(path.join(root, "forge.config.ts"), "utf8");
  assert.match(forge, /setupIcon: path\.resolve\("assets\/AppIcon\.ico"\)/);
  assert.match(forge, /icon: path\.resolve\("assets\/AppIcon-linux\.png"\)/);
});
