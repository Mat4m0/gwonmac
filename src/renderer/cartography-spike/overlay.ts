/**
 * Joins certified live observations and coordinates both native map overlays.
 * The fixed cartography grid and path-derived walkability mask remain
 * independent: uncertainty in either source hides only that derived layer.
 */
import type {
  CompassFrameSpikeController,
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
  projectCartographyGridToCompass,
  projectCartographyGridToMissionMap,
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
    const missionContentBox = missionMap !== null && missionMapBox !== null
      ? projectMissionMapContentBox(missionMap, missionMapBox)
      : null;

    let gridPresented = false;
    if (
      settings.cartographyGridEnabled
      && compassBox !== null
      && missionMap !== null
      && missionMap.generation === compass.generation
    ) {
      const compassProjection = projectCartographyGridToCompass({
        frame: missionMap,
        compass,
        box: compassBox,
      });
      if (compassProjection === null) {
        compassGridLayer.hide();
      } else {
        compassGridLayer.update({ projection: compassProjection, style, opacity });
        gridPresented = true;
      }

      const missionProjection = missionContentBox === null
        ? null
        : projectCartographyGridToMissionMap({
            frame: missionMap,
            box: missionContentBox,
          });
      if (missionProjection === null) {
        missionMapGridLayer.hide();
      } else {
        missionMapGridLayer.update({ projection: missionProjection, style, opacity });
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
