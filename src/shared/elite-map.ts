/**
 * The presentation-only map boundary consumed by the embedded Elite Skills UI.
 * Native observers, drawing, and pointer ownership remain renderer-owned; no
 * memory address crosses this contract.
 */
import type { ToolboxObservation } from "./builds/live-party.js";
import type { TravelCharacterKey } from "./travel-history.js";
import type { EliteMissionMapMarkers } from "./elite-map-settings.js";
import type { EliteMapHit, EliteMarkerScene } from "./elite-map-scene.js";
export type EliteMapSurface = Readonly<{
  box: Readonly<{ left: number; top: number; width: number; height: number }>;
  transform: Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;
}>;
export type EliteMapView = Readonly<{
  world: (EliteMapSurface & Readonly<{ continent: number }>) | null;
  mission: Readonly<{ box: EliteMapSurface["box"]; transform: EliteMapSurface["transform"] | null }> | null;
  mapId: number | null;
  characterKey: TravelCharacterKey | null;
  observation: ToolboxObservation;
  missionMarkers: EliteMissionMapMarkers;
}>;
export const EMPTY_ELITE_MAP: EliteMapView = Object.freeze({
  world: null, mission: null, mapId: null, characterKey: null,
  observation: Object.freeze({ status: "waiting" }), missionMarkers: "saved",
});
/** What the planner needs from its host besides tracking storage. */
export type EliteMapHost = Readonly<{
  /** Receives the markers to draw whenever the planner's choice changes. */
  present(scene: EliteMarkerScene): void;
  setMissionMarkers(mode: EliteMissionMapMarkers): void | Promise<void>;
}>;
export type EliteMapHandle = Readonly<{
  update(view: EliteMapView): void;
  /** The host's pointer hit on a drawn marker, or null when it leaves. */
  pointer(hit: EliteMapHit | null): void;
  activate(hit: EliteMapHit): void;
  find(skillId: number): void;
  close(): void;
  dispose(): void;
}>;
