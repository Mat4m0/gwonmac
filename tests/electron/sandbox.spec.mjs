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
        search: globalThis.location.search,
        toolboxPresent: globalThis.document.getElementById("toolbox") !== null,
        keys: Object.keys(window.gwNative).sort(),
        nativeFrozen: Object.isFrozen(window.gwNative),
        namespacesFrozen: Object.values(window.gwNative).every(Object.isFrozen),
        diagnosticsKeys: Object.keys(window.gwNative.diagnostics).sort(),
        requireType: typeof window.require,
        processType: typeof window.process,
      }));
      expect(boundary).toEqual({
        protocol: "gw:",
        // The game cursor ships on, so a default launch carries the parameter
        // renderer-trust allow-lists for it — and nothing else.
        search: "?native-cursor=1",
        toolboxPresent: false,
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
        namespacesFrozen: true,
        diagnosticsKeys: [
          "clockSync",
          "current",
          "recordClockOffset",
          "recordGraphics",
          "recordRendererFrames",
          "recordRendererMetrics",
          "recordRendererMilestone",
        ],
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

      await fixture.page.evaluate(() => {
        globalThis.location.assign("gw://app/account/login");
      });
      await fixture.page.waitForTimeout(100);
      expect(new URL(fixture.page.url()).pathname).toBe("/");

      const oversizedSocketError = await fixture.page.evaluate(async () => {
        try {
          await window.gwNative.sockets.send(
            1,
            new Uint8Array(4 * 1024 * 1024 + 1),
          );
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      });
      expect(oversizedSocketError).toContain("invalid socket payload");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("accepts explicit automation without adding production Toolbox UI", async () => {
    const fixture = await launchOffline("gw-toolbox-developer-e2e-", {
      GW_TOOLBOX_AUTOMATION: "1",
    });
    try {
      expect(new URL(fixture.page.url()).search).toBe(
        "?toolbox-automation=1&native-cursor=1",
      );
      await expect(fixture.page.locator("#toolbox")).toHaveCount(0);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("passes an explicit template filesystem trace request to the renderer", async () => {
    const fixture = await launchOffline("gw-template-fs-trace-e2e-", {
      GW_TEMPLATE_FS_TRACE: "1",
    });
    try {
      expect(new URL(fixture.page.url()).search).toBe(
        "?native-cursor=1&template-fs-trace=1",
      );
      await expect(fixture.page.locator("#toolbox")).toHaveCount(0);
    } finally {
      await closeOffline(fixture);
    }
  });
});
