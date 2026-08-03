import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { boxOf, startGameInput } from "./input-helpers.js";

interface CameraEvent {
  type: string;
  button: number;
  buttons: number;
  clientX: number;
  movementX: number;
}

type CameraInputWindow = typeof window & {
  __inputReleases: string[];
  __cameraEvents: CameraEvent[];
  __cameraDrains: number;
  __cameraTasks: number[];
};

test.describe("renderer camera input", () => {
  test("allows pointer lock only for the owned game canvas", async () => {
    // Real pointer lock needs a focused widget, so this launch takes focus.
    const fixture = await launchOffline("gw-pointer-permission-e2e-", {
      GW_BACKGROUND_LAUNCH: "0",
    });
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        electronApp.focus({ steal: true });
        BrowserWindow.getAllWindows()[0]?.focus();
      });
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        canvas.focus();
      });
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.pointerLockElement?.id ?? null,
          ),
        )
        .toBe("canvas");
      await page.mouse.move(box.x + 130, box.y + 120);
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.pointerLockElement?.id ?? null,
          ),
        )
        .toBe("canvas");
      await page.mouse.up({ button: "right" });
      await expect
        .poll(() =>
          page.evaluate(
            () => globalThis.document.pointerLockElement?.id ?? null,
          ),
        )
        .toBeNull();
    } finally {
      await closeOffline(fixture);
    }
  });

  // A held drag re-anchors only after POINTER_ROAM canvases of travel, so these
  // tests report a deliberately tiny canvas: it brings that budget within a
  // mouse move the fixture window can hold. Four pixels of canvas at 95 from the
  // window's own left edge means 64 pixels of roam either side of it.
  const CAMERA_CANVAS = 4;
  const CAMERA_ROAM = CAMERA_CANVAS * 16;

  // The press sits two pixels below the reported top so the drag starts inside
  // the budget on both axes; every move in these tests is horizontal.
  const CAMERA_Y = 2;

  /** Watches what the client receives, from a right-drag pressed at box.x+100. */
  const watchCameraDrag = async (page: Page, box: { x: number; y: number }) => {
    await page.evaluate(({ x, y, size }) => {
      const gameCanvas = globalThis.document.getElementById("canvas");
      const loading = globalThis.document.getElementById("loading");
      if (!gameCanvas || !loading) {
        throw new Error("the renderer shell is missing");
      }
      loading.classList.add("gone");
      const testWindow = window as CameraInputWindow;
      testWindow.__cameraEvents = [];
      // Microtasks queued by a listener drain only once the task dispatching it
      // ends, so a shared count is an exact witness that these events were
      // delivered without yielding to the event loop between them.
      testWindow.__cameraDrains = 0;
      testWindow.__cameraTasks = [];
      for (const type of ["mousemove", "mouseup", "mousedown"] as const) {
        gameCanvas.addEventListener(type, (event) => {
          if (!event.isTrusted) {
            testWindow.__cameraTasks.push(testWindow.__cameraDrains);
            globalThis.queueMicrotask(() => {
              testWindow.__cameraDrains += 1;
            });
            testWindow.__cameraEvents.push({
              type,
              button: event.button,
              buttons: event.buttons,
              clientX: event.clientX,
              movementX: event.movementX,
            });
          }
        });
      }
      gameCanvas.getBoundingClientRect = () =>
        new globalThis.DOMRect(x + 95, y, size, size);
      Object.defineProperty(globalThis.document, "pointerLockElement", {
        configurable: true,
        value: gameCanvas,
      });
      globalThis.document.exitPointerLock = () => {
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: null,
        });
      };
      gameCanvas.focus();
    }, { x: box.x, y: box.y, size: CAMERA_CANVAS });

    await page.mouse.move(box.x + 100, box.y + CAMERA_Y);
    await page.mouse.down({ button: "right" });
  };

  test("carries a held camera drag past the edge of the canvas", async () => {
    const fixture = await launchOffline("gw-pointer-edge-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await watchCameraDrag(page, box);

      // Both moves leave the cursor well outside a four-pixel canvas. The client
      // keeps integrating them there, so stopping at the edge to re-anchor buys
      // nothing and costs a released button — which a small window pays on about
      // every third move, and is why it rotated worse than a large one.
      await page.mouse.move(box.x + 80, box.y + CAMERA_Y);
      await page.mouse.move(box.x + 60, box.y + CAMERA_Y);
      await expect
        .poll(() =>
          page.evaluate(() => (window as CameraInputWindow).__cameraEvents),
        )
        .toEqual([
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 - 15,
            movementX: -20,
          },
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 - 35,
            movementX: -20,
          },
        ]);
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("recycles a held camera drag once it roams past its budget", async () => {
    const fixture = await launchOffline("gw-pointer-roam-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await watchCameraDrag(page, box);

      // Eighty left of a press five into the canvas overruns the budget by 11.
      await page.mouse.move(box.x + 20, box.y + CAMERA_Y);
      await expect
        .poll(() =>
          page.evaluate(() => (window as CameraInputWindow).__cameraEvents),
        )
        .toEqual([
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 - CAMERA_ROAM,
            movementX: -(CAMERA_ROAM + 5),
          },
          {
            type: "mouseup",
            button: 2,
            buttons: 0,
            clientX: box.x + 95 - CAMERA_ROAM,
            movementX: 0,
          },
          {
            type: "mousedown",
            button: 2,
            buttons: 2,
            clientX: box.x + 95 + CAMERA_CANVAS / 2,
            movementX: 0,
          },
          {
            type: "mousemove",
            button: 0,
            buttons: 2,
            clientX: box.x + 95 + CAMERA_CANVAS / 2 - 11,
            movementX: -11,
          },
        ]);
      // The recycled drag has to reach the client in the task that produced it.
      // Replaying the leftover delta from a later animation frame satisfies
      // every assertion above and still freezes the camera for that frame.
      await expect
        .poll(() =>
          page.evaluate(() => (window as CameraInputWindow).__cameraTasks),
        )
        .toEqual([0, 0, 0, 0]);
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("ends a camera drag without dispatching any position reconciliation", async () => {
    const fixture = await launchOffline("gw-pointer-release-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await watchCameraDrag(page, box);

      // The same overrun as the roam test leaves the client's absolute
      // position away from the press point. The release must NOT try to walk
      // it back: the client samples mouse state per frame, so a walk-back
      // move lands in the release's frame and is integrated into the camera —
      // shipping one made every rotation visibly snap back on release.
      await page.mouse.move(box.x + 20, box.y + CAMERA_Y);
      const beforeRelease = await page.evaluate(
        () => (window as CameraInputWindow).__cameraEvents.length,
      );
      await page.mouse.up({ button: "right" });
      await page.waitForTimeout(100);
      const moves = await page.evaluate(
        (from) =>
          (window as CameraInputWindow).__cameraEvents
            .slice(from)
            .filter(({ type }) => type === "mousemove"),
        beforeRelease,
      );
      expect(moves).toEqual([]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("releases only held mouse buttons when pointer lock is lost", async () => {
    const fixture = await launchOffline("gw-pointer-loss-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        const testWindow = window as CameraInputWindow;
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
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: canvas,
        });
        canvas.requestPointerLock = () => Promise.resolve();
        canvas.focus();
      });
      const box = await boxOf(page.locator("#canvas"));
      await page.keyboard.down("w");
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
      await page.evaluate(() => {
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: null,
        });
        globalThis.document.dispatchEvent(
          new globalThis.Event("pointerlockchange"),
        );
      });
      expect(
        await page.evaluate(() => (window as CameraInputWindow).__inputReleases),
      ).toEqual(["mouse:2"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });
});
