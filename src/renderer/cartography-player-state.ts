/**
 * Keeps the certified player location private to renderer consumers.
 * The developer-facing companion global remains unavailable in player mode.
 */
import type { CompanionSnapshot } from "./companion-snapshot.js";

let current: CompanionSnapshot | null = null;

export function readCartographyPlayerState(): CompanionSnapshot | null {
  return current;
}

export function updateCartographyPlayerState(state: CompanionSnapshot): void {
  current = state;
}

export function clearCartographyPlayerState(): void {
  current = null;
}
