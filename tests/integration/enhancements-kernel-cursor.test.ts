import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDRESSES,
  COMPANION_CURSOR_ABI,
  COMPANION_CURSOR_BYTES,
  createKernel,
  CURSOR,
  CURSOR_EDGE,
  CURSOR_HIDDEN,
  CURSOR_MAGIC,
  CURSOR_UNSUPPORTED,
  CURSOR_VALID,
  expectedRgba,
  fnv1a,
  installCursorGraph,
  invalidCursor,
  paintCursor,
  publishedPixels,
  readyCursor,
  TEXTURE_KEY,
} from "../fixtures/enhancements.ts";

describe("Companion cursor kernel", () => {
  it("rejects a cursor region of the wrong size, alignment, or extent", async () => {
    const kernel = await createKernel();
    assert.equal(kernel.init({ cursorSize: COMPANION_CURSOR_BYTES - 1 }), 0);
    assert.equal(kernel.init({ cursorSize: COMPANION_CURSOR_BYTES + 1 }), 0);
    assert.equal(kernel.init({ cursorSize: 64 }), 0);
    assert.equal(kernel.init({ cursorPointer: ADDRESSES.cursor + 1 }), 0);
    assert.equal(kernel.init({ cursorPointer: ADDRESSES.cursor + 2 }), 0);
    assert.equal(kernel.init({ cursorPointer: 0xff_f000 }), 0);
    assert.equal(kernel.init({ cursorPointer: 0xffff_f000 }), 0);
    kernel.tick();
    assert.equal(kernel.field(CURSOR.magic), 0);
    assert.equal(kernel.init(), 1);
  });

  it("publishes a validated 32x32 cursor once per distinct cursor", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view, { hotspotX: 5, hotspotY: 7 });
    const first = paintCursor(view, 1);
    assert.equal(kernel.init(), 1);

    const cleared = invalidCursor(kernel.header());
    assert.equal(cleared.status, "invalid");
    assert.equal(cleared.reason, "cursor");
    assert.equal(kernel.field(CURSOR.generation), 0);
    assert.deepEqual([...kernel.payload().slice(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);

    kernel.tick();
    const ready = publishedPixels(kernel.published());
    assert.equal(ready.status, "ready");
    assert.equal(ready.generation, 1);
    assert.equal(ready.flags, CURSOR_VALID);
    assert.equal(ready.hidden, false);
    assert.equal(ready.hotspotX, 5);
    assert.equal(ready.hotspotY, 7);
    assert.equal(ready.pixelHash, fnv1a(first));
    assert.equal(kernel.field(CURSOR.magic), CURSOR_MAGIC);
    assert.equal(view.getUint16(ADDRESSES.cursor + CURSOR.abi, true), COMPANION_CURSOR_ABI);
    assert.equal(
      view.getUint16(ADDRESSES.cursor + CURSOR.byteLength, true),
      COMPANION_CURSOR_BYTES,
    );
    assert.equal(kernel.field(CURSOR.width), CURSOR_EDGE);
    assert.equal(kernel.field(CURSOR.height), CURSOR_EDGE);
    assert.deepEqual([...ready.pixels.slice(0, 4)], [0x11, 0x22, 0x33, 0xff]);
    assert.deepEqual(ready.pixels, expectedRgba(first));

    const sequence = kernel.field(CURSOR.sequence);
    assert.equal(sequence % 2, 0);
    for (let index = 0; index < 12; index += 1) kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 1);
    assert.equal(kernel.field(CURSOR.sequence), sequence);

    const second = paintCursor(view, 2);
    kernel.cursorEvent();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 2);
    assert.equal(kernel.field(CURSOR.pixelHash), fnv1a(second));
    assert.deepEqual(publishedPixels(kernel.published()).pixels, expectedRgba(second));
    kernel.tick();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 2);

    view.setUint32(ADDRESSES.art + 0x04, 9, true);
    kernel.cursorEvent();
    kernel.tick();
    assert.equal(kernel.field(CURSOR.generation), 3);
    assert.equal(kernel.field(CURSOR.pixelHash), fnv1a(second));
    assert.equal(readyCursor(kernel.header()).hotspotY, 9);

    view.setInt32(ADDRESSES.showCount, -1, true);
    kernel.tick();
    const gone = readyCursor(kernel.header());
    assert.equal(gone.status, "ready");
    assert.equal(gone.flags, CURSOR_VALID | CURSOR_HIDDEN);
    assert.equal(gone.hidden, true);
    assert.equal(gone.generation, 3);
    assert.deepEqual(kernel.payload(), expectedRgba(second));
    view.setInt32(ADDRESSES.showCount, 0, true);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).flags, CURSOR_VALID);
    assert.equal(kernel.field(CURSOR.generation), 3);
    assert.deepEqual(kernel.payload(), expectedRgba(second));
  });

  it("never publishes an uncommitted colour buffer as a cursor", async () => {
    const kernel = await createKernel();
    installCursorGraph(kernel.view);
    assert.equal(kernel.init(), 1);
    const sequence = kernel.field(CURSOR.sequence);
    for (let index = 0; index < 5; index += 1) kernel.tick();
    const header = invalidCursor(kernel.header());
    assert.equal(header.status, "invalid");
    assert.equal(header.flags, 0);
    assert.equal(kernel.field(CURSOR.generation), 0);
    assert.equal(kernel.field(CURSOR.sequence), sequence);
    assert.equal(kernel.published(), null);

    paintCursor(kernel.view, 4);
    kernel.cursorEvent();
    kernel.tick();
    assert.equal(kernel.header().status, "ready");
    assert.equal(kernel.field(CURSOR.generation), 1);
  });

  it("keeps the last good pixels while the software cursor is live", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view);
    const good = paintCursor(view, 5);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).generation, 1);

    view.setUint32(ADDRESSES.softwareModel, 1, true);
    const replacement = paintCursor(view, 6);
    kernel.cursorEvent();
    for (let index = 0; index < 3; index += 1) kernel.tick();
    const unsupported = invalidCursor(kernel.header());
    assert.equal(unsupported.status, "invalid");
    assert.equal(unsupported.reason, "unsupported");
    assert.equal(unsupported.flags, CURSOR_UNSUPPORTED);
    assert.equal(kernel.field(CURSOR.generation), 1);
    assert.deepEqual(kernel.payload(), expectedRgba(good));

    view.setUint32(ADDRESSES.softwareModel, 0, true);
    kernel.cursorEvent();
    kernel.tick();
    const recovered = publishedPixels(kernel.published());
    assert.equal(recovered.status, "ready");
    assert.equal(recovered.generation, 2);
    assert.deepEqual(recovered.pixels, expectedRgba(replacement));
  });

  it("clears validity for every rejected art, handle, or texture", async () => {
    const kernel = await createKernel();
    const { view } = kernel;
    installCursorGraph(view);
    const words = paintCursor(view, 7);
    assert.equal(kernel.init(), 1);
    kernel.tick();
    assert.equal(readyCursor(kernel.header()).generation, 1);

    const rejections: [name: string, breakGraph: () => void][] = [
      ["texture type", () => view.setUint32(ADDRESSES.texture + 0x0c, 9, true)],
      ["texture width", () => view.setUint32(ADDRESSES.texture + 0x14, 64, true)],
      ["texture height", () => view.setUint32(ADDRESSES.texture + 0x18, 16, true)],
      ["access key", () => view.setUint32(ADDRESSES.handle + 0x08, TEXTURE_KEY + 1, true)],
      ["null art", () => view.setUint32(ADDRESSES.activeArt, 0, true)],
      ["misaligned art", () => view.setUint32(ADDRESSES.activeArt, ADDRESSES.art + 1, true)],
      ["hotspot x", () => view.setUint32(ADDRESSES.art + 0x00, CURSOR_EDGE, true)],
      ["hotspot y", () => view.setUint32(ADDRESSES.art + 0x04, 0xffff_ffff, true)],
    ];
    let generation = 1;
    for (const [name, breakGraph] of rejections) {
      breakGraph();
      kernel.cursorEvent();
      kernel.tick();
      const broken = invalidCursor(kernel.header());
      assert.equal(broken.status, "invalid", name);
      assert.equal(broken.reason, "cursor", name);
      assert.equal(broken.flags, 0, name);
      assert.equal(kernel.published(), null, name);
      assert.equal(kernel.field(CURSOR.generation), generation, name);
      assert.deepEqual(kernel.payload(), expectedRgba(words), name);

      installCursorGraph(view);
      kernel.cursorEvent();
      kernel.tick();
      generation += 1;
      assert.equal(kernel.header().status, "ready", name);
      assert.equal(kernel.field(CURSOR.generation), generation, name);
    }
  });
});
