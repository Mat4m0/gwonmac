/**
 * Owns Cartography installation behind one observer, model, kernel, and UI lifecycle.
 * Partial installation is rolled back before control returns to the harness.
 */
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";
import { readCartographyPlayerState } from "../cartography-player-state.js";
import { createCartographyContextReader } from "./context-observer.js";
import { createExplorationSpikeReader } from "./exploration-observer.js";
import {
  createCompassFrameSpikeReader,
  createMissionMapFrameSpikeReader,
} from "./frame-observer.js";
import { mountCartographyOverlay } from "./overlay.js";
import { installCartographyReachabilityKernel } from "./reachability-kernel.js";
import { createWorldMapAnchorSpikeReader } from "./world-map-anchor-observer.js";

/** Install the complete atomic feature or do nothing; never mount a subset. */
export async function installCartographySpike(options: Readonly<{
  exports: WebAssembly.Exports;
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  settings(): AppSettings;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
}>): Promise<() => void> {
  const context = createCartographyContextReader(options.exports);
  const compass = createCompassFrameSpikeReader(options.exports);
  const missionMap = createMissionMapFrameSpikeReader(options.exports);
  const exploration = createExplorationSpikeReader(options.exports);
  const anchor = createWorldMapAnchorSpikeReader(options.exports);
  if (
    context === null || compass === null || missionMap === null
    || exploration === null || anchor === null
  ) return () => {};

  let kernel;
  try {
    kernel = await installCartographyReachabilityKernel(options.exports);
  } catch (cause) {
    console.error("[cartography] reachability kernel unavailable", cause);
    return () => {};
  }
  window.gwCompassFrameSpike = compass;
  window.gwMissionMapFrameSpike = missionMap;
  window.gwWorldMapAnchorSpike = anchor;
  window.gwExplorationSpike = exploration;
  const disposeOverlay = mountCartographyOverlay({
    parent: options.parent,
    canvas: options.canvas,
    modelSources: {
      context,
      compass,
      missionMap,
      exploration,
      anchor,
      kernel,
      companion: readCartographyPlayerState,
      revealRadius: () => options.settings().cartographyRevealMode === "birds-eye" ? 3 : 1,
      correction: () => null,
    },
    settings: options.settings,
    persist: options.persist,
  });

  return () => {
    disposeOverlay();
    kernel.dispose();
    if (window.gwCompassFrameSpike === compass) delete window.gwCompassFrameSpike;
    if (window.gwMissionMapFrameSpike === missionMap) delete window.gwMissionMapFrameSpike;
    if (window.gwWorldMapAnchorSpike === anchor) delete window.gwWorldMapAnchorSpike;
    if (window.gwExplorationSpike === exploration) delete window.gwExplorationSpike;
  };
}
