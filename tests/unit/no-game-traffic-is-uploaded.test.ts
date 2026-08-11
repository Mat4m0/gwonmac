// The public promise is not that an online game sends nothing: required login
// and gameplay traffic goes to ArenaNet. It is that none of that data can be
// redirected to GWonMac or another arbitrary endpoint, and that diagnostics
// never contain the payload. This test owns those two executable boundaries.
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
//     three socket events the diagnostics schema declares carry an id, an
//     allowlisted destination port, a close reason and a failure code. A
//     record that carries anything else stops the export instead of being
//     scrubbed on the way out.
//
// A third property joined the claim when the certificate feed gained a
// delivery path: the app now fetches a document of its own from GitHub, and a
// request is a place a fact about this installation could travel. The last
// section holds that request to the same standard — it carries the address and
// nothing this application added to it.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { SocketEvent } from "../../src/shared/contracts.ts";
import {
  CERTIFICATE_FEED_ASSET,
  CERTIFICATE_FEED_SIGNATURE_ASSET,
  CertificateFeedDelivery,
} from "../../src/main/certification/certificate-feed-delivery.ts";
import { latestReleaseAssetUrl } from "../../src/shared/project-identity.ts";
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
    // Annotated on the callback rather than only on `recorded`: flatMap infers
    // its element type from the first branch, so a socket event that stopped
    // matching the schema would have been widened away instead of rejected.
    const recorded: DiagnosticEvent[] = events.flatMap((event): DiagnosticEvent[] => {
      if (event.type === "open") {
        return [{ k: "socket.open", socketId: event.socketId, port: event.port }];
      }
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

    assert.doesNotThrow(() => inspectEventLog(line({ socketId: 1, port: 6112 })));
    assert.throws(
      () => inspectEventLog(line({ socketId: 1, port: 6112, bytes: "QUNDT1VOVA==" })),
      /carries undeclared field bytes/,
    );
    assert.throws(
      () => inspectEventLog(line({ socketId: 1, port: 6112, payload: [65, 66, 67] })),
      /undeclared field payload/,
    );
  });
});

describe("no game traffic is uploaded: what the certificate feed asks for", () => {
  const roots: string[] = [];
  after(async () => {
    await Promise.all(
      roots.map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  /**
   * A delivery whose pin is a throwaway public key, so requests happen at all,
   * and whose fetch records the exact call rather than making one. The private
   * half is discarded on the next line: nothing here needs to sign.
   */
  async function recorded(): Promise<{
    delivery: CertificateFeedDelivery;
    calls: { url: string; init: RequestInit | undefined }[];
  }> {
    const root = await mkdtemp(path.join(tmpdir(), "gw-feed-request-"));
    roots.push(root);
    const spki = generateKeyPairSync("ed25519").publicKey.export({
      format: "der",
      type: "spki",
    });
    const pinnedKeyPath = path.join(root, "public-key.txt");
    await writeFile(pinnedKeyPath, spki.subarray(spki.byteLength - 32).toString("base64"));
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    return {
      calls,
      delivery: new CertificateFeedDelivery({
        storePath: path.join(root, "certificate-feed.json"),
        pinnedKeyPath,
        enabled: true,
        publish: () => {},
        fetch: async (input, init) => {
          calls.push({ url: String(input), init });
          return new Response(new Uint8Array(), { status: 200 });
        },
      }),
    };
  }

  it("asks two fixed addresses derived from this project's repository", async () => {
    const { delivery, calls } = await recorded();
    await delivery.refresh();

    assert.deepEqual(calls.map(({ url }) => url), [
      latestReleaseAssetUrl(CERTIFICATE_FEED_ASSET),
      latestReleaseAssetUrl(CERTIFICATE_FEED_SIGNATURE_ASSET),
    ]);
    for (const { url } of calls) {
      const parsed = new URL(url);
      // A query string and a fragment are the two places a value could be
      // smuggled into an address that otherwise looks constant.
      assert.equal(parsed.origin, "https://github.com");
      assert.equal(parsed.search, "");
      assert.equal(parsed.hash, "");
      assert.equal(parsed.username, "");
      assert.equal(parsed.password, "");
    }
  });

  it("adds nothing to the request: no body, no header, no credential", async () => {
    const { delivery, calls } = await recorded();
    await delivery.refresh();

    assert.equal(calls.length, 2);
    for (const { init } of calls) {
      assert.ok(init, "the request was made with no init at all");
      assert.equal(init.method, "GET");
      // A GET with a body would be the plainest way to upload something. The
      // rest are the ways an installation could be recognised without one.
      assert.equal(init.body, undefined);
      assert.equal(init.headers, undefined);
      assert.equal(init.credentials, "omit");
      assert.equal(init.cache, "no-store");
      assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.referrer, undefined);
      assert.equal(init.integrity, undefined);
      // The transport's own keys are the only ones present, and none of them
      // names a value this application chose.
      assert.deepEqual(Object.keys(init).sort(), [
        "cache",
        "credentials",
        "method",
        "redirect",
        "referrerPolicy",
        "signal",
      ]);
    }
  });
});
