import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURSOR,
  CURSOR_EDGE,
  CURSOR_HIDDEN,
  CURSOR_PIXEL_BYTES,
  CURSOR_UNSUPPORTED,
  CURSOR_VALID,
  type CursorOverrides,
  cursorReason,
  cursorRegion,
  invalidCursor,
  MAGIC,
  publishedPixels,
  readCompanionCursorHeader,
  readCompanionCursorPixels,
  readyCursor,
} from "../fixtures/enhancements.ts";

describe("Companion cursor region ABI", () => {
  it("decodes a published cursor and its RGBA payload", () => {
    const region = cursorRegion();
    const header = readyCursor(readCompanionCursorHeader(region, 0));
    assert.equal(header.status, "ready");
    assert.equal(header.generation, 1);
    assert.equal(header.flags, CURSOR_VALID);
    assert.equal(header.hotspotX, 3);
    assert.equal(header.hotspotY, 4);
    assert.equal(header.pixelHash, 0x1357_9bdf);
    assert.equal(header.hidden, false);

    const full = publishedPixels(readCompanionCursorPixels(region, 0));
    assert.equal(full.status, "ready");
    assert.equal(full.pixels.length, CURSOR_PIXEL_BYTES);
    assert.deepEqual([...full.pixels.slice(0, 4)], [0x60, 0x40, 0x20, 0xff]);
    // The copy is private: mutating the region must not reach it.
    new DataView(region).setUint32(CURSOR.pixels, 0, true);
    assert.equal(full.pixels[0], 0x60);
  });

  it("reports hidden and non-cursor states without inventing geometry", () => {
    const hidden = readyCursor(
      readCompanionCursorHeader(
        cursorRegion({ flags: CURSOR_VALID | CURSOR_HIDDEN }),
        0,
      ),
    );
    assert.equal(hidden.status, "ready");
    assert.equal(hidden.hidden, true);

    const cleared = invalidCursor(
      readCompanionCursorHeader(cursorRegion({ flags: 0 }), 0),
    );
    assert.equal(cleared.status, "invalid");
    assert.equal(cleared.reason, "cursor");
    assert.deepEqual(
      [cleared.hotspotX, cleared.hotspotY, cleared.pixelHash],
      [0, 0, 0],
    );
    assert.equal(readCompanionCursorPixels(cursorRegion({ flags: 0 }), 0), null);

    const unsupported = invalidCursor(
      readCompanionCursorHeader(cursorRegion({ flags: CURSOR_UNSUPPORTED }), 0),
    );
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.reason, "unsupported");
  });

  it("rejects a torn, foreign, or malformed cursor region", () => {
    const reason = (overrides: CursorOverrides) =>
      cursorReason(readCompanionCursorHeader(cursorRegion(overrides), 0));
    assert.equal(reason({ magic: MAGIC }), "cursor");
    assert.equal(reason({ abi: 2 }), "cursor");
    assert.equal(reason({ byteLength: 64 }), "cursor");
    assert.equal(reason({ sequence: 3 }), "writing");
    assert.equal(reason({ flags: 0x8 }), "cursor");
    assert.equal(reason({ reservedWord: 1, reservedIndex: 5 }), "cursor");
    assert.equal(reason({ width: 64 }), "corrupt");
    assert.equal(reason({ height: 16 }), "corrupt");
    assert.equal(reason({ hotspotX: CURSOR_EDGE }), "corrupt");
    assert.equal(reason({ hotspotY: 99 }), "corrupt");
    assert.equal(reason({ generation: 0 }), "corrupt");
    // Hidden is meaningless without a cursor; unsupported must stand alone.
    assert.equal(reason({ flags: CURSOR_HIDDEN }), "corrupt");
    assert.equal(reason({ flags: CURSOR_HIDDEN | CURSOR_UNSUPPORTED }), "corrupt");
    assert.equal(reason({ flags: CURSOR_VALID | CURSOR_UNSUPPORTED }), "corrupt");
    assert.equal(
      reason({ flags: CURSOR_VALID | CURSOR_HIDDEN | CURSOR_UNSUPPORTED }),
      "corrupt",
    );
    assert.equal(readCompanionCursorPixels(cursorRegion({ sequence: 3 }), 0), null);

    assert.equal(
      cursorReason(readCompanionCursorHeader(new ArrayBuffer(64), 0)),
      "memory",
    );
    assert.equal(cursorReason(readCompanionCursorHeader(cursorRegion(), 4)), "memory");
    assert.equal(readCompanionCursorPixels(cursorRegion(), -4), null);
  });
});
