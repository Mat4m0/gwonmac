import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { closeOffline, launchCachedClient } from "./fixtures.mjs";
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
  __lockRequests: number;
  __cursorHidden: boolean;
};

const launchCameraClient = (
  prefix: string,
  environment: Record<string, string> = {},
) => launchCachedClient(prefix, {
  // Camera tests need the real active snapshot. Queue Play behind client
  // publication instead of using the shell-only unready-launch seam.
  GW_TEST_ALLOW_UNREADY_LAUNCH: "0",
  ...environment,
});

test.describe("renderer camera input", () => {
  test("allows pointer lock only for the owned game canvas", async () => {
    // Real pointer lock needs a focused widget, so this launch takes focus.
    const fixture = await launchCameraClient("gw-pointer-permission-e2e-", {
      GW_BACKGROUND_LAUNCH: "0",
    });
    try {
      const { app, page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        const loading = globalThis.document.getElementById("loading");
        if (!canvas || !loading) throw new Error("the renderer shell is missing");
        loading.classList.add("gone");
        // This test owns Chromium's real permission boundary. Cursor-mode
        // gating is covered below with a controlled readout, so leave that
        // optional readout unavailable and exercise the immediate fallback.
        window.gwCursorState = () => null;
        canvas.focus();
      });
      const canvas = page.locator("#canvas");
      const box = await boxOf(canvas);
      await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) throw new Error("game window is missing");
        if (!win.isFocused()) {
          const focused = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              win.removeListener("focus", onFocus);
              reject(new Error("game window did not receive focus"));
            }, 5_000);
            const onFocus = () => {
              clearTimeout(timeout);
              resolve();
            };
            win.once("focus", onFocus);
          });
          win.show();
          electronApp.focus({ steal: true });
          win.focus();
          await focused;
        }
      });
      await canvas.focus();
      await expect.poll(() => page.evaluate(() => ({
        active: document.activeElement?.id,
        focused: document.hasFocus(),
      }))).toEqual({ active: "canvas", focused: true });
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
    const fixture = await launchCameraClient("gw-pointer-edge-e2e-");
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
    const fixture = await launchCameraClient("gw-pointer-roam-e2e-");
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
    const fixture = await launchCameraClient("gw-pointer-release-e2e-");
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

  // The client separates right-click's two modes itself: entering mouse-look
  // hides its cursor within a tick, a map/UI pan never does (measured
  // 2026-08-03). These two tests pin the lock gate on that readout.
  const watchLockRequests = async (page: Page, hidden: boolean) => {
    await page.evaluate((cursorHidden) => {
      const canvas = globalThis.document.getElementById("canvas");
      const loading = globalThis.document.getElementById("loading");
      if (!canvas || !loading) throw new Error("the renderer shell is missing");
      loading.classList.add("gone");
      const testWindow = window as CameraInputWindow;
      testWindow.__lockRequests = 0;
      testWindow.__cursorHidden = cursorHidden;
      (canvas as HTMLCanvasElement).requestPointerLock = () => {
        testWindow.__lockRequests += 1;
        return Promise.resolve();
      };
      testWindow.gwCursorState = () => Object.freeze({
        generation: 1,
        pixelHash: 1,
        hidden: testWindow.__cursorHidden,
        valid: true,
        cssLength: 0,
      });
      canvas.focus();
    }, hidden);
  };

  test("keeps a right-drag unlocked while the client cursor stays visible", async () => {
    const fixture = await launchCameraClient("gw-pointer-map-pan-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await watchLockRequests(page, false);
      const box = await boxOf(page.locator("#canvas"));
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
      // Long enough for several mode-watch samples to have asked the client.
      await page.waitForTimeout(300);
      await page.mouse.move(box.x + 60, box.y + 100);
      await page.mouse.up({ button: "right" });
      expect(
        await page.evaluate(
          () => (window as CameraInputWindow).__lockRequests,
        ),
      ).toBe(0);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("locks the pointer once the client hides its cursor", async () => {
    const fixture = await launchCameraClient("gw-pointer-mouselook-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await watchLockRequests(page, false);
      const box = await boxOf(page.locator("#canvas"));
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(
          () => (window as CameraInputWindow).__lockRequests,
        ),
      ).toBe(0);
      // The client enters mouse-look a tick after the press; the held drag's
      // mode watch must escalate to the lock on its own.
      await page.evaluate(() => {
        (window as CameraInputWindow).__cursorHidden = true;
      });
      await expect
        .poll(
          () =>
            page.evaluate(() => (window as CameraInputWindow).__lockRequests),
          // The mode watch samples every 50 ms, but a loaded machine running
          // the whole suite can throttle background timers well past that.
          { timeout: 15_000 },
        )
        .toBe(1);
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("releases only held mouse buttons when pointer lock is lost", async () => {
    const fixture = await launchCameraClient("gw-pointer-loss-e2e-");
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
            testWindow.__inputReleases.push(
              `mouse:${event.button}:buttons=${event.buttons}`,
            );
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
      await page.mouse.down({ button: "left" });
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
      ).toEqual(["mouse:2:buttons=1"]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "right" });
      await page.mouse.up({ button: "left" });
    } finally {
      await closeOffline(fixture);
    }
  });
});
