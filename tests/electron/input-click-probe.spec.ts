import { expect, test } from "@playwright/test";
import {
  installInputClickProbe,
  type BrowserInputClickProbe,
} from "../../scripts/enhancements-live/input-click-probe.js";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { boxOf, startGameInput } from "./input-helpers.js";

type InputProbeWindow = typeof window & {
  __gwInputClickProbe?: BrowserInputClickProbe;
};

test.describe("renderer input probe", () => {
  test("distinguishes mouse pass-through from touch translation", async () => {
    const fixture = await launchOffline("gw-input-click-probe-e2e-");
    try {
      const { page } = fixture;
      await startGameInput(page);
      await page.evaluate(installInputClickProbe);
      await page.evaluate(() => {
        globalThis.document.getElementById("loading")?.classList.add("gone");
      });
      const box = await boxOf(page.locator("#canvas"));
      const run = async (mode: "off" | "translate") => {
        await page.evaluate(async (selected) => {
          const settings = await window.gwNative.settings.get();
          window.gwApplySettings?.({ ...settings, touchMode: selected });
          const probe = (window as InputProbeWindow).__gwInputClickProbe;
          if (!probe) throw new Error("input click probe is missing");
          probe.begin(selected, selected, false);
        }, mode);
        await page.mouse.click(box.x + 100, box.y + 100);
        return page.evaluate(() => {
          const probe = (window as InputProbeWindow).__gwInputClickProbe;
          if (!probe) throw new Error("input click probe is missing");
          return probe.finish();
        });
      };

      const mouse = await run("off");
      const translated = await run("translate");
      expect(mouse?.stats).toMatchObject({
        trustedMouseDown: 1,
        trustedMouseUp: 1,
        trustedDownOnCanvas: 1,
        trustedDownOverCanvas: 1,
        canvasCaptureMouseDown: 1,
        syntheticTouchStart: 0,
      });
      expect(translated?.stats).toMatchObject({
        trustedMouseDown: 1,
        trustedMouseUp: 1,
        trustedDownOnCanvas: 1,
        trustedDownOverCanvas: 1,
        canvasCaptureMouseDown: 0,
        syntheticTouchStart: 1,
        syntheticTouchEnd: 1,
      });
    } finally {
      await closeOffline(fixture);
    }
  });
});
