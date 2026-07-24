import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { closeOffline, launchOffline, main } from "./fixtures.mjs";

test.describe("sandbox boundary", () => {
  test.skip(!existsSync(main), "run tsc + copy-renderer before electron tests");

  test("exposes only the frozen application capabilities", async () => {
    const fixture = await launchOffline("gw-sandbox-e2e-");
    try {
      const boundary = await fixture.page.evaluate(() => ({
        protocol: globalThis.location.protocol,
        keys: Object.keys(window.gwNative).sort(),
        nativeFrozen: Object.isFrozen(window.gwNative),
        requireType: typeof window.require,
        processType: typeof window.process,
      }));
      expect(boundary).toEqual({
        protocol: "gw:",
        keys: [
          "app",
          "cache",
          "client",
          "credentials",
          "diagnostics",
          "dns",
          "gameStorage",
          "progress",
          "settings",
          "snapshot",
          "sockets",
          "update",
        ],
        nativeFrozen: true,
        requireType: "undefined",
        processType: "undefined",
      });
      expect(
        await fixture.app.evaluate(({ app }) =>
          app.commandLine.hasSwitch("use-mock-keychain"),
        ),
      ).toBe(true);
      const snapshotResponse = await fixture.page.evaluate(async () => {
        const response = await window.fetch("Gw.snapshot", {
          headers: { Range: "bytes=0-0" },
        });
        return {
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
        };
      });
      expect(snapshotResponse).toEqual({
        status: 503,
        cacheControl: "no-store",
      });
    } finally {
      await closeOffline(fixture);
    }
  });
});
