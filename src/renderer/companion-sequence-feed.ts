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

export type CompanionSequenceFeedOptions = Readonly<{
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => FreshnessTimer;
  cancel?: (timer: FreshnessTimer) => void;
  staleAfterMs?: number;
}>;

const DEFAULT_STALE_AFTER_MS = 500;

export function createCompanionSequenceFeed<State extends SequencedState>(
  initial: State,
  stale: State,
  options: CompanionSequenceFeedOptions = {},
) {
  const listeners = new Set<(state: State) => void>();
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((callback, delay) =>
    globalThis.setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timer) => globalThis.clearTimeout(timer));
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  let current = initial;
  let acceptedSequence: number | null = null;
  let blockedSequence: number | null = null;
  let advancedAt = 0;
  let timer: FreshnessTimer | null = null;

  const publish = (state: State) => {
    current = state;
    for (const listener of listeners) listener(state);
  };
  const stopTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const watch = () => {
    stopTimer();
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

  return Object.freeze({
    get state() {
      return current;
    },
    update(next: State) {
      if (next.status !== "ready" || !Number.isSafeInteger(next.sequence)) {
        if (acceptedSequence !== null) blockedSequence = acceptedSequence;
        stopTimer();
        publish(next);
        return;
      }
      const sequence = next.sequence!;
      if (sequence === blockedSequence) {
        publish(stale);
        return;
      }
      if (sequence !== acceptedSequence) {
        acceptedSequence = sequence;
        blockedSequence = null;
        advancedAt = now();
        watch();
      }
      publish(next);
    },
    subscribe(listener: (state: State) => void) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    reset() {
      stopTimer();
      acceptedSequence = null;
      blockedSequence = null;
      publish(initial);
    },
    dispose() {
      stopTimer();
      listeners.clear();
    },
  });
}
