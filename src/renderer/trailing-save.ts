/**
 * Owns the writes of a Hub form that saves as the player changes it (Settings, Maps).
 * A change made while a save runs waits and merges into one trailing save of the latest
 * values, so a held arrow on a slider loses no step, and the control being edited is never
 * disabled or made inert under the keyboard (HUB-021, HUB-055).
 */
export function createTrailingSave<Change>(options: Readonly<{
  write(change: Change): Promise<void>;
  /** Folds a newer change into a waiting one, or returns null when both must be written in order. */
  merge(waiting: Change, next: Change): Change | null;
  /** Every waiting change was written, or one failed; the form repaints from the stored values. */
  settled(failed: boolean): void;
}>) {
  const waiting: Change[] = [];
  let running = false;
  async function drain() {
    running = true;
    let failed = false;
    while (waiting.length) {
      try { await options.write(waiting.shift()!); } catch { failed = true; }
    }
    running = false;
    options.settled(failed);
  }
  return {
    save(change: Change) {
      const last = waiting.at(-1);
      const merged = last === undefined ? null : options.merge(last, change);
      if (merged === null) waiting.push(change); else waiting[waiting.length - 1] = merged;
      if (!running) void drain();
    },
    /** A save runs or waits: repainting the controls now would undo the player's newer steps. */
    get pending() { return running; },
  };
}
