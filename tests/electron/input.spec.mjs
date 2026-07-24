import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

async function startGameInput(page) {
  const canvas = page.locator("#canvas");
  const quickStart = page.locator("#data-choice-quick");
  await expect
    .poll(
      async () =>
        (await canvas.getAttribute("data-input-ready")) === "true" ||
        (await quickStart.isVisible()),
    )
    .toBe(true);
  if (await quickStart.isVisible()) await quickStart.click();
  await expect(canvas).toHaveAttribute("data-input-ready", "true");
}

test.describe("renderer input", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("releases held input and cancels synthetic touches", async () => {
    const fixture = await launchOffline("gw-input-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        globalThis.document.getElementById("loading").classList.add("gone");
        window.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            window.__inputReleases.push(
              `key:${event.code}:${event.keyCode}:${event.which}`,
            );
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            window.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        canvas.focus();
      });

      await page.keyboard.down("w");
      const canvasBox = await page.locator("#canvas").boundingBox();
      await page.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
      await page.mouse.down({ button: "left" });
      await page.evaluate(() =>
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset")),
      );
      expect(await page.evaluate(() => window.__inputReleases)).toEqual([
        "key:KeyW:87:87",
        "mouse:0",
      ]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "left" });

      const touchEvents = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        const events = [];
        for (const type of ["touchstart", "touchend", "touchcancel"]) {
          canvas.addEventListener(type, () => events.push(type));
        }
        const mouse = (type, detail = 0) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 100,
              clientY: 100,
              detail,
            }),
          );
        const applyTouchMode = async (touchMode) => {
          const settings = await window.gwNative.settings.set({ touchMode });
          window.gwApplySettings(settings);
        };

        await applyTouchMode("translate");
        mouse("mousedown");
        window.dispatchEvent(new globalThis.CustomEvent("gw:input-reset"));
        await applyTouchMode("dbltap");
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
        "touchstart",
        "touchcancel",
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
        const observed = [];
        for (const type of ["touchstart", "touchend", "touchcancel"]) {
          canvas.addEventListener(type, (event) => {
            observed.push({
              type,
              identifier: event.changedTouches[0].identifier,
            });
          });
        }
        const mouse = (type, detail) =>
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
        await new Promise((resolve) => setTimeout(resolve, 180));
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

  test("cancels an active synthetic tap before a rapid follow-up click", async () => {
    const fixture = await launchOffline("gw-double-click-cancel-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      const result = await page.evaluate(async () => {
        const canvas = globalThis.document.getElementById("canvas");
        const observed = [];
        for (const type of ["touchstart", "touchend", "touchcancel"]) {
          canvas.addEventListener(type, () => observed.push(type));
        }
        const mouse = (type, detail) =>
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
        const observed = [];
        window.addEventListener(
          "wheel",
          (event) => {
            if (
              !event.isTrusted &&
              event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
            ) {
              observed.push(event.deltaY);
            }
          },
          true,
        );
        const pixel = (deltaY) =>
          canvas.dispatchEvent(
            new globalThis.WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              deltaMode: globalThis.WheelEvent.DOM_DELTA_PIXEL,
            }),
          );
        const line = (deltaY) =>
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
        afterDiscrete: [-1],
        complete: [-1, 3],
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("allows pointer lock only for the owned game canvas", async () => {
    const fixture = await launchOffline("gw-pointer-permission-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        globalThis.document.getElementById("loading").classList.add("gone");
        globalThis.document.getElementById("canvas").focus();
      });
      const canvas = page.locator("#canvas");
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down({ button: "right" });
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

  test("releases held keys and buttons when pointer lock is lost", async () => {
    const fixture = await launchOffline("gw-pointer-loss-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        globalThis.document.getElementById("loading").classList.add("gone");
        window.__inputReleases = [];
        window.addEventListener("keyup", (event) => {
          if (!event.isTrusted) {
            window.__inputReleases.push(
              `key:${event.code}:${event.keyCode}:${event.which}`,
            );
          }
        });
        window.addEventListener("mouseup", (event) => {
          if (!event.isTrusted) {
            window.__inputReleases.push(`mouse:${event.button}`);
          }
        });
        Object.defineProperty(globalThis.document, "pointerLockElement", {
          configurable: true,
          value: canvas,
        });
        canvas.requestPointerLock = () => Promise.resolve();
        canvas.focus();
      });
      const box = await page.locator("#canvas").boundingBox();
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
      expect(await page.evaluate(() => window.__inputReleases)).toEqual([
        "key:KeyW:87:87",
        "mouse:2",
      ]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });
});
