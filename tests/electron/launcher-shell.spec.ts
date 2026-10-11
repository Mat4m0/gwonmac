import { expect, test } from "@playwright/test";
import { closeOffline, launchOffline, openSettings } from "./fixtures.mjs";

test("the Vue launcher owns a narrow frozen bridge and offline subtree", async () => {
  const fixture = await launchOffline("gw-vue-launcher-security-", {
    GW_TEST_RETURN_LAUNCHER: "1",
  });
  try {
    await expect(fixture.page).toHaveURL("gw://app/launcher/index.html");
    await expect(fixture.page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    const boundary = await fixture.page.evaluate(() => ({
      gameBridge: typeof (window as Window & { gwNative?: unknown }).gwNative,
      launcherKeys: Object.keys(window.launcherNative).sort(),
      rootFrozen: Object.isFrozen(window.launcherNative),
      namespacesFrozen: Object.values(window.launcherNative).every(Object.isFrozen),
      nodeRequire: typeof (globalThis as typeof globalThis & { require?: unknown }).require,
      nodeProcess: typeof (globalThis as typeof globalThis & { process?: unknown }).process,
    }));
    expect(boundary).toEqual({
      gameBridge: "undefined",
      launcherKeys: [
        "experience",
        "external",
        "navigation",
        "news",
        "profiles",
        "settings",
        "state",
        "updates",
      ],
      rootFrozen: true,
      namespacesFrozen: true,
      nodeRequire: "undefined",
      nodeProcess: "undefined",
    });
    // The Settings window owns the writes; it has its own frozen bridge and no account access.
    const settings = await openSettings(fixture);
    expect(await settings.evaluate(() => ({
      gameBridge: typeof (window as Window & { gwNative?: unknown }).gwNative,
      launcherBridge: typeof (window as Window & { launcherNative?: unknown }).launcherNative,
      settingsKeys: Object.keys(window.settingsNative).sort(),
      rootFrozen: Object.isFrozen(window.settingsNative),
      namespacesFrozen: Object.values(window.settingsNative).every(Object.isFrozen),
      nodeRequire: typeof (globalThis as typeof globalThis & { require?: unknown }).require,
      nodeProcess: typeof (globalThis as typeof globalThis & { process?: unknown }).process,
    }))).toEqual({
      gameBridge: "undefined",
      launcherBridge: "undefined",
      settingsKeys: [
        "experience", "external", "gameFiles", "settings", "state", "target", "texturePacks", "tools", "updates",
      ],
      rootFrozen: true,
      namespacesFrozen: true,
      nodeRequire: "undefined",
      nodeProcess: "undefined",
    });
    if (await fixture.page.getByRole("button", { name: "Continue" }).isVisible()) {
      await fixture.page.getByRole("button", { name: "Continue" }).click();
      await fixture.page.getByRole("button", { name: "Not now" }).click();
    }
  } finally {
    await closeOffline(fixture);
  }
});
