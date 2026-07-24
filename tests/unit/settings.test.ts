import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/shared/contracts.js";
import { AppError } from "../../src/shared/errors.js";
import {
  loadSettings,
  parseSettings,
  parseSettingsPatch,
  saveSettings,
} from "../../src/main/core/settings.js";

describe("settings", () => {
  it("exposes the documented defaults", () => {
    assert.deepEqual(DEFAULT_SETTINGS, {
      renderScale: 1,
      pointerLock: true,
      cursorTheme: "guild-wars",
      touchMode: "dbltap",
      showDiagnostics: false,
      dataStrategy: null,
    });
  });

  it("fills missing fields and ignores unknown keys on read", () => {
    const got = parseSettings({
      patchMode: "fullImage",
      renderScale: 2,
      mystery: true,
    });
    assert.equal("patchMode" in got, false);
    assert.equal(got.renderScale, 2);
    assert.equal(got.pointerLock, true);
    assert.equal("mystery" in got, false);
  });

  it("rejects unknown types", () => {
    assert.throws(() => parseSettings({ pointerLock: "yes" }), AppError);
    assert.throws(() => parseSettings({ renderScale: 3 }), AppError);
    assert.throws(() => parseSettings({ cursorTheme: "custom" }), AppError);
    assert.throws(() => parseSettings({ touchMode: "hover" }), AppError);
    assert.throws(() => parseSettings({ dataStrategy: "automatic" }), AppError);
    assert.throws(() => parseSettings([]), AppError);
  });

  it("validates patches without filling fields from defaults", () => {
    assert.deepEqual(parseSettingsPatch({ cursorTheme: "guild-wars-2" }), {
      cursorTheme: "guild-wars-2",
    });
    assert.deepEqual(parseSettingsPatch({ mystery: true }), {});
    assert.throws(() => parseSettingsPatch({ pointerLock: "yes" }), AppError);
  });

  it("loads defaults for missing or corrupt files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    assert.deepEqual(await loadSettings(path), DEFAULT_SETTINGS);
    await writeFile(path, "{not json");
    let backup = "";
    assert.deepEqual(
      await loadSettings(path, (value) => {
        backup = value;
      }),
      DEFAULT_SETTINGS,
    );
    assert.match(backup, /settings\.json\.corrupt-\d+$/);
    assert.equal(await readFile(backup, "utf8"), "{not json");
    assert.deepEqual(await readdir(dir), [backup.split("/").at(-1)]);
  });

  it("saves only known fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const saved = await saveSettings(path, {
      ...DEFAULT_SETTINGS,
      showDiagnostics: true,
      renderScale: 1.5,
    });
    assert.equal(saved.showDiagnostics, true);
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(Object.keys(disk).sort(), [
      "cursorTheme",
      "dataStrategy",
      "pointerLock",
      "renderScale",
      "showDiagnostics",
      "touchMode",
    ]);
  });
});
