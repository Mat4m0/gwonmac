/** Execute retained event delivery to distinguish queued completion from processed updates. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { queueFixture } from "../fixtures/native-friend-queue.js";
const CONTEXT = 0x700000;

test("retained native user-event queue preserves its processed boundary", async (t) => {
  const path = process.env.GW_CLIENT_WASM;
  assert.ok(path, "GW_CLIENT_WASM must name the retained official artifact");
  const input = new Uint8Array(await readFile(path));

  await t.test("enqueue success does not mean a friend update was processed", async () => {
    const f = await queueFixture(input);
    for (const id of [38, 44, 40, 14]) assert.equal(f.enqueue(id, id + 100), 1);
    assert.equal(f.delivered.length, 0);
    assert.equal(f.scheduled(), 4);
    f.drain();
    assert.deepEqual(f.delivered, [38, 44, 40, 14].map((id) => ({ id, value: id + 100, size: 4 })));
    f.drain();
    assert.equal(f.delivered.length, 4, "draining again must not redeliver consumed events");
  });

  await t.test("native login completion follows native roster production in the delivered queue", async () => {
    const f = await queueFixture(input);
    f.rosterEntry(41); // Wrong request is ignored by the original producer.
    f.rosterEntry();
    f.completeLogin(0);
    f.rosterEntry(); // A completed request cannot produce more initial entries.
    assert.equal(f.delivered.length, 0);
    f.drain();
    assert.deepEqual(f.delivered.map(({ id, size }) => ({ id, size })), [
      { id: 38, size: 104 }, { id: 14, size: 352 },
    ]);
    assert.equal(f.delivered[1]?.value, 0, "the processed completion carries success");
  });

  await t.test("native failed completion also emits event 14 and must not establish readiness", async () => {
    const f = await queueFixture(input);
    f.completeLogin(7);
    f.drain();
    assert.deepEqual(f.delivered, [{ id: 14, value: 7, size: 352 }]);
  });

  await t.test("an empty queue and a processed completion with no roster entries are distinguishable", async () => {
    const f = await queueFixture(input);
    f.drain();
    assert.equal(f.delivered.length, 0);
    f.completeLogin(0);
    assert.equal(f.delivered.length, 0);
    f.drain();
    assert.deepEqual(f.delivered, [{ id: 14, value: 0, size: 352 }]);
  });

  await t.test("FIFO survives a block boundary and copies payloads at enqueue time", async () => {
    const f = await queueFixture(input);
    for (let index = 0; index < 100; index += 1) assert.equal(f.enqueue(38, index, 104), 1);
    assert.equal(f.enqueue(14, 777, 352), 1);
    f.drain();
    assert.deepEqual(f.delivered, [
      ...Array.from({ length: 100 }, (_, value) => ({ id: 38, value, size: 104 })),
      { id: 14, value: 777, size: 352 },
    ]);
    assert.ok(f.allocatedBytes() > 8192);
  });

  await t.test("events enqueued from a callback wait for the next drain", async () => {
    const f = await queueFixture(input);
    f.onDelivery((id) => { if (id === 38) assert.equal(f.enqueue(40, 999), 1); });
    f.enqueue(38, 123);
    f.enqueue(14);
    f.drain();
    assert.deepEqual(f.delivered.map((event) => event.id), [38, 14]);
    f.drain();
    assert.deepEqual(f.delivered.map((event) => event.id), [38, 14, 40]);
  });

  await t.test("disabled contexts can report enqueue success without delivering completion", async () => {
    const f = await queueFixture(input);
    f.write(CONTEXT + 20, 4);
    assert.equal(f.enqueue(14), 1);
    f.drain();
    assert.equal(f.delivered.length, 0);
    assert.equal(f.scheduled(), 0);
  });

  await t.test("closed queues refuse the completion event", async () => {
    const f = await queueFixture(input);
    f.write(CONTEXT + 592, 1);
    assert.equal(f.enqueue(14), 0);
    f.drain();
    assert.equal(f.delivered.length, 0);
  });
});
