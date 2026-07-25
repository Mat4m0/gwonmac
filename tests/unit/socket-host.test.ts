import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSocketHost } from "../../src/renderer/socket-host.js";
import type { SocketEvent } from "../../src/shared/contracts.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeNative() {
  let listener: ((event: SocketEvent) => void) | null = null;
  let subscriptions = 0;
  let unsubscribes = 0;
  const connects: Array<(id: number) => void> = [];
  const closes: number[] = [];
  const sends: Array<{ id: number; data: Uint8Array }> = [];
  return {
    api: {
      connect: () =>
        new Promise<number>((resolve) => {
          connects.push(resolve);
        }),
      send: async (id: number, data: Uint8Array) => {
        sends.push({ id, data });
      },
      close: async (id: number) => {
        closes.push(id);
      },
      onEvent: (callback: (event: SocketEvent) => void) => {
        subscriptions += 1;
        listener = callback;
        return () => {
          unsubscribes += 1;
          listener = null;
        };
      },
    },
    connects,
    closes,
    sends,
    emit(event: SocketEvent) {
      listener?.(event);
    },
    counts: () => ({ subscriptions, unsubscribes }),
  };
}

describe("renderer socket host", () => {
  it("uses one subscription and demultiplexes sockets by native ID", async () => {
    const native = fakeNative();
    const host = createSocketHost({
      native: native.api,
      log: () => undefined,
    });
    const first = host.socket.connect("one");
    const second = host.socket.connect("two");
    const opened: string[] = [];
    const messages: number[] = [];
    first.onopen = () => opened.push("one");
    second.onopen = () => opened.push("two");
    first.onmessage = (data) => messages.push(data[0]!);
    native.connects[0]!(11);
    native.connects[1]!(12);
    await turn();
    native.emit({ type: "open", socketId: 12 });
    native.emit({ type: "open", socketId: 11 });
    native.emit({ type: "data", socketId: 11, data: new Uint8Array([7]) });
    assert.deepEqual(opened, ["two", "one"]);
    assert.deepEqual(messages, [7]);
    assert.equal(native.counts().subscriptions, 1);
    host.dispose();
    assert.equal(native.counts().unsubscribes, 1);
  });

  it("honors close requested before connect resolves and closes once", async () => {
    const native = fakeNative();
    const host = createSocketHost({
      native: native.api,
      log: () => undefined,
    });
    const socket = host.socket.connect("one");
    let closed = 0;
    socket.onclose = () => {
      closed += 1;
      socket.close();
    };
    socket.close();
    native.connects[0]!(21);
    await turn();
    assert.deepEqual(native.closes, [21]);
    native.emit({ type: "close", socketId: 21, reason: "closed" });
    assert.equal(closed, 1);
    assert.deepEqual(native.closes, [21]);
  });

  it("rejects pre-open sends asynchronously and compacts opened payloads", async () => {
    const native = fakeNative();
    const host = createSocketHost({
      native: native.api,
      log: () => undefined,
    });
    const socket = host.socket.connect("one");
    const early = socket.send(new Uint8Array([1]));
    await assert.rejects(early, /socket is not open/);

    native.connects[0]!(31);
    await turn();
    native.emit({ type: "open", socketId: 31 });
    const backing = new Uint8Array(1024);
    backing.set([2, 3, 4, 5], 100);
    await socket.send(backing.subarray(100, 104));
    assert.equal(native.sends.length, 1);
    assert.equal(native.sends[0]!.id, 31);
    assert.deepEqual([...native.sends[0]!.data], [2, 3, 4, 5]);
    assert.equal(native.sends[0]!.data.buffer.byteLength, 4);
  });
});
