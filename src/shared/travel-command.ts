/**
 * Complete host boundary for the one named travel action. It accepts a typed
 * destination request and exposes availability; no generic UI message crosses.
 */
import type { TravelRequest } from "./travel.js";

export type TravelGameState = Readonly<{
  status?: string;
  reason?: string;
  mapId?: number;
  instanceType?: number;
}>;

export type TravelCommand = Readonly<{
  travel(request: TravelRequest): void;
  unavailable(): string | null;
}>;
