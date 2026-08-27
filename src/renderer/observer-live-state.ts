/**
 * Renderer-local truth for observer-backed presentation.
 *
 * Certification says a producer may run. This state says whether that
 * producer has supplied usable data in the current renderer. It is rebuilt
 * from companion memory on every launch and is never persisted. This module
 * is Core-safe: its domain imports are type-only and it installs no observer.
 */
import type {
  CompanionSkillCooldownState,
  CompanionSkillSlotState,
} from "./companion-skill-snapshot.js";

export type EnhancementLiveState = Readonly<{
  skillGeometry: CompanionSkillSlotState;
  skillCooldowns: CompanionSkillCooldownState;
}>;

const listeners = new Set<(state: EnhancementLiveState) => void>();
let geometryReported = false;
let cooldownsReported = false;
let state: EnhancementLiveState = Object.freeze({
  skillGeometry: Object.freeze({
    status: "waiting" as const,
    reason: "inactive" as const,
    candidateCount: 0,
  }),
  skillCooldowns: Object.freeze({ status: "waiting" as const, reason: "memory" as const }),
});

function geometrySignature(value: CompanionSkillSlotState): string {
  return value.status === "ready"
    ? `ready:${value.frameId}`
    : `waiting:${value.reason}:${"candidateCount" in value ? value.candidateCount : ""}`;
}

function cooldownSignature(value: CompanionSkillCooldownState): string {
  return value.status === "ready"
    ? `ready:${value.generation}`
    : `waiting:${value.reason}`;
}

function publish(next: EnhancementLiveState): void {
  state = Object.freeze(next);
  for (const listener of listeners) listener(state);
}

export function setSkillGeometryLiveState(next: CompanionSkillSlotState): boolean {
  if (geometryReported && geometrySignature(state.skillGeometry) === geometrySignature(next)) {
    return false;
  }
  geometryReported = true;
  publish({ ...state, skillGeometry: next });
  return true;
}

export function setSkillCooldownLiveState(next: CompanionSkillCooldownState): boolean {
  if (cooldownsReported && cooldownSignature(state.skillCooldowns) === cooldownSignature(next)) {
    return false;
  }
  cooldownsReported = true;
  publish({ ...state, skillCooldowns: next });
  return true;
}

export function enhancementLiveState(): EnhancementLiveState {
  return state;
}

export function subscribeEnhancementLiveState(
  listener: (state: EnhancementLiveState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
