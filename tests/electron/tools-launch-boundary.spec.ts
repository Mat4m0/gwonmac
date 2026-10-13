/** Core omits Maps transports; live Tools disablement denies real IPC work. */
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";

for (const tools of [false, true]) {
  test(`${tools ? "Tools" : "Core"} launch enforces Maps transport ownership`, async () => {
    const fixture = await launchOffline("gw-tools-boundary-", {}, async (userData) => {
      await writeFile(path.join(userData, "settings.json"), JSON.stringify({
        gwonmacTools: tools, cartographyEnabled: true,
      }), { mode: 0o600 });
    });
    try {
      const { app, page } = fixture;
      expect(await page.evaluate(() => "cartography" in window.gwNative)).toBe(tools);
      if (!tools) return;
      const launcher = app.windows().find(window => window.url().endsWith("launcher/index.html"));
      if (!launcher) throw new Error("launcher is required");
      const read = () => page.evaluate(async () => {
        const api = window.gwNative;
        if (!("cartography" in api)) throw new Error("Maps transport is missing");
        return api.cartography.getMapKnowledge("a".repeat(64));
      });
      const record = () => page.evaluate(async () => {
        const api = window.gwNative;
        if (!("cartography" in api)) throw new Error("Maps transport is missing");
        return api.cartography.recordMapKnowledge({
          kernelSha256: "a".repeat(64), mapId: 1, continent: 0,
          width: 1, height: 1, revealRadius: 1, words: [1],
        });
      });
      expect(await read()).toEqual([]);
      await launcher.evaluate(() => window.launcherNative.tools.setFeature({ tool: "maps", enabled: false }));
      await expect(read()).rejects.toThrow(/Maps is disabled/);
      await expect(record()).rejects.toThrow(/Maps is disabled/);
      await launcher.evaluate(() => window.launcherNative.tools.setFeature({ tool: "maps", enabled: true }));
      expect(await read()).toEqual([]);
      await launcher.evaluate(() => window.launcherNative.tools.setMasterEnabled(false));
      await expect(read()).rejects.toThrow(/Maps is disabled/);
      await expect(record()).rejects.toThrow(/Maps is disabled/);
      expect(await page.evaluate(() => "cartography" in window.gwNative)).toBe(true);
    } finally {
      await closeOffline(fixture);
    }
  });
}
