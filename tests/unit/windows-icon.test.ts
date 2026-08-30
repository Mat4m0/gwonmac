/** The Windows icon stays a deterministic derivative of the canonical artwork. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PNG } from "pngjs";
import {
  WINDOWS_ICON_SIZES,
  windowsIcon,
} from "../../scripts/windows-icon.ts";

describe("Windows application icon", () => {
  it("contains every reviewed size and matches the tracked derivative", async () => {
    const generated = windowsIcon(await readFile("assets/AppIcon.png"));
    assert.deepEqual(generated, await readFile("assets/AppIcon.ico"));
    assert.equal(generated.readUInt16LE(0), 0);
    assert.equal(generated.readUInt16LE(2), 1);
    assert.equal(generated.readUInt16LE(4), WINDOWS_ICON_SIZES.length);
    WINDOWS_ICON_SIZES.forEach((size, index) => {
      const entry = 6 + index * 16;
      assert.equal(generated.readUInt8(entry), size === 256 ? 0 : size);
      assert.equal(generated.readUInt8(entry + 1), size === 256 ? 0 : size);
      const length = generated.readUInt32LE(entry + 8);
      const offset = generated.readUInt32LE(entry + 12);
      const png = PNG.sync.read(generated.subarray(offset, offset + length));
      assert.equal(png.width, size);
      assert.equal(png.height, size);
    });
  });
});
