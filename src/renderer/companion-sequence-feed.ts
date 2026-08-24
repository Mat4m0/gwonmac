/**
 * One fail-closed freshness boundary for a sequence-protected companion record.
 * Consumers subscribe to the same accepted state instead of independently
 * deciding whether identical native bytes are still live.
 */

type SequencedState = Readonly<{
  status: string;
  sequence?: number;
}>;

type FreshnessTimer = ReturnType<typeof globalThis.setTimeout> | number;

export type CompanionSequenceFeedOptions<State extends SequencedState = SequencedState> = Readonly<{
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => FreshnessTimer;
  cancel?: (timer: FreshnessTimer) => void;
  staleAfterMs?: number | null;
  /**
   * Suppress a listener notification when only publication metadata changed.
   * The accepted sequence and freshness deadline still advance.
   */
  sameReadyState?: (previous: State, next: State) => boolean;
}>;

const DEFAULT_STALE_AFTER_MS = 500;
export const CONTINUOUS_COMPANION_FRESHNESS = Object.freeze({
  staleAfterMs: DEFAULT_STALE_AFTER_MS,
});
const UINT32_HALF_RANGE = 0x8000_0000;

function isSequence(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 0xffff_ffff;
}

function isNewerSequence(candidate: number, previous: number): boolean {
  const distance = (candidate - previous) >>> 0;
  return distance !== 0 && distance < UINT32_HALF_RANGE;
}

export function createCompanionSequenceFeed<State extends SequencedState>(
  initial: State,
  stale: State,
  options: CompanionSequenceFeedOptions<State> = {},
) {
  const listeners = new Set<(state: State) => void>();
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((callback, delay) =>
    globalThis.setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timer) => globalThis.clearTimeout(timer));
  const staleAfterMs = options.staleAfterMs === undefined
    ? DEFAULT_STALE_AFTER_MS
    : options.staleAfterMs;
  if (
    staleAfterMs !== null
    && (!Number.isFinite(staleAfterMs) || staleAfterMs < 0)
  ) {
    throw new Error("Companion freshness duration is invalid");
  }
  let current = initial;
  let acceptedSequence: number | null = null;
  let blockedSequence: number | null = null;
  let advancedAt = 0;
  let timer: FreshnessTimer | null = null;
  let disposed = false;

  const publish = (state: State) => {
    if (current === state) return;
    current = state;
    for (const listener of listeners) listener(state);
  };
  const publishReady = (state: State) => {
    const equivalent = current.status === "ready"
      && options.sameReadyState?.(current, state) === true;
    current = state;
    if (!equivalent) {
      for (const listener of listeners) listener(state);
    }
  };
  const stopTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const watch = () => {
    stopTimer();
    if (disposed || staleAfterMs === null) return;
    const sequence = acceptedSequence;
    if (sequence === null) return;
    timer = schedule(() => {
      timer = null;
      if (acceptedSequence !== sequence) return;
      const remaining = staleAfterMs - (now() - advancedAt);
      if (remaining > 0) {
        watch();
        return;
      }
      blockedSequence = sequence;
      publish(stale);
    }, Math.max(0, staleAfterMs - (now() - advancedAt)));
  };
  const invalidate = (next: State) => {
    if (disposed) return;
    if (acceptedSequence !== null) blockedSequence = acceptedSequence;
    stopTimer();
    publish(next);
  };
  const withdraw = () => invalidate(stale);

  return Object.freeze({
    get state() {
      return current;
    },
    update(next: State) {
      if (disposed) return;
      if (next.status !== "ready") {
        invalidate(next);
        return;
      }
      if (!isSequence(next.sequence)) {
        withdraw();
        return;
      }
      const sequence = next.sequence;
      if (
        acceptedSequence !== null
        && sequence !== acceptedSequence
        && !isNewerSequence(sequence, acceptedSequence)
      ) {
        blockedSequence = acceptedSequence;
        stopTimer();
        publish(stale);
        return;
      }
      if (sequence === acceptedSequence) {
        if (sequence === blockedSequence) publish(stale);
        return;
      }
      acceptedSequence = sequence;
      blockedSequence = null;
      advancedAt = now();
      watch();
      publishReady(next);
    },
    withdraw,
    subscribe(listener: (state: State) => void) {
      if (disposed) return () => false;
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    reset() {
      if (disposed) return;
      stopTimer();
      acceptedSequence = null;
      blockedSequence = null;
      publish(initial);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      listeners.clear();
    },
  });
}
