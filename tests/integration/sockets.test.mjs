import assert from "node:assert/strict";
import net from "node:net";
import { after, before, describe, it } from "node:test";
import { SocketManager } from "../../build/main/core/sockets.js";

describe("integration: native sockets", () => {
  const events = [];
  const counters = new Map();
  const observations = [];
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
  );

  before(async () => {
    process.env.GW_ALLOW_PRIVATE = "1";
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(6112, "127.0.0.1", resolve);
    });
  });

  after(async () => {
    manager.closeAll();
    delete process.env.GW_ALLOW_PRIVATE;
    await new Promise((resolve) => server.close(resolve));
  });

  async function event(type, socketId) {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const found = events.find(
        (candidate) =>
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
