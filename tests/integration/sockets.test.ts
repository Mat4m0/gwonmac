import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, it } from "node:test";
import type { SocketEvent } from "../../src/shared/contracts.ts";
import { SocketManager } from "../../src/main/core/sockets.ts";

// The sink is handed the owner alongside the contract event, so the recorded
// shape is the event union widened by one field — and it stays a union, so a
// recorded "data" still carries `data` and a recorded "open" still does not.
type RecordedEvent = SocketEvent & { ownerId: number };

describe("integration: native sockets", () => {
  const events: RecordedEvent[] = [];
  const counters = new Map<string, number>();
  const observations: { name: string; value: number }[] = [];
  const server = net.createServer((socket) => {
    socket.on("data", (data) => socket.write(data));
  });
  const manager = new SocketManager(
    (ownerId, event) => events.push({ ownerId, ...event }),
    {
      count: (name, value = 1) =>
        counters.set(name, (counters.get(name) ?? 0) + value),
      observe: (name, value) => observations.push({ name, value }),
    },
    (destination) => {
      assert.equal(destination, "127.0.0.1:6112");
      return { host: "127.0.0.1", port: 6112, family: 4 };
    },
  );

  before(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", () => resolve());
    });
  });

  after(async () => {
    manager.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function event<Type extends SocketEvent["type"]>(
    type: Type,
    socketId: number,
  ): Promise<Extract<RecordedEvent, { type: Type }>> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const found = events.find(
        (candidate): candidate is Extract<RecordedEvent, { type: Type }> =>
          candidate.type === type && candidate.socketId === socketId,
      );
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`socket ${socketId} did not emit ${type}`);
  }

  it("delivers open, exact binary data, metrics, ownership, and one close", async () => {
    const owner = 41;
    const socketId = await manager.connect(owner, "127.0.0.1:6112");
    await event("open", socketId);
    const payload = new Uint8Array([0, 1, 127, 128, 255]);
    await manager.send(socketId, payload, owner);
    const data = await event("data", socketId);
    assert.deepEqual([...data.data], [...payload]);
    await assert.rejects(() => manager.send(socketId, payload, owner + 1), /owned/);
    await manager.close(socketId, owner);
    await event("close", socketId);
    assert.equal(
      events.filter(
        (candidate) =>
          candidate.type === "close" && candidate.socketId === socketId,
      ).length,
      1,
    );
    assert.equal(counters.get("socket.opened"), 1);
    assert.equal(counters.get("socket.sendCalls"), 1);
    assert.equal(counters.get("socket.sendPayloadBytes"), payload.length);
    assert.equal(counters.get("socket.bytesSent"), payload.length);
    assert.equal(counters.get("socket.bytesReceived"), payload.length);
    assert.ok(observations.some((sample) => sample.name === "socket.connect"));
    assert.ok(
      observations.some((sample) => sample.name === "socket.writeCallback"),
    );
    assert.ok(observations.some((sample) => sample.name === "socket.lifetime"));
  });
});
