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
        init: { ...window.gwNative.init },
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
        // Launch configuration is not in the URL any more; renderer-trust
        // accepts no query string at all.
        search: "",
        // The game cursor ships on, so a default launch asks for it here.
        init: {
          toolboxAutomation: false,
          nativeCursor: true,
          templateFsTrace: false,
        },
        toolboxPresent: false,
        keys: [
          "app",
          "cache",
          "client",
          "commands",
          "credentials",
          "diagnostics",
          "dns",
          "gameStorage",
          "init",
          "progress",
          "releaseNotice",
          "settings",
          "snapshot",
          "sockets",
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

  // P5.18. This was fourteen regular expressions over src/main/window.ts,
  // src/main/ipc.ts and src/main/protocol.ts in the release suite — a test that
  // proved those files contained certain characters. Eleven of them are asked
  // of the running application here instead: the preferences Chromium actually
  // applied, the guard actually attached, the policy actually served, and a
  // permission actually refused.
  //
  // The three that are not here have no honest form at this boundary and are
  // named in tests/policy/source-main-process-security-guards.test.mjs.
  test("the security posture holds on the real window, not only in the source", async () => {
    const fixture = await launchOffline("gw-security-posture-e2e-");
    try {
      const applied = await fixture.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const preferences = win.webContents.getLastWebPreferences();
        return {
          nodeIntegration: preferences.nodeIntegration,
          contextIsolation: preferences.contextIsolation,
          sandbox: preferences.sandbox,
          webSecurity: preferences.webSecurity,
          webviewTag: preferences.webviewTag,
          allowRunningInsecureContent: preferences.allowRunningInsecureContent,
          experimentalFeatures: preferences.experimentalFeatures,
          // Defence in depth behind `webviewTag: false`: even a build that
          // turned the tag back on would not get a guest attached.
          webviewGuards: win.webContents.listenerCount("will-attach-webview"),
        };
      });
      expect(applied).toEqual({
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewGuards: 1,
      });

      // The policy the renderer is actually served, read out of the response
      // its own protocol handler produced.
      const csp = await fixture.page.evaluate(async () => {
        const response = await window.fetch(globalThis.location.href);
        return response.headers.get("content-security-policy");
      });
      for (const directive of [
        "frame-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "base-uri 'none'",
      ]) {
        expect(csp).toContain(directive);
      }

      // The permission handler answers `false` to everything that is not
      // pointer lock for this window's own canonical document. The granting
      // half is executed against a real lock in tests/electron/input.spec.mjs,
      // *allows pointer lock only for the owned game canvas*; what a launcher
      // page can show is the refusal.
      const notifications = await fixture.page.evaluate(() =>
        window.Notification.requestPermission(),
      );
      expect(notifications).toBe("denied");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("accepts explicit automation without adding production Toolbox UI", async () => {
    const fixture = await launchOffline("gw-toolbox-developer-e2e-", {
      GW_TOOLBOX_AUTOMATION: "1",
    });
    try {
      expect(new URL(fixture.page.url()).search).toBe("");
      expect(
        await fixture.page.evaluate(() => ({ ...window.gwNative.init })),
      ).toEqual({
        toolboxAutomation: true,
        nativeCursor: true,
        templateFsTrace: false,
      });
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
      expect(new URL(fixture.page.url()).search).toBe("");
      expect(
        await fixture.page.evaluate(() => ({ ...window.gwNative.init })),
      ).toEqual({
        toolboxAutomation: false,
        nativeCursor: true,
        templateFsTrace: true,
      });
      await expect(fixture.page.locator("#toolbox")).toHaveCount(0);
    } finally {
      await closeOffline(fixture);
    }
  });
});
