/**
 * Owns Cartography installation behind one observer, model, kernel, and UI lifecycle.
 * Partial installation is rolled back before control returns to the harness.
 */
import { createNativeCompassRangesLayer } from "./native-compass-ranges-layer.js";
import { createNativeMapGraphicsLayer } from "./native-map-graphics-layer.js";
import { createNativeCompassTerrainLayer } from "./native-compass-terrain-layer.js";
import type {
  CartographyEvidenceCapture,
  CartographyEvidenceExportResult,
} from "../../shared/cartography-evidence.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import type { CartographyMapKnowledge } from
  "../../shared/cartography-map-knowledge.js";
import type {
  CompassFrameSpikeController,
  MissionMapFrameSpikeController,
  WorldMapFrameSpikeController,
  WorldMapFrameSpikeDiagnostic,
} from "../../shared/cartography-spike.js";
import { disposeCartographyResources } from "../cartography-lifecycle.js";
import { readCartographyPlayerState } from "../cartography-player-state.js";
import { createCartographyContextReader } from "./context-observer.js";
import { createExplorationSpikeReader } from "./exploration-observer.js";
import {
  createCompassFrameSpikeReader,
  createMissionMapFrameSpikeReader,
  createWorldMapFrameSpikeReader,
} from "./frame-observer.js";
import { mountCartographyOverlay } from "./overlay.js";
import { installCartographyReachabilityKernel } from "./reachability-kernel.js";
import { createWorldMapAnchorSpikeReader } from "./world-map-anchor-observer.js";

const unavailableCompass = Object.freeze({
  snapshot: () => null,
}) satisfies CompassFrameSpikeController;

const unavailableMissionMap = Object.freeze({
  snapshot: () => null,
}) satisfies MissionMapFrameSpikeController;

const unavailableWorldMapDiagnostic = Object.freeze({
  status: null,
  sequence: null,
  generation: null,
  frameId: null,
  visible: null,
  continent: null,
  zoom: null,
  topLeftX: null,
  topLeftY: null,
  bottomRightX: null,
  bottomRightY: null,
}) satisfies WorldMapFrameSpikeDiagnostic;

const unavailableWorldMap = Object.freeze({
  snapshot: () => null,
  diagnostics: () => unavailableWorldMapDiagnostic,
}) satisfies WorldMapFrameSpikeController;

/** Install the atomic evidence core; unavailable presentation surfaces stay isolated. */
export async function installCartographySpike(options: Readonly<{
  exports: WebAssembly.Exports;
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  settings(): AppSettings;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
  /** Main owns validation and saving; the renderer supplies bounded observations only. */
  exportEvidence(
    capture: CartographyEvidenceCapture,
  ): Promise<CartographyEvidenceExportResult>;
  getMapKnowledge(kernelSha256: string): Promise<readonly CartographyMapKnowledge[]>;
  recordMapKnowledge(
    value: CartographyMapKnowledge,
  ): Promise<readonly CartographyMapKnowledge[]>;
}>): Promise<() => void> {
  const context = createCartographyContextReader(options.exports);
  const compassReader = createCompassFrameSpikeReader(options.exports);
  const missionMapReader = createMissionMapFrameSpikeReader(options.exports);
  const worldMapReader = createWorldMapFrameSpikeReader(options.exports);
  const exploration = createExplorationSpikeReader(options.exports);
  const anchor = createWorldMapAnchorSpikeReader(options.exports);
  if (context === null || exploration === null || anchor === null) {
    const missing = [
      context === null ? "context" : null,
      exploration === null ? "exploration" : null,
      anchor === null ? "anchor" : null,
    ].filter((name): name is string => name !== null);
    console.error(`[cartography] required observers unavailable: ${missing.join(", ")}`);
    return () => {};
  }
  const compass = compassReader ?? unavailableCompass;
  const missionMap = missionMapReader ?? unavailableMissionMap;
  const worldMap = worldMapReader ?? unavailableWorldMap;

  let kernel;
  try {
    kernel = await installCartographyReachabilityKernel(options.exports);
  } catch (cause) {
    console.error("[cartography] reachability kernel unavailable", cause);
    kernel = Object.freeze({
      sha256: null,
      classify: () => null,
      diagnostic: () => null,
      dispose: () => undefined,
    });
  }
  let initialMapKnowledge: readonly CartographyMapKnowledge[] = [];
  if (kernel.sha256 !== null) {
    try {
      initialMapKnowledge = await options.getMapKnowledge(kernel.sha256);
    } catch (cause) {
      console.error("[cartography] remembered map knowledge unavailable", cause);
    }
  }
  const cleanup = [() => kernel.dispose()];
  const dispose = () => disposeCartographyResources(cleanup);
  try {
    const nativeCompassRanges = createNativeCompassRangesLayer(options.exports, options.parent.ownerDocument);
    cleanup.push(() => nativeCompassRanges.dispose());
    const nativeMapGraphics = createNativeMapGraphicsLayer(options.exports, options.parent.ownerDocument);
    cleanup.push(() => nativeMapGraphics.dispose());
    const compassTerrainLayer = createNativeCompassTerrainLayer(options.exports, options.parent.ownerDocument);
    cleanup.push(() => compassTerrainLayer.dispose());
    if (compassReader !== null) window.gwCompassFrameSpike = compassReader;
    if (missionMapReader !== null) window.gwMissionMapFrameSpike = missionMapReader;
    if (worldMapReader !== null) window.gwWorldMapFrameSpike = worldMapReader;
    window.gwWorldMapAnchorSpike = anchor;
    window.gwExplorationSpike = exploration;
    cleanup.push(() => {
      if (window.gwCompassFrameSpike === compassReader) delete window.gwCompassFrameSpike;
      if (window.gwMissionMapFrameSpike === missionMapReader) delete window.gwMissionMapFrameSpike;
      if (window.gwWorldMapFrameSpike === worldMapReader) delete window.gwWorldMapFrameSpike;
      if (window.gwWorldMapAnchorSpike === anchor) delete window.gwWorldMapAnchorSpike;
      if (window.gwExplorationSpike === exploration) delete window.gwExplorationSpike;
    });
    const disposeOverlay = mountCartographyOverlay({
      compassTerrainLayer,
      nativeMapGraphics,
      nativeCompassRanges,
      parent: options.parent,
      canvas: options.canvas,
      modelSources: {
        context,
        compass,
        missionMap,
        worldMap,
        exploration,
        anchor,
        kernel,
        companion: readCartographyPlayerState,
        revealRadius: () => options.settings().cartographyRevealMode === "birds-eye" ? 3 : 1,
      },
      settings: options.settings,
      persist: options.persist,
      exportEvidence: options.exportEvidence,
      initialMapKnowledge,
      recordMapKnowledge: options.recordMapKnowledge,
    });

    cleanup.push(disposeOverlay);
    return dispose;
  } catch (cause) {
    try { dispose(); } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], "Maps installation and cleanup failed", {cause: cleanupError});
    }
    throw cause;
  }
}
