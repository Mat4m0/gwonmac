/** Live Maps toggles cannot leak an overlay during asynchronous installation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCartographyLifecycle } from "../../src/renderer/cartography-lifecycle.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("Maps loads once, disposes on disable, and reinstalls on enable", async () => {
  let installs = 0;
  let disposals = 0;
  const host = createCartographyLifecycle(async () => { installs++; return () => { disposals++; }; }, error => assert.fail(String(error)));
  host.update(false);
  assert.equal(installs, 0);
  host.update(true);
  host.update(true);
  await tick();
  assert.equal(installs, 1);
  host.update(false);
  assert.equal(disposals, 1);
  host.update(true);
  await tick();
  assert.equal(installs, 2);
  host.dispose();
  host.update(true);
  assert.equal(disposals, 2);
  assert.equal(installs, 2);
});

test("disposes a late installation and serializes rapid toggles", async () => {
  let finish!: (cleanup: () => void) => void;
  let installs = 0;
  let disposals = 0;
  const host = createCartographyLifecycle(() => {
    installs++;
    return new Promise(resolve => { finish = resolve; });
  }, error => assert.fail(String(error)));
  host.update(true);
  host.update(false);
  host.update(true);
  assert.equal(installs, 1);
  host.dispose();
  finish(() => { disposals++; });
  await tick();
  assert.equal(disposals, 1);
});

test("a failed optional installation reports failure without retrying forever", async () => {
  const failures: unknown[] = [];
  const host = createCartographyLifecycle(async () => { throw new Error("unavailable"); }, error => failures.push(error));
  host.update(true);
  await tick();
  assert.equal(failures.length, 1);
  host.dispose();
});
