/**
 * Owns presentation of immutable Cartography models through independent surfaces.
 * Native observation and semantic classification never occur on animation frames.
 */
import { resolveCartographyPreset } from "../../shared/cartography-presets.js";
import type {
  CartographyEvidenceCapture,
  CartographyEvidenceExportResult,
} from "../../shared/cartography-evidence.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import {
  bitsetHasCell,
  readCartographyModel,
  readCartographyPresentation,
  type CartographyModel,
  type CartographyModelSources,
  type CartographyPresentation,
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
import { captureCartographyEvidence } from "./evidence-capture.js";
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
  | Readonly<{
      status: "unavailable";
      reason: string;
      kernel: ReturnType<CartographyModelSources["kernel"]["diagnostic"]>;
    }>
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
      kernel: ReturnType<CartographyModelSources["kernel"]["diagnostic"]>;
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

function bitsetsEqual(
  left: Readonly<{ width: number; height: number; words: Uint32Array }>,
  right: Readonly<{ width: number; height: number; words: Uint32Array }>,
): boolean {
  return left.width === right.width
    && left.height === right.height
    && left.words.length === right.words.length
    && left.words.every((word, index) => word === right.words[index]);
}

export function mountCartographyOverlay(options: Readonly<{
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  modelSources: CartographyModelSources;
  settings(): AppSettings;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
  exportEvidence(
    capture: CartographyEvidenceCapture,
  ): Promise<CartographyEvidenceExportResult>;
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
    exportEvidence: () => options.exportEvidence(
      captureCartographyEvidence(model, options.modelSources),
    ),
  });

  let animationFrame = 0;
  let startupTimer = 0;
  let disposed = false;
  let model: CartographyModel = Object.freeze({ status: "unavailable", reason: "context" });
  let presentation: CartographyPresentation = Object.freeze({
    player: null,
    compass: null,
    missionMap: null,
  });
  let nextModelPoll = 0;
  let explorationVersion = 0;
  let actionabilityVersion = 0;
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

  const hideCompassLayers = (): void => {
    compassGridLayer.hide();
    compassTerrainLayer.hide();
  };
  const hideMission = (): void => {
    missionGridLayer.hide();
    missionTerrainLayer.hide();
  };
  const hideAllLayers = (): void => {
    hideCompassLayers();
    hideMission();
  };
  const gridStats = (): CartographyGridStats => Object.freeze({
    compass: compassGridLayer.snapshot(),
    missionMap: missionGridLayer.snapshot(),
  });
  view.gwCartographyGridStats = gridStats;
  const modelStats = (): CartographyModelStats => model.status === "unavailable"
    ? Object.freeze({
        status: "unavailable",
        reason: model.reason,
        kernel: options.modelSources.kernel.diagnostic(),
      })
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
        compassReady: presentation.compass !== null,
        missionMapReady: presentation.missionMap !== null,
        kernel: options.modelSources.kernel.diagnostic(),
      });
  view.gwCartographyModelStats = modelStats;

  const safe = (surface: "compass" | "mission-map", render: () => void): void => {
    try {
      render();
    } catch (cause) {
      if (surface === "compass") hideCompassLayers();
      else hideMission();
      console.error(`[cartography] ${surface} rendering failed`, cause);
    }
  };

  const render = (): void => {
    const now = view.performance.now();
    if (now >= nextModelPoll) {
      const previous = model;
      const next = readCartographyModel(options.modelSources);
      if (next.status === "ready") {
        if (
          previous.status !== "ready"
          || !bitsetsEqual(previous.exploration, next.exploration)
        ) explorationVersion += 1;
        if (
          previous.status !== "ready"
          || !bitsetsEqual(previous.actionableCells, next.actionableCells)
        ) actionabilityVersion += 1;
      }
      model = next;
      controls.updateQaStatus(modelStats());
      nextModelPoll = now + MODEL_POLL_MS;
    }
    presentation = readCartographyPresentation(model, options.modelSources);
    if (model.status !== "ready") {
      terrainKey = "";
      terrain = null;
      hideAllLayers();
      const compass = options.modelSources.compass.snapshot();
      const box = compass === null
        ? null
        : projectNativeFrame(compass, options.canvas.getBoundingClientRect());
      if (box === null) controls.hide();
      else controls.update(box, options.settings());
      return;
    }
    const settings = options.settings();
    const style = resolveCartographyPreset(settings.cartographyPresetLibrary);
    if (style === null) {
      hideAllLayers();
      controls.hide();
      return;
    }
    const gridOpacity = previewGridOpacity ?? settings.cartographyGridOpacity;
    const walkabilityOpacity = previewWalkabilityOpacity
      ?? settings.cartographyWalkabilityOpacity;
    const revealRadius = settings.cartographyRevealMode === "birds-eye" ? 3 : 1;
    const explorationKey = `${model.epoch.mapId}:${model.epoch.area}:${explorationVersion}`;
    const actionabilityKey = [
      model.epoch.mapId,
      model.epoch.area,
      model.epoch.resource,
      actionabilityVersion,
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
      if (
        model.status !== "ready"
        || presentation.compass === null
        || presentation.player === null
      ) {
        hideCompassLayers();
        return;
      }
      const compass = presentation.compass;
      const box = projectNativeFrame(compass, canvasBox);
      if (box === null) {
        hideCompassLayers();
        return;
      }
      const playerMapX = model.worldAnchor.x
        + presentation.player.x / GAME_UNITS_PER_MAP_UNIT;
      const playerMapY = model.worldAnchor.y
        - presentation.player.y / GAME_UNITS_PER_MAP_UNIT;
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
          explorationVersion: explorationKey,
          isExplored,
          revealabilityVersion: actionabilityKey,
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
        || presentation.compass === null
        || presentation.missionMap === null
      ) {
        hideMission();
        return;
      }
      const mission = presentation.missionMap;
      const outerBox = projectMissionMapFrame(
        mission,
        presentation.compass,
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
            explorationVersion: explorationKey,
            isExplored,
            revealabilityVersion: actionabilityKey,
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
