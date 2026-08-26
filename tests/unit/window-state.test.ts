import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../../src/shared/errors.js";
import {
  defaultWindowState,
  cascadeWindowState,
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
      displayWorkArea: { x: -1440, y: 0, width: 1440, height: 900 },
    };
    await saveWindowState(path, value);
    assert.deepEqual(await loadWindowState(path), value);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
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
    assert.ok(loaded);
    assert.deepEqual(loaded, alpha);
    assert.deepEqual(parseWindowState({ formatVersion: 1, ...alpha }), alpha);
    assert.throws(
      () => parseWindowState({
        formatVersion: 1,
        ...alpha,
        displayWorkArea: { x: 0, y: 0, width: 0, height: 900 },
      }),
      AppError,
    );

    const workArea = { x: 0, y: 25, width: 1728, height: 1080 };
    const migrated = fitWindowStateToDisplays(loaded, [workArea], workArea);
    await saveWindowState(path, migrated);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      formatVersion: 1,
      ...migrated,
    });
    assert.deepEqual(await loadWindowState(path), migrated);
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
        displayWorkArea: secondary,
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
        displayWorkArea: primary,
      },
    );
    assert.deepEqual(defaultWindowState(primary), {
      bounds: { x: 224, y: 165, width: 1280, height: 800 },
      mode: "normal",
      displayWorkArea: primary,
    });
  });

  it("keeps the default window distinct from a constrained work area", () => {
    const primary = { x: 0, y: 25, width: 1024, height: 684 };
    assert.deepEqual(defaultWindowState(primary), {
      bounds: { x: 32, y: 57, width: 960, height: 620 },
      mode: "normal",
      displayWorkArea: primary,
    });
  });

  const proportionalCases = [
    {
      name: "an unchanged work area",
      savedArea: { x: 0, y: 25, width: 1920, height: 1055 },
      bounds: { x: 576, y: 236, width: 960, height: 633 },
      workAreas: [{ x: 0, y: 25, width: 1920, height: 1055 }],
      primary: { x: 0, y: 25, width: 1920, height: 1055 },
      expectedArea: { x: 0, y: 25, width: 1920, height: 1055 },
      expectedBounds: { x: 576, y: 236, width: 960, height: 633 },
    },
    {
      name: "a larger work area",
      savedArea: { x: 0, y: 25, width: 1920, height: 1055 },
      bounds: { x: 576, y: 236, width: 960, height: 633 },
      workAreas: [{ x: 0, y: 25, width: 2560, height: 1400 }],
      primary: { x: 0, y: 25, width: 2560, height: 1400 },
      expectedArea: { x: 0, y: 25, width: 2560, height: 1400 },
      expectedBounds: { x: 768, y: 305, width: 1280, height: 840 },
    },
    {
      name: "a smaller work area constrained by minimum window size",
      savedArea: { x: 0, y: 25, width: 1920, height: 1055 },
      bounds: { x: 576, y: 236, width: 960, height: 633 },
      workAreas: [{ x: 0, y: 25, width: 1024, height: 684 }],
      primary: { x: 0, y: 25, width: 1024, height: 684 },
      expectedArea: { x: 0, y: 25, width: 1024, height: 684 },
      expectedBounds: { x: 134, y: 67, width: 800, height: 600 },
    },
    {
      name: "a missing display",
      savedArea: { x: 2000, y: 25, width: 1920, height: 1055 },
      bounds: { x: 2576, y: 236, width: 960, height: 633 },
      workAreas: [{ x: 0, y: 25, width: 1728, height: 1080 }],
      primary: { x: 0, y: 25, width: 1728, height: 1080 },
      expectedArea: { x: 0, y: 25, width: 1728, height: 1080 },
      expectedBounds: { x: 432, y: 241, width: 864, height: 648 },
    },
    {
      name: "the matching display in a multi-display layout",
      savedArea: { x: 1728, y: 25, width: 1920, height: 1055 },
      bounds: { x: 2304, y: 236, width: 960, height: 633 },
      workAreas: [
        { x: 0, y: 25, width: 1728, height: 1080 },
        { x: 1728, y: 25, width: 2560, height: 1400 },
      ],
      primary: { x: 0, y: 25, width: 1728, height: 1080 },
      expectedArea: { x: 1728, y: 25, width: 2560, height: 1400 },
      expectedBounds: { x: 2496, y: 305, width: 1280, height: 840 },
    },
  ] as const;

  for (const testCase of proportionalCases) {
    it(`restores relative geometry on ${testCase.name}`, () => {
      assert.deepEqual(
        fitWindowStateToDisplays(
          {
            bounds: testCase.bounds,
            mode: "normal",
            displayWorkArea: testCase.savedArea,
          },
          [...testCase.workAreas],
          testCase.primary,
        ),
        {
          bounds: testCase.expectedBounds,
          mode: "normal",
          displayWorkArea: testCase.expectedArea,
        },
      );
    });
  }

  it("cascades new account windows by 32px and clamps them", () => {
    const workArea = { x: 0, y: 24, width: 1600, height: 1000 };
    const base = defaultWindowState(workArea);

    assert.deepEqual(cascadeWindowState(base, 1, workArea).bounds, {
      ...base.bounds,
      x: base.bounds.x + 32,
      y: base.bounds.y + 32,
    });
    assert.deepEqual(cascadeWindowState(base, 20, workArea).bounds, {
      x: workArea.x + workArea.width - base.bounds.width,
      y: workArea.y + workArea.height - base.bounds.height,
      width: base.bounds.width,
      height: base.bounds.height,
    });
  });
});
