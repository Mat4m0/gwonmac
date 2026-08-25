/**
 * Closed predicates for the observed Guild Wars relog progression.
 * They keep stale playable publications from completing a new reload.
 */
export function isRelogCharacterEntryState(state: PreGameState): boolean {
  return state === "character-select" || state === "reconnect";
}

export function isRelogPostCharacterState(state: PreGameState): boolean {
  return state === "reconnect" || state === "loading";
}

export function relogOutcomeForPlayable(
  playable: "outpost" | "explorable" | null,
): "outpost" | "restored" | null {
  if (playable === null) return null;
  return playable === "explorable" ? "restored" : "outpost";
}

export function observeRelogPlayableTransition(
  observedNonPlayable: boolean,
  playable: "outpost" | "explorable" | null,
): Readonly<{
  observedNonPlayable: boolean;
  outcome: "outpost" | "restored" | null;
}> {
  if (playable === null) {
    return { observedNonPlayable: true, outcome: null };
  }
  return {
    observedNonPlayable,
    outcome: observedNonPlayable ? relogOutcomeForPlayable(playable) : null,
  };
}
