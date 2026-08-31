import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeTravelPreferencesV1 } from "../../src/main/core/travel-preferences-v1.js";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import "./settings-test-fixture.mjs";

test.describe("data and display settings", () => {
  test("shows the Multiple Accounts setup when its tab is selected", async () => {
    const fixture = await launchOffline("gw-settings-accounts-e2e-");
    try {
      const { page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-accounts").click();

      const pane = page.locator("#settings-pane-accounts");
      await expect(pane).toBeVisible();
      await expect(pane.getByRole("heading", { name: "Multiple Accounts" }))
        .toBeVisible();
      await expect(page.locator("#accounts-first-name")).toHaveCount(0);
      await expect(page.getByRole("group", { name: "Build library" }))
        .toHaveCount(0);
      await expect(page.getByRole("group", { name: "Build templates" }))
        .toHaveCount(0);
      await expect(pane).toContainText("Create and manage every account there");
      await expect(page.locator("#accounts-enable")).toBeVisible();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("display choices apply as intended and survive reopening", async () => {
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
      await expect(
        page.locator('input[name="uiStyle"][value="guild-wars"]'),
      ).toBeChecked();
      await expect(page.locator('select[name="uiFont"]')).toHaveValue("guild-wars");
      await expect(root).not.toHaveAttribute("data-ui-style");
      await expect(root).not.toHaveAttribute("data-ui-font");
      await expect(page.locator('select[name="uiTheme"]')).toHaveCount(0);
      await expect(page.locator('select[name="uiDensity"]')).toHaveCount(0);
      const settingsTypography = await page.locator("#settings-dialog").evaluate(
        (dialog) => {
          const style = globalThis.getComputedStyle(dialog);
          return {
            font: style.fontFamily,
            textShadow: style.textShadow,
            titleWeight: globalThis.getComputedStyle(
              globalThis.document.querySelector("#settings-title")!,
            ).fontWeight,
          };
        },
      );
      // Offline has no active game archive to convert yet, so the selected
      // Guild Wars face resolves to the homepage's packaged QT fallback. The
      // dialog must not replace that global choice with its own font.
      expect(settingsTypography.font).toContain("QTFrizQuad");
      expect(settingsTypography.font).not.toContain("Guild Wars Original");
      expect(settingsTypography.textShadow).not.toBe("none");
      expect(settingsTypography.titleWeight).toBe("400");
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
      await page.locator("#settings-opacity-default").click();
      await expect(page.locator('input[name="uiPanelOpacity"]')).toHaveValue("94");
      await expect(page.locator('output[name="uiPanelOpacityValue"]')).toHaveText("94%");
      await expectToken("--ui-panel-opacity", "0.94");

      await page.locator('input[name="uiStyle"][value="obsidian"]').click();
      await expect(root).toHaveAttribute("data-ui-style", "obsidian");
      await expect(root).not.toHaveAttribute("data-ui-font");
      await page.locator('select[name="uiFont"]').selectOption("inter");
      await expect(root).toHaveAttribute("data-ui-font", "inter");
      await expect(page.locator("#settings-feedback")).toHaveText("Saved.");
      const interTypography = await page.locator("#settings-dialog").evaluate(
        (dialog) => {
          const style = globalThis.getComputedStyle(dialog);
          return {
            font: style.fontFamily,
            textShadow: style.textShadow,
            titleWeight: globalThis.getComputedStyle(
              globalThis.document.querySelector("#settings-title")!,
            ).fontWeight,
          };
        },
      );
      expect(interTypography.font).toContain("ui-sans-serif");
      expect(interTypography.font).not.toContain("QTFrizQuad");
      expect(interTypography.textShadow).toBe("none");
      expect(interTypography.titleWeight).toBe("700");
      await expectToken("--ui-panel-opacity", "0.94");

      await page.locator('select[name="controllerPromptStyle"]')
        .selectOption("playstation");
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).controllerPromptStyle,
      )).toBe("playstation");
      await expect(page.locator("#settings-feedback")).toContainText(
        "Restart GWonMac to apply controller button symbols",
      );

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
      await expect(
        page.locator('input[name="uiStyle"][value="obsidian"]'),
      ).toBeChecked();
      await expect(root).toHaveAttribute("data-ui-style", "obsidian");
      await expect(page.locator('select[name="uiFont"]')).toHaveValue("inter");
      await expect(root).toHaveAttribute("data-ui-font", "inter");
      await expect(page.locator('input[name="uiPanelOpacity"]')).toHaveValue("94");
      await expect(page.locator('output[name="uiPanelOpacityValue"]')).toHaveText("94%");
      await expect(page.locator('select[name="controllerPromptStyle"]'))
        .toHaveValue("playstation");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("edits, shares, imports, and reactivates a custom theme", async () => {
    const fixture = await launchOffline("gw-settings-custom-theme-e2e-");
    try {
      const { page } = fixture;
      const root = page.locator("html");
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-display").click();

      // Tabs navigate the editor. Merely viewing a saved palette must not
      // change the active interface underneath the player.
      await page.locator("#settings-theme-tab-custom").click();
      await expect(page.locator("#settings-theme-custom")).toBeVisible();
      const themeHex = page.locator('[data-theme-hex="window"]');
      await themeHex.focus();
      await themeHex.press("Enter");
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(root).not.toHaveAttribute("data-ui-style");
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).uiStyle,
      )).toBe("guild-wars");
      await expect(page.locator("#settings-theme-use-custom")).toBeVisible();

      await page.locator('[data-theme-hex="window"]').fill("#202830");
      await page.locator('[data-theme-hex="window"]').dispatchEvent("change");
      // Sharing reads the visible draft, even while the asynchronous settings
      // write is still in flight.
      await page.locator("#settings-theme-share").click();
      await expect.poll(() => page.evaluate(() => window.gwNative.clipboard.readText()))
        .toBe("gwonmac-theme-v1:classic:#202830:#292927:#202225:#080807:#1B3554:#E6C882:#F1EBDD:#B7B09F:#D8D2BF:1");
      await expect(root).not.toHaveAttribute("data-ui-style");
      await expect(root).toHaveAttribute("data-ui-material", "classic");
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).uiCustomTheme.window,
      )).toBe("#202830");
      await expect.poll(() => root.evaluate((element) =>
        element.style.getPropertyValue("--ui-panel-fill"),
      )).toContain("32 40 48");

      const beforeIndependent = await page.evaluate(async () => {
        const settings = await window.gwNative.settings.get();
        return { uiFont: settings.uiFont, uiPanelOpacity: settings.uiPanelOpacity };
      });

      await page.locator("#settings-theme-import").click();
      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(page.locator("#settings-theme-import-dialog")).toHaveAttribute("open", "");
      await page.locator("#settings-theme-import-value").fill("not-a-theme");
      await page.locator("#settings-theme-import-apply").click();
      await expect(page.locator("#settings-theme-import-error")).toBeVisible();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).uiCustomTheme.window,
      )).toBe("#202830");

      await page.locator("#settings-theme-import-value").fill(
        "gwonmac-theme-v1:modern:#F4F4F4:#FFFFFF:#FFFFFF:#E5E7EB:#123456:#22C55E:#171717:#666666:#D4D4D4:0",
      );
      await page.locator("#settings-theme-import-apply").click();
      await expect(page.locator("#settings-theme-import-dialog")).not.toHaveAttribute("open", "");
      await expect(page.locator("#settings-theme-import")).toBeFocused();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).uiCustomTheme,
      )).toMatchObject({
        window: "#F4F4F4",
        material: "modern",
        titlebar: "#FFFFFF",
        surface: "#FFFFFF",
        recessed: "#E5E7EB",
        selected: "#123456",
        accent: "#22C55E",
        text: "#171717",
        mutedText: "#666666",
        border: "#D4D4D4",
        windowGradient: false,
      });
      await expect(root).toHaveAttribute("data-ui-style", "obsidian");
      await expect.poll(() => root.evaluate((element) =>
        element.style.getPropertyValue("--ui-accent"),
      )).toBe("#22C55E");
      await expect(root).toHaveAttribute("data-ui-material", "modern");

      await page.locator("#settings-theme-reset").click();
      await expect(page.locator('[data-theme-hex="window"]')).toHaveValue("#1B1A18");
      await expect(page.locator('[data-theme-hex="selected"]')).toHaveValue("#3C3832");
      await expect(page.locator('select[name="uiThemeMaterial"]')).toHaveValue("modern");
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).uiCustomTheme,
      )).toMatchObject({ material: "modern", window: "#1B1A18", selected: "#3C3832" });

      await page.locator("#settings-theme-tab-builtins").click();
      await page.locator('input[name="uiStyle"][value="obsidian"]').click();
      await expect(root).toHaveAttribute("data-ui-style", "obsidian");
      await expect.poll(() => root.evaluate((element) =>
        element.style.getPropertyValue("--ui-panel-fill"),
      )).toBe("");
      await page.locator("#settings-theme-tab-custom").click();
      await page.locator("#settings-theme-use-custom").click();
      await expect(root).toHaveAttribute("data-ui-style", "obsidian");
      await expect(root).toHaveAttribute("data-ui-material", "modern");

      await expect.poll(() => page.evaluate(async () => {
        const settings = await window.gwNative.settings.get();
        return { uiFont: settings.uiFont, uiPanelOpacity: settings.uiPanelOpacity };
      })).toEqual(beforeIndependent);

      await page.locator("#settings-done").click();
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-display").click();
      await expect(root).toHaveAttribute("data-ui-style", "obsidian");
      await expect(root).toHaveAttribute("data-ui-material", "modern");
      await expect(page.locator('[data-theme-hex="window"]')).toHaveValue("#1B1A18");
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
        "Choose a lower scale if Guild Wars feels slow",
      );
      // Segment radios intentionally cover their visible labels at zero
      // opacity. Skip Chromium's paint-based actionability check, then wait
      // for this save before starting the independent Diagnostics update.
      await page.locator('input[name="renderScale"][value="1.5"]')
        .check({ force: true });
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).renderScale,
      )).toBe(1.5);
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
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute("open", "");
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("gw:settings", {
        detail: { pane: "controls" },
      })));
      await expect(page.locator("#settings-pane-controls")).toContainText(
        "Guild Wars cursor",
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

  test("reset ignores the retired cursor preference and does not restart", async () => {
    const fixture = await launchOffline(
      "gw-settings-reset-restart-e2e-",
      {},
      (userData) => Promise.all([
        writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            formatVersion: 1,
            nativeCursor: false,
            travelShortcuts: [
              { mapId: 55, district: "international", districtNumber: 0 },
              null, null, null, null, null, null, null, null,
            ],
          }),
        ),
        writeFile(
          path.join(userData, "travel-preferences.json"),
          JSON.stringify(serializeTravelPreferencesV1({
            formatVersion: 1,
            synonyms: [{ term: "home", mapId: 55 }],
          })),
        ),
      ]).then(() => undefined),
    );
    try {
      const { app, page, userData } = fixture;
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
      expect(reset).toMatchObject({
        status: "complete",
        settings: { renderScale: 2 },
        travelPreferences: null,
      });
      expect(
        await app.evaluate(() => {
          const { quit, relaunch, options } = globalThis.__resetRestart;
          if (!options) throw new Error("no message box was shown");
          return {
            quit,
            relaunch,
            buttons: options.buttons,
            detail: options.detail,
          };
        }),
      ).toEqual({
        quit: false,
        relaunch: false,
        buttons: ["Reset GWonMac Settings", "Cancel"],
        detail:
          "Core-owned settings, including Tools switches, window size and position, and diagnostics return to their defaults. Stored Build Library and Travel shortcuts and search phrases remain. Downloaded game data and your saved login stay untouched.",
      });
      expect(await page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ renderScale: 2 });
      const rawSettings = JSON.parse(
        await readFile(path.join(userData, "settings.json"), "utf8"),
      ) as { travelShortcuts: unknown[] };
      expect(rawSettings.travelShortcuts[0]).toEqual({
        mapId: 55,
        district: "international",
        districtNumber: 0,
      });
      expect(JSON.parse(
        await readFile(path.join(userData, "travel-preferences.json"), "utf8"),
      )).toMatchObject({ synonyms: [{ term: "home", mapId: 55 }] });
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
        status: "complete",
        settings: {
          renderScale: 2,
          showDiagnostics: false,
        },
        travelPreferences: null,
      });
      expect(await page.evaluate(() => window.gwNative.settings.get())).toMatchObject({
        renderScale: 2,
        showDiagnostics: false,
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("changes neither preference owner when reset is cancelled", async () => {
    const fixture = await launchOffline(
      "gw-settings-reset-cancel-e2e-",
      {},
      (userData) => Promise.all([
        writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ formatVersion: 1, showDiagnostics: true }),
        ),
        writeFile(
          path.join(userData, "travel-preferences.json"),
          JSON.stringify(serializeTravelPreferencesV1({
            formatVersion: 1,
            synonyms: [{ term: "home", mapId: 55 }],
          })),
        ),
      ]).then(() => undefined),
    );
    try {
      const { app, page, userData } = fixture;
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      const before = await page.evaluate(async () => ({
        settings: await window.gwNative.settings.get(),
      }));
      const travelBefore = await readFile(
        path.join(userData, "travel-preferences.json"),
        "utf8",
      );

      expect(await page.evaluate(() => window.gwNative.settings.reset())).toBeNull();
      expect(await page.evaluate(async () => ({
        settings: await window.gwNative.settings.get(),
      }))).toEqual(before);
      expect(await readFile(
        path.join(userData, "travel-preferences.json"),
        "utf8",
      )).toBe(travelBefore);
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
      await page.locator("#settings-tab-display").click();
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("gw:settings:set");
        ipcMain.handle("gw:settings:set", () => {
          throw new Error("forced settings write failure");
        });
      });

      // The rejected save restores the canonical radio immediately, so this
      // click must not wait for the transient checked state to persist.
      await page.locator('input[name="uiStyle"][value="obsidian"]').click();
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Close and reopen Settings to confirm which value is active before retrying.",
      );
      await expect(page.locator("#settings-feedback")).toHaveAttribute(
        "data-tone",
        "error",
      );
      await expect(
        page.locator('input[name="uiStyle"][value="guild-wars"]'),
      ).toBeChecked();
      await expect(page.locator("html")).not.toHaveAttribute("data-ui-style");
      expect(
        await page.evaluate(() => window.gwNative.settings.get()),
      ).toMatchObject({ uiStyle: "guild-wars" });

      await page.locator("#settings-theme-tab-custom").click();
      await page.locator('[data-theme-hex="window"]').fill("#AABBCC");
      await page.locator('[data-theme-hex="window"]').dispatchEvent("change");
      await expect(page.locator("#settings-feedback")).toHaveText(
        "The custom theme could not be saved. The last confirmed theme is active.",
      );
      await expect(page.locator('[data-theme-hex="window"]')).toHaveValue("#0B0B0B");
      await expect(page.locator("html")).not.toHaveAttribute("data-ui-style");
    } finally {
      await closeOffline(fixture);
    }
  });
});
