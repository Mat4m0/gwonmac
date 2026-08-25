import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeOffline, launchOffline } from "./fixtures.mjs";
import { packageVersion } from "./settings-test-fixture.mjs";

type ShortcutModifier = "meta" | "control" | "shift" | "alt";

function sendInput(
  app: ElectronApplication,
  keyCode: string,
  modifiers: ShortcutModifier[] = [],
) {
  return app.evaluate(({ BrowserWindow }, input) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    contents?.sendInputEvent({
      type: "keyDown",
      keyCode: input.keyCode,
      modifiers: input.modifiers,
    });
    contents?.sendInputEvent({
      type: "keyUp",
      keyCode: input.keyCode,
      modifiers: input.modifiers,
    });
  }, { keyCode, modifiers });
}

async function openControls(app: ElectronApplication, page: Page) {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      ?.items[0]?.submenu?.items.find((item) => item.label === "Settings…")
      ?.click();
  });
  await page.locator("#settings-tab-controls").click();
}

test.describe("tools and update settings", () => {
  test("removes Travel Recent controls while accepting the released file", async () => {
    const fixture = await launchOffline(
      "gw-settings-travel-recents-e2e-",
      {},
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            gwonmacTools: true,
            travelPalette: true,
          }),
          { mode: 0o600 },
        );
        await writeFile(
          path.join(userData, "travel-preferences.json"),
          JSON.stringify({
            formatVersion: 1,
            synonyms: [],
            recentLimit: 5,
            recentMapIds: [55, 449, 194],
          }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page, userData } = fixture;
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find((item) => item.label === "Settings…")
          ?.click();
      });
      await page.locator("#settings-tab-controls").click();

      await expect(page.locator('select[name="travelRecentLimit"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Clear Recent" })).toHaveCount(0);
      await expect(page.getByText("Recent destinations", { exact: true })).toHaveCount(0);
      await expect(page.evaluate(() => window.gwNative.travelPreferences.get()))
        .resolves.toMatchObject({ synonyms: [] });
      expect(JSON.parse(await readFile(
        path.join(userData, "travel-preferences.json"),
        "utf8",
      ))).toEqual({
        formatVersion: 1,
        synonyms: [],
        recentLimit: 0,
        recentMapIds: [],
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("Command-Shift-C opens storage or its settings, never hero builds", async () => {
    const fixture = await launchOffline("gw-storage-shortcut-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() => {
        document.body.dataset.toolsActions = "0";
        window.addEventListener("gw:tools-toggle", (event) => {
          event.preventDefault();
          document.body.dataset.toolsActions = String(
            Number(document.body.dataset.toolsActions ?? "0") + 1,
          );
        });
      });
      await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        contents?.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["meta", "shift"],
        });
        contents?.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["meta", "shift"],
        });
      });

      await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
      await expect(page.locator(".settings-panes")).toHaveAttribute(
        "data-active",
        "controls",
      );
      await expect(page.locator("body")).toHaveAttribute("data-tools-actions", "0");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("records, replaces, clears, and restores app shortcuts without firing them", async () => {
    const fixture = await launchOffline("gw-settings-shortcuts-e2e-");
    try {
      const { app, page } = fixture;
      await openControls(app, page);

      const toolsRow = page.locator('[data-shortcut-action="tools.toggle"]');
      const tradeRow = page.locator('[data-shortcut-action="trade.toggle"]');
      const storageRow = page.locator('[data-shortcut-action="storage.open"]');
      await expect(toolsRow.locator("kbd")).toHaveText("⌘B");
      await expect(tradeRow.locator("kbd")).toHaveText("⌘⇧B");
      await expect(storageRow.locator("kbd")).toHaveText("⌘⇧C");

      await page.evaluate(() => {
        document.body.dataset.shortcutActions = "0";
        document.body.dataset.shortcutLeaks = "0";
        window.addEventListener("gw:tools-toggle", (event) => {
          event.preventDefault();
          document.body.dataset.shortcutActions = String(
            Number(document.body.dataset.shortcutActions ?? "0") + 1,
          );
        });
        window.addEventListener("keydown", (event) => {
          if (event.code === "KeyK") {
            document.body.dataset.shortcutLeaks = String(
              Number(document.body.dataset.shortcutLeaks ?? "0") + 1,
            );
          }
        }, true);
      });

      await toolsRow.locator(".settings-shortcut-change").click();
      await expect(toolsRow.locator("kbd")).toHaveText("Listening…");
      await expect(toolsRow.locator(".settings-shortcut-message"))
        .toContainText("Delete clears · Escape cancels");
      await sendInput(app, "B", ["meta"]);
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {},
        });
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "0");

      await toolsRow.locator(".settings-shortcut-change").click();
      await expect(toolsRow.locator("kbd")).toHaveText("Listening…");
      await sendInput(app, "K", ["meta", "shift"]);
      await expect.poll(async () => ({
        key: await toolsRow.locator("kbd").textContent(),
        message: await toolsRow.locator(".settings-shortcut-message").textContent(),
        change: await toolsRow.locator(".settings-shortcut-change").textContent(),
      })).toEqual({ key: "⌘⇧K", message: "", change: "Change" });
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {
            "tools.toggle": { key: "k", shift: true, option: false },
          },
        });
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "0");
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-leaks", "0");
      expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()
        ?.getMenuItemById("toggle-tools")?.accelerator)).toBeNull();

      await storageRow.locator(".settings-shortcut-change").click();
      await sendInput(app, "K", ["meta", "shift"]);
      await expect(storageRow.locator(".settings-shortcut-message"))
        .toContainText("used by Show or hide GWonMac Tools");
      await storageRow.locator(".settings-shortcut-replace").click();
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {
            "tools.toggle": null,
            "storage.open": { key: "k", shift: true, option: false },
          },
        });
      await expect(toolsRow.locator("kbd")).toHaveText("Not set");

      await storageRow.locator(".settings-shortcut-change").click();
      await sendInput(app, "Backspace");
      await expect(storageRow.locator("kbd")).toHaveText("Not set");

      await tradeRow.locator(".settings-shortcut-change").click();
      await expect(tradeRow.locator("kbd")).toHaveText("Listening…");
      await page.locator("#settings-shortcuts-restore").click();
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ shortcutOverrides: {} });
      await expect(toolsRow.locator("kbd")).toHaveText("⌘B");
      await expect(tradeRow.locator("kbd")).toHaveText("⌘⇧B");
      await expect(tradeRow.locator(".settings-shortcut-change")).toHaveText("Change");
      await expect(storageRow.locator("kbd")).toHaveText("⌘⇧C");
      await page.locator("#settings-done").click();
      await sendInput(app, "B", ["control"]);
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "0");
      await sendInput(app, "B", ["meta"]);
      await expect(page.locator("body")).toHaveAttribute("data-shortcut-actions", "1");
    } finally {
      await closeOffline(fixture);
    }
  });

  test("changes, clears, and restores the Trade Chat shortcut", async () => {
    const fixture = await launchOffline(
      "gw-settings-trade-shortcut-e2e-",
      {},
      (userData) => writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify({ gwonmacTools: true }),
        { mode: 0o600 },
      ),
    );
    try {
      const { app, page } = fixture;

      await page.evaluate(() => {
        document.body.dataset.tradeShortcutActions = "0";
        document.body.dataset.tradeShortcutLeaks = "0";
        window.addEventListener("gw:trade-toggle", (event) => {
          event.preventDefault();
          document.body.dataset.tradeShortcutActions = String(
            Number(document.body.dataset.tradeShortcutActions ?? "0") + 1,
          );
        });
        window.addEventListener("keydown", (event) => {
          if (event.code === "KeyK") {
            document.body.dataset.tradeShortcutLeaks = String(
              Number(document.body.dataset.tradeShortcutLeaks ?? "0") + 1,
            );
          }
        }, true);
      });
      await sendInput(app, "B", ["meta", "shift"]);
      await expect(page.locator("body")).toHaveAttribute(
        "data-trade-shortcut-actions",
        "1",
      );

      await openControls(app, page);
      const tradeRow = page.locator('[data-shortcut-action="trade.toggle"]');
      await expect(tradeRow.locator("kbd")).toHaveText("⌘⇧B");
      await tradeRow.locator(".settings-shortcut-change").click();
      await sendInput(app, "K", ["meta", "shift"]);
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          shortcutOverrides: {
            "trade.toggle": { key: "k", shift: true, option: false },
          },
        });
      await expect(tradeRow.locator("kbd")).toHaveText("⌘⇧K");

      await page.locator("#settings-done").click();
      await sendInput(app, "B", ["meta", "shift"]);
      await expect(page.locator("body")).toHaveAttribute(
        "data-trade-shortcut-actions",
        "1",
      );
      await sendInput(app, "K", ["meta", "shift"]);
      await expect(page.locator("body")).toHaveAttribute(
        "data-trade-shortcut-actions",
        "2",
      );
      await expect(page.locator("body")).toHaveAttribute(
        "data-trade-shortcut-leaks",
        "0",
      );

      await openControls(app, page);
      await tradeRow.locator(".settings-shortcut-change").click();
      await sendInput(app, "Backspace");
      await expect(tradeRow.locator("kbd")).toHaveText("Not set");
      await page.locator("#settings-done").click();
      await sendInput(app, "K", ["meta", "shift"]);
      await expect(page.locator("body")).toHaveAttribute(
        "data-trade-shortcut-actions",
        "2",
      );

      await openControls(app, page);
      await page.locator("#settings-shortcuts-restore").click();
      await expect(tradeRow.locator("kbd")).toHaveText("⌘⇧B");
      await page.locator("#settings-done").click();
      await sendInput(app, "B", ["meta", "shift"]);
      await expect(page.locator("body")).toHaveAttribute(
        "data-trade-shortcut-actions",
        "3",
      );
    } finally {
      await closeOffline(fixture);
    }
  });

  test("records display-only keyboard, mouse, and wheel labels", async () => {
    const fixture = await launchOffline(
      "gw-settings-skill-keys-e2e-",
      {},
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ gwonmacTools: true }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      const sendInput = (
        keyCode: string,
        modifiers: Array<"meta" | "control" | "shift" | "alt"> = [],
      ) => app.evaluate(({ BrowserWindow }, input) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        contents?.sendInputEvent({
          type: "keyDown",
          keyCode: input.keyCode,
          modifiers: input.modifiers,
        });
        contents?.sendInputEvent({
          type: "keyUp",
          keyCode: input.keyCode,
          modifiers: input.modifiers,
        });
      }, { keyCode, modifiers });
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find((item) => item.label === "Settings…")
          ?.click();
      });
      await page.locator("#settings-tab-controls").click();
      await expect(page.locator("#settings-skill-keys")).toBeVisible();

      const rows = page.locator("[data-skill-key-slot]");
      const first = rows.nth(0);
      await first.locator(".settings-skill-key-change").click();
      await expect(first.locator(".settings-skill-key-message"))
        .toContainText("mouse button");
      await sendInput("F12", ["control", "alt", "shift", "meta"]);
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillKeyBindings[0],
      )).toEqual({
        input: { kind: "keyboard", code: "F12" },
        modifiers: { control: true, option: true, shift: true, command: true },
      });
      await expect(first.locator(".skill-key-plate")).toContainText("⌃⌥⇧⌘F12");

      const help = page.locator("#settings-skill-keys-help");
      const helpBox = await help.boundingBox();
      if (!helpBox) throw new Error("skill-key help must be visible");
      const second = rows.nth(1);
      await second.locator(".settings-skill-key-change").click();
      await page.mouse.click(helpBox.x + 4, helpBox.y + 4, { button: "right" });
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillKeyBindings[1],
      )).toMatchObject({ input: { kind: "mouse-button", button: 2 } });

      const third = rows.nth(2);
      await third.locator(".settings-skill-key-change").click();
      await page.mouse.move(helpBox.x + 4, helpBox.y + 4);
      await page.mouse.wheel(0, -120);
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillKeyBindings[2],
      )).toMatchObject({ input: { kind: "wheel", direction: "up" } });

      const fourth = rows.nth(3);
      await fourth.locator(".settings-skill-key-change").click();
      await fourth.locator(".settings-skill-key-change").click();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillKeyBindings[3],
      )).toBeNull();

      await page.locator("#settings-skill-keys-clear").click();
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          skillKeyBindings: [null, null, null, null, null, null, null, null],
        });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("persists and re-renders skill cooldown presentation settings", async () => {
    const fixture = await launchOffline(
      "gw-settings-skill-cooldowns-e2e-",
      {},
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({ gwonmacTools: true }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      await openControls(app, page);
      const fieldset = page.locator("#settings-skill-cooldowns");
      await expect(fieldset).toBeVisible();

      const enabled = fieldset.locator('[name="skillCooldownOverlayEnabled"]');
      await enabled.uncheck();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillCooldownOverlayEnabled,
      )).toBe(false);

      await fieldset.locator('[name="skillCooldownColorChoice"][value="gold"]')
        .check();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillCooldownColor,
      )).toEqual({ kind: "preset", preset: "gold" });

      await fieldset.locator('[name="skillCooldownColorChoice"][value="custom"]')
        .check();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillCooldownColor,
      )).toEqual({ kind: "custom", value: "#e35a4f" });
      const customHex = fieldset.locator('[name="skillCooldownCustomHex"]');
      await customHex.fill("#123abc");
      await customHex.press("Tab");
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).skillCooldownColor,
      )).toEqual({ kind: "custom", value: "#123abc" });

      await page.locator("#settings-done").click();
      await openControls(app, page);
      await expect(enabled).not.toBeChecked();
      await expect(
        fieldset.locator('[name="skillCooldownColorChoice"][value="custom"]'),
      ).toBeChecked();
      await expect(customHex).toHaveValue("#123abc");
      await expect(fieldset.locator(".skill-cooldown-glyph"))
        .toHaveText("2.9");
    } finally {
      await closeOffline(fixture);
    }
  });

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
      await expect(page.locator("#settings-form")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(page.locator("#settings-feedback")).toHaveText(
        "Changes save automatically.",
      );
      await expect.poll(() => page.evaluate(() => document.activeElement?.id))
        .toBe("settings-tab-data");
      await page.keyboard.press("Escape");
      await expect(page.locator("#settings-dialog")).not.toHaveAttribute("open", "");
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
          ?.items[0]?.submenu?.items.find(
            (candidate) => candidate.label === "Settings…",
          )
          ?.click();
      });
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
      // Installed release stage and selected update track are separate facts.
      await expect(page.locator("#settings-update-stage")).toHaveText(
        packageVersion.includes("-beta.")
          ? "Beta"
          : packageVersion.includes("-rc.")
            ? "Release Candidate"
            : packageVersion.includes("-alpha.")
              ? "Alpha"
              : "Stable",
      );
      await expect(page.locator('select[name="updateTrack"]')).toHaveValue("stable");
      await page.locator('select[name="updateTrack"]').selectOption("beta");
      await expect
        .poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({ updateTrack: "beta" });
      await expect(page.locator("#settings-update-status")).toContainText(
        "must be updated manually",
      );
      await expect(page.locator("#settings-restart-update")).toBeHidden();
    } finally {
      await closeOffline(fixture);
    }
  });

  test("an older Stable return is presented only as the fixed Releases action", async () => {
    const fixture = await launchOffline("gw-update-manual-return-e2e-");
    try {
      const result = await fixture.page.evaluate(async () => {
        const root = document.implementation.createHTMLDocument("update proof");
        root.body.innerHTML = `
          <a id="loading-update-check"></a>
          <span id="loading-update-status"></span>
          <span id="loading-update-when"></span>
          <a id="loading-update-get"></a>
          <button id="settings-check-updates"></button>
          <button id="settings-open-releases"></button>
          <button id="settings-restart-update"></button>
          <span id="settings-update-status"></span>
          <span id="settings-update-when"></span>
          <span id="settings-update-version"></span>
          <span id="settings-update-stage"></span>
          <button id="client-compat-check"></button>
          <button id="client-compat-restart"></button>
          <button id="client-compat-releases"></button>
          <span id="client-compat-update"></span>
        `;
        const importRenderer = async <T>(specifier: string): Promise<T> =>
          import(specifier);
        const module = await importRenderer<
          typeof import("../../src/renderer/update-action.js")
        >("./update-action.js");
        const action = module.createUpdateAction({
          getState: async () => ({
            phase: "manual-stable-return" as const,
            currentVersion: "2026.8.0-beta.1",
            checkedAt: "2026-08-10T00:00:00.000Z",
            stableVersion: "2026.7.0",
          }),
          check: async () => undefined,
          restartAndInstall: async () => undefined,
          onState: () => () => undefined,
        });
        let releases = 0;
        module.bindUpdateActionDom(root, action, async () => {
          releases += 1;
        });
        await action.initialize();
        root.getElementById("settings-open-releases")?.click();
        return {
          message: root.getElementById("settings-update-status")?.textContent,
          label: root.getElementById("settings-open-releases")?.textContent,
          restartHidden: (root.getElementById("settings-restart-update") as HTMLElement).hidden,
          releases,
        };
      });

      expect(result).toEqual({
        message:
          "Stable version 2026.7.0 is available. Returning to Stable requires a manual install.",
        label: "Open Releases to Return to Stable…",
        restartHidden: true,
        releases: 1,
      });
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
        globalThis.fetch = async () => new Response(JSON.stringify({
          url: `${base}/${zip}`,
          name: `Guild Wars Reforged v${version}`,
          version,
          tag,
          pub_date: "2026-07-30T00:00:00.000Z",
          notes: "",
        }), { status: 200 });
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

  test("the first Tools enable can be declined and a saved enable survives relaunch refusal", async () => {
    const fixture = await launchOffline("gw-tools-enable-restart-e2e-");
    try {
      const { app, page } = fixture;
      await page.evaluate(() =>
        globalThis.dispatchEvent(new globalThis.Event("gw:settings")),
      );
      await page.locator("#settings-tab-controls").click();
      const controls = page.locator("#settings-pane-controls");
      await expect(page.locator("#settings-tool-features")).toBeHidden();
      await expect(page.locator("#settings-tools-off")).toBeVisible();
      await expect(page.locator("#settings-availability")).not.toHaveAttribute(
        "open",
        "",
      );
      await expect(controls).toContainText(
        "Guild Wars cursor",
      );
      await expect(controls).toContainText(
        "Tools work in outposts and guild halls, and close during PvP play",
      );
      await expect(controls).toContainText("Apply teams in Guild Wars");
      await expect(page.locator('input[name="nativeCursor"]')).toHaveCount(0);
      await expect(page.locator('input[name="teamManagement"]')).toBeDisabled();
      await expect(page.locator('input[name="xunlaiStorage"]')).toBeDisabled();
      await expect(page.locator('input[name="targetReadout"]')).toBeDisabled();
      expect(
        await page.evaluate(
          () => window.gwNative.init.enhancementSelection.nativeCursor,
        ),
      ).toBe(true);
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
          messages: [],
          originalQuit: electronApp.quit,
          originalRelaunch: electronApp.relaunch,
        };
        const record = async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ): Promise<Electron.MessageBoxReturnValue> => {
          globalThis.__resetRestart.options = options;
          globalThis.__resetRestart.messages?.push(options);
          return { response: 0, checkboxChecked: false };
        };
        dialog.showMessageBox = record as typeof dialog.showMessageBox;
        electronApp.relaunch = () => {
          globalThis.__resetRestart.relaunch = true;
          throw new Error("injected relaunch refusal");
        };
        electronApp.quit = () => {
          globalThis.__resetRestart.quit = true;
        };
      });

      await page.locator('input[name="gwonmacTools"]').click();
      await expect.poll(() => page.evaluate(async () =>
        (await window.gwNative.settings.get()).gwonmacTools)).toBe(true);
      await expect.poll(() => app.evaluate(() =>
        globalThis.__resetRestart.messages?.length ?? 0)).toBe(2);
      expect(await app.evaluate(() => {
        const { quit, relaunch, messages } = globalThis.__resetRestart;
        const [confirmation, warning] = messages ?? [];
        if (!confirmation || !warning) throw new Error("both restart dialogs were not shown");
        return {
          quit,
          relaunch,
          confirmation: {
            buttons: confirmation.buttons,
            detail: confirmation.detail,
            message: confirmation.message,
          },
          warning: {
            buttons: warning.buttons,
            detail: warning.detail,
            message: warning.message,
          },
        };
      })).toEqual({
        quit: false,
        relaunch: true,
        confirmation: {
          buttons: ["Enable and Restart", "Cancel"],
          detail:
            "GWonMac prepares every certified Tools capability together. Restart once to use the saved change. This closes Guild Wars if it is running.",
          message: "Restart to enable optional Tools?",
        },
        warning: {
          buttons: ["OK"],
          detail: "Your change is saved. Quit and reopen GWonMac to apply it.",
          message: "Restart did not start",
        },
      });
      await app.evaluate(({ app: electronApp }) => {
        electronApp.quit = globalThis.__resetRestart.originalQuit;
        electronApp.relaunch = globalThis.__resetRestart.originalRelaunch;
      });
    } finally {
      await closeOffline(fixture);
    }
  });

  test("child Tools toggles stay immediate after the one preparation restart", async () => {
    const fixture = await launchOffline(
      "gw-tools-capability-restart-e2e-",
      {},
      async (userData) => {
        await writeFile(
          path.join(userData, "settings.json"),
          JSON.stringify({
            gwonmacTools: true,
            targetReadout: false,
            teamManagement: false,
            xunlaiStorage: false,
            travelPalette: false,
          }),
          { mode: 0o600 },
        );
      },
    );
    try {
      const { app, page } = fixture;
      await app.evaluate(({ dialog }) => {
        globalThis.__capabilityRestartMessages = [];
        dialog.showMessageBox = (async (
          _win: Electron.BaseWindow,
          options: Electron.MessageBoxOptions,
        ) => {
          globalThis.__capabilityRestartMessages?.push(options.message);
          return { response: 1, checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      });

      await page.evaluate(async () => {
        await window.gwNative.settings.set({ targetReadout: true });
        await window.gwNative.settings.set({ teamManagement: true });
        await window.gwNative.settings.set({ xunlaiStorage: true });
        await window.gwNative.settings.set({ travelPalette: true });
        await window.gwNative.settings.set({ gwonmacTools: false });
        await window.gwNative.settings.set({ gwonmacTools: true });
      });
      expect(await app.evaluate(() => globalThis.__capabilityRestartMessages))
        .toEqual([]);
      await expect.poll(() => page.evaluate(() => window.gwNative.settings.get()))
        .toMatchObject({
          targetReadout: true,
          teamManagement: true,
          xunlaiStorage: true,
          travelPalette: true,
          gwonmacTools: true,
        });
    } finally {
      await closeOffline(fixture);
    }
  });

});
