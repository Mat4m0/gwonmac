/**
 * Owns presentation of immutable Cartography models through independent surfaces.
 * Native observation and semantic classification never occur on animation frames.
 */
import { resolveCartographyPreset } from "../../shared/cartography-presets.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import {
  bitsetHasCell,
  readCartographyModel,
  type CartographyModel,
  type CartographyModelSources,
} from "./cartography-model.js";
import {
  createCartographyGridLayer,
  type CartographyGridLayerSnapshot,
} from "./cartography-grid-layer.js";
import {
  cartographyCellAtScreenPoint,
  projectCartographyGridToCompass,
  projectCartographyGridToMissionMap,
} from "./cartography-grid-projection.js";
import { cartographyHoverRevealRadius } from "./cartography-paint.js";
import { projectMissionMapFrame, projectNativeFrame } from "./frame-placement.js";
import { createInverseMaskLayer } from "./inverse-mask-layer.js";
import {
  GAME_UNITS_PER_MAP_UNIT,
  projectMissionMapContentBox,
  projectTerrainToCompass,
  projectTerrainToMissionMap,
} from "./map-projections.js";
import { createCartographyOverlayControls } from "./overlay-controls.js";
import {
  createWalkableTerrainSurface,
  type WalkableTerrainSurface,
} from "./walkable-terrain-surface.js";

const MODEL_POLL_MS = 200;

export type CartographyGridStats = Readonly<{
  compass: CartographyGridLayerSnapshot | null;
  missionMap: CartographyGridLayerSnapshot | null;
}>;

export type CartographyModelStats =
  | Readonly<{ status: "unavailable"; reason: string }>
  | Readonly<{
      status: "ready";
      sequence: number;
      mapId: number;
      areaEpoch: number;
      resourceGeneration: number;
      terrain: Readonly<{ width: number; height: number; mapUnitsPerPixel: number }>;
      reachableCells: number;
      actionableCells: number;
      compassReady: boolean;
      missionMapReady: boolean;
    }>;

function countSetBits(words: Uint32Array): number {
  let count = 0;
  for (const source of words) {
    let word = source;
    while (word !== 0) {
      word &= word - 1;
      count += 1;
    }
  }
  return count;
}

export function mountCartographyOverlay(options: Readonly<{
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  modelSources: CartographyModelSources;
  settings(): AppSettings;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
}>): () => void {
  const document = options.parent.ownerDocument;
  const view = document.defaultView;
  if (view === null) throw new Error("cartography overlay requires a live document");
  const compassTerrainLayer = createInverseMaskLayer(
    options.parent,
    "cartography-compass-mask",
  );
  const missionTerrainLayer = createInverseMaskLayer(
    options.parent,
    "cartography-mission-map-mask",
  );
  const compassGridLayer = createCartographyGridLayer(
    options.parent,
    "cartography-compass-grid",
  );
  const missionGridLayer = createCartographyGridLayer(
    options.parent,
    "cartography-mission-map-grid",
  );
  let previewGridOpacity: number | null = null;
  let previewWalkabilityOpacity: number | null = null;
  const controls = createCartographyOverlayControls({
    parent: options.parent,
    persist: options.persist,
    previewOpacity(layer, opacity) {
      if (layer === "grid") previewGridOpacity = opacity;
      else previewWalkabilityOpacity = opacity;
    },
  });

  let animationFrame = 0;
  let startupTimer = 0;
  let disposed = false;
  let model: CartographyModel = Object.freeze({ status: "unavailable", reason: "context" });
  let nextModelPoll = 0;
  let terrainKey = "";
  let terrain: WalkableTerrainSurface | null = null;
  let pointerX = Number.NaN;
  let pointerY = Number.NaN;
  let shiftHeld = false;
  let optionHeld = false;

  const rememberPointer = (event: PointerEvent): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    shiftHeld = event.shiftKey;
    optionHeld = event.altKey;
  };
  const rememberModifiers = (event: KeyboardEvent): void => {
    shiftHeld = event.shiftKey;
    optionHeld = event.altKey;
  };
  const forgetPointer = (): void => {
    pointerX = Number.NaN;
    pointerY = Number.NaN;
    shiftHeld = false;
    optionHeld = false;
  };
  const forgetHiddenPointer = (): void => {
    if (document.visibilityState === "hidden") forgetPointer();
  };
  view.addEventListener("pointermove", rememberPointer, { capture: true, passive: true });
  view.addEventListener("keydown", rememberModifiers, true);
  view.addEventListener("keyup", rememberModifiers, true);
  view.addEventListener("blur", forgetPointer);
  document.addEventListener("visibilitychange", forgetHiddenPointer);

  const hideCompass = (): void => {
    compassGridLayer.hide();
    compassTerrainLayer.hide();
    controls.hide();
  };
  const hideMission = (): void => {
    missionGridLayer.hide();
    missionTerrainLayer.hide();
  };
  const hideAll = (): void => {
    hideCompass();
    hideMission();
  };
  const gridStats = (): CartographyGridStats => Object.freeze({
    compass: compassGridLayer.snapshot(),
    missionMap: missionGridLayer.snapshot(),
  });
  view.gwCartographyGridStats = gridStats;
  const modelStats = (): CartographyModelStats => model.status === "unavailable"
    ? Object.freeze({ status: "unavailable", reason: model.reason })
    : Object.freeze({
        status: "ready",
        sequence: model.sequence,
        mapId: model.epoch.mapId,
        areaEpoch: model.epoch.area,
        resourceGeneration: model.epoch.resource,
        terrain: Object.freeze({
          width: model.walkableTerrain.width,
          height: model.walkableTerrain.height,
          mapUnitsPerPixel: model.walkableTerrain.mapUnitsPerPixel,
        }),
        reachableCells: countSetBits(model.reachableCells.words),
        actionableCells: countSetBits(model.actionableCells.words),
        compassReady: model.surfaces.compass !== null,
        missionMapReady: model.surfaces.missionMap !== null,
      });
  view.gwCartographyModelStats = modelStats;

  const safe = (surface: "compass" | "mission-map", render: () => void): void => {
    try {
      render();
    } catch (cause) {
      if (surface === "compass") hideCompass();
      else hideMission();
      console.error(`[cartography] ${surface} rendering failed`, cause);
    }
  };

  const render = (): void => {
    const now = view.performance.now();
    if (now >= nextModelPoll) {
      model = readCartographyModel(options.modelSources);
      nextModelPoll = now + MODEL_POLL_MS;
    }
    if (model.status !== "ready") {
      terrainKey = "";
      terrain = null;
      hideAll();
      return;
    }
    const settings = options.settings();
    const style = resolveCartographyPreset(settings.cartographyPresetLibrary);
    if (style === null) {
      hideAll();
      return;
    }
    const gridOpacity = previewGridOpacity ?? settings.cartographyGridOpacity;
    const walkabilityOpacity = previewWalkabilityOpacity
      ?? settings.cartographyWalkabilityOpacity;
    const revealRadius = settings.cartographyRevealMode === "birds-eye" ? 3 : 1;
    const version = [
      model.epoch.mapId,
      model.epoch.area,
      model.epoch.resource,
      model.sequence,
    ].join(":");
    const nextTerrainKey = `${model.epoch.area}:${model.epoch.resource}`;
    if (nextTerrainKey !== terrainKey) {
      terrain = createWalkableTerrainSurface(document, model.walkableTerrain);
      terrainKey = terrain === null ? "" : nextTerrainKey;
    }
    const isExplored = (x: number, y: number): boolean | null => {
      if (model.status !== "ready") return null;
      return bitsetHasCell(model.exploration, { x, y });
    };
    const isActionable = (x: number, y: number): boolean | null => {
      if (model.status !== "ready") return null;
      return bitsetHasCell(model.actionableCells, { x, y }) === true ? true : null;
    };
    const canvasBox = options.canvas.getBoundingClientRect();

    safe("compass", () => {
      if (model.status !== "ready" || model.surfaces.compass === null) {
        hideCompass();
        return;
      }
      const compass = model.surfaces.compass;
      const box = projectNativeFrame(compass, canvasBox);
      if (box === null) {
        hideCompass();
        return;
      }
      const playerMapX = model.worldAnchor.x + model.player.x / GAME_UNITS_PER_MAP_UNIT;
      const playerMapY = model.worldAnchor.y - model.player.y / GAME_UNITS_PER_MAP_UNIT;
      if (settings.cartographyGridEnabled) {
        const projection = projectCartographyGridToCompass({
          frame: { generation: model.epoch.area, playerMapX, playerMapY },
          compass,
          box,
        });
        if (projection === null) compassGridLayer.hide();
        else compassGridLayer.update({
          projection,
          style: style.grid,
          opacity: gridOpacity,
          explorationVersion: version,
          isExplored,
          revealabilityVersion: version,
          canCurrentMapReveal: isActionable,
          hoveredCell: null,
          revealRadius,
        });
      } else compassGridLayer.hide();
      if (settings.cartographyOverlayEnabled && terrain !== null) {
        const projection = projectTerrainToCompass({
          box,
          terrain,
          playerMapX,
          playerMapY,
          directionX: compass.compassDirectionX,
          directionY: compass.compassDirectionY,
        });
        if (projection === null) compassTerrainLayer.hide();
        else compassTerrainLayer.update({
          projection,
          terrain,
          version: nextTerrainKey,
          style: style.walkability,
          opacity: walkabilityOpacity,
        });
      } else compassTerrainLayer.hide();
      controls.update(box, settings);
    });

    safe("mission-map", () => {
      if (
        model.status !== "ready"
        || model.surfaces.compass === null
        || model.surfaces.missionMap === null
      ) {
        hideMission();
        return;
      }
      const mission = model.surfaces.missionMap;
      const outerBox = projectMissionMapFrame(
        mission,
        model.surfaces.compass,
        canvasBox,
      );
      const box = outerBox === null ? null : projectMissionMapContentBox(mission, outerBox);
      if (box === null) {
        hideMission();
        return;
      }
      if (settings.cartographyGridEnabled) {
        const projection = projectCartographyGridToMissionMap({ frame: mission, box });
        if (projection === null) missionGridLayer.hide();
        else {
          const hoveredCell = shiftHeld
            ? cartographyCellAtScreenPoint(projection, pointerX, pointerY)
            : null;
          missionGridLayer.update({
            projection,
            style: style.grid,
            opacity: gridOpacity,
            explorationVersion: version,
            isExplored,
            revealabilityVersion: version,
            canCurrentMapReveal: isActionable,
            hoveredCell,
            revealRadius: hoveredCell === null
              ? revealRadius
              : cartographyHoverRevealRadius(shiftHeld, optionHeld),
          });
        }
      } else missionGridLayer.hide();
      if (settings.cartographyOverlayEnabled && terrain !== null) {
        const projection = projectTerrainToMissionMap({ frame: mission, box, terrain });
        if (projection === null) missionTerrainLayer.hide();
        else missionTerrainLayer.update({
          projection,
          terrain,
          version: nextTerrainKey,
          style: style.walkability,
          opacity: walkabilityOpacity,
        });
      } else missionTerrainLayer.hide();
    });
  };

  const update = (): void => {
    if (disposed) return;
    render();
    if (!disposed) animationFrame = view.requestAnimationFrame(update);
  };
  startupTimer = view.setTimeout(() => {
    startupTimer = 0;
    if (!disposed) animationFrame = view.requestAnimationFrame(update);
  });

  return () => {
    disposed = true;
    if (startupTimer !== 0) view.clearTimeout(startupTimer);
    view.cancelAnimationFrame(animationFrame);
    view.removeEventListener("pointermove", rememberPointer, true);
    view.removeEventListener("keydown", rememberModifiers, true);
    view.removeEventListener("keyup", rememberModifiers, true);
    view.removeEventListener("blur", forgetPointer);
    document.removeEventListener("visibilitychange", forgetHiddenPointer);
    compassTerrainLayer.dispose();
    missionTerrainLayer.dispose();
    compassGridLayer.dispose();
    missionGridLayer.dispose();
    controls.dispose();
    if (view.gwCartographyGridStats === gridStats) delete view.gwCartographyGridStats;
    if (view.gwCartographyModelStats === modelStats) delete view.gwCartographyModelStats;
  };
}
