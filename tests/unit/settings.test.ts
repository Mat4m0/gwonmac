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
      renderScale: 2,
      nativeCursor: false,
      touchMode: "dbltap",
      showDiagnostics: false,
      dataStrategy: null,
    });
  });

  it("keeps the game cursor opt-in and drops the retired theme key", () => {
    // A profile written before the cursor became a boolean carries
    // `cursorTheme`. It is an unknown field, so it is ignored rather than
    // rejected: nothing else the player chose may be lost with it.
    const got = parseSettings({
      cursorTheme: "guild-wars-2",
      renderScale: 1,
      touchMode: "off",
      showDiagnostics: true,
      dataStrategy: "full",
    });
    assert.equal("cursorTheme" in got, false);
    assert.equal(got.nativeCursor, false);
    assert.deepEqual(got, {
      renderScale: 1,
      nativeCursor: false,
      touchMode: "off",
      showDiagnostics: true,
      dataStrategy: "full",
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
    assert.equal("mystery" in got, false);
  });

  it("rejects unknown types", () => {
    assert.throws(() => parseSettings({ renderScale: 3 }), AppError);
    assert.throws(() => parseSettings({ nativeCursor: "yes" }), AppError);
    assert.throws(() => parseSettings({ touchMode: "hover" }), AppError);
    assert.throws(() => parseSettings({ dataStrategy: "automatic" }), AppError);
    assert.throws(() => parseSettings([]), AppError);
  });

  it("validates patches without filling fields from defaults", () => {
    assert.deepEqual(parseSettingsPatch({ nativeCursor: true }), {
      nativeCursor: true,
    });
    assert.throws(() => parseSettingsPatch({ mystery: true }), AppError);
    // A renderer that still names the retired key is a bug, not a migration.
    assert.throws(() => parseSettingsPatch({ cursorTheme: "system" }), AppError);
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
      "dataStrategy",
      "nativeCursor",
      "renderScale",
      "showDiagnostics",
      "touchMode",
    ]);
  });
});
