import { expect, type Page, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";

/** One cursor region header, as the kernel would publish it. */
interface CursorPublication {
  flags: number;
  generation: number;
  hotspotX: number;
  hotspotY: number;
  tint: number;
}

/** One instruction in a script handed to `driveCursor`. */
interface CursorStep {
  name: string;
  publish?: CursorPublication;
  classList?: string;
  on?: boolean;
  drift?: boolean;
  event?: "pointerlockchange";
  dispose?: boolean;
  poll?: boolean;
  measure?: boolean;
  /** Set the transition-hold answer the consumer reads on its next poll. */
  hold?: boolean;
}

/** One decoded `image-set` candidate: its size and the first six pixels of row 0. */
interface CursorCandidate {
  width: number;
  height: number;
  columns: number[][];
}

// The consumer's own state shape, named rather than restated, so a change to
// what it reports fails here instead of being silently absent.
type CursorConsumerState = ReturnType<
  typeof import("../../src/renderer/enhancement-cursor.js").createCursorConsumer
>["state"];

interface CursorObservation {
  canvas: string;
  inline: string;
  dialog: string;
  root: string;
  state: CursorConsumerState;
}

interface CursorRun {
  resting: string;
  steps: Record<string, CursorObservation>;
  candidates?: { distinct: number; images: CursorCandidate[] };
}

// Drives the renderer's cursor consumer against a synthetic cursor region.
// The kernel side is covered by tests/integration/enhancement.test.ts; this is
// only about what Chromium actually computes for the game canvas.
async function driveCursor(
  page: Page,
  steps: readonly CursorStep[],
): Promise<CursorRun> {
  return page.evaluate(async (script) => {
    // The page serves renderer modules under `gw://app`; no path from this
    // spec resolves that specifier, so the shape is taken from the source.
    const importRenderer = async <T>(specifier: string): Promise<T> =>
      import(specifier);
    const { createCursorConsumer } = await importRenderer<
      typeof import("../../src/renderer/enhancement-cursor.js")
    >(new URL("enhancement-cursor.js", globalThis.location.href).href);
    const BYTES = 4160;
    // A real `WebAssembly.Memory`, which is what the consumer is declared to
    // take and what the client hands it; one page is sixteen times the region.
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);
    const publish = ({
      flags,
      generation,
      hotspotX,
      hotspotY,
      tint,
    }: CursorPublication) => {
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
    const dialog = globalThis.document.getElementById("loading");
    if (!canvas) throw new Error("the game canvas is missing");
    if (!dialog) throw new Error("the game fallback is missing");
    const cursorOf = (element: Element) =>
      globalThis.getComputedStyle(element).cursor;
    const PNG_URL = /data:image\/png;base64,[A-Za-z0-9+/=]+/g;
    // The data URLs are kilobytes of noise; the shape is what matters.
    const shapeOf = (value: string) => value.replace(PNG_URL, "<png>");

    // Decodes an image-set candidate and reports the first six pixels of row
    // 0, which is where a smoothed upscale would show interpolated alpha.
    const measure = async (dataUrl: string): Promise<CursorCandidate> => {
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
      if (!context) throw new Error("no 2d context for the cursor probe");
      context.drawImage(image, 0, 0);
      const row = context.getImageData(0, 0, 6, 1).data;
      const columns: number[][] = [];
      for (let x = 0; x < 6; x += 1) {
        columns.push([...row.slice(x * 4, x * 4 + 4)]);
      }
      return { width: image.naturalWidth, height: image.naturalHeight, columns };
    };

    const resting = cursorOf(canvas);
    let holding = false;
    const consumer = createCursorConsumer({
      element: canvas,
      memory,
      cursorPointer: 0,
      fallback: "",
      transitionHold: () => holding,
    });
    const observed: CursorRun = { resting: shapeOf(resting), steps: {} };
    try {
      for (const step of script) {
        if (step.hold !== undefined) holding = step.hold;
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
          const images: CursorCandidate[] = [];
          for (const url of urls) images.push(await measure(url));
          observed.candidates = { distinct: new Set(urls).size, images };
        }
      }
    } finally {
      consumer.dispose();
    }
    return observed;
  }, steps);
}

test.describe("enhancement cursor presentation", () => {
  test("repeats hit-testing after a click only when the game emitted no cursor event", async () => {
    const fixture = await launchOffline("gw-cursor-refresh-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(async () => {
        const { installCursorRefresh } = await import(
          new URL("cursor-refresh.js", globalThis.location.href).href
        ) as typeof import("../../src/renderer/cursor-refresh.js");
        const canvas = globalThis.document.createElement("canvas");
        canvas.id = "cursor-refresh-probe";
        canvas.style.cssText =
          "position:fixed;left:20px;top:20px;width:100px;height:100px;z-index:9999";
        globalThis.document.body.append(canvas);
        const proof = {
          eventCount: 0,
          refreshes: 0,
          moves: [] as { x: number; trusted: boolean }[],
        };
        canvas.addEventListener("mousemove", (event) => {
          if (!event.isTrusted) {
            proof.moves.push({ x: event.clientX, trusted: false });
          }
        });
        const refresh = installCursorRefresh(
          canvas,
          () => proof.eventCount,
          () => { proof.refreshes += 1; },
        );
        Object.assign(globalThis, {
          __cursorRefreshProof: proof,
          __cursorRetest: refresh.retest,
        });
        globalThis.addEventListener("pagehide", refresh.dispose, { once: true });
      });

      const canvas = page.locator("#cursor-refresh-probe");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("the game canvas has no bounds");
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      await page.mouse.click(x, y);
      await page.evaluate(() => new Promise<void>((resolve) =>
        globalThis.requestAnimationFrame(() => resolve())));
      expect(await page.evaluate(() => {
        const proof = (globalThis as typeof globalThis & {
          __cursorRefreshProof: {
            refreshes: number;
            moves: { x: number; trusted: boolean }[];
          };
        }).__cursorRefreshProof;
        return proof;
      })).toMatchObject({
        refreshes: 1,
        moves: [
          { x: x + 1, trusted: false },
          { x, trusted: false },
        ],
      });

      // A real game callback between press and release makes the fallback a
      // no-op: it exists to fill one missing edge, not duplicate normal work.
      await page.evaluate(() => {
        const proof = (globalThis as typeof globalThis & {
          __cursorRefreshProof: { eventCount: number };
        }).__cursorRefreshProof;
        const canvas = globalThis.document.getElementById("cursor-refresh-probe");
        canvas?.addEventListener("mousedown", () => {
          proof.eventCount += 1;
        }, { once: true });
      });
      await page.mouse.click(x, y);
      await page.evaluate(() => new Promise<void>((resolve) =>
        globalThis.requestAnimationFrame(() => resolve())));
      expect(await page.evaluate(() => {
        const proof = (globalThis as typeof globalThis & {
          __cursorRefreshProof: { refreshes: number; moves: unknown[] };
        }).__cursorRefreshProof;
        return { refreshes: proof.refreshes, moveCount: proof.moves.length };
      })).toEqual({ refreshes: 1, moveCount: 2 });

      // The manual re-test serves the hidden-transition retry loop: it repeats
      // the pair at the stored click, and refuses once real movement makes the
      // game re-evaluate hover on its own.
      expect(await page.evaluate(() => {
        const g = globalThis as typeof globalThis & {
          __cursorRetest: () => boolean;
          __cursorRefreshProof: { refreshes: number; moves: unknown[] };
        };
        const accepted = g.__cursorRetest();
        return {
          accepted,
          refreshes: g.__cursorRefreshProof.refreshes,
          moveCount: g.__cursorRefreshProof.moves.length,
        };
      })).toEqual({ accepted: true, refreshes: 2, moveCount: 4 });
      // A tremor over the canvas re-aims the re-test at the pointer instead
      // of abandoning the transition; only leaving the canvas disarms it.
      await page.mouse.move(x + 30, y + 30);
      expect(await page.evaluate(() => {
        const g = globalThis as typeof globalThis & {
          __cursorRetest: () => boolean;
          __cursorRefreshProof: { moves: { x: number }[] };
        };
        const accepted = g.__cursorRetest();
        const moves = g.__cursorRefreshProof.moves;
        return {
          accepted,
          moveCount: moves.length,
          lastX: moves[moves.length - 1]?.x,
        };
      })).toEqual({ accepted: true, moveCount: 6, lastX: x + 30 });
      await page.mouse.move(400, 400);
      expect(await page.evaluate(() => {
        const g = globalThis as typeof globalThis & {
          __cursorRetest: () => boolean;
          __cursorRefreshProof: { moves: unknown[] };
        };
        return {
          accepted: g.__cursorRetest(),
          moveCount: g.__cursorRefreshProof.moves.length,
        };
      })).toEqual({ accepted: false, moveCount: 6 });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a click-armed transition holds the last art instead of hiding", async () => {
    const fixture = await launchOffline("gw-cursor-hold-e2e-");
    try {
      const observed = await driveCursor(fixture.page, [
        { name: "art", publish: { flags: 1, generation: 2, hotspotX: 3, hotspotY: 4, tint: 0x20 }, poll: true },
        // The hide arrives while the transition is armed: the art must stay.
        { name: "held", hold: true, publish: { flags: 3, generation: 2, hotspotX: 3, hotspotY: 4, tint: 0x20 }, poll: true },
        // Resolution is one swap from old art to new art, never through none.
        { name: "resolved", publish: { flags: 1, generation: 3, hotspotX: 5, hotspotY: 4, tint: 0x2e }, poll: true },
        // A hold that ends with no republish still owes the hide it withheld.
        { name: "re-hidden", publish: { flags: 3, generation: 3, hotspotX: 5, hotspotY: 4, tint: 0x2e }, poll: true },
        { name: "disarmed", hold: false, poll: true },
      ]);
      const shape = (name: string) => observed.steps[name]?.canvas;
      expect(shape("art")).toContain("image-set");
      expect(shape("held")).toBe(shape("art"));
      expect(observed.steps["held"]?.state).toMatchObject({ hidden: true });
      expect(shape("resolved")).toContain("image-set");
      expect(shape("resolved")).not.toBe(shape("art"));
      expect(shape("re-hidden")).toBe(shape("resolved"));
      expect(shape("disarmed")).toBe("none");
    } finally {
      await closeOffline(fixture);
    }
  });

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
      // A step the script named but the run never recorded is a failure of the
      // driver, not an assertion this test may skip.
      const at = (name: string) => {
        const observation = observed.steps[name];
        if (!observation) throw new Error(`step "${name}" was not observed`);
        return observation;
      };
      const cursor = at("cursor");
      const candidates = observed.candidates;
      if (!candidates) throw new Error("no cursor candidates were measured");

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
      expect(candidates.distinct).toBe(2);
      expect(candidates.images[0]).toEqual({
        width: 32,
        height: 32,
        columns: [clear, opaque, opaque, opaque, opaque, opaque],
      });
      expect(candidates.images[1]).toEqual({
        width: 64,
        height: 64,
        columns: [clear, clear, opaque, opaque, opaque, opaque],
      });

      // (c) the game cursor is confined to the canvas: the fallback and
      // the rest of the chrome keep the plain pointer.
      expect(cursor.dialog).toBe(observed.resting);
      expect(cursor.root).toBe(observed.resting);
      expect(cursor.dialog).not.toContain("<png>");

      // (d) pointer lock's `cursor: none !important` outranks the inline value.
      expect(at("locked").canvas).toBe("none");
      expect(at("locked").inline).toBe(cursor.inline);
      expect(at("unlocked").canvas).toBe(cursor.canvas);

      // macOS can restore the system arrow behind our back; re-asserting on
      // pointerlockchange must put the game cursor back without a rebuild.
      expect(at("drift").canvas).toBe(cursor.canvas);

      // A hidden cursor is `none` on the canvas alone.
      expect(at("hidden").canvas).toBe("none");
      expect(at("hidden").state.hidden).toBe(true);
      expect(at("hidden").dialog).toBe(observed.resting);

      // (b) losing the cursor -- or disposing the consumer -- hands the canvas
      // back to the plain macOS pointer, which is the whole fallback story.
      expect(at("invalid").canvas).toBe(observed.resting);
      expect(at("invalid").inline).toBe("");
      expect(at("invalid").state.valid).toBe(false);
      expect(at("disposed").canvas).toBe(observed.resting);
      expect(at("disposed").inline).toBe("");
    } finally {
      await closeOffline(fixture);
    }
  });

});
