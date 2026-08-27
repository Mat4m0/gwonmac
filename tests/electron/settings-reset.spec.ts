/** Reset copy and persistence stay aligned with the active launch boundary. */
import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeTravelPreferencesV1 } from
  "../../src/main/core/travel-preferences-v1.js";
import { closeOffline, launchOffline } from "./fixtures.mjs";

test("Tools reset promises and clears both Travel preference owners", async () => {
  const fixture = await launchOffline(
    "gw-settings-tools-reset-e2e-",
    {},
    async (userData) => {
      await writeFile(
        path.join(userData, "settings.json"),
        JSON.stringify({
          gwonmacTools: true,
          travelShortcuts: [
            { mapId: 55, district: "international", districtNumber: 0 },
            null, null, null, null, null, null, null, null,
          ],
        }),
        { mode: 0o600 },
      );
      await writeFile(
        path.join(userData, "travel-preferences.json"),
        JSON.stringify(serializeTravelPreferencesV1({
          formatVersion: 1,
          synonyms: [{ term: "home", mapId: 55 }],
        })),
        { mode: 0o600 },
      );
    },
  );
  try {
    const { app, page, userData } = fixture;
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
    });

    expect(await page.evaluate(() => window.gwNative.settings.reset()))
      .toMatchObject({ status: "complete" });
    expect(await app.evaluate(() => globalThis.__resetRestart.options?.detail))
      .toBe(
        "Display, tools, Travel shortcuts, custom search phrases, window size and position, and diagnostics return to their defaults. Downloaded game data and your saved login stay untouched.",
      );
    const settings = JSON.parse(
      await readFile(path.join(userData, "settings.json"), "utf8"),
    ) as { travelShortcuts: unknown[] };
    expect(settings.travelShortcuts[0]).toEqual({
      mapId: 81,
      district: "international",
      districtNumber: 0,
    });
    expect(JSON.parse(await readFile(
      path.join(userData, "travel-preferences.json"),
      "utf8",
    ))).toMatchObject({ formatVersion: 1, synonyms: [] });
  } finally {
    await closeOffline(fixture);
  }
});
