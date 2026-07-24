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
            window.__inputReleases.push(`key:${event.code}`);
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
        "key:KeyW",
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
        const mouse = (type) =>
          canvas.dispatchEvent(
            new globalThis.MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 100,
              clientY: 100,
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
        mouse("mousedown");
        mouse("mouseup");
        mouse("mousedown");
        mouse("mouseup");
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

  test("accumulates trackpad pixels without changing discrete wheel input", async () => {
    const fixture = await launchOffline("gw-wheel-e2e-");
    try {
      await startGameInput(fixture.page);
      const steps = await fixture.page.evaluate(() => {
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
        for (const deltaY of [60, 60]) {
          canvas.dispatchEvent(
            new globalThis.WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY,
              deltaMode: globalThis.WheelEvent.DOM_DELTA_PIXEL,
            }),
          );
        }
        canvas.dispatchEvent(
          new globalThis.WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: -1,
            deltaMode: globalThis.WheelEvent.DOM_DELTA_LINE,
          }),
        );
        return observed;
      });
      expect(steps).toEqual([1, -1]);
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
            window.__inputReleases.push(`key:${event.code}`);
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
        "key:KeyW",
        "mouse:2",
      ]);
      await page.keyboard.up("w");
      await page.mouse.up({ button: "right" });
    } finally {
      await closeOffline(fixture);
    }
  });
});
