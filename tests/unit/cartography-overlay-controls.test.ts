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
import {
  cartographyOverlayDisposition,
} from "../../src/renderer/cartography-spike/overlay.js";
import type { CartographyState } from
  "../../src/renderer/cartography-spike/cartography-model.js";

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
  assert.match(controls, /boxChanged \|\| placementChanged \|\| becameVisible/u);
});

test("Cartography controls open only by click and remain open after pointer movement", () => {
  const controls = readFileSync(
    "src/renderer/cartography-spike/overlay-controls.ts",
    "utf8",
  );
  assert.match(controls, /trigger\.addEventListener\("click", \(\) => setOpen\(!open\)\)/u);
  assert.doesNotMatch(controls, /pointerenter|pointerleave|matches\(":hover"\)|transient|collapseTimer/u);
  assert.match(controls, /if \(open && event\.target instanceof Node/u);
});

test("Compass range controls open only by click", () => {
  const controls = readFileSync(
    "src/renderer/cartography-spike/compass-range-controls.ts",
    "utf8",
  );
  assert.match(
    controls,
    /trigger\.addEventListener\("click", \(\) => setOpen\(!open\)\)/u,
  );
  assert.doesNotMatch(
    controls,
    /pointerenter|pointerleave|focusin|focusout|matches\(":hover"\)|collapseTimer/u,
  );
  assert.match(controls, /if \(open && event\.target instanceof Node/u);
  assert.match(controls, /allButton\.addEventListener\("click", toggleAll\)/u);
});

test("compact Cartography panel keeps guidance progressively disclosed", () => {
  const controls = readFileSync(
    "src/renderer/cartography-spike/overlay-controls.ts",
    "utf8",
  );
  assert.doesNotMatch(controls, /cartography-overlay-hint|Hold <kbd>|Numbers: solid/u);
  assert.match(controls, /const qa = document\.createElement\("details"\)/u);
});

test("unsupported areas and transient failures leave controls available", () => {
  const unavailable = (reason: "unsupported-area" | "loading"): CartographyState => ({
    context: null,
    continent: { status: "unavailable", reason },
    currentInstance: { status: "unavailable", reason },
    surfaces: { compass: null, missionMap: null, worldMap: null },
  });
  assert.equal(cartographyOverlayDisposition(unavailable("unsupported-area")), "controls-only");
  assert.equal(cartographyOverlayDisposition(unavailable("loading")), "controls-only");
});

test("Cartography QA status distinguishes loading from exact kernel failures", () => {
  assert.deepEqual(describeCartographyQaStatus({
    continent: { status: "unavailable", reason: "loading" },
    currentInstance: { status: "unavailable", reason: "loading" },
    compassReady: false,
    missionMapReady: false,
    worldMapReady: false,
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
    continent: { status: "unavailable", reason: "kernel" },
    currentInstance: { status: "unavailable", reason: "kernel" },
    compassReady: false,
    missionMapReady: false,
    worldMapReady: false,
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
    continent: {
      status: "ready",
      continentId: 1,
      exploredCreditableCells: 4_500,
      remainingCells: 120,
    },
    compassReady: true,
    missionMapReady: false,
    worldMapReady: false,
    worldMapObserver: worldObserver,
    currentInstance: {
      status: "ready",
      sequence: 4,
      mapId: 58,
      areaEpoch: 3,
      resourceGeneration: 2,
      terrain: { width: 256, height: 272, mapUnitsPerPixel: 2 },
      reachableCells: 228,
      guidance: { status: "ready", actionableCells: 92 },
    },
    kernel: null,
  });
  assert.equal(ready.summary, "Ready · 92 targets here");
  assert.ok(ready.rows.some(([label, value]) =>
    label === "Guidance" && value === "92 targets here · 228 reachable cells"));
});

test("Cartography QA keeps continent progress visible without current guidance", () => {
  const ready = describeCartographyQaStatus({
    continent: {
      status: "ready",
      continentId: 2,
      exploredCreditableCells: 7_000,
      remainingCells: 31,
    },
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
    label === "Walkable" && value === "Unavailable · kernel"));
});

test("Cartography QA explains terrain-only areas", () => {
  const limited = describeCartographyQaStatus({
    continent: { status: "unavailable", reason: "unsupported-area" },
    currentInstance: {
      status: "ready",
      sequence: 4,
      mapId: 495,
      areaEpoch: 9,
      resourceGeneration: 3,
      terrain: { width: 128, height: 96, mapUnitsPerPixel: 2 },
      reachableCells: 81,
      guidance: { status: "unavailable", reason: "unsupported-area" },
    },
    compassReady: true,
    missionMapReady: true,
    worldMapReady: false,
    worldMapObserver: worldObserver,
    kernel: null,
  });
  assert.equal(limited.tone, "limited");
  assert.equal(limited.summary, "Limited · Walkable terrain ready");
  assert.ok(limited.rows.some(([label, value]) =>
    label === "Grid" && value === "Unavailable in this area"));
});
