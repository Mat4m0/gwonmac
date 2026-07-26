import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

// Drives the renderer's cursor consumer against a synthetic cursor region.
// The kernel side is covered by tests/integration/enhancement.test.mjs; this is
// only about what Chromium actually computes for the game canvas.
async function driveCursor(page, steps) {
  return page.evaluate(async (script) => {
    const { createCursorConsumer } = await import(
      new URL("enhancement-cursor.js", globalThis.location.href).href
    );
    const BYTES = 4160;
    const buffer = new ArrayBuffer(BYTES);
    const view = new DataView(buffer);
    const publish = ({ flags, generation, hotspotX, hotspotY, tint }) => {
      view.setUint32(0, 0x43545747, true);
      view.setUint16(4, 1, true);
      view.setUint16(6, BYTES, true);
      view.setUint32(8, 2, true);
      view.setUint32(12, flags, true);
      view.setUint32(16, generation, true);
      view.setUint32(20, 32, true);
      view.setUint32(24, 32, true);
      view.setUint32(28, hotspotX, true);
      view.setUint32(32, hotspotY, true);
      view.setUint32(36, generation * 977, true);
      for (let index = 0; index < 1024; index += 1) {
        // Canonical RGBA8: an opaque body over a transparent border column.
        view.setUint32(
          64 + index * 4,
          index % 32 === 0 ? 0 : (0xff00_0000 | tint) >>> 0,
          true,
        );
      }
    };

    const canvas = globalThis.document.getElementById("canvas");
    const dialog = globalThis.document.getElementById("settings-dialog");
    const cursorOf = (element) => globalThis.getComputedStyle(element).cursor;
    const PNG_URL = /data:image\/png;base64,[A-Za-z0-9+/=]+/g;
    // The data URLs are kilobytes of noise; the shape is what matters.
    const shapeOf = (value) => value.replace(PNG_URL, "<png>");

    // Decodes an image-set candidate and reports the first six pixels of row
    // 0, which is where a smoothed upscale would show interpolated alpha.
    const measure = async (dataUrl) => {
      const image = new globalThis.Image();
      await new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener(
          "error",
          () => reject(new Error("cursor candidate failed to decode")),
          { once: true },
        );
        image.src = dataUrl;
      });
      const probe = globalThis.document.createElement("canvas");
      probe.width = image.naturalWidth;
      probe.height = image.naturalHeight;
      const context = probe.getContext("2d");
      context.drawImage(image, 0, 0);
      const row = context.getImageData(0, 0, 6, 1).data;
      const columns = [];
      for (let x = 0; x < 6; x += 1) {
        columns.push([...row.slice(x * 4, x * 4 + 4)]);
      }
      return { width: image.naturalWidth, height: image.naturalHeight, columns };
    };

    const resting = cursorOf(canvas);
    const consumer = createCursorConsumer({
      element: canvas,
      memory: { buffer },
      cursorPointer: 0,
      fallback: "",
    });
    const observed = { resting: shapeOf(resting), steps: {} };
    try {
      for (const step of script) {
        if (step.publish) publish(step.publish);
        if (step.classList) {
          canvas.classList.toggle(step.classList, step.on === true);
        }
        if (step.drift) canvas.style.cursor = "";
        if (step.event === "pointerlockchange") {
          globalThis.document.dispatchEvent(
            new globalThis.Event("pointerlockchange"),
          );
        }
        if (step.dispose) consumer.dispose();
        if (step.poll !== false && !step.dispose) consumer.poll();
        observed.steps[step.name] = {
          canvas: shapeOf(cursorOf(canvas)),
          inline: shapeOf(canvas.style.cursor),
          dialog: shapeOf(cursorOf(dialog)),
          root: shapeOf(cursorOf(globalThis.document.documentElement)),
          state: consumer.state,
        };
        if (step.measure) {
          const urls = canvas.style.cursor.match(PNG_URL) ?? [];
          observed.candidates = { distinct: new Set(urls).size, images: [] };
          for (const url of urls) {
            observed.candidates.images.push(await measure(url));
          }
        }
      }
    } finally {
      consumer.dispose();
    }
    return observed;
  }, steps);
}

test.describe("enhancement cursor presentation", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("renders the game cursor as a 32 px image-set and hands back the plain pointer", async () => {
    const fixture = await launchOffline("gw-enhancement-cursor-e2e-");
    try {
      const { page } = fixture;
      const observed = await driveCursor(page, [
        {
          name: "cursor",
          measure: true,
          publish: {
            flags: 1,
            generation: 1,
            hotspotX: 5,
            hotspotY: 7,
            tint: 0x2244cc,
          },
        },
        { name: "locked", classList: "cursor-hidden", on: true },
        { name: "unlocked", classList: "cursor-hidden", on: false },
        { name: "drift", drift: true, event: "pointerlockchange", poll: false },
        {
          name: "hidden",
          publish: {
            flags: 3,
            generation: 2,
            hotspotX: 5,
            hotspotY: 7,
            tint: 0x2244cc,
          },
        },
        {
          name: "invalid",
          publish: {
            flags: 0,
            generation: 2,
            hotspotX: 0,
            hotspotY: 0,
            tint: 0,
          },
        },
        { name: "disposed", dispose: true },
      ]);

      // No cursor artwork is bundled any more, so the resting state of the
      // canvas -- and the fallback in every failure below -- is the plain
      // macOS pointer, not a stylesheet image.
      expect(observed.resting).toBe("auto");
      const cursor = observed.steps.cursor;

      // (a) 1x and 2x candidates, an authoring-grid hotspot, and the mandatory
      // fallback keyword -- without it the whole declaration is dropped.
      // Chromium computes the 1x/2x candidates as 1dppx/2dppx.
      expect(cursor.canvas).toBe(
        'image-set(url("<png>") 1dppx, url("<png>") 2dppx) 5 7, default',
      );
      // Inline style only: never a stylesheet rule, never documentElement.
      expect(cursor.inline).toBe(
        'image-set(url("<png>") 1x, url("<png>") 2x) 5 7, default',
      );
      expect(cursor.state.generation).toBe(1);
      expect(cursor.state.pixelHash).toBe(977);
      expect(cursor.state.valid).toBe(true);
      expect(cursor.state.hidden).toBe(false);
      expect(cursor.state.cssLength).toBeGreaterThan(cursor.inline.length);

      // The 2x candidate must be a distinct 64x64 nearest-neighbour double.
      // A 32x32 PNG alone reaches macOS at scale 1 and is upscaled blurry;
      // smoothing would bleed the transparent first column into column 1.
      const opaque = [0xcc, 0x44, 0x22, 0xff];
      const clear = [0, 0, 0, 0];
      expect(observed.candidates.distinct).toBe(2);
      expect(observed.candidates.images[0]).toEqual({
        width: 32,
        height: 32,
        columns: [clear, opaque, opaque, opaque, opaque, opaque],
      });
      expect(observed.candidates.images[1]).toEqual({
        width: 64,
        height: 64,
        columns: [clear, clear, opaque, opaque, opaque, opaque],
      });

      // (c) the game cursor is confined to the canvas: the settings dialog and
      // the rest of the chrome keep the plain pointer.
      expect(cursor.dialog).toBe(observed.resting);
      expect(cursor.root).toBe(observed.resting);
      expect(cursor.dialog).not.toContain("<png>");

      // (d) pointer lock's `cursor: none !important` outranks the inline value.
      expect(observed.steps.locked.canvas).toBe("none");
      expect(observed.steps.locked.inline).toBe(cursor.inline);
      expect(observed.steps.unlocked.canvas).toBe(cursor.canvas);

      // macOS can restore the system arrow behind our back; re-asserting on
      // pointerlockchange must put the game cursor back without a rebuild.
      expect(observed.steps.drift.canvas).toBe(cursor.canvas);

      // A hidden cursor is `none` on the canvas alone.
      expect(observed.steps.hidden.canvas).toBe("none");
      expect(observed.steps.hidden.state.hidden).toBe(true);
      expect(observed.steps.hidden.dialog).toBe(observed.resting);

      // (b) losing the cursor -- or disposing the consumer -- hands the canvas
      // back to the plain macOS pointer, which is the whole fallback story.
      expect(observed.steps.invalid.canvas).toBe(observed.resting);
      expect(observed.steps.invalid.inline).toBe("");
      expect(observed.steps.invalid.state.valid).toBe(false);
      expect(observed.steps.disposed.canvas).toBe(observed.resting);
      expect(observed.steps.disposed.inline).toBe("");
    } finally {
      await closeOffline(fixture);
    }
  });

  // The choice is real only if a saved `nativeCursor` survives the whole chain:
  // settings file -> enhancementsEnabledFor -> renderer init payload. Without it,
  // harness.js never imports enhancements.js and no cursor appears.
  test("a saved opt-in reaches the renderer init payload", async () => {
    const seed = (value) => async (userData) =>
      writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify({
          renderScale: 2,
          nativeCursor: value,
          targetReadout: false,
          touchMode: "dbltap",
          showDiagnostics: false,
          dataStrategy: "quick",
        }),
        { mode: 0o600 },
      );

    const optedIn = await launchOffline("gw-cursor-opt-in-e2e-", {}, seed(true));
    try {
      expect(
        await optedIn.page.evaluate(() => ({
          ...globalThis.gwNative.init,
          search: globalThis.location.search,
        })),
      ).toEqual({
        enhancementAutomation: false,
        enhancementSelection: {
          nativeCursor: true,
          targetReadout: false,
        },
        templateFsTrace: false,
        // The configuration is no longer in the URL the trust root checks.
        search: "",
      });
      expect(
        await optedIn.page.evaluate(() => globalThis.gwNative.settings.get()),
      ).toMatchObject({ nativeCursor: true });
    } finally {
      await closeOffline(optedIn);
    }

    const optedOut = await launchOffline(
      "gw-cursor-opt-out-e2e-",
      {},
      seed(false),
    );
    try {
      expect(
        await optedOut.page.evaluate(
          () => globalThis.gwNative.init.enhancementSelection.nativeCursor,
        ),
      ).toBe(false);
    } finally {
      await closeOffline(optedOut);
    }
  });
});
