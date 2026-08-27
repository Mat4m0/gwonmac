/**
 * The minimal renderer-local projection used by Settings.
 *
 * Certification says a producer may run. Readiness says whether that producer
 * has supplied usable data during this renderer session. It is rebuilt on
 * every launch, never persisted, and deliberately excludes coordinates,
 * timers, account data, and other game observations.
 */
import type { SkillGeometryWaitReason } from "../shared/diagnostics.js";

export type ObserverReadiness = Readonly<{
  skillGeometry:
    | Readonly<{ status: "waiting"; reason: SkillGeometryWaitReason }>
    | Readonly<{ status: "ready" }>;
  skillCooldowns: "waiting" | "ready";
}>;

const listeners = new Set<(state: ObserverReadiness) => void>();
let geometryReported = false;
let state: ObserverReadiness = Object.freeze({
  skillGeometry: Object.freeze({ status: "waiting", reason: "inactive" }),
  skillCooldowns: "waiting",
});

function publish(next: ObserverReadiness): void {
  state = Object.freeze(next);
  for (const listener of listeners) listener(state);
}

export function setSkillGeometryReadiness(
  next: ObserverReadiness["skillGeometry"],
): boolean {
  const current = state.skillGeometry;
  if (
    geometryReported
    &&
    current.status === next.status
    && (current.status === "ready"
      || (next.status === "waiting" && current.reason === next.reason))
  ) return false;
  geometryReported = true;
  publish({ ...state, skillGeometry: Object.freeze(next) });
  return true;
}

export function setSkillCooldownReadiness(next: "waiting" | "ready"): boolean {
  if (state.skillCooldowns === next) return false;
  publish({ ...state, skillCooldowns: next });
  return true;
}

export function observerReadiness(): ObserverReadiness {
  return state;
}

export function subscribeObserverReadiness(
  listener: (state: ObserverReadiness) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
