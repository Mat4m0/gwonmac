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
      "formatVersion",
      "nativeCursor",
      "renderScale",
      "showDiagnostics",
      "touchMode",
    ]);
    assert.equal(disk.formatVersion, 1);
  });

  it("loads an alpha-written bare-JSON file with every value intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    // Byte-for-byte what v0.0.1-alpha.1 wrote: no formatVersion, and a
    // `cursorTheme` key that build had and this one does not.
    const alpha = {
      renderScale: 1.5,
      nativeCursor: true,
      touchMode: "translate",
      showDiagnostics: true,
      dataStrategy: "full",
      cursorTheme: "guild-wars-2",
    };
    await writeFile(path, JSON.stringify(alpha));

    let recovered = "";
    const loaded = await loadSettings(path, (backup) => {
      recovered = backup;
    });
    assert.equal(recovered, "", "an alpha profile must not be treated as corrupt");
    assert.deepEqual(loaded, {
      renderScale: 1.5,
      nativeCursor: true,
      touchMode: "translate",
      showDiagnostics: true,
      dataStrategy: "full",
    });
    // Nothing was moved aside, so the file the player had is still the file.
    assert.deepEqual(await readdir(dir), ["settings.json"]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), alpha);

    // The next save is the only thing that rewrites it, and it keeps the values.
    await saveSettings(path, loaded);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      ...loaded,
    });
    assert.deepEqual(await loadSettings(path), loaded);
  });

  it("keeps the three newest corrupt backups and drops the rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    for (const epoch of [1000, 2000, 3000, 4000]) {
      await writeFile(`${path}.corrupt-${epoch}`, `stale ${epoch}`);
    }
    // Neighbours in the same profile directory that this must not touch.
    await writeFile(join(dir, "window-state.json"), "{}");
    await writeFile(`${path}.corrupt-not-an-epoch`, "hand-written");
    await writeFile(path, "{not json");

    let backup = "";
    await loadSettings(path, (value) => {
      backup = value;
    });
    const kept = (await readdir(dir)).sort();
    assert.deepEqual(kept, [
      "settings.json.corrupt-3000",
      "settings.json.corrupt-4000",
      "settings.json.corrupt-not-an-epoch",
      backup.split("/").at(-1),
      "window-state.json",
    ].sort());
    // The newest three are the new one and the two most recent older ones.
    assert.equal(await readFile(`${path}.corrupt-4000`, "utf8"), "stale 4000");
    assert.equal(await readFile(backup, "utf8"), "{not json");
  });

  it("moves aside a settings format this build cannot read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const future = { formatVersion: 2, renderScale: 1, touchMode: "off" };
    await writeFile(path, JSON.stringify(future));
    assert.throws(() => parseSettings(future), AppError);

    let backup = "";
    assert.deepEqual(
      await loadSettings(path, (value) => {
        backup = value;
      }),
      DEFAULT_SETTINGS,
    );
    // Refused, not reinterpreted, and not destroyed: the bytes are still there.
    assert.deepEqual(JSON.parse(await readFile(backup, "utf8")), future);
  });
});
