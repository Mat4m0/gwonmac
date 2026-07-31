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
      // On since P3.34: the game's own cursor is what a Guild Wars player
      // expects to see, so the setting is how it is switched off.
      nativeCursor: true,
      // The first optional read-only feature stays opt-in.
      targetReadout: false,
      showDiagnostics: false,
      dataStrategy: null,
      // On by default since the 2026-07 UX revision, and declared as a
      // pre-checked line at first run. Unticking it is the one flag that stops
      // every network request nobody asked for, without exception.
      autoCheckUpdates: true,
      lastUpdateCheckAt: null,
      // No client build has been warned about yet, so every build warns once.
      compatibilityNoticeSeenFor: null,
    });
  });

  it("gives an alpha profile the game cursor and drops retired fields", () => {
    // A profile written before the cursor became a boolean carries
    // `cursorTheme` and a selectable input mode. They are unknown fields now,
    // so they are ignored rather than rejected: nothing else the player chose
    // may be lost with them.
    //
    // Such a profile also predates the default flip. It gets the new default
    // rather than the old one — an alpha install that never expressed a
    // preference is not an install that said no.
    const got = parseSettings({
      cursorTheme: "guild-wars-2",
      renderScale: 1,
      touchMode: "off",
      showDiagnostics: true,
      dataStrategy: "full",
    });
    assert.equal("cursorTheme" in got, false);
    assert.equal(got.nativeCursor, true);
    assert.deepEqual(got, {
      renderScale: 1,
      nativeCursor: true,
      targetReadout: false,
      showDiagnostics: true,
      dataStrategy: "full",
      autoCheckUpdates: true,
      lastUpdateCheckAt: null,
      compatibilityNoticeSeenFor: null,
    });
  });

  it("fills missing fields and ignores unknown keys on read", () => {
    assert.equal(parseSettings({}).renderScale, 2);
    const got = parseSettings({
      patchMode: "fullImage",
      renderScale: 2,
      mystery: true,
    });
    assert.equal("patchMode" in got, false);
    assert.equal(got.renderScale, 2);
    assert.equal("mystery" in got, false);
  });

  it("preserves every explicit supported render scale", () => {
    assert.equal(parseSettings({ renderScale: 1 }).renderScale, 1);
    assert.equal(parseSettings({ renderScale: 1.5 }).renderScale, 1.5);
    assert.equal(parseSettings({ renderScale: 2 }).renderScale, 2);
  });

  it("rejects unknown types", () => {
    assert.throws(() => parseSettings({ renderScale: 3 }), AppError);
    assert.throws(() => parseSettings({ nativeCursor: "yes" }), AppError);
    assert.throws(() => parseSettings({ targetReadout: 1 }), AppError);
    assert.throws(() => parseSettings({ dataStrategy: "automatic" }), AppError);
    assert.throws(() => parseSettings([]), AppError);
  });

  it("takes the update fields only in the shapes the renderer can produce", () => {
    assert.equal(parseSettings({ autoCheckUpdates: true }).autoCheckUpdates, true);
    assert.throws(() => parseSettings({ autoCheckUpdates: "yes" }), AppError);

    assert.equal(parseSettings({ lastUpdateCheckAt: null }).lastUpdateCheckAt, null);
    assert.equal(parseSettings({ lastUpdateCheckAt: 0 }).lastUpdateCheckAt, 0);
    assert.equal(
      parseSettings({ lastUpdateCheckAt: 1_800_000_000_000 }).lastUpdateCheckAt,
      1_800_000_000_000,
    );
    // Epoch milliseconds, not a date, not a duration, not a negative.
    assert.throws(() => parseSettings({ lastUpdateCheckAt: -1 }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: 1.5 }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: Number.NaN }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: 1e300 }), AppError);
    assert.throws(() => parseSettings({ lastUpdateCheckAt: "2026-07-26" }), AppError);
  });

  it("takes the acknowledged client build only as a client hash", () => {
    const hash = "b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483";
    assert.equal(
      parseSettings({ compatibilityNoticeSeenFor: hash })
        .compatibilityNoticeSeenFor,
      hash,
    );
    assert.equal(
      parseSettings({ compatibilityNoticeSeenFor: null })
        .compatibilityNoticeSeenFor,
      null,
    );
    // It names a build, so a boolean, a truncated hash or upper case — the
    // shapes a "notice shown" flag would arrive as — are all refused.
    assert.throws(() => parseSettings({ compatibilityNoticeSeenFor: true }), AppError);
    assert.throws(() => parseSettings({ compatibilityNoticeSeenFor: "b031" }), AppError);
    assert.throws(
      () => parseSettings({ compatibilityNoticeSeenFor: hash.toUpperCase() }),
      AppError,
    );
  });

  it("validates patches without filling fields from defaults", () => {
    assert.deepEqual(parseSettingsPatch({ nativeCursor: true }), {
      nativeCursor: true,
    });
    assert.deepEqual(parseSettingsPatch({ targetReadout: true }), {
      targetReadout: true,
    });
    assert.deepEqual(parseSettingsPatch({ lastUpdateCheckAt: 1_000 }), {
      lastUpdateCheckAt: 1_000,
    });
    assert.throws(() => parseSettingsPatch({ mystery: true }), AppError);
    assert.throws(() => parseSettingsPatch({ touchMode: "dbltap" }), AppError);
    // A renderer that still names the retired key is a bug, not a migration.
    assert.throws(() => parseSettingsPatch({ cursorTheme: "system" }), AppError);
  });

  it("loads defaults for missing or corrupt files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    const missing = await loadSettings(path);
    assert.deepEqual(missing, DEFAULT_SETTINGS);
    assert.equal(missing.renderScale, 2);
    await writeFile(path, "{not json");
    let backup = "";
    const corrupt = await loadSettings(path, (value) => {
      backup = value;
    });
    assert.deepEqual(corrupt, DEFAULT_SETTINGS);
    assert.equal(corrupt.renderScale, 2);
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
      "autoCheckUpdates",
      "compatibilityNoticeSeenFor",
      "dataStrategy",
      "formatVersion",
      "lastUpdateCheckAt",
      "nativeCursor",
      "renderScale",
      "showDiagnostics",
      "targetReadout",
    ]);
    assert.equal(disk.formatVersion, 1);
  });

  it("loads an alpha-written bare-JSON file with every value intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-settings-"));
    const path = join(dir, "settings.json");
    // Byte-for-byte what v0.0.1-alpha.1 wrote: no formatVersion, and retired
    // cursor/input keys that build had and this one does not.
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
      targetReadout: false,
      showDiagnostics: true,
      dataStrategy: "full",
      // Fields that alpha never wrote arrive at their defaults — deliberately
      // including the update check, which now defaults on: a profile that
      // never answered the question inherits the current default, while any
      // profile that completed first run carries its explicit answer and an
      // opt-out is therefore never overridden.
      autoCheckUpdates: true,
      lastUpdateCheckAt: null,
      compatibilityNoticeSeenFor: null,
    });
    // Nothing was moved aside, so the file the player had is still the file.
    assert.deepEqual(await readdir(dir), ["settings.json"]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), alpha);

    // The next save is the only thing that rewrites it. Unrelated values stay;
    // retired input and cursor fields disappear without a migration marker.
    await saveSettings(path, loaded);
    const rewritten = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(rewritten, {
      formatVersion: 1,
      ...loaded,
    });
    assert.equal("touchMode" in rewritten, false);
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
