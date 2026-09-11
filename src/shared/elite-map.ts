/**
 * The presentation-only map boundary consumed by the embedded Elite Skills UI.
 * Native observers remain renderer-owned; no memory address crosses this contract.
 */
import type { ToolboxObservation } from "./builds/live-party.js";
import type { TravelCharacterKey } from "./travel-history.js";
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
}>;
export const EMPTY_ELITE_MAP: EliteMapView = Object.freeze({
  world: null, mission: null, mapId: null, characterKey: null,
  observation: Object.freeze({ status: "waiting" }),
});
export type EliteMapHandle = Readonly<{
  update(view: EliteMapView): void;
  find(skillId: number): void;
  close(): void;
  dispose(): void;
}>;
