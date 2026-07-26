import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSocketHost } from "../../src/renderer/socket-host.js";
import {
  MAX_QUEUED_BYTES_PER_OWNER,
  MAX_QUEUED_BYTES_PER_SOCKET,
  MAX_SOCKETS_PER_OWNER,
  SocketManager,
  type ManagedSocket,
  type SocketFactory,
} from "../../src/main/core/sockets.js";
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
    native.emit({ type: "close", socketId: 21, reason: "requested" });
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

/**
 * A socket whose write callbacks fire when the test says so. A loopback peer
 * cannot express "this write is still queued" — the kernel drains an arbitrary
 * prefix of it — and the reservation bug these tests pin is precisely about a
 * callback that arrives after the socket is already gone.
 */
class FakeSocket implements ManagedSocket {
  readonly writes: Array<(error?: Error | null) => void> = [];
  destroyed = false;
  private readonly onConnect: Array<() => void> = [];
  private readonly onError: Array<(error: Error) => void> = [];
  private readonly onClose: Array<() => void> = [];

  setNoDelay(): void {}

  write(_data: Uint8Array, callback: (error?: Error | null) => void): boolean {
    this.writes.push(callback);
    return false;
  }

  destroy(): void {
    this.destroyed = true;
  }

  once(_event: "connect", listener: () => void): void {
    this.onConnect.push(listener);
  }

  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
  on(
    event: "data" | "error" | "close",
    listener:
      | ((chunk: Uint8Array) => void)
      | ((error: Error) => void)
      | (() => void),
  ): void {
    if (event === "error") this.onError.push(listener as (error: Error) => void);
    if (event === "close") this.onClose.push(listener as () => void);
  }

  /** The peer accepted the connection. */
  open(): void {
    for (const listener of this.onConnect.splice(0)) listener();
  }

  /** The socket errored, as after a peer reset. */
  fail(message: string): void {
    for (const listener of [...this.onError]) listener(new Error(message));
  }

  /** Every write callback still owed fires now, as Node does on destroy. */
  flushPendingWrites(error?: Error): void {
    for (const callback of this.writes.splice(0)) callback(error ?? null);
  }
}

function socketFixture() {
  const created: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const socket = new FakeSocket();
    created.push(socket);
    return socket;
  };
  const events: Array<{ ownerId: number } & SocketEvent> = [];
  const manager = new SocketManager(
    (ownerId, event) => events.push({ ownerId, ...event }),
    null,
    () => ({ host: "127.0.0.1", port: 6112, family: 4 }),
    factory,
  );
  return {
    manager,
    created,
    events,
    async connect(ownerId: number): Promise<{ id: number; socket: FakeSocket }> {
      const before = created.length;
      const id = await manager.connect(ownerId, "127.0.0.1:6112");
      const socket = created[before]!;
      socket.open();
      return { id, socket };
    },
  };
}


/**
 * Start a send without awaiting it: a queued write settles only when the peer
 * drains it, so awaiting one that is still reserved would hang.
 */
function startSend(promise: Promise<void>): {
  settled: boolean;
  error: unknown;
} {
  const state: { settled: boolean; error: unknown } = {
    settled: false,
    error: undefined,
  };
  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

const FULL_SOCKET = new Uint8Array(MAX_QUEUED_BYTES_PER_SOCKET);
const ONE_BYTE = new Uint8Array(1);
const SOCKETS_PER_OWNER_BUDGET =
  MAX_QUEUED_BYTES_PER_OWNER / MAX_QUEUED_BYTES_PER_SOCKET;
const totalQueued = (manager: SocketManager): number =>
  [...manager.queuedBytesByOwner().values()].reduce((sum, n) => sum + n, 0);

describe("main-process socket queue budget", () => {
  it("holds the aggregate owner ceiling across 64 sockets", async () => {
    const fixture = socketFixture();
    const owner = 3;
    const opened: number[] = [];
    for (let i = 0; i < MAX_SOCKETS_PER_OWNER; i += 1) {
      opened.push((await fixture.connect(owner)).id);
    }
    assert.equal(fixture.manager.size(owner), MAX_SOCKETS_PER_OWNER);

    const attempts = opened.map((id) =>
      startSend(fixture.manager.send(id, FULL_SOCKET, owner)),
    );
    await turn();

    // The per-socket ceiling alone would have allowed 64 x 4 MiB = 256 MiB.
    const reserved = attempts.filter((attempt) => !attempt.settled);
    assert.equal(reserved.length, SOCKETS_PER_OWNER_BUDGET);
    assert.equal(
      attempts.filter((attempt) =>
        /owner send queue exceeds/.test(String(attempt.error)),
      ).length,
      MAX_SOCKETS_PER_OWNER - SOCKETS_PER_OWNER_BUDGET,
    );
    assert.deepEqual(
      fixture.manager.queuedBytesByOwner(),
      new Map([[owner, MAX_QUEUED_BYTES_PER_OWNER]]),
    );

    // Refusal is not teardown: every socket is still open, and the moment the
    // peer drains one write the budget it held becomes spendable again.
    assert.equal(fixture.manager.size(owner), MAX_SOCKETS_PER_OWNER);
    const last = opened[MAX_SOCKETS_PER_OWNER - 1]!;
    await assert.rejects(
      fixture.manager.send(last, ONE_BYTE, owner),
      /owner send queue exceeds/,
    );
    fixture.created[0]!.flushPendingWrites();
    const afterDrain = startSend(fixture.manager.send(last, ONE_BYTE, owner));
    await turn();
    assert.equal(afterDrain.settled, false);
    assert.equal(
      totalQueued(fixture.manager),
      MAX_QUEUED_BYTES_PER_OWNER - MAX_QUEUED_BYTES_PER_SOCKET + 1,
    );
    fixture.manager.closeAll();
  });

  it("refuses a write past the per-socket ceiling while the owner still has room", async () => {
    const fixture = socketFixture();
    const owner = 4;
    const first = await fixture.connect(owner);
    startSend(fixture.manager.send(first.id, FULL_SOCKET, owner));
    await assert.rejects(
      fixture.manager.send(first.id, ONE_BYTE, owner),
      /socket send queue exceeds/,
    );
    assert.equal(totalQueued(fixture.manager), MAX_QUEUED_BYTES_PER_SOCKET);

    const second = await fixture.connect(owner);
    startSend(fixture.manager.send(second.id, FULL_SOCKET, owner));
    await turn();
    assert.equal(totalQueued(fixture.manager), 2 * MAX_QUEUED_BYTES_PER_SOCKET);
    fixture.manager.closeAll();
  });

  it("keeps one owner's budget and sockets out of another owner's reach", async () => {
    const fixture = socketFixture();
    const noisy = 10;
    const quiet = 11;
    for (let i = 0; i < SOCKETS_PER_OWNER_BUDGET; i += 1) {
      const { id } = await fixture.connect(noisy);
      startSend(fixture.manager.send(id, FULL_SOCKET, noisy));
    }
    assert.equal(
      fixture.manager.queuedBytesByOwner().get(noisy),
      MAX_QUEUED_BYTES_PER_OWNER,
    );

    // A saturated owner spends none of anyone else's budget.
    const victim = await fixture.connect(quiet);
    const quietSend = startSend(
      fixture.manager.send(victim.id, FULL_SOCKET, quiet),
    );
    await turn();
    assert.equal(quietSend.settled, false);
    assert.equal(
      fixture.manager.queuedBytesByOwner().get(quiet),
      MAX_QUEUED_BYTES_PER_SOCKET,
    );

    await assert.rejects(
      fixture.manager.send(victim.id, ONE_BYTE, noisy),
      /is not owned by caller/,
    );
    await assert.rejects(
      fixture.manager.close(victim.id, noisy),
      /is not owned by caller/,
    );

    fixture.manager.closeAll(noisy);
    assert.equal(fixture.manager.size(noisy), 0);
    assert.equal(fixture.manager.size(quiet), 1);
    assert.equal(victim.socket.destroyed, false);
    assert.deepEqual(
      fixture.manager.queuedBytesByOwner(),
      new Map([[quiet, MAX_QUEUED_BYTES_PER_SOCKET]]),
    );
    fixture.manager.closeAll();
  });

  it("reclaims a dead socket's bytes once, not again when its callbacks arrive late", async () => {
    const fixture = socketFixture();
    const owner = 20;
    const doomed = await fixture.connect(owner);
    const survivor = await fixture.connect(owner);
    startSend(fixture.manager.send(doomed.id, FULL_SOCKET, owner));
    startSend(fixture.manager.send(survivor.id, FULL_SOCKET, owner));
    await turn();
    assert.equal(totalQueued(fixture.manager), 2 * MAX_QUEUED_BYTES_PER_SOCKET);

    await fixture.manager.close(doomed.id, owner);
    assert.equal(
      fixture.manager.queuedBytesByOwner().get(owner),
      MAX_QUEUED_BYTES_PER_SOCKET,
    );

    // Node fires a destroyed socket's owed callbacks afterwards. Charging them
    // a second time would take the surviving socket's reservation away.
    doomed.socket.flushPendingWrites(new Error("ERR_STREAM_DESTROYED"));
    assert.equal(
      fixture.manager.queuedBytesByOwner().get(owner),
      MAX_QUEUED_BYTES_PER_SOCKET,
    );

    survivor.socket.flushPendingWrites();
    assert.equal(fixture.manager.queuedBytesByOwner().size, 0);
    fixture.manager.closeAll();
  });

  it("leaves no owner queued after close, failure, reload and quit", async () => {
    const fixture = socketFixture();
    const owner = 30;

    const closed = await fixture.connect(owner);
    startSend(fixture.manager.send(closed.id, FULL_SOCKET, owner));
    await fixture.manager.close(closed.id, owner);
    assert.equal(fixture.manager.queuedBytesByOwner().size, 0, "after close");

    const failed = await fixture.connect(owner);
    startSend(fixture.manager.send(failed.id, FULL_SOCKET, owner));
    failed.socket.fail("peer reset");
    assert.equal(fixture.manager.queuedBytesByOwner().size, 0, "after failure");

    const reloaded = await fixture.connect(owner);
    startSend(fixture.manager.send(reloaded.id, FULL_SOCKET, owner));
    fixture.manager.closeAll(owner);
    assert.equal(fixture.manager.queuedBytesByOwner().size, 0, "after reload");

    const quitting = await fixture.connect(owner);
    startSend(fixture.manager.send(quitting.id, FULL_SOCKET, owner));
    fixture.manager.closeAll();
    assert.equal(fixture.manager.queuedBytesByOwner().size, 0, "after quit");

    // Every torn-down socket's write callbacks arrive after the fact.
    for (const socket of fixture.created) {
      socket.flushPendingWrites(new Error("ERR_STREAM_DESTROYED"));
    }
    await turn();
    assert.equal(
      fixture.manager.queuedBytesByOwner().size,
      0,
      "after late callbacks",
    );
    assert.equal(fixture.manager.size(), 0);

    // Per-socket counters returned to zero as well: the owner can reserve its
    // whole budget again, four full sockets' worth.
    for (let i = 0; i < SOCKETS_PER_OWNER_BUDGET; i += 1) {
      const { id } = await fixture.connect(owner);
      startSend(fixture.manager.send(id, FULL_SOCKET, owner));
    }
    await turn();
    assert.equal(totalQueued(fixture.manager), MAX_QUEUED_BYTES_PER_OWNER);
    fixture.manager.closeAll();
  });
});
