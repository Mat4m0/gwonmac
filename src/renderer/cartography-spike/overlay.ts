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
import type { CartographyMapKnowledge } from
  "../../shared/cartography-map-knowledge.js";
import {
  bitsetHasCell,
  readCartographyState,
  readCartographyPresentation,
  type CartographyModelSources,
  type CartographyPresentation,
  type CartographyState,
} from "./cartography-model.js";
import {
  createCartographyGridLayer,
  type CartographyGridLayerSnapshot,
} from "./cartography-grid-layer.js";
import {
  cartographyCellAtScreenPoint,
  projectCartographyGridToCompass,
  projectCartographyGridToMissionMap,
  projectCartographyGridToWorldMap,
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
import { createContinentCoverageLayer } from "./continent-coverage-layer.js";
import { createCurrentInstanceBoundaryLayer } from "./current-instance-boundary-layer.js";
import {
  createCartographyOverlayControls,
  type CartographyQaStatus,
} from "./overlay-controls.js";
import {
  createCompassRangeControls,
  visibleCompassRangeIds,
} from "./compass-range-controls.js";
import {
  createCompassRangeLayer,
  type CompassRangeLayerSnapshot,
} from "./compass-range-layer.js";
import {
  createWalkableTerrainSurface,
  type WalkableTerrainSurface,
} from "./walkable-terrain-surface.js";
import {
  cartographyKnowledgeWordsFingerprint,
  mergeCartographyMapKnowledge,
} from "./map-knowledge.js";

const MODEL_POLL_MS = 200;

export type CartographyGridStats = Readonly<{
  compass: CartographyGridLayerSnapshot | null;
  missionMap: CartographyGridLayerSnapshot | null;
  worldMap: CartographyGridLayerSnapshot | null;
}>;

export type CartographyModelStats = CartographyQaStatus;
export type CompassRangeStats = CompassRangeLayerSnapshot;

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

export type CartographyOverlayDisposition = "controls-only" | "layers";

/** Decide the whole overlay surface policy from the canonical model state. */
export function cartographyOverlayDisposition(
  state: CartographyState,
): CartographyOverlayDisposition {
  if (state.continent.status === "ready" || state.currentInstance.status === "ready") {
    return "layers";
  }
  return "controls-only";
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
  initialMapKnowledge: readonly CartographyMapKnowledge[];
  recordMapKnowledge(
    value: CartographyMapKnowledge,
  ): Promise<readonly CartographyMapKnowledge[]>;
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
  const missionCoverageLayer = createContinentCoverageLayer(
    options.parent,
    "cartography-mission-map-coverage",
  );
  const missionBoundaryLayer = createCurrentInstanceBoundaryLayer(
    options.parent,
    "cartography-mission-map-current-instance-boundary",
  );
  const worldGridLayer = createCartographyGridLayer(
    options.parent,
    "cartography-world-map-grid",
  );
  const worldCoverageLayer = createContinentCoverageLayer(
    options.parent,
    "cartography-world-map-coverage",
  );
  const worldBoundaryLayer = createCurrentInstanceBoundaryLayer(
    options.parent,
    "cartography-world-map-current-instance-boundary",
  );
  const compassRangeLayer = createCompassRangeLayer(options.parent);
  const compassRangeControls = createCompassRangeControls({
    parent: options.parent,
    persist: options.persist,
  });
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
      captureCartographyEvidence(state, options.modelSources),
    ),
  });

  let animationFrame = 0;
  let startupTimer = 0;
  let disposed = false;
  let state: CartographyState = Object.freeze({
    context: null,
    continent: Object.freeze({ status: "unavailable", reason: "context" }),
    currentInstance: Object.freeze({ status: "unavailable", reason: "context" }),
    surfaces: Object.freeze({ compass: null, missionMap: null, worldMap: null }),
  });
  let presentation: CartographyPresentation = Object.freeze({
    player: null,
    compass: null,
    missionMap: null,
    worldMap: null,
  });
  let nextModelPoll = 0;
  let explorationVersion = 0;
  let actionabilityVersion = 0;
  let mapKnowledge = options.initialMapKnowledge;
  let mapKnowledgeVersion = 0;
  let mapKnowledgeProjectionKey = "";
  let rememberedReachable: Readonly<{
    width: number;
    height: number;
    words: Uint32Array;
  }> | null = null;
  let requestedKnowledgeKey = "";
  let knowledgeWrites: Promise<void> = Promise.resolve();
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
    missionCoverageLayer.hide();
    missionBoundaryLayer.hide();
  };
  const hideWorld = (): void => {
    worldGridLayer.hide();
    worldCoverageLayer.hide();
    worldBoundaryLayer.hide();
  };
  const hideAllLayers = (): void => {
    hideCompassLayers();
    hideMission();
    hideWorld();
  };
  const gridStats = (): CartographyGridStats => {
    return Object.freeze({
      compass: compassGridLayer.snapshot(),
      missionMap: missionGridLayer.snapshot(),
      worldMap: worldGridLayer.snapshot(),
    });
  };
  view.gwCartographyGridStats = gridStats;
  const rangeStats = (): CompassRangeStats => compassRangeLayer.snapshot();
  view.gwCompassRangeStats = rangeStats;
  const modelStats = (): CartographyModelStats => Object.freeze({
    continent: state.continent.status === "ready"
      ? Object.freeze({
          status: "ready" as const,
          continentId: state.continent.continent,
          exploredCreditableCells: countSetBits(state.continent.exploredCreditable.words),
          remainingCells: countSetBits(state.continent.remaining.words),
        })
      : state.continent,
    currentInstance: state.currentInstance.status === "ready"
      ? Object.freeze({
          status: "ready" as const,
          sequence: state.currentInstance.sequence,
          mapId: state.currentInstance.epoch.mapId,
          areaEpoch: state.currentInstance.epoch.area,
          resourceGeneration: state.currentInstance.epoch.resource,
          terrain: Object.freeze({
            width: state.currentInstance.walkableTerrain.width,
            height: state.currentInstance.walkableTerrain.height,
            mapUnitsPerPixel: state.currentInstance.walkableTerrain.mapUnitsPerPixel,
          }),
          reachableCells: countSetBits(state.currentInstance.reachableCells.words),
          guidance: state.currentInstance.guidance.status === "ready"
            ? Object.freeze({
                status: "ready" as const,
                actionableCells: countSetBits(
                  state.currentInstance.guidance.actionableCells.words,
                ),
              })
            : state.currentInstance.guidance,
        })
      : state.currentInstance,
    compassReady: presentation.compass !== null,
    missionMapReady: presentation.missionMap !== null
      && (state.continent.status === "ready" || state.currentInstance.status === "ready"),
    worldMapReady: worldGridLayer.snapshot() !== null,
    worldMapObserver: options.modelSources.worldMap.diagnostics(),
    kernel: options.modelSources.kernel.diagnostic(),
  });
  view.gwCartographyModelStats = modelStats;

  const safe = (surface: "compass" | "mission-map" | "world-map", render: () => void): void => {
    try {
      render();
    } catch (cause) {
      if (surface === "compass") hideCompassLayers();
      else if (surface === "mission-map") hideMission();
      else hideWorld();
      console.error(`[cartography] ${surface} rendering failed`, cause);
    }
  };

  const rememberCurrentMap = (
    current: Extract<CartographyState["currentInstance"], { status: "ready" }>,
    revealRadius: 1 | 3,
  ): void => {
    const kernelSha256 = options.modelSources.kernel.sha256;
    if (kernelSha256 === null) return;
    const wordsFingerprint = cartographyKnowledgeWordsFingerprint(current.reachableCells.words);
    const key = [
      current.epoch.mapId,
      current.continent,
      current.reachableCells.width,
      current.reachableCells.height,
      revealRadius,
      current.epoch.resource,
      wordsFingerprint,
    ].join(":");
    if (key === requestedKnowledgeKey) return;
    requestedKnowledgeKey = key;
    const record = Object.freeze({
      kernelSha256,
      mapId: current.epoch.mapId,
      continent: current.continent,
      width: current.reachableCells.width,
      height: current.reachableCells.height,
      revealRadius,
      words: Object.freeze(Array.from(current.reachableCells.words)),
    });
    knowledgeWrites = knowledgeWrites.then(async () => {
      mapKnowledge = await options.recordMapKnowledge(record);
      mapKnowledgeVersion += 1;
    }).catch((cause) => {
      if (requestedKnowledgeKey === key) requestedKnowledgeKey = "";
      console.error("[cartography] could not remember current map knowledge", cause);
    });
  };

  const render = (): void => {
    const now = view.performance.now();
    if (now >= nextModelPoll) {
      const previous = state;
      const next = readCartographyState(options.modelSources);
      if (next.continent.status === "ready") {
        if (
          previous.continent.status !== "ready"
          || previous.continent.generation !== next.continent.generation
          || previous.continent.explorationSequence
            !== next.continent.explorationSequence
        ) explorationVersion += 1;
      }
      if (next.currentInstance.status === "ready") {
        const previousGuidance = previous.currentInstance.status === "ready"
          ? previous.currentInstance.guidance
          : null;
        const nextGuidance = next.currentInstance.guidance;
        if (
          previousGuidance === null
          || previousGuidance.status !== nextGuidance.status
          || previousGuidance.status === "ready" && nextGuidance.status === "ready"
            && !bitsetsEqual(
              previousGuidance.actionableCells,
              nextGuidance.actionableCells,
            )
        ) actionabilityVersion += 1;
      }
      state = next;
      if (
        state.continent.status === "ready"
        && state.currentInstance.status === "ready"
        && state.currentInstance.guidance.status === "ready"
      ) {
        rememberCurrentMap(
          state.currentInstance,
          options.settings().cartographyRevealMode === "birds-eye" ? 3 : 1,
        );
      }
      controls.updateQaStatus(modelStats());
      nextModelPoll = now + MODEL_POLL_MS;
    }
    presentation = readCartographyPresentation(state, options.modelSources);
    const settings = options.settings();
    const style = resolveCartographyPreset(settings.cartographyPresetLibrary);
    const canvasBox = options.canvas.getBoundingClientRect();
    const compass = options.modelSources.compass.snapshot();
    const controlBox = compass === null ? null : projectNativeFrame(compass, canvasBox);
    compassRangeLayer.update(controlBox, visibleCompassRangeIds(settings));
    if (controlBox === null) {
      controls.hide();
      compassRangeControls.hide();
    } else if (style === null) {
      controls.hide();
      compassRangeControls.update(controlBox, settings, { index: 0, count: 1 });
    } else {
      controls.update(controlBox, settings, { index: 0, count: 2 });
      compassRangeControls.update(controlBox, settings, { index: 1, count: 2 });
    }
    const disposition = cartographyOverlayDisposition(state);
    if (disposition !== "layers") {
      terrainKey = "";
      terrain = null;
      hideAllLayers();
      return;
    }
    if (style === null) {
      hideAllLayers();
      return;
    }
    const gridOpacity = previewGridOpacity ?? settings.cartographyGridOpacity;
    const walkabilityOpacity = previewWalkabilityOpacity
      ?? settings.cartographyWalkabilityOpacity;
    const revealRadius = settings.cartographyRevealMode === "birds-eye" ? 3 : 1;
    const explorationKey = `${state.continent.status === "ready"
      ? `${state.continent.continent}:${state.continent.generation}:${state.continent.explorationSequence}`
      : "unavailable"}:${explorationVersion}`;
    const nextMapKnowledgeProjectionKey = state.continent.status === "ready"
      ? [
          state.continent.continent,
          state.continent.explored.width,
          state.continent.explored.height,
          revealRadius,
          mapKnowledgeVersion,
        ].join(":")
      : "";
    if (nextMapKnowledgeProjectionKey !== mapKnowledgeProjectionKey) {
      const kernelSha256 = options.modelSources.kernel.sha256;
      const words = state.continent.status === "ready" && kernelSha256 !== null
        ? mergeCartographyMapKnowledge(mapKnowledge, {
            kernelSha256,
            continent: state.continent.continent,
            width: state.continent.explored.width,
            height: state.continent.explored.height,
            revealRadius,
          })
        : null;
      rememberedReachable = state.continent.status === "ready" && words !== null
        ? Object.freeze({
            width: state.continent.explored.width,
            height: state.continent.explored.height,
            words,
          })
        : null;
      mapKnowledgeProjectionKey = nextMapKnowledgeProjectionKey;
    }
    const actionabilityKey = [
      state.currentInstance.status === "ready" ? state.currentInstance.epoch.mapId : "-",
      state.currentInstance.status === "ready" ? state.currentInstance.epoch.area : "-",
      state.currentInstance.status === "ready" ? state.currentInstance.epoch.resource : "-",
      actionabilityVersion,
      mapKnowledgeVersion,
    ].join(":");
    const nextTerrainKey = state.currentInstance.status === "ready"
      ? `${state.currentInstance.epoch.area}:${state.currentInstance.epoch.resource}`
      : "";
    if (nextTerrainKey !== terrainKey) {
      terrain = state.currentInstance.status === "ready"
        ? createWalkableTerrainSurface(document, state.currentInstance.walkableTerrain)
        : null;
      terrainKey = terrain === null ? "" : nextTerrainKey;
    }
    const isExplored = (x: number, y: number): boolean | null => {
      if (state.continent.status !== "ready") return null;
      return bitsetHasCell(state.continent.explored, { x, y });
    };
    const isRemaining = (x: number, y: number): boolean | null => {
      if (state.continent.status !== "ready") return null;
      return bitsetHasCell(state.continent.remaining, { x, y });
    };
    const canCurrentMapReveal = (x: number, y: number): boolean | null => {
      if (
        state.currentInstance.status !== "ready"
        || state.currentInstance.guidance.status !== "ready"
      ) return null;
      return bitsetHasCell(state.currentInstance.reachableCells, { x, y });
    };
    const canVisitedMapReveal = (x: number, y: number): boolean | null => {
      if (rememberedReachable === null) return null;
      return bitsetHasCell(rememberedReachable, { x, y });
    };
    safe("compass", () => {
      if (
        state.currentInstance.status !== "ready"
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
      const playerMapX = state.currentInstance.worldAnchor.x
        + presentation.player.x / GAME_UNITS_PER_MAP_UNIT;
      const playerMapY = state.currentInstance.worldAnchor.y
        - presentation.player.y / GAME_UNITS_PER_MAP_UNIT;
      if (settings.cartographyGridEnabled && settings.cartographyCompassGridEnabled
        && state.continent.status === "ready") {
        const projection = projectCartographyGridToCompass({
          frame: { generation: state.currentInstance.epoch.area, playerMapX, playerMapY },
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
          isRemaining,
          revealabilityVersion: actionabilityKey,
          canCurrentMapReveal,
          canVisitedMapReveal,
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
    });

    safe("mission-map", () => {
      if (
        presentation.compass === null
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
      const mapProjection = projectCartographyGridToMissionMap({ frame: mission, box });
      if (settings.cartographyGridEnabled && state.continent.status === "ready") {
        if (mapProjection === null) {
          missionGridLayer.hide();
          missionCoverageLayer.hide();
          missionBoundaryLayer.hide();
        }
        else {
          const hoveredCell = shiftHeld
            ? cartographyCellAtScreenPoint(mapProjection, pointerX, pointerY)
            : null;
          missionGridLayer.update({
            projection: mapProjection,
            style: style.grid,
            opacity: gridOpacity,
            explorationVersion: explorationKey,
            isExplored,
            isRemaining,
            revealabilityVersion: actionabilityKey,
            canCurrentMapReveal,
            canVisitedMapReveal,
            hoveredCell,
            revealRadius: hoveredCell === null
              ? revealRadius
              : cartographyHoverRevealRadius(shiftHeld, optionHeld),
          });
          missionCoverageLayer.update({
            projection: mapProjection,
            explored: state.continent.exploredCreditable,
            version: explorationKey,
          });
          if (state.currentInstance.status === "ready") {
            missionBoundaryLayer.update({
              projection: mapProjection,
              bounds: state.currentInstance.mapBounds,
              version: actionabilityKey,
            });
          } else missionBoundaryLayer.hide();
        }
      } else missionGridLayer.hide();
      if (!settings.cartographyGridEnabled || state.continent.status !== "ready") {
        missionCoverageLayer.hide();
        missionBoundaryLayer.hide();
      }
      if (
        settings.cartographyOverlayEnabled
        && state.currentInstance.status === "ready"
        && terrain !== null
      ) {
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

    safe("world-map", () => {
      if (
        presentation.compass === null
        || presentation.worldMap === null
        || state.continent.status !== "ready"
        || presentation.worldMap.continent !== state.continent.continent
      ) {
        hideWorld();
        return;
      }
      const world = presentation.worldMap;
      const box = projectMissionMapFrame(world, presentation.compass, canvasBox);
      const mapProjection = box === null
        ? null
        : projectCartographyGridToWorldMap({ frame: world, box });
      if (!settings.cartographyGridEnabled || mapProjection === null) {
        hideWorld();
        return;
      }
      const hoveredCell = shiftHeld
        ? cartographyCellAtScreenPoint(mapProjection, pointerX, pointerY)
        : null;
      worldGridLayer.update({
        projection: mapProjection,
        style: style.grid,
        opacity: gridOpacity,
        explorationVersion: explorationKey,
        isExplored,
        isRemaining,
        revealabilityVersion: actionabilityKey,
        canCurrentMapReveal,
        canVisitedMapReveal,
        hoveredCell,
        revealRadius: hoveredCell === null
          ? 0
          : cartographyHoverRevealRadius(shiftHeld, optionHeld),
      });
      worldCoverageLayer.update({
        projection: mapProjection,
        explored: state.continent.exploredCreditable,
        version: explorationKey,
      });
      if (state.currentInstance.status === "ready") {
        worldBoundaryLayer.update({
          projection: mapProjection,
          bounds: state.currentInstance.mapBounds,
          version: actionabilityKey,
        });
      } else worldBoundaryLayer.hide();
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
    missionCoverageLayer.dispose();
    missionBoundaryLayer.dispose();
    worldCoverageLayer.dispose();
    worldBoundaryLayer.dispose();
    compassGridLayer.dispose();
    missionGridLayer.dispose();
    worldGridLayer.dispose();
    compassRangeLayer.dispose();
    compassRangeControls.dispose();
    controls.dispose();
    if (view.gwCartographyGridStats === gridStats) delete view.gwCartographyGridStats;
    if (view.gwCartographyModelStats === modelStats) delete view.gwCartographyModelStats;
    if (view.gwCompassRangeStats === rangeStats) delete view.gwCompassRangeStats;
  };
}
