/**
 * Installs and disposes the complete cartography observation and presentation feature.
 * Keeps the development-only observers behind one lifecycle boundary.
 */
import { createCompassFrameSpikeReader, createMissionMapFrameSpikeReader } from
  "./frame-observer.js";
import { mountCartographyOverlay } from "./overlay.js";
import { createPathingSpikeReader } from "./pathing-observer.js";
import { createExplorationSpikeReader } from "./exploration-observer.js";
import type { AppSettings, RendererSettingsPatch } from "../../shared/contracts.js";

/** Install the complete development feature or do nothing; never mount a subset. */
export function installCartographySpike(options: Readonly<{
  exports: WebAssembly.Exports;
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  settings(): AppSettings;
  persist(patch: RendererSettingsPatch): Promise<AppSettings>;
}>): () => void {
  const pathing = createPathingSpikeReader(options.exports);
  const compass = createCompassFrameSpikeReader(options.exports);
  const missionMap = createMissionMapFrameSpikeReader(options.exports);
  const exploration = createExplorationSpikeReader(options.exports);
  if (pathing === null || compass === null || missionMap === null) return () => {};

  pathing.reset();
  window.gwPathingSpike = pathing;
  window.gwCompassFrameSpike = compass;
  window.gwMissionMapFrameSpike = missionMap;
  if (exploration !== null) window.gwExplorationSpike = exploration;
  const disposeOverlay = mountCartographyOverlay({
    parent: options.parent,
    canvas: options.canvas,
    compass,
    missionMap,
    pathing,
    exploration,
    companion: () => window.gwCompanionState,
    settings: options.settings,
    persist: options.persist,
  });

  return () => {
    disposeOverlay();
    if (window.gwPathingSpike === pathing) delete window.gwPathingSpike;
    if (window.gwCompassFrameSpike === compass) delete window.gwCompassFrameSpike;
    if (window.gwMissionMapFrameSpike === missionMap) delete window.gwMissionMapFrameSpike;
    if (exploration !== null && window.gwExplorationSpike === exploration) {
      delete window.gwExplorationSpike;
    }
  };
}
