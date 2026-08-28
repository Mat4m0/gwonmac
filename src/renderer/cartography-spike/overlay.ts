/**
 * Joins certified live observations and coordinates both native map overlays.
 * Withdraws all derived geometry whenever their generations or lifecycle disagree.
 */
import type {
  CompassFrameSpikeController,
  MissionMapFrameSpikeController,
  PathingSpikeController,
} from "../../shared/cartography-spike.js";
import { cartographyOverlayStyle } from "../../shared/cartography-overlay.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import type { PublishedCompanionState } from "../companion-snapshot.js";
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
  const compassLayer = createInverseMaskLayer(options.parent, "cartography-compass-mask");
  const missionMapMaskLayer = createInverseMaskLayer(
    options.parent,
    "cartography-mission-map-mask",
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

  const withdrawGeometry = () => {
    geometryVersion = "";
    mask = null;
    compassLayer.hide();
    missionMapMaskLayer.hide();
    controls.hide();
  };

  const render = () => {
    const compass = options.compass.snapshot();
    const missionMap = options.missionMap.snapshot();
    const pathing = options.pathing.snapshot();
    const companion = options.companion();
    const canvasBox = options.canvas.getBoundingClientRect();
    const settings = options.settings();

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
      withdrawGeometry();
      return;
    }

    const compassBox = compass === null
      ? null
      : projectNativeFrame(compass, canvasBox);
    const ready = settings.cartographyOverlayEnabled
      && compassBox !== null
      && pathing?.status === 1
      && pathing.totalTrapezoids > 0
      && pathing.totalTrapezoids <= MAX_RENDERED_TRAPEZOIDS
      && pathing.generation === compass?.generation
      && companionReady;
    if (!ready || compass === null || companion === null || pathing === null) {
      withdrawGeometry();
      return;
    }

    const nextGeometryVersion = [
      pathing.generation,
      pathing.sequence,
      pathing.totalTrapezoids,
    ].join(":");
    if (nextGeometryVersion !== geometryVersion) {
      const geometry = options.pathing.readLargestGeometry();
      geometryVersion = geometry === null ? "" : nextGeometryVersion;
      mask = geometry === null ? null : createWalkabilityMask(options.parent.ownerDocument, geometry);
      if (mask === null) geometryVersion = "";
    }
    if (mask === null) {
      compassLayer.hide();
      missionMapMaskLayer.hide();
      controls.hide();
    } else {
      const style = cartographyOverlayStyle(
        settings.cartographyOverlayStyle,
        settings.cartographyOverlayCustomStyle,
      );
      const opacity = previewOpacity ?? settings.cartographyOverlayOpacity;
      const compassProjection = projectWalkabilityToCompass({
        box: compassBox,
        mask,
        playerX: companion.playerX,
        playerY: companion.playerY,
        directionX: compass.compassDirectionX,
        directionY: compass.compassDirectionY,
      });
      if (compassProjection === null) {
        withdrawGeometry();
        return;
      }
      compassLayer.update({
        projection: compassProjection,
        mask,
        version: geometryVersion,
        style,
        opacity,
      });
      controls.update(compassBox, settings);
      const missionContentBox = missionMap !== null && missionMapBox !== null
        ? projectMissionMapContentBox(missionMap, missionMapBox)
        : null;
      const missionProjection = missionMap !== null && missionContentBox !== null
        ? projectWalkabilityToMissionMap({
          frame: missionMap,
          box: missionContentBox,
          mask,
          playerX: companion.playerX,
          playerY: companion.playerY,
        })
        : null;
      if (missionProjection !== null) {
        missionMapMaskLayer.update({
          projection: missionProjection,
          mask,
          version: geometryVersion,
          style,
          opacity,
        });
      } else {
        missionMapMaskLayer.hide();
      }
    }
  };

  const update = () => {
    if (disposed) return;
    try {
      render();
    } catch {
      withdrawGeometry();
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
    compassLayer.dispose();
    missionMapMaskLayer.dispose();
    controls.dispose();
  };
}
