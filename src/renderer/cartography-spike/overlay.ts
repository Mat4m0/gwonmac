/**
 * Joins certified live observations and coordinates both native map overlays.
 * The fixed cartography grid and path-derived walkability mask remain
 * independent: uncertainty in either source hides only that derived layer.
 */
import type {
  CompassFrameSpikeController,
  ExplorationSpikeBitmap,
  ExplorationSpikeController,
  MissionMapFrameSpikeController,
  PathingSpikeController,
} from "../../shared/cartography-spike.js";
import { cartographyOverlayStyle } from "../../shared/cartography-overlay.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import type { PublishedCompanionState } from "../companion-snapshot.js";
import {
  createCartographyGridLayer,
  type CartographyGridLayerSnapshot,
} from "./cartography-grid-layer.js";
import {
  advanceCartographyGridAnchor,
  cartographyCellAtScreenPoint,
  createCartographyGridAnchor,
  projectCartographyGridToCompass,
  projectCartographyGridToMissionMap,
  type CartographyGridAnchor,
} from "./cartography-grid-projection.js";
import { projectMissionMapFrame, projectNativeFrame } from "./frame-placement.js";
import { createInverseMaskLayer } from "./inverse-mask-layer.js";
import {
  projectMissionMapContentBox,
  projectWalkabilityToCompass,
  projectWalkabilityToMissionMap,
} from "./map-projections.js";
import { createCartographyOverlayControls } from "./overlay-controls.js";
import {
  advancePathingMapLifecycle,
  INITIAL_PATHING_MAP_LIFECYCLE,
} from "./pathing-lifecycle.js";
import { createWalkabilityMask, type WalkabilityMask } from "./walkability-mask.js";

const MAX_RENDERED_TRAPEZOIDS = 4_096;

export type CartographyGridStats = Readonly<{
  compass: CartographyGridLayerSnapshot | null;
  missionMap: CartographyGridLayerSnapshot | null;
}>;

/** Join independently certified observations only at the presentation edge. */
export function mountCartographyOverlay(options: Readonly<{
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  compass: CompassFrameSpikeController;
  missionMap: MissionMapFrameSpikeController;
  pathing: PathingSpikeController;
  exploration: ExplorationSpikeController | null;
  companion(): PublishedCompanionState | null | undefined;
  settings(): AppSettings;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
}>): () => void {
  const compassMaskLayer = createInverseMaskLayer(
    options.parent,
    "cartography-compass-mask",
  );
  const missionMapMaskLayer = createInverseMaskLayer(
    options.parent,
    "cartography-mission-map-mask",
  );
  const compassGridLayer = createCartographyGridLayer(
    options.parent,
    "cartography-compass-grid",
  );
  const missionMapGridLayer = createCartographyGridLayer(
    options.parent,
    "cartography-mission-map-grid",
  );
  let previewOpacity: number | null = null;
  const controls = createCartographyOverlayControls({
    parent: options.parent,
    persist: options.persist,
    previewOpacity: (opacity) => { previewOpacity = opacity; },
  });
  const view = options.parent.ownerDocument.defaultView;
  if (view === null) throw new Error("cartography overlay requires a live document");
  let animationFrame = 0;
  let startupTimer = 0;
  let disposed = false;
  let geometryVersion = "";
  let mask: WalkabilityMask | null = null;
  let lifecycle = INITIAL_PATHING_MAP_LIFECYCLE;
  let gridAnchor: CartographyGridAnchor | null = null;
  let explorationBitmap: ExplorationSpikeBitmap | null = null;
  let explorationFingerprint = "";
  let nextExplorationReadAt = 0;
  let pointerX = Number.NaN;
  let pointerY = Number.NaN;

  const rememberPointer = (event: PointerEvent): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  };
  const forgetPointer = (): void => {
    pointerX = Number.NaN;
    pointerY = Number.NaN;
  };
  view.addEventListener("pointermove", rememberPointer, { capture: true, passive: true });
  view.addEventListener("blur", forgetPointer);

  const refreshExploration = (generation: number): void => {
    if (
      explorationBitmap !== null
      && explorationBitmap.snapshot.generation !== generation
    ) {
      explorationBitmap = null;
      explorationFingerprint = "";
      nextExplorationReadAt = 0;
    }
    if (options.exploration === null || view.performance.now() < nextExplorationReadAt) return;
    nextExplorationReadAt = view.performance.now() + 500;
    const next = options.exploration.readBitmap();
    if (next === null || next.snapshot.generation !== generation) {
      explorationBitmap = null;
      explorationFingerprint = "";
      return;
    }
    let hash = 2_166_136_261;
    for (const word of next.words) {
      hash ^= word;
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    explorationBitmap = next;
    explorationFingerprint = `${generation}:${hash.toString(16)}`;
  };

  const exploredCell = (cellX: number, cellY: number): boolean | null => {
    const bitmap = explorationBitmap;
    if (
      bitmap === null
      || cellX < 0 || cellX >= bitmap.snapshot.width
      || cellY < 0 || cellY >= bitmap.snapshot.height
    ) return null;
    const bit = cellY * bitmap.snapshot.width + cellX;
    return ((bitmap.words[bit >>> 5]! >>> (bit & 31)) & 1) === 1;
  };

  const hideWalkability = () => {
    geometryVersion = "";
    mask = null;
    compassMaskLayer.hide();
    missionMapMaskLayer.hide();
  };
  const hideGrid = () => {
    compassGridLayer.hide();
    missionMapGridLayer.hide();
  };
  const withdrawAll = () => {
    hideWalkability();
    hideGrid();
    controls.hide();
  };

  const gridStats = (): CartographyGridStats => Object.freeze({
    compass: compassGridLayer.snapshot(),
    missionMap: missionMapGridLayer.snapshot(),
  });
  view.gwCartographyGridStats = gridStats;

  const render = () => {
    const compass = options.compass.snapshot();
    const missionMap = options.missionMap.snapshot();
    const pathing = options.pathing.snapshot();
    const companion = options.companion();
    const canvasBox = options.canvas.getBoundingClientRect();
    const settings = options.settings();
    const compassBox = compass === null
      ? null
      : projectNativeFrame(compass, canvasBox);
    const missionMapBox = missionMap !== null && compass !== null
      ? projectMissionMapFrame(missionMap, compass, canvasBox)
      : null;

    const companionReady = companion?.status === "ready"
      && companion.instanceName !== "Loading";
    const transition = advancePathingMapLifecycle(
      lifecycle,
      companionReady ? companion.mapId : null,
    );
    lifecycle = transition.lifecycle;
    if (transition.reset) {
      gridAnchor = null;
      options.pathing.reset();
      withdrawAll();
      return;
    }
    if (!companionReady || compass === null || companion === null) {
      withdrawAll();
      return;
    }

    const style = cartographyOverlayStyle(
      settings.cartographyOverlayStyle,
      settings.cartographyOverlayCustomStyle,
    );
    const opacity = previewOpacity ?? settings.cartographyOverlayOpacity;
    const revealRadius = settings.cartographyBirdsEyeCompass ? 3 : 1;
    refreshExploration(compass.generation);
    const missionContentBox = missionMap !== null && missionMapBox !== null
      ? projectMissionMapContentBox(missionMap, missionMapBox)
      : null;

    let gridPresented = false;
    if (settings.cartographyGridEnabled && compassBox !== null) {
      const liveCompassProjection = missionMap === null
        ? null
        : projectCartographyGridToCompass({
            frame: missionMap,
            compass,
            box: compassBox,
          });
      if (liveCompassProjection !== null && missionMap !== null) {
        gridAnchor = createCartographyGridAnchor({
          frame: missionMap,
          playerX: companion.playerX,
          playerY: companion.playerY,
        });
      }
      const anchoredFrame = liveCompassProjection === null && gridAnchor !== null
        ? advanceCartographyGridAnchor(gridAnchor, {
            generation: compass.generation,
            playerX: companion.playerX,
            playerY: companion.playerY,
          })
        : null;
      const compassProjection = liveCompassProjection ?? (anchoredFrame === null
        ? null
        : projectCartographyGridToCompass({
            frame: anchoredFrame,
            compass,
            box: compassBox,
          }));
      if (compassProjection === null) {
        compassGridLayer.hide();
      } else {
        compassGridLayer.update({
          projection: compassProjection,
          style,
          opacity,
          explorationVersion: explorationFingerprint,
          isExplored: exploredCell,
          hoveredCell: null,
          revealRadius,
        });
        gridPresented = true;
      }

      const missionProjection = missionMap === null || missionContentBox === null
        ? null
        : projectCartographyGridToMissionMap({
            frame: missionMap,
            box: missionContentBox,
          });
      if (missionProjection === null) {
        missionMapGridLayer.hide();
      } else {
        const hoveredCell = cartographyCellAtScreenPoint(
          missionProjection,
          pointerX,
          pointerY,
        );
        missionMapGridLayer.update({
          projection: missionProjection,
          style,
          opacity,
          explorationVersion: explorationFingerprint,
          isExplored: exploredCell,
          hoveredCell,
          revealRadius,
        });
        gridPresented = true;
      }
    } else {
      hideGrid();
    }

    const walkabilityReady = settings.cartographyOverlayEnabled
      && compassBox !== null
      && pathing?.status === 1
      && pathing.totalTrapezoids > 0
      && pathing.totalTrapezoids <= MAX_RENDERED_TRAPEZOIDS
      && pathing.generation === compass.generation;
    let walkabilityPresented = false;
    if (!walkabilityReady || pathing === null) {
      hideWalkability();
    } else {
      const nextGeometryVersion = [
        pathing.generation,
        pathing.sequence,
        pathing.totalTrapezoids,
      ].join(":");
      if (nextGeometryVersion !== geometryVersion) {
        const geometry = options.pathing.readLargestGeometry();
        geometryVersion = geometry === null ? "" : nextGeometryVersion;
        mask = geometry === null
          ? null
          : createWalkabilityMask(options.parent.ownerDocument, geometry);
        if (mask === null) geometryVersion = "";
      }
      if (mask === null) {
        compassMaskLayer.hide();
        missionMapMaskLayer.hide();
      } else {
        const compassProjection = projectWalkabilityToCompass({
          box: compassBox,
          mask,
          playerX: companion.playerX,
          playerY: companion.playerY,
          directionX: compass.compassDirectionX,
          directionY: compass.compassDirectionY,
        });
        if (compassProjection === null) {
          compassMaskLayer.hide();
        } else {
          compassMaskLayer.update({
            projection: compassProjection,
            mask,
            version: geometryVersion,
            style,
            opacity,
          });
          walkabilityPresented = true;
        }

        const missionProjection = missionMap !== null && missionContentBox !== null
          ? projectWalkabilityToMissionMap({
              frame: missionMap,
              box: missionContentBox,
              mask,
              playerX: companion.playerX,
              playerY: companion.playerY,
            })
          : null;
        if (missionProjection === null) {
          missionMapMaskLayer.hide();
        } else {
          missionMapMaskLayer.update({
            projection: missionProjection,
            mask,
            version: geometryVersion,
            style,
            opacity,
          });
        }
      }
    }

    if (compassBox !== null && (gridPresented || walkabilityPresented)) {
      controls.update(compassBox, settings);
    } else {
      controls.hide();
    }
  };

  const update = () => {
    if (disposed) return;
    try {
      render();
    } catch {
      withdrawAll();
    } finally {
      if (!disposed) animationFrame = view.requestAnimationFrame(update);
    }
  };
  // The feature mounts while Emscripten is still completing startup. Deferring
  // once lets Guild Wars register its frame first, so live frame scalars are
  // consumed after the native map draw instead of one frame before it.
  startupTimer = view.setTimeout(() => {
    startupTimer = 0;
    if (!disposed) animationFrame = view.requestAnimationFrame(update);
  });

  return () => {
    disposed = true;
    if (startupTimer !== 0) view.clearTimeout(startupTimer);
    view.cancelAnimationFrame(animationFrame);
    view.removeEventListener("pointermove", rememberPointer, true);
    view.removeEventListener("blur", forgetPointer);
    compassMaskLayer.dispose();
    missionMapMaskLayer.dispose();
    compassGridLayer.dispose();
    missionMapGridLayer.dispose();
    controls.dispose();
    if (view.gwCartographyGridStats === gridStats) {
      delete view.gwCartographyGridStats;
    }
  };
}
