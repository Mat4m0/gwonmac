import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { boxOf, startGameInput } from "./input-helpers.js";

type PointerInputWindow = typeof window & {
  __inputReleases: string[];
  __edgeMoves: Array<[number, number]>;
  __macInputEvents: string[];
};

test.describe("renderer pointer input", () => {
  test("releases held input and cancels synthetic touches", async () => {
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

      const touchEvents = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const events: string[] = [];
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, () => events.push(type));
        }
        const mouse = (type: string, detail = 0) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 100,
              clientY: 100,
              detail,
            }),
          );
        mouse("mousedown", 1);
        mouse("mouseup", 1);
        mouse("mousedown", 2);
        mouse("mouseup", 2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset"));
        await new Promise((resolve) => setTimeout(resolve, 60));
        return events;
      });
      expect(touchEvents).toEqual([
        "touchstart",
        "touchcancel",
      ]);
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
  test("uses the native click count for double-tap compatibility", async () => {
    const fixture = await launchOffline("gw-double-click-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const touchEvents = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const observed: Array<{ type: string; identifier: number }> = [];
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, (event) => {
            const touch = event.changedTouches[0];
            if (!touch) throw new Error(`${type} carried no changed touch`);
            observed.push({ type, identifier: touch.identifier });
          });
        }
        const mouse = (type: string, detail: number) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 120,
              clientY: 140,
              detail,
            }),
          );

        // The OS may recognize a deliberately slow pair according to the
        // user's accessibility preference. The host must trust that native
        // count instead of applying its former 400 ms cutoff.
        mouse("mousedown", 1);
        mouse("mouseup", 1);
        await new Promise((resolve) => setTimeout(resolve, 450));
        mouse("mousedown", 2);
        mouse("mouseup", 2);
        const deadline = performance.now() + 2_000;
        while (observed.length < 4 && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return observed;
      });

      expect(touchEvents.map(({ type }) => type)).toEqual([
        "touchstart",
        "touchend",
        "touchstart",
        "touchend",
      ]);
      expect(new Set(touchEvents.map(({ identifier }) => identifier)).size).toBe(
        2,
      );
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

  test("cancels an active synthetic tap before a rapid follow-up click", async () => {
    const fixture = await launchOffline("gw-double-click-cancel-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("#canvas is missing");
        const observed: string[] = [];
        for (const type of ["touchstart", "touchend", "touchcancel"] as const) {
          canvas.addEventListener(type, () => observed.push(type));
        }
        const mouse = (type: string, detail: number) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 120,
              clientY: 140,
              detail,
            }),
          );

        mouse("mousedown", 2);
        mouse("mouseup", 2);
        await new Promise((resolve) => setTimeout(resolve, 30));
        mouse("mousedown", 3);
        mouse("mouseup", 3);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const interrupted = [...observed];

        observed.length = 0;
        mouse("mousedown", 2);
        canvas.dispatchEvent(
          new globalThis.MouseEvent("mouseleave", {
            bubbles: true,
            button: 0,
            clientX: 400,
            clientY: 400,
          }),
        );
        mouse("mouseup", 2);
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { interrupted, afterLeave: observed };
      });

      expect(result).toEqual({
        interrupted: ["touchstart", "touchcancel"],
        afterLeave: [],
      });
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
