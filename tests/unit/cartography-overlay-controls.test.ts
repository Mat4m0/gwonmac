import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CARTOGRAPHY_BUILTIN_PRESETS,
  type CartographyPresetLibrary,
} from "../../src/shared/cartography-overlay.js";
import {
  encodeCartographyPresetRef,
  parseCartographyPresetRef,
} from "../../src/renderer/cartography-preset-select.js";
import { describeCartographyQaStatus } from "../../src/renderer/cartography-spike/overlay-controls.js";

const library: CartographyPresetLibrary = {
  activePreset: { kind: "builtin", id: "cartographer" },
  customPresets: [{
    id: "mine",
    name: "Night route",
    style: CARTOGRAPHY_BUILTIN_PRESETS.monochrome.style,
  }],
};

const worldObserver = {
  status: 0, sequence: 0, generation: 0, frameId: 0, visible: 0,
  continent: 0, zoom: 0,
  topLeftX: 0, topLeftY: 0, bottomRightX: 0, bottomRightY: 0,
} as const;

test("Cartography preset references round-trip only known presets", () => {
  assert.deepEqual(parseCartographyPresetRef("builtin:cartographer", library), {
    kind: "builtin", id: "cartographer",
  });
  assert.deepEqual(parseCartographyPresetRef("custom:mine", library), {
    kind: "custom", id: "mine",
  });
  assert.equal(
    encodeCartographyPresetRef({ kind: "builtin", id: "monochrome" }),
    "builtin:monochrome",
  );
  for (const value of [
    "", "cartographer", "builtin:", "builtin:unknown", "custom:", "custom:missing",
    "other:mine", "custom:mine:extra",
  ]) {
    assert.equal(parseCartographyPresetRef(value, library), null, value);
  }
});

test("compact Cartography controls avoid frame-loop layout reads and static inline paint", () => {
  const controls = readFileSync(
    "src/renderer/cartography-spike/overlay-controls.ts",
    "utf8",
  );
  assert.doesNotMatch(controls, /offsetHeight|style\.cssText/u);
  assert.match(controls, /canonical !== settings/u);
  assert.match(controls, /boxChanged \|\| becameVisible/u);
});

test("unsupported areas hide the Cartography control with every overlay layer", () => {
  const overlay = readFileSync("src/renderer/cartography-spike/overlay.ts", "utf8");
  assert.match(
    overlay,
    /state\.continent\.reason === "unsupported-area"[\s\S]*controls\.hide\(\);[\s\S]*return;/u,
  );
});

test("Cartography QA status distinguishes loading from exact kernel failures", () => {
  assert.deepEqual(describeCartographyQaStatus({
    status: "unavailable",
    reason: "loading",
    worldMapObserver: worldObserver,
    kernel: null,
  }), {
    tone: "loading",
    summary: "Loading",
    rows: [
      ["Reason", "loading"],
      ["World observer", "not-published · frame 0 · generation 0"],
    ],
  });
  const failed = describeCartographyQaStatus({
    status: "unavailable",
    reason: "kernel",
    worldMapObserver: worldObserver,
    kernel: {
      status: 7,
      sequence: 2,
      mapId: 194,
      areaEpoch: 8,
      layoutId: 1,
      width: 256,
      height: 512,
      resourceGeneration: 3,
      totalTrapezoids: 4_500,
      reachableTrapezoids: 0,
      groundCells: 0,
      doorwayCount: 0,
      terrainWidth: 0,
      terrainHeight: 0,
    },
  });
  assert.equal(failed.tone, "unavailable");
  assert.equal(failed.summary, "Unavailable · kernel/plane-limit");
  assert.deepEqual(failed.rows[0], ["Reason", "kernel/plane-limit"]);
});

test("Cartography QA ready status reports player-facing classification counts", () => {
  const ready = describeCartographyQaStatus({
    status: "ready",
    continentId: 1,
    exploredCreditableCells: 4_500,
    remainingCells: 120,
    compassReady: true,
    missionMapReady: false,
    worldMapReady: false,
    worldMapObserver: worldObserver,
    currentInstance: {
      status: "ready",
      mapId: 58,
      areaEpoch: 3,
      resourceGeneration: 2,
      terrain: { width: 256, height: 272, mapUnitsPerPixel: 2 },
      reachableCells: 228,
      actionableCells: 92,
    },
    kernel: null,
  });
  assert.equal(ready.summary, "Ready · 92 targets here");
  assert.ok(ready.rows.some(([label, value]) =>
    label === "Guidance" && value === "92 targets here · 228 reachable cells"));
});

test("Cartography QA keeps continent progress visible without current guidance", () => {
  const ready = describeCartographyQaStatus({
    status: "ready",
    continentId: 2,
    exploredCreditableCells: 7_000,
    remainingCells: 31,
    compassReady: false,
    missionMapReady: true,
    worldMapReady: true,
    worldMapObserver: worldObserver,
    currentInstance: { status: "unavailable", reason: "kernel" },
    kernel: null,
  });
  assert.equal(ready.tone, "ready");
  assert.equal(ready.summary, "Continent ready · 31 remaining");
  assert.ok(ready.rows.some(([label, value]) =>
    label === "Current guidance" && value === "Unavailable · kernel"));
});
