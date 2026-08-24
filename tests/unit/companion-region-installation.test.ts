import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompanionRegionInstallation } from "../../src/renderer/companion-region-installation.ts";
import { createCompanionSequenceFeed } from "../../src/renderer/companion-sequence-feed.ts";

type State =
  | Readonly<{ status: "waiting"; reason: "memory" | "stale" }>
  | Readonly<{ status: "ready"; sequence: number; value: number }>;

const waiting = Object.freeze({ status: "waiting", reason: "memory" } as const);
const stale = Object.freeze({ status: "waiting", reason: "stale" } as const);
const ready = (sequence: number, value = sequence): State => Object.freeze({
  status: "ready",
  sequence,
  value,
});

test("a bounded region owns allocation and ignores observations while inactive", () => {
  const region = createCompanionRegionInstallation<State>({
    available: true,
    name: "test facts",
    bytes: 32,
    waiting,
    stale,
    freshness: null,
  });
  const observed: State[] = [];
  const unsubscribe = region.subscribe((state) => observed.push(state));

  region.sink?.update(ready(2));
  assert.deepEqual(observed, [waiting]);
  region.allocate(() => 128);
  assert.deepEqual(region.region, {
    name: "test facts",
    pointer: 128,
    size: 32,
    align: 4,
  });

  region.setActive(true);
  region.sink?.update(ready(2));
  assert.equal(region.state.status, "ready");
  region.setActive(false);
  assert.equal(region.state, stale);
  region.setActive(true);
  region.sink?.update(ready(2, 99));
  assert.equal(region.state, stale, "reactivation requires a newer publication");
  region.sink?.update(ready(4));
  assert.deepEqual(region.state, ready(4));

  let released = 0;
  region.release((pointer) => { released = pointer; });
  assert.equal(released, 128);
  assert.equal(region.pointer, 0);
  assert.equal(region.state, waiting);
  unsubscribe();
  region.dispose();
});

test("a withdrawn sequence accepts only a newer uint32 publication", () => {
  const feed = createCompanionSequenceFeed<State>(waiting, stale);
  feed.update(ready(10));
  feed.withdraw();
  feed.update(ready(10, 99));
  feed.update(ready(8));
  assert.equal(feed.state, stale);
  feed.update(ready(12));
  assert.deepEqual(feed.state, ready(12));
});

test("malformed ready sequences fail closed", () => {
  const feed = createCompanionSequenceFeed<State>(waiting, stale);
  feed.update(ready(2));
  for (const sequence of [undefined, -2, 1.5, 0x1_0000_0000]) {
    feed.update({ status: "ready", sequence, value: 99 } as unknown as State);
    assert.equal(feed.state, stale);
  }
});

test("an event-driven region keeps a stable accepted publication", () => {
  let scheduled = false;
  const region = createCompanionRegionInstallation<State>({
    available: true,
    name: "event facts",
    bytes: 32,
    waiting,
    stale,
    freshness: {
      staleAfterMs: null,
      schedule: () => {
        scheduled = true;
        return 1;
      },
    },
  });
  // The null policy must prevent the default liveness timer from existing.
  region.setActive(true);
  region.sink?.update(ready(2));
  assert.equal(region.state.status, "ready");
  assert.equal(scheduled, false);
});

test("region descriptors require non-ready withdrawal sentinels", () => {
  assert.throws(() => createCompanionRegionInstallation<State>({
    available: true,
    name: "unsafe facts",
    bytes: 32,
    waiting,
    stale: ready(2),
    freshness: null,
  }), /descriptor is invalid/u);
  assert.throws(() => createCompanionRegionInstallation<State>({
    available: true,
    name: "unsafe facts",
    bytes: 32,
    waiting: ready(2),
    stale,
    freshness: null,
  }), /descriptor is invalid/u);
});

test("teardown withdraws ready state even when freeing fails", () => {
  const region = createCompanionRegionInstallation<State>({
    available: true,
    name: "test facts",
    bytes: 32,
    waiting,
    stale,
    freshness: null,
  });
  region.allocate(() => 128);
  region.setActive(true);
  region.sink?.update(ready(2));
  assert.throws(() => region.release(() => { throw new Error("free failed"); }));
  assert.equal(region.state, stale);
  assert.equal(region.pointer, 128, "ownership remains until free succeeds");

  region.release(() => undefined);
  assert.equal(region.state, waiting);
  region.allocate(() => 256);
  region.setActive(true);
  region.sink?.update(ready(4));
  region.dispose();
  assert.equal(region.state, stale);
  region.sink?.update(ready(6));
  assert.equal(region.state, stale, "disposal is terminal");
  region.release(() => undefined);
});

test("freshness duration rejects non-finite and negative values", () => {
  for (const staleAfterMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(
      () => createCompanionSequenceFeed<State>(waiting, stale, { staleAfterMs }),
      /freshness duration/u,
    );
  }
});

test("sequence ordering accepts uint32 wrap and suppresses duplicate publications", () => {
  const feed = createCompanionSequenceFeed<State>(waiting, stale);
  const observed: State[] = [];
  feed.subscribe((state) => observed.push(state));
  feed.update(ready(0xffff_fffe));
  feed.update(ready(0xffff_fffe, 99));
  feed.update(ready(0));

  assert.deepEqual(observed, [waiting, ready(0xffff_fffe), ready(0)]);
});
