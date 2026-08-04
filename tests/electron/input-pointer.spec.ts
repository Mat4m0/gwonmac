import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { boxOf, startGameInput } from "./input-helpers.js";

type PointerInputWindow = typeof window & {
  __inputReleases: string[];
  __edgeMoves: Array<[number, number]>;
  __macInputEvents: string[];
};

test.describe("renderer pointer input", () => {
  test("releases held keys and buttons on an input reset", async () => {
    const fixture = await launchOffline("gw-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as PointerInputWindow;
        testWindow.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(
              `key:${event.code}:${event.keyCode}:${event.which}`,
            );
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        canvas.focus();
      });

      await page.keyboard.down("w");
      const canvasBox = await boxOf(page.locator("#canvas"));
      await page.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
      await page.mouse.down({ button: "left" });
      await page.evaluate(() =>
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset")),
      );
      expect(
        await page.evaluate(() => (window as PointerInputWindow).__inputReleases),
      ).toEqual(["key:KeyW:87:87", "mouse:0"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "left" });

    } finally {
      await closeOffline(fixture);
    }
  });

  test("never dispatches a touch event, whatever the click run", async () => {
    // The host used to reach the client's double-click by synthesising a pair
    // of touch taps. That path is gone — the client's own flag carries it now
    // — and it must not come back as a fallback: a tap warps the cursor,
    // force-releases captured buttons, enters the drag machinery, and delivers
    // an extra click of its own. See internal/upstream/mouse-double-click.md.
    const fixture = await launchOffline("gw-no-touch-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const touches = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const seen: string[] = [];
        for (const type of [
          "touchstart", "touchend", "touchmove", "touchcancel",
        ] as const) {
          canvas.addEventListener(type, () => seen.push(type));
        }
        const mouse = (type: string, detail: number) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true, button: 0, clientX: 120, clientY: 140, detail,
            }),
          );
        // A double-click, then a longer run, then a drag — every shape that
        // used to arm, fire, or refuse a tap pair.
        for (const detail of [1, 2, 3, 4, 5, 6]) {
          mouse("mousedown", detail);
          mouse("mouseup", detail);
        }
        // Well past the old 250 ms holdback plus its gap.
        await new Promise((resolve) => setTimeout(resolve, 600));
        return seen;
      });
      expect(touches).toEqual([]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("passes primary clicks and drags through without touch input", async () => {
    const fixture = await launchOffline("gw-macos-pointer-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as PointerInputWindow;
        testWindow.__macInputEvents = [];
        for (const type of ["mousedown", "mouseup"] as const) {
          canvas.addEventListener(type, (event) => {
            testWindow.__macInputEvents.push(
              `${type}:${event.button}:${event.buttons}`,
            );
          });
        }
        canvas.addEventListener("mousemove", (event) => {
          if (event.buttons === 1) {
            testWindow.__macInputEvents.push("mousemove:0:1");
          }
        });
        for (const type of ["touchstart", "touchmove", "touchend"] as const) {
          canvas.addEventListener(type, () => {
            testWindow.__macInputEvents.push(type);
          });
        }
      });

      const box = await boxOf(page.locator("#canvas"));
      await page.mouse.click(box.x + 100, box.y + 100);
      await page.mouse.move(box.x + 140, box.y + 140);
      await page.mouse.down({ button: "left" });
      await page.mouse.move(box.x + 180, box.y + 170);
      await page.mouse.up({ button: "left" });

      expect(
        await page.evaluate(() =>
          (window as PointerInputWindow).__macInputEvents),
      ).toEqual([
        "mousedown:0:1",
        "mouseup:0:0",
        "mousedown:0:1",
        "mousemove:0:1",
        "mouseup:0:0",
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });
  test("releases held input when the pointer leaves the app window", async () => {
    const fixture = await launchOffline("gw-input-window-leave-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as PointerInputWindow;
        testWindow.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`key:${event.code}`);
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            testWindow.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        canvas.focus();
      });
      const box = await boxOf(page.locator("#canvas"));
      await page.keyboard.down("w");
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "left" });
      await page.evaluate(() => {
        globalThis.document.documentElement.dispatchEvent(
          new globalThis.MouseEvent("mouseleave"),
        );
      });
      expect(
        await page.evaluate(() => (window as PointerInputWindow).__inputReleases),
      ).toEqual(["key:KeyW", "mouse:0"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "left" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps the game canvas interactive through every renderer edge", async () => {
    const fixture = await launchOffline("gw-input-viewport-edges-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as PointerInputWindow;
        testWindow.__edgeMoves = [];
        canvas.addEventListener("mousemove", (event) => {
          testWindow.__edgeMoves.push([event.clientX, event.clientY]);
        });
        const viewport: [number, number] = [
          globalThis.innerWidth,
          globalThis.innerHeight,
        ];
        const points: Array<[number, number]> = [
          [0, 0],
          [viewport[0] - 1, 0],
          [0, viewport[1] - 1],
          [viewport[0] - 1, viewport[1] - 1],
        ];
        const corner = globalThis.document.elementFromPoint(
          viewport[0] - 1,
          viewport[1] - 1,
        );
        if (!corner) throw new Error("the viewport corner hit-tests to nothing");
        const canvasSize: [number, number] = [
          canvas.clientWidth,
          canvas.clientHeight,
        ];
        return {
          viewport,
          canvas: canvasSize,
          edgeTargets: points.map(([x, y]) =>
            globalThis.document.elementFromPoint(x, y)?.id ?? null,
          ),
          edgeCursor: globalThis.getComputedStyle(corner).cursor,
        };
      });
      expect(result.canvas).toEqual(result.viewport);
      expect(result.edgeTargets).toEqual([
        "canvas",
        "canvas",
        "canvas",
        "canvas",
      ]);
      // No cursor artwork ships, and this session did not opt in, so the very
      // edge of the canvas is the plain macOS pointer.
      expect(result.edgeCursor).toBe("auto");
      await page.mouse.move(0, 0);
      await page.mouse.move(result.viewport[0] - 1, 0);
      await page.mouse.move(0, result.viewport[1] - 1);
      await page.mouse.move(
        result.viewport[0] - 1,
        result.viewport[1] - 1,
      );
      expect(
        await page.evaluate(() => (window as PointerInputWindow).__edgeMoves),
      ).toEqual([
        [0, 0],
        [result.viewport[0] - 1, 0],
        [0, result.viewport[1] - 1],
        [result.viewport[0] - 1, result.viewport[1] - 1],
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("accumulates trackpad pixels without changing discrete wheel input", async () => {
    const fixture = await launchOffline("gw-wheel-e2e-");
    try {
      await startGameInput(fixture.page);
      const result = await fixture.page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const observed: Array<[number, number]> = [];
        canvas.addEventListener(
          "wheel",
          (event) => {
            if (!event.isTrusted) {
              observed.push([event.deltaMode, event.deltaY]);
            }
          },
        );
        const pixel = (deltaY: number) =>
          canvas.dispatchEvent(
            new globalThis.WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              deltaMode: globalThis.WheelEvent.DOM_DELTA_PIXEL,
            }),
          );
        const line = (deltaY: number) =>
          canvas.dispatchEvent(
            new globalThis.WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              deltaMode: globalThis.WheelEvent.DOM_DELTA_LINE,
            }),
          );

        pixel(60);
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset"));
        pixel(60);
        const afterReset = [...observed];

        line(-1);
        pixel(60);
        const afterDiscrete = [...observed];
        pixel(60);
        const complete = [...observed];
        return { afterReset, afterDiscrete, complete };
      });
      expect(result).toEqual({
        afterReset: [],
        afterDiscrete: [[1, -1]],
        complete: [
          [1, -1],
          [0, 100],
        ],
      });
    } finally {
      await closeOffline(fixture);
    }
  });
});
