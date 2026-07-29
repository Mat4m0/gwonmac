import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../../src/shared/errors.js";
import {
  defaultWindowState,
  fitWindowStateToDisplays,
  loadWindowState,
  parseWindowState,
  saveWindowState,
} from "../../src/main/core/window-state.js";

describe("window state", () => {
  it("validates and round-trips owner-only state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-window-state-"));
    const path = join(dir, "window-state.json");
    const value = {
      bounds: { x: -1200, y: 40, width: 1280, height: 800 },
      mode: "fullscreen" as const,
    };
    await saveWindowState(path, value);
    assert.deepEqual(await loadWindowState(path), value);
    if (process.platform !== "win32") {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    assert.throws(
      () => parseWindowState({ ...value, mode: "minimized" }),
      AppError,
    );
  });

  it("restores an alpha window written without a format version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-window-state-"));
    const path = join(dir, "window-state.json");
    const alpha = {
      bounds: { x: 120, y: 64, width: 1024, height: 768 },
      mode: "maximized" as const,
    };
    await writeFile(path, JSON.stringify(alpha));

    let invalid = false;
    const loaded = await loadWindowState(path, () => {
      invalid = true;
    });
    assert.equal(invalid, false, "an alpha window must not be discarded");
    assert.deepEqual(loaded, alpha);

    await saveWindowState(path, loaded!);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      ...alpha,
    });
    assert.deepEqual(await loadWindowState(path), alpha);
  });

  it("discards a window-state format this build cannot read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-window-state-"));
    const path = join(dir, "window-state.json");
    await writeFile(
      path,
      JSON.stringify({
        formatVersion: 2,
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        mode: "normal",
      }),
    );
    let invalid = false;
    assert.equal(
      await loadWindowState(path, () => {
        invalid = true;
      }),
      null,
    );
    assert.equal(invalid, true);
  });

  it("removes corrupt state and falls back cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gw-window-state-"));
    const path = join(dir, "window-state.json");
    await writeFile(path, "{broken");
    assert.equal(await loadWindowState(path), null);
    assert.equal(await loadWindowState(path), null);
  });

  it("keeps visible windows on their display and clamps oversized bounds", () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1050 };
    const secondary = { x: -1440, y: 0, width: 1440, height: 900 };
    const state = {
      bounds: { x: -1500, y: -30, width: 1800, height: 1200 },
      mode: "maximized" as const,
    };
    assert.deepEqual(
      fitWindowStateToDisplays(state, [primary, secondary], primary),
      {
        bounds: { x: -1440, y: 0, width: 1440, height: 900 },
        mode: "maximized",
      },
    );
  });

  it("centers state on the primary display when its monitor disappeared", () => {
    const primary = { x: 0, y: 25, width: 1728, height: 1080 };
    const state = {
      bounds: { x: 4000, y: 100, width: 1280, height: 800 },
      mode: "normal" as const,
    };
    assert.deepEqual(
      fitWindowStateToDisplays(state, [primary], primary),
      {
        bounds: { x: 224, y: 165, width: 1280, height: 800 },
        mode: "normal",
      },
    );
    assert.deepEqual(defaultWindowState(primary), {
      bounds: { x: 224, y: 165, width: 1280, height: 800 },
      mode: "normal",
    });
  });

  it("keeps the default window distinct from a constrained work area", () => {
    const primary = { x: 0, y: 25, width: 1024, height: 684 };
    assert.deepEqual(defaultWindowState(primary), {
      bounds: { x: 32, y: 57, width: 960, height: 620 },
      mode: "normal",
    });
  });
});
