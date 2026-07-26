// P3.24. The website answers "Is Guild Wars for macOS safe?" with: the app
// "does not upload telemetry, credentials, account identifiers, or game
// traffic". One review read the game-traffic half as an overclaim. It is not —
// but until now it was backed by three modules' own tests that happen to add up
// to it, and nothing named for the claim. This is that test.
//
// Two properties make game packets un-uploadable, and both run here:
//
//  1. A packet can only leave through a socket, and a socket can only be
//     pointed at a public ArenaNet destination. Loopback, private addresses and
//     every port outside the game's three are refused before a connection
//     exists, so no host this project controls can be handed a packet.
//     `SocketManager` reaches the network through exactly one injected factory
//     (`net.connect` in production), so the destinations that factory is given
//     are the complete set of destinations the app can open.
//  2. What the recorder is told about a socket cannot contain the bytes. The
//     manager publishes payloads to exactly one consumer — the game — and the
//     three socket events the diagnostics schema declares carry an id, a close
//     reason and a failure code. A record that carries anything else stops the
//     export instead of being scrubbed on the way out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SocketEvent } from "../../src/shared/contracts.ts";
import { allowedName, isAllowedPort } from "../../src/main/core/allowlists.ts";
import { AppError } from "../../src/shared/errors.ts";
import { inspectEventLog } from "../../src/main/diagnostics/detector.ts";
import { diagnosticEventRecord } from "../../src/main/diagnostics/schema.ts";
import type { DiagnosticEvent } from "../../src/main/diagnostics/schema.ts";
import {
  SocketManager,
  parseDestination,
  type ManagedSocket,
} from "../../src/main/core/sockets.ts";

class FakeSocket implements ManagedSocket {
  written: Uint8Array[] = [];
  private connect: (() => void) | null = null;
  private readonly handlers = new Map<string, ((value: never) => void)[]>();

  setNoDelay(): void {}
  write(data: Uint8Array, callback: (error?: Error | null) => void): boolean {
    this.written.push(data);
    callback(null);
    return true;
  }
  destroy(): void {}
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

interface Attempt {
  host: string;
  port: number;
  family: 4 | 6;
}

/**
 * The production validator, passed explicitly because the socket factory after
 * it must be. The loopback case below uses the constructor's own defaults, so
 * the default validator is exercised too.
 */
function manager(): {
  sockets: SocketManager;
  socket: FakeSocket;
  events: SocketEvent[];
  attempts: Attempt[];
} {
  const socket = new FakeSocket();
  const events: SocketEvent[] = [];
  const attempts: Attempt[] = [];
  const sockets = new SocketManager(
    (_ownerId, event) => events.push(event),
    null,
    parseDestination,
    (options) => {
      attempts.push(options);
      return socket;
    },
  );
  return { sockets, socket, events, attempts };
}

describe("no game traffic is uploaded: the only reachable destination", () => {
  it("refuses every destination that is not a public ArenaNet-shaped address", async () => {
    // Each of these is a way a packet could reach somebody other than the game.
    const refused = [
      ["127.0.0.1:6112", "a collector running on the player's own machine"],
      ["192.168.1.10:443", "a box on the player's LAN"],
      ["10.0.0.5:6112", "a private-range host"],
      ["169.254.10.1:80", "link-local"],
      ["100.64.0.1:443", "carrier-grade NAT"],
      ["203.0.113.10:8080", "a public host on a port the game never uses"],
      ["203.0.113.10:22", "a public host on SSH"],
      ["gwonmac.vercel.app:443", "this project's own website, by name"],
      ["203.0.113.10", "a bare address with no port"],
    ] as const;

    for (const [destination, why] of refused) {
      const { sockets, attempts } = manager();
      await assert.rejects(
        sockets.connect(1, destination),
        (error: unknown) => error instanceof AppError,
        `${destination} (${why}) must not be connectable`,
      );
      assert.deepEqual(attempts, [], `${destination} reached the network`);
      assert.equal(sockets.size(), 0);
    }
  });

  it("refuses loopback through the constructor's own defaults", async () => {
    // No factory is injected here, so the default one (`net.connect`) would run
    // if the default validator let this through. Nothing is attempted: the
    // rejection happens before a socket object exists.
    const sockets = new SocketManager(() => {});
    await assert.rejects(sockets.connect(1, "127.0.0.1:6112"));
    assert.equal(sockets.size(), 0);
  });

  it("opens an allowed destination at exactly the address it was given", async () => {
    for (const port of [6112, 80, 443]) {
      const { sockets, attempts } = manager();
      await sockets.connect(1, `203.0.113.10:${port}`);
      assert.deepEqual(attempts, [{ host: "203.0.113.10", port, family: 4 }]);
    }
  });

  it("resolves no name outside ArenaNet's, including this project's own", () => {
    for (const host of [
      "gwonmac.vercel.app",
      "api.github.com",
      "plausible.io",
      "ko-fi.com",
      "arenanetworks.com.example.net",
    ]) {
      assert.equal(allowedName(host), false, host);
    }
    assert.equal(allowedName("auth.arenanetworks.com"), true);
    assert.equal(allowedName("guildwars.com"), true);
    assert.equal(isAllowedPort(8080), false);
  });
});

describe("no game traffic is uploaded: what the recorder may hear", () => {
  /** One socket's whole life, with a payload in each direction. */
  async function lifetime(payload: Uint8Array): Promise<SocketEvent[]> {
    const { sockets, socket, events } = manager();
    const id = await sockets.connect(1, "203.0.113.10:6112");
    socket.open();
    await sockets.send(id, payload);
    socket.emit("data", payload);
    await sockets.close(id);
    return events;
  }

  it("publishes payload bytes to the game and to nothing else", async () => {
    const payload = new TextEncoder().encode("ACCOUNT-SECRET-PACKET");
    const events = await lifetime(payload);

    const carriers = events.filter((event) => event.type === "data");
    assert.equal(carriers.length, 1);
    assert.deepEqual(carriers[0], { type: "data", socketId: 1, data: payload });

    // Every other event is a lifetime event, and none of them is a byte.
    for (const event of events) {
      if (event.type === "data") continue;
      for (const value of Object.values(event)) {
        assert.equal(
          typeof value === "string" || typeof value === "number",
          true,
          `${event.type} carries a non-scalar field`,
        );
      }
    }
  });

  it("exports a socket's lifetime with no trace of what it carried", async () => {
    const secret = "ACCOUNT-SECRET-PACKET";
    const payload = new TextEncoder().encode(secret);
    const events = await lifetime(payload);

    // The three events the diagnostics schema declares for a socket, built the
    // way the production path builds them.
    const recorded: DiagnosticEvent[] = events.flatMap((event) => {
      if (event.type === "open") return [{ k: "socket.open", socketId: event.socketId }];
      if (event.type === "close") {
        return [
          { k: "socket.close", socketId: event.socketId, reason: event.reason },
        ];
      }
      if (event.type === "error") {
        return [{ k: "socket.error", socketId: event.socketId, code: event.code }];
      }
      return [];
    });
    assert.equal(recorded.length, 2);

    let seq = 0;
    const log = recorded
      .map((event) => {
        seq += 1;
        const record = diagnosticEventRecord(event);
        return JSON.stringify({
          seq,
          tsUs: 1_000 * seq,
          wallTime: new Date(seq * 1_000).toISOString(),
          level: record.level,
          subsystem: record.subsystem,
          name: record.name,
          fields: record.fields,
        });
      })
      .join("\n");

    const inspection = inspectEventLog(log);
    assert.equal(inspection.records, recorded.length);
    assert.equal(inspection.schemaChecked, recorded.length);
    assert.equal(inspection.openFields, 0);

    // Not "the redactor removed it" — there is nowhere for it to have been.
    assert.equal(log.includes(secret), false);
    assert.equal(log.includes(Buffer.from(payload).toString("base64")), false);
    assert.equal(log.includes(Buffer.from(payload).toString("hex")), false);
  });

  it("stops the export if a socket record carries the bytes anyway", () => {
    const line = (fields: Record<string, unknown>) =>
      JSON.stringify({
        seq: 1,
        tsUs: 1_000,
        wallTime: new Date(1_000).toISOString(),
        level: "info",
        subsystem: "socket",
        name: "socket.open",
        fields,
      });

    assert.doesNotThrow(() => inspectEventLog(line({ socketId: 1 })));
    assert.throws(
      () => inspectEventLog(line({ socketId: 1, bytes: "QUNDT1VOVA==" })),
      /carries undeclared field bytes/,
    );
    assert.throws(
      () => inspectEventLog(line({ socketId: 1, payload: [65, 66, 67] })),
      /undeclared field payload/,
    );
  });
});
