// `SocketManager` used to publish `error.message` and free-text close
// reasons to both the renderer and the flight recorder — libuv writes the
// destination address into that message ("connect ECONNREFUSED 1.2.3.4:6112").
// These tests drive the manager with a fake socket and read what it emitted:
// every failure must arrive as a declared code, and no emitted value may
// contain any part of the text the error carried.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SocketEvent } from "../../src/shared/contracts.ts";
import {
  CONNECT_TIMEOUT_MS,
  SocketManager,
  socketFailureCode,
  type ManagedSocket,
} from "../../src/main/core/sockets.ts";

class FakeSocket implements ManagedSocket {
  destroyed = false;
  private connect: (() => void) | null = null;
  private readonly handlers = new Map<string, ((value: never) => void)[]>();

  setNoDelay(): void {}
  write(_data: Uint8Array, callback: (error?: Error | null) => void): boolean {
    callback(null);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  once(_event: "connect", listener: () => void): void {
    this.connect = listener;
  }
  on(event: string, listener: (value: never) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
  }

  open(): void {
    this.connect?.();
  }
  emit(event: "data" | "error" | "close", value?: unknown): void {
    for (const listener of this.handlers.get(event) ?? []) {
      (listener as (value?: unknown) => void)(value);
    }
  }
}

function manager(): {
  sockets: SocketManager;
  socket: FakeSocket;
  events: SocketEvent[];
  connect: () => Promise<number>;
} {
  const socket = new FakeSocket();
  const events: SocketEvent[] = [];
  const sockets = new SocketManager(
    (_ownerId, event) => events.push(event),
    null,
    () => ({ host: "1.2.3.4", port: 6112, family: 4 }),
    () => socket,
  );
  return {
    sockets,
    socket,
    events,
    connect: () => sockets.connect(7, "1.2.3.4:6112"),
  };
}

/** Every string an emitted event carries, whatever its shape. */
function emittedText(events: SocketEvent[]): string[] {
  return events.flatMap((event) =>
    Object.values(event).filter(
      (value): value is string => typeof value === "string",
    ),
  );
}

describe("socket events carry no error text", () => {
  it("publishes a declared failure code, not libuv's message", async () => {
    const { socket, events, connect } = manager();
    await connect();
    socket.open();
    const refused = Object.assign(
      new Error("connect ECONNREFUSED 1.2.3.4:6112"),
      { code: "ECONNREFUSED" },
    );
    socket.emit("error", refused);

    assert.deepEqual(events, [
      { type: "open", socketId: 1, port: 6112 },
      { type: "error", socketId: 1, code: "refused" },
      { type: "close", socketId: 1, reason: "error" },
    ]);
    for (const text of emittedText(events)) {
      assert.equal(text.includes("1.2.3.4"), false, text);
      assert.equal(text.includes("ECONNREFUSED"), false, text);
    }
  });

  it("collapses an unrecognised errno rather than passing it through", async () => {
    const { socket, events, connect } = manager();
    await connect();
    socket.open();
    socket.emit(
      "error",
      Object.assign(new Error("read EPROTO /Users/x/socket"), {
        code: "EPROTO",
      }),
    );

    assert.deepEqual(events.at(-2), {
      type: "error",
      socketId: 1,
      code: "other",
    });
    for (const text of emittedText(events)) {
      assert.equal(text.includes("EPROTO"), false, text);
      assert.equal(text.includes("/Users/x"), false, text);
    }
  });

  it("classifies each errno the allowlist names, and nothing else", () => {
    assert.equal(socketFailureCode({ code: "ETIMEDOUT" }), "timeout");
    assert.equal(socketFailureCode({ code: "ECONNREFUSED" }), "refused");
    assert.equal(socketFailureCode({ code: "ECONNRESET" }), "reset");
    assert.equal(socketFailureCode({ code: "EPIPE" }), "reset");
    assert.equal(socketFailureCode({ code: "EHOSTUNREACH" }), "unreachable");
    assert.equal(socketFailureCode({ code: "ENETUNREACH" }), "unreachable");
    assert.equal(socketFailureCode({ code: "ENETDOWN" }), "unreachable");
    assert.equal(socketFailureCode({ code: "ENOTFOUND" }), "dns");
    assert.equal(socketFailureCode({ code: "EAI_AGAIN" }), "dns");
    // Not an errno, not an object, not an error at all.
    assert.equal(socketFailureCode({ code: "EPROTO" }), "other");
    assert.equal(socketFailureCode(new Error("plain")), "other");
    assert.equal(socketFailureCode("ECONNREFUSED"), "other");
    assert.equal(socketFailureCode(null), "other");
    assert.equal(socketFailureCode(undefined), "other");
  });

  it("names why a socket closed, from a closed vocabulary", async () => {
    for (const [act, reason] of [
      [
        (sockets: SocketManager, socket: FakeSocket) => {
          socket.open();
          return sockets.close(1, 7);
        },
        "requested",
      ],
      [
        (sockets: SocketManager, socket: FakeSocket) => {
          socket.open();
          sockets.closeAll(7);
        },
        "owner",
      ],
      [
        (_sockets: SocketManager, socket: FakeSocket) => {
          socket.open();
          socket.emit("close");
        },
        "peer",
      ],
    ] as const) {
      const { sockets, socket, events, connect } = manager();
      await connect();
      await act(sockets, socket);
      assert.deepEqual(
        events.at(-1),
        { type: "close", socketId: 1, reason },
        reason,
      );
    }
  });

  it("reports a connect timeout as a timeout, not as an error", async () => {
    const timers: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      if (ms === CONNECT_TIMEOUT_MS) timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    try {
      const { socket, events, connect } = manager();
      await connect();
      assert.equal(timers.length, 1);
      timers[0]!();
      assert.equal(socket.destroyed, true);
      assert.deepEqual(events, [
        { type: "error", socketId: 1, code: "timeout" },
        { type: "close", socketId: 1, reason: "timeout" },
      ]);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
