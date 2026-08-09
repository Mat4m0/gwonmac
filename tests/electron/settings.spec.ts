import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  OFFICIAL_WASM,
  seedCachedClient,
} from "../helpers/packaged-enhancement-fixture.js";
import {
  closeOffline,
  launchOffline,
  launchOfflineAt,
  type OfflineFixture,
} from "./fixtures.mjs";

const packageVersion = (
  JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
    version: string;
  }
).version;

declare global {
  // The main-process probe that records what the reset dialog was asked and
  // whether the app quit and relaunched. It exists only while this spec runs.
  var __resetRestart: {
    quit: boolean;
    relaunch: boolean;
    options: Electron.MessageBoxOptions | null;
    originalQuit: Electron.App["quit"];
    originalRelaunch: Electron.App["relaunch"];
  };
  var __updateInstallCalls: number;
}

test.describe("settings experience", () => {
  test("shows requested and effective memory modes without blocking an unsupported launch", async () => {
    let relaunched: OfflineFixture | null = null;
    const fixture = await launchOffline(
      "gw-settings-memory-e2e-",
      { GW_OFFLINE_SHELL: "0", GW_REQUIRE_CACHED_CLIENT: "1" },
      async (userData) => {
        const artifacts = path.join(userData, "game", "artifacts");
        await mkdir(artifacts, { recursive: true });
        await writeFile(path.join(artifacts, "Gw.jspi.wasm"), OFFICIAL_WASM);
        await seedCachedClient({ artifacts, userData });
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            autoCheckUpdates: false,
            extendedMemoryEnabled: true,
            dataStrategy: "quick",
          }),
        );
      },
    );
    try {
      const { page } = fixture;
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.client.session()).extendedMemory,
      )).toMatchObject({
        requestedAtLaunch: true,
        status: "unavailable",
        effectiveCapBytes: 2_147_483_648,
      });

      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-advanced").click();
      await expect(page.locator('input[name="extendedMemoryEnabled"]')).toBeChecked();
      await expect(page.locator("#settings-memory-badge")).toHaveText(
        "Unavailable for this Guild Wars update",
      );
      await expect(page.locator("#settings-memory-status")).toContainText(
        "Guild Wars started normally with 2 GB",
      );

      await page.locator('input[name="extendedMemoryEnabled"]').click();
      await expect(page.locator("#settings-memory-badge")).toHaveText(
        "Restart required",
      );
      await expect(page.locator("#settings-memory-status")).toContainText(
        "This session is still using 2 GB",
      );
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).extendedMemoryEnabled,
      )).toBe(false);
      await fixture.app.close();
      relaunched = await launchOfflineAt(fixture.userData, {
        GW_OFFLINE_SHELL: "0",
        GW_REQUIRE_CACHED_CLIENT: "1",
      });
      await expect.poll(() => relaunched!.page.evaluate(async () =>
        (await window.gwNative.client.session()).extendedMemory,
      )).toEqual({
        requestedAtLaunch: false,
        status: "standard",
        effectiveCapBytes: 2_147_483_648,
        fallbackReason: null,
      });
    } finally {
      await closeOffline(relaunched ?? fixture);
    }
  });

  // P5.1: the menu item used to run a string of JavaScript in the renderer.
  // It now sends a typed command, and this is the only caller of `settings.open`
  // — every other spec dispatches the renderer event directly, which would keep
  // passing if the main-process half were removed entirely.
  test("the application menu opens Settings and the dedicated Updates pane", async () => {
    const fixture = await launchOffline("gw-settings-menu-e2e-");
    try {
      const { app, page } = fixture;
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute(
        "open",
        "",
      );
      expect(
        await app.evaluate(({ Menu }) => {
          const item = Menu.getApplicationMenu()
            ?.items[0]?.submenu?.items.find(
              (candidate) => candidate.label === "Settings…",
            );
          item?.click();
          return item?.accelerator;
        }),
      ).toBe("CmdOrCtrl+,");
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-done").click();
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find(
            (candidate) => candidate.label === "Check for Updates…",
          )
          ?.click();
      });
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(page.locator(".settings-panes")).toHaveAttribute(
        "data-active",
        "updates",
      );
      await expect(page.locator("#settings-pane-updates")).toContainText(
        "Automatically check for and download app updates",
      );
      await expect(page.locator("#settings-update-version")).toHaveText(
        packageVersion,
      );
      // The label follows the running version's shape, so this test holds on
      // both sides of a stable release.
      await expect(page.locator("#settings-update-channel")).toHaveText(
        /^\d+\.\d+\.\d+$/u.test(packageVersion) ? "Stable" : "Preview",
      );
      await expect(page.locator("#settings-update-status")).toContainText(
        "can't update itself",
      );
      await expect(page.locator("#settings-restart-update")).toBeHidden();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("a ready update flushes IDBFS before installing", async () => {
    const fixture = await launchOffline(
      "gw-update-restart-e2e-",
      { GW_TEST_DISTRIBUTION_CHANNEL: "release" },
      async (userData) => {
        // Update-capable build: the default launch check would reach the real
        // GitHub before the stub below installs, so this profile opts out and
        // the test drives every check itself.
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ autoCheckUpdates: false }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      await app.evaluate(({ autoUpdater }) => {
        globalThis.__updateInstallCalls = 0;
        const version = "9999.1.0";
        const tag = `v${version}`;
        const zip = `Guild-Wars-Reforged-${version}-macOS-arm64.zip`;
        const base =
          `https://github.com/Mat4m0/gwonmac/releases/download/${tag}`;
        globalThis.fetch = async (input) => {
          const url = String(input);
          return new Response(JSON.stringify(
            url.includes("api.github.com")
              ? [{
                  tag_name: tag,
                  draft: false,
                  // A stable offer is the one shape every install accepts: a
                  // preview may advance to stable, while a stable install is
                  // never offered a preview — so a preview fixture would be
                  // refused the day the app version loses its suffix.
                  prerelease: false,
                  assets: [
                    {
                      name: "RELEASES.json",
                      browser_download_url: `${base}/RELEASES.json`,
                    },
                    {
                      name: zip,
                      browser_download_url: `${base}/${zip}`,
                    },
                  ],
                }]
              : {
                  url: `${base}/${zip}`,
                  name: `Guild Wars Reforged v${version}`,
                  version,
                  tag,
                  pub_date: "2026-07-30T00:00:00.000Z",
                  notes: "",
                },
          ), { status: 200 });
        };
        autoUpdater.setFeedURL = () => undefined;
        autoUpdater.checkForUpdates = () => {
          queueMicrotask(() => autoUpdater.emit("update-downloaded"));
        };
        autoUpdater.quitAndInstall = () => {
          globalThis.__updateInstallCalls += 1;
        };
      });
      await page.evaluate(() => {
        window.Module ??= {};
        window.Module.FS = {
          syncfs: (_populate, callback) => {
            document.documentElement.dataset.updateFsSynced = "yes";
            callback();
          },
        };
        globalThis.dispatchEvent(new globalThis.CustomEvent("gw:settings", {
          detail: { pane: "updates" },
        }));
      });
      await expect(page.locator("#settings-update-version")).toHaveText(
        packageVersion,
      );
      await page.locator("#settings-check-updates").click();
      await expect(page.locator("#settings-restart-update")).toBeVisible();
      await page.locator("#settings-restart-update").click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-update-fs-synced"))
        .toBe("yes");
      await expect
        .poll(() => app.evaluate(() => globalThis.__updateInstallCalls))
        .toBe(1);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("panel opacity changes the one interface and survives", async () => {
    const fixture = await launchOffline("gw-settings-appearance-e2e-");
    try {
      const { page } = fixture;
      const root = page.locator("html");
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-tab-display").click();

      await expect(page.locator('input[name="uiPanelOpacity"]')).toHaveValue("94");
      await expect(page.locator('select[name="uiTheme"]')).toHaveCount(0);
      await expect(page.locator('select[name="uiDensity"]')).toHaveCount(0);
      // Polled, not read once: the save is a round trip through main and the
      // token is written when it returns. The slider's own readout updates on
      // the drag and so proves nothing about the setting having landed.
      const expectToken = async (property: string, value: string) => {
        await expect
          .poll(() =>
            root.evaluate(
              (html, name) => html.style.getPropertyValue(name),
              property,
            ),
          )
          .toBe(value);
      };

      await page.locator('input[name="uiPanelOpacity"]').fill("65");
      await page.locator('input[name="uiPanelOpacity"]').dispatchEvent("change");
      await expect(page.locator('output[name="uiPanelOpacityValue"]'))
        .toHaveText("65%");
      await expectToken("--ui-panel-opacity", "0.65");
      await expect(page.locator("#settings-feedback")).toHaveText("Saved.");
      await expect(page.locator("#settings-feedback")).toHaveAttribute(
        "data-tone",
        "success",
      );
      expect(
        await page.locator("#settings-dialog").evaluate((element) =>
          globalThis.getComputedStyle(element)
            .getPropertyValue("--ui-panel-opacity").trim()),
      ).toBe("0.97");

      // Nothing here may reach the game. The canvas is the game's surface, and
      // a presentation setting that resized or restyled it would be exactly the
      // leak `contracts.ts` promises does not exist.
      await expect(page.locator("#settings-feedback")).not.toContainText(
        "could not be saved",
      );

      // Closing and reopening reads the form back from main rather than from
      // whatever the controls happen to still hold.
      await page.locator("#settings-done").click();
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-display").click();
      await expect(page.locator('input[name="uiPanelOpacity"]')).toHaveValue("65");
      await expect(page.locator('output[name="uiPanelOpacityValue"]')).toHaveText("65%");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("explains render cost and keeps required Core visible", async () => {
    const fixture = await launchOffline("gw-settings-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-tab-advanced").click();
      await expect(page.locator('[name="touchMode"]')).toHaveCount(0);
      await expect(page.locator("#settings-pane-advanced")).not.toContainText(
        "Mobile touch compatibility",
      );
      await page.locator("#settings-tab-display").click();
      await expect(
        page.locator('input[name="renderScale"][value="2"]'),
      ).toBeChecked();

      const dimensions = await page.evaluate(() => {
        const canvas = globalThis.document.getElementById("canvas");
        if (!canvas) throw new Error("the game canvas is missing");
        const label = (scale: string) => {
          const element = globalThis.document.querySelector(
            `[data-render-scale="${scale}"]`,
          );
          if (!element) throw new Error(`no label for render scale ${scale}`);
          return element.textContent;
        };
        return {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          one: label("1"),
          oneAndHalf: label("1.5"),
          two: label("2"),
        };
      });
      expect(dimensions.one).toBe(
        `≈ ${dimensions.width} × ${dimensions.height}`,
      );
      expect(dimensions.oneAndHalf).toBe(
        `≈ ${Math.round(dimensions.width * 1.5)} × ` +
          `${Math.round(dimensions.height * 1.5)}`,
      );
      expect(dimensions.two).toBe(
        `≈ ${dimensions.width * 2} × ${dimensions.height * 2}`,
      );
      await expect(page.locator("#settings-pane-display")).toContainText(
        "Choose Balanced or Performance",
      );

      await page.locator('input[name="renderScale"][value="1.5"]').check();
      await fixture.app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()?.items.find(
          (item) => item.label === "View",
        );
        view?.submenu?.items
          .find((item) => item.label === "Toggle Diagnostics")
          ?.click();
      });
      await expect
        .poll(async () =>
          (await page.evaluate(() => window.gwNative.settings.get()))
            .showDiagnostics,
        )
        .toBe(true);
      await page.locator("#settings-tab-controls").click();
      await expect(page.locator("#settings-pane-controls")).toContainText(
        "Core is on for supported Guild Wars builds",
      );
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          renderScale: 1.5,
          showDiagnostics: true,
        });
      // Nothing about the running session's cursor may change.
      expect(
        await page.locator("#canvas").evaluate((canvas) =>
          globalThis.getComputedStyle(canvas).cursor,
        ),
      ).toBe("auto");

      await page.locator("#settings-done").click();
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await expect(page.locator(".settings-panes")).toHaveAttribute(
        "data-active",
        "controls",
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("labels required Core honestly and ships the cursor on", async () => {
    const fixture = await launchOffline("gw-cursor-default-e2e-");
    try {
      const { page } = fixture;
      expect(
        await page.evaluate(async () =>
          "nativeCursor" in await window.gwNative.settings.get()),
      ).toBe(false);
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      await expect(page.locator('input[name="nativeCursor"]')).toHaveCount(0);

      const controls = page.locator("#settings-pane-controls");
      await expect(controls).toContainText("Core is on for supported Guild Wars builds");
      await expect(controls).toContainText("native cursor");
      await expect(controls).toContainText("required and stay on");
      await expect(controls).toContainText("Optional tools stay off in PvP");
      await expect(page.locator('input[name="gwonmacTools"]')).not.toBeChecked();
      await expect(page.locator('input[name="teamManagement"]')).toBeDisabled();
      await expect(page.locator('input[name="targetReadout"]')).toBeDisabled();
      // Loading the Enhancement does not paint a cursor by itself: the game must
      // publish one first, and this launcher has no game.
      expect(
        await page.locator("#canvas").evaluate((canvas) =>
          globalThis.getComputedStyle(canvas).cursor,
        ),
      ).toBe("auto");
      // The default reaches the renderer through the same init payload an
      // explicit opt-in does, not around it.
      expect(
        await page.evaluate(
          () => window.gwNative.init.enhancementSelection.nativeCursor,
        ),
      ).toBe(true);
      // Launch capability and persisted product preferences are separate.
      expect(
        await page.evaluate(() =>
          Object.keys(window.gwNative.init.enhancementSelection).map((name) => {
            const id = name.replace(/[A-Z]/gu, (letter) =>
              `-${letter.toLowerCase()}`);
            return {
              name,
              settings: !!globalThis.document.querySelector(
                `input[name="${name}"]`,
              ),
              launcher: !!globalThis.document.getElementById(
                `data-choice-${id}`,
              ),
            };
          }),
        ),
      ).toEqual([
        { name: "nativeCursor", settings: false, launcher: false },
        { name: "tools", settings: false, launcher: false },
      ]);
    } finally {
      await closeOffline(fixture);
    }
  });

  test("the first Tools enable can be declined, then saves and restarts atomically", async () => {
    const fixture = await launchOffline("gw-tools-enable-restart-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await page.locator('input[name="gwonmacTools"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Optional Tools were not changed. Your current setup is still active.",
      );
      await expect(page.locator("#settings-feedback")).toHaveAttribute(
        "data-tone",
        "warning",
      );
      await expect(page.locator('input[name="gwonmacTools"]')).not.toBeChecked();
      expect(await page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ gwonmacTools: false });

      await app.evaluate(({ app: electronApp, dialog }) => {
        globalThis.__resetRestart = {
          quit: false,
          relaunch: false,
          options: null,
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        const record = async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ): Promise<Electron.MessageBoxReturnValue> => {
          globalThis.__resetRestart.options = options;
          return { response: 0, checkboxChecked: false };
        };
        dialog.showMessageBox = record as typeof dialog.showMessageBox;
        electronApp.relaunch = () => {
          globalThis.__resetRestart.relaunch = true;
        };
        electronApp.quit = () => {
          globalThis.__resetRestart.quit = true;
        };
      });

      await page.locator('input[name="gwonmacTools"]').click();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).gwonmacTools)).toBe(true);
      expect(await app.evaluate(() => {
        const { quit, relaunch, options } = globalThis.__resetRestart;
        if (!options) throw new Error("no message box was shown");
        return { quit, relaunch, buttons: options.buttons };
      })).toEqual({
        quit: true,
        relaunch: true,
        buttons: ["Enable and Restart", "Cancel"],
      });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__resetRestart.originalQuit;
        electronApp.relaunch = globalThis.__resetRestart.originalRelaunch;
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("reset ignores the retired cursor preference and does not restart", async () => {
    const fixture = await launchOffline(
      "gw-settings-reset-restart-e2e-",
      {},
      (userData) =>
        writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ formatVersion: 1, nativeCursor: false }),
        ),
    );
    try {
      const { app, page } = fixture;
      expect(await page.evaluate(async () =>
        "nativeCursor" in await window.gwNative.settings.get())).toBe(false);
      await app.evaluate(({ app: electronApp, dialog }) => {
        globalThis.__resetRestart = {
          quit: false,
          relaunch: false,
          options: null,
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        // Electron declares `showMessageBox` as two overloads and the app calls
        // the window+options one; a stub written for that form is not assignable
        // to the options-only signature, so the replacement is stated once.
        const record = async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ): Promise<Electron.MessageBoxReturnValue> => {
          globalThis.__resetRestart.options = options;
          return { response: 0, checkboxChecked: false };
        };
        dialog.showMessageBox = record as typeof dialog.showMessageBox;
        electronApp.relaunch = () => {
          globalThis.__resetRestart.relaunch = true;
        };
        electronApp.quit = () => {
          globalThis.__resetRestart.quit = true;
        };
      });

      const reset = await page.evaluate(() => window.gwNative.settings.reset());
      expect(reset).toMatchObject({ renderScale: 2 });
      expect(
        await app.evaluate(() => {
          const { quit, relaunch, options } = globalThis.__resetRestart;
          if (!options) throw new Error("no message box was shown");
          return { quit, relaunch, buttons: options.buttons };
        }),
      ).toEqual({
        quit: false,
        relaunch: false,
        buttons: ["Reset GWonMac Settings", "Cancel"],
      });
      expect(await page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ renderScale: 2 });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__resetRestart.originalQuit;
        electronApp.relaunch = globalThis.__resetRestart.originalRelaunch;
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps a committed settings reset when window-state reset fails", async () => {
    const fixture = await launchOffline("gw-settings-reset-window-failure-e2e-");
    try {
      const { app, page, userData } = fixture;
      await page.evaluate(() =>
        window.gwNative.settings.set({ showDiagnostics: true }),
      );
      const windowState = path.join(userData, "window-state.json");
      await rm(windowState, { recursive: true, force: true });
      // Atomic rename cannot replace a directory with the window-state file,
      // deterministically exercising the independent document's failure.
      await mkdir(windowState);
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 0,
          checkboxChecked: false,
        });
      });

      const reset = await page.evaluate(() => window.gwNative.settings.reset());
      expect(reset).toMatchObject({
        renderScale: 2,
        showDiagnostics: false,
      });
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        renderScale: 2,
        showDiagnostics: false,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("keeps settings keyboard navigation and reduced motion accessible", async () => {
    // toBeFocused() requires document.hasFocus(), so this launch takes focus.
    const fixture = await launchOffline("gw-settings-accessibility-e2e-", {
      GW_BACKGROUND_LAUNCH: "0",
    });
    try {
      const { page } = fixture;
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );

      // The desktop rail is vertical: ArrowDown moves exactly one section.
      // The previous duplicate handlers moved twice and skipped a destination.
      const panes = await page
        .locator(".settings-rail .settings-rtab")
        .evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).dataset.pane));
      const [first, second] = panes;
      expect(second).toBeTruthy();

      const dataTab = page.locator(`#settings-tab-${first}`);
      const nextTab = page.locator(`#settings-tab-${second}`);
      await dataTab.focus();
      await dataTab.press("ArrowDown");
      await expect(nextTab).toBeFocused();
      await expect(nextTab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(`#settings-pane-${second}`)).toBeVisible();
      await expect(page.locator(`#settings-pane-${first}`)).toBeHidden();

      await expect(page.locator(".settings-rail")).toHaveAttribute(
        "aria-orientation",
        "vertical",
      );
      await nextTab.press("ArrowRight");
      await expect(nextTab).toBeFocused();

      const containment = await page.evaluate(() => {
        const dialog = document.querySelector("#settings-dialog")
          ?.getBoundingClientRect();
        const form = document.querySelector("#settings-form")
          ?.getBoundingClientRect();
        const footer = document.querySelector(".settings-footerbar")
          ?.getBoundingClientRect();
        if (!dialog || !form || !footer) throw new Error("settings geometry missing");
        return {
          dialog: { right: dialog.right, bottom: dialog.bottom },
          form: { right: form.right, bottom: form.bottom },
          footer: { right: footer.right, bottom: footer.bottom },
        };
      });
      expect(containment.form.right).toBeLessThanOrEqual(containment.dialog.right);
      expect(containment.form.bottom).toBeLessThanOrEqual(containment.dialog.bottom);
      expect(containment.footer.right).toBeLessThanOrEqual(containment.dialog.right);
      expect(containment.footer.bottom).toBeLessThanOrEqual(containment.dialog.bottom);

      await page.setViewportSize({ width: 320, height: 480 });
      await expect(page.locator(".settings-rail")).toHaveAttribute(
        "aria-orientation",
        "horizontal",
      );
      const compactGeometry = await page.evaluate(() => {
        const dialog = document.querySelector("#settings-dialog")
          ?.getBoundingClientRect();
        const panes = document.querySelector(".settings-panes");
        const rail = document.querySelector(".settings-rail");
        const footer = document.querySelector(".settings-footerbar")
          ?.getBoundingClientRect();
        if (!dialog || !panes || !rail || !footer) {
          throw new Error("compact settings geometry missing");
        }
        return {
          dialog: {
            left: dialog.left,
            top: dialog.top,
            right: dialog.right,
            bottom: dialog.bottom,
          },
          footerBottom: footer.bottom,
          paneWidth: [panes.clientWidth, panes.scrollWidth],
          railWidth: [rail.clientWidth, rail.scrollWidth],
        };
      });
      expect(compactGeometry.dialog.left).toBeGreaterThanOrEqual(0);
      expect(compactGeometry.dialog.top).toBeGreaterThanOrEqual(0);
      expect(compactGeometry.dialog.right).toBeLessThanOrEqual(320);
      expect(compactGeometry.dialog.bottom).toBeLessThanOrEqual(480);
      expect(compactGeometry.footerBottom).toBeLessThanOrEqual(
        compactGeometry.dialog.bottom,
      );
      expect(compactGeometry.paneWidth[1]).toBe(compactGeometry.paneWidth[0]);
      expect(compactGeometry.railWidth[1]).toBe(compactGeometry.railWidth[0]);

      const firstCompactTab = page.locator(`#settings-tab-${first}`);
      await firstCompactTab.focus();
      await firstCompactTab.press("ArrowRight");
      await expect(nextTab).toBeFocused();
      await page.locator("#settings-done").click();
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute(
        "open",
        "",
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("restores canonical presentation when a settings save fails", async () => {
    const fixture = await launchOffline("gw-settings-save-failure-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-advanced").click();
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("gw:settings:set");
        ipcMain.handle("gw:settings:set", () => {
          throw new Error("forced settings write failure");
        });
      });

      await page.locator('input[name="showDiagnostics"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Settings could not be saved. Your previous setting is still active; try again.",
      );
      await expect(page.locator("#settings-feedback")).toHaveAttribute(
        "data-tone",
        "error",
      );
      await expect(page.locator('input[name="showDiagnostics"]')).not.toBeChecked();
      expect(
        await page.evaluate(() => window.gwNative.settings.get()),
      ).toMatchObject({ showDiagnostics: false });
    } finally {
      await closeOffline(fixture);
    }
  });
});
