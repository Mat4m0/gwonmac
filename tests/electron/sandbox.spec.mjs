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
    } finally {
      await closeOffline(fixture);
    }
  });
});
