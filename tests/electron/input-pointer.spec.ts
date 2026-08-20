import { expect, test } from "@playwright/test";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
import { boxOf, startGameInput } from "./input-helpers.js";

type PointerInputWindow = typeof window & {
  __inputReleases: string[];
  __edgeMoves: Array<[number, number]>;
  __macInputEvents: string[];
  __nativeDoubleClickProbe: { flag: number; touches: number };
};

test.describe("renderer pointer input", () => {
  test("releases held keys and buttons on an input reset", async () => {
    const fixture = await launchCachedClient("gw-input-e2e-");
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

  test("adds taps only for an uncertified double-click", async () => {
    const fixture = await launchCachedClient("gw-macos-pointer-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      // Scripted events are untrusted. They cannot originate the fallback,
      // even when they claim to be the even press in a click run.
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
        for (const detail of [1, 2, 3, 4, 5, 6]) {
          mouse("mousedown", detail);
          mouse("mouseup", detail);
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
        return seen;
      });
      expect(touches).toEqual([]);

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
      await page.mouse.dblclick(box.x + 60, box.y + 60);
      await expect.poll(async () => page.evaluate(() =>
        (window as PointerInputWindow).__macInputEvents.filter(
          (type) => type.startsWith("touch"),
        ),
      )).toEqual(["touchstart", "touchend", "touchstart", "touchend"]);

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
        "mouseup:0:0",
        "touchstart",
        "touchend",
        "touchstart",
        "touchend",
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

  test("cancels an unfinished fallback as one atomic gesture", async () => {
    const fixture = await launchCachedClient("gw-double-click-cancel-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const seen: string[] = [];
        (window as PointerInputWindow).__macInputEvents = seen;
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, () => {
            seen.push(type);
            if (type === "touchstart") {
              window.dispatchEvent(new CustomEvent("gw:input-reset"));
            }
          });
        }
      });
      const box = await boxOf(page.locator("#canvas"));

      await page.mouse.dblclick(box.x + 60, box.y + 60);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() =>
        (window as PointerInputWindow).__macInputEvents,
      )).toEqual(["touchstart", "touchcancel"]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps the certified native flag as the primary path", async () => {
    const fixture = await launchCachedClient("gw-native-double-click-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const probe = await page.evaluate(async () => {
        const { installDoubleClick } = await import(
          new URL("double-click.js", globalThis.location.href).href
        ) as typeof import("../../src/renderer/double-click.js");
        const canvas = globalThis.document.createElement("canvas");
        canvas.id = "native-double-click-probe";
        canvas.style.cssText = "position:fixed;inset:20px;width:100px;height:100px;z-index:9999";
        globalThis.document.body.append(canvas);
        const testWindow = window as PointerInputWindow;
        testWindow.__nativeDoubleClickProbe = { flag: 0, touches: 0 };
        for (const type of ["touchstart", "touchend"] as const) {
          canvas.addEventListener(type, () => {
            testWindow.__nativeDoubleClickProbe.touches += 1;
          });
        }
        installDoubleClick({
          canvas,
          nativeFlag: () => ({
            get value() { return testWindow.__nativeDoubleClickProbe.flag; },
            set value(value: number) {
              testWindow.__nativeDoubleClickProbe.flag = value;
            },
          }),
          log() {},
        });
        return canvas.id;
      });
      const box = await boxOf(page.locator(`#${probe}`));

      await page.mouse.dblclick(box.x + 30, box.y + 30);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() =>
        (window as PointerInputWindow).__nativeDoubleClickProbe,
      )).toEqual({ flag: 1, touches: 0 });

      await page.mouse.click(box.x + 30, box.y + 30);
      expect(await page.evaluate(() =>
        (window as PointerInputWindow).__nativeDoubleClickProbe,
      )).toEqual({ flag: 0, touches: 0 });
    } finally {
      await closeOffline(fixture);
    }
  });
  test("releases only pointer input when the pointer leaves the app window", async () => {
    const fixture = await launchCachedClient("gw-input-window-leave-e2e-");
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
      ).toEqual(["mouse:0"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "left" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps the game canvas interactive through every renderer edge", async () => {
    const fixture = await launchCachedClient("gw-input-viewport-edges-e2e-");
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
    const fixture = await launchCachedClient("gw-wheel-e2e-");
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
