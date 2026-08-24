/**
 * Owns one fixed-size, companion-written memory region and its accepted feed.
 *
 * Region allocation, activation withdrawal, freshness, and cleanup are the
 * same safety problem for every bounded observation. Domain modules supply the
 * wire size, states, and an explicit freshness policy; event-driven records can
 * opt out of the timer instead of treating an unchanged value as dead.
 */
import {
  createCompanionSequenceFeed,
  type CompanionSequenceFeedOptions,
} from "./companion-sequence-feed.js";

type SequencedState = Readonly<{
  status: string;
  sequence?: number;
}>;

type Malloc = (bytes: number) => unknown;
type Free = (pointer: number) => void;

export type CompanionRegionDescriptor<State extends SequencedState> = Readonly<{
  available: boolean;
  name: string;
  bytes: number;
  align?: number;
  waiting: State;
  stale: State;
  freshness: CompanionSequenceFeedOptions | null;
}>;

export function createCompanionRegionInstallation<State extends SequencedState>(
  descriptor: CompanionRegionDescriptor<State>,
) {
  const {
    available,
    name,
    bytes,
    align = 4,
    waiting,
    stale,
    freshness,
  } = descriptor;
  if (
    name.length === 0
    || !Number.isSafeInteger(bytes)
    || bytes <= 0
    || !Number.isSafeInteger(align)
    || align <= 0
    || waiting.status === "ready"
    || stale.status === "ready"
  ) {
    throw new Error("Companion region descriptor is invalid");
  }

  const feed = createCompanionSequenceFeed(
    waiting,
    stale,
    freshness ?? { staleAfterMs: null },
  );
  let pointer = 0;
  let active = false;
  let disposed = false;
  const sink = Object.freeze({
    update(state: State) {
      if (!disposed && active) feed.update(state);
    },
  });

  return Object.freeze({
    available,
    get pointer() { return pointer; },
    get bytes() { return available ? bytes : 0; },
    get allocated() { return !available || pointer !== 0; },
    get active() { return active; },
    get state() { return feed.state; },
    get region() {
      return available
        ? Object.freeze({ name, pointer, size: bytes, align })
        : null;
    },
    get sink() { return available ? sink : null; },
    allocate(malloc: Malloc) {
      if (disposed || !available || pointer !== 0) return;
      const allocated = Number(malloc(bytes));
      pointer = Number.isSafeInteger(allocated) && allocated > 0
        ? allocated
        : 0;
    },
    setActive(next: boolean) {
      if (disposed || !available || active === next) return;
      active = next;
      if (!active) feed.withdraw();
    },
    subscribe(listener: (state: State) => void) {
      return available ? feed.subscribe(listener) : () => false;
    },
    release(free: Free) {
      active = false;
      feed.withdraw();
      if (pointer !== 0) free(pointer);
      pointer = 0;
      feed.reset();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      feed.withdraw();
      feed.dispose();
    },
  });
}
