/**
 * Main-process TCP ownership: public unicast only, ports 6112/80/443.
 *
 * The renderer never holds a handle. It holds a socket id, and every operation
 * on that id is re-checked against the owner it was opened under, so one
 * renderer generation cannot read, write to, or close another's connection.
 * Owner teardown closes what that owner opened and nothing else.
 *
 * The per-socket and per-owner queue ceilings are the backpressure boundary: a
 * client that writes faster than the network drains is refused rather than
 * allowed to grow main-process memory without limit. Sockets are counted per
 * owner for the same reason.
 *
 * Nothing about a destination or a libuv failure escapes as text. Addresses stay
 * inside this module and errors collapse into the closed contract vocabulary
 * before they are published.
 */
import net from "node:net";
import type {
  SocketCloseReason,
  SocketEvent,
  SocketFailureCode,
} from "../../shared/contracts.js";
import { AllowlistError, ValidationError } from "../../shared/errors.js";
import {
  assertPublicDestination,
  parseDestination as parseAllowedDestination,
} from "./allowlists.js";

export const CONNECT_TIMEOUT_MS = 10_000;
export const MAX_SOCKETS_PER_OWNER = 64;
export const MAX_QUEUED_BYTES_PER_SOCKET = 4 * 1024 * 1024;
export const MAX_QUEUED_BYTES_PER_OWNER = 16 * 1024 * 1024;

/**
 * The one place a socket failure becomes a publishable value. `error.message`
 * quotes the destination address and `error.code` is an open libuv set, so
 * neither may leave this module; both collapse into the closed contract
 * vocabulary, and anything unrecognised is "other".
 */
export function socketFailureCode(error: unknown): SocketFailureCode {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  switch (code) {
    case "ETIMEDOUT":
      return "timeout";
    case "ECONNREFUSED":
      return "refused";
    case "ECONNRESET":
    case "EPIPE":
      return "reset";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ENETDOWN":
      return "unreachable";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
    default:
      return "other";
  }
}

export function parseDestination(destination: string): {
  host: string;
  port: number;
  family: 4 | 6;
} {
  const parsed = parseAllowedDestination(destination);
  assertPublicDestination(parsed.host, parsed.port);
  return {
    host: parsed.host,
    port: parsed.port,
    family: parsed.host.includes(":") ? 6 : 4,
  };
}

/**
 * One outstanding write's claim on the per-socket and per-owner budgets.
 * `settled` makes the release exactly-once: a socket torn down with pending
 * writes reclaims its own reservations, and a write callback that fires
 * afterwards must not subtract those bytes a second time — the owner counter
 * outlives the socket and would otherwise be charged against surviving ones.
 */
interface Reservation {
  readonly bytes: number;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
}

interface OwnedSocket {
  id: number;
  ownerId: number;
  socket: ManagedSocket;
  queuedBytes: number;
  reservations: Set<Reservation>;
  opened: boolean;
  closed: boolean;
  destination: string;
  bytesSent: number;
  bytesReceived: number;
  openedAt: number;
}

/**
 * The part of `net.Socket` this manager uses. `net.Socket` satisfies it
 * structurally, so production is unchanged, and a test can supply a socket
 * whose write callbacks fire when the test says so rather than when a kernel
 * buffer happens to drain.
 */
export interface ManagedSocket {
  setNoDelay(enable: boolean): void;
  write(data: Uint8Array, callback: (error?: Error | null) => void): boolean;
  destroy(): void;
  once(event: "connect", listener: () => void): void;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
}

export type SocketEventSink = (ownerId: number, event: SocketEvent) => void;
export type SocketDestinationValidator = (destination: string) => {
  host: string;
  port: number;
  family: 4 | 6;
};
export type SocketFactory = (options: {
  host: string;
  port: number;
  family: 4 | 6;
}) => ManagedSocket;
export interface SocketMetrics {
  count(name: string, delta?: number, ownerId?: number): void;
  observe(name: string, durationUs: number, ownerId?: number): void;
  gauge?(name: string, value: number): void;
  peakGauge?(name: string, value: number): void;
}

export class SocketManager {
  private readonly sockets = new Map<number, OwnedSocket>();
  private readonly byOwner = new Map<number, Set<number>>();
  private readonly queuedByOwner = new Map<number, number>();
  private nextId = 1;
  private activeWrites = 0;
  private readonly emit: SocketEventSink;
  private readonly metrics: SocketMetrics | null;
  private readonly validateDestination: SocketDestinationValidator;
  private readonly createSocket: SocketFactory;

  constructor(
    emit: SocketEventSink,
    metrics: SocketMetrics | null = null,
    validateDestination: SocketDestinationValidator = parseDestination,
    createSocket: SocketFactory = (options) => net.connect(options),
  ) {
    this.emit = emit;
    this.metrics = metrics;
    this.validateDestination = validateDestination;
    this.createSocket = createSocket;
  }

  async connect(ownerId: number, destination: string): Promise<number> {
    const parsed = this.validateDestination(destination);
    const owned = this.byOwner.get(ownerId);
    if (owned && owned.size >= MAX_SOCKETS_PER_OWNER) {
      throw new AllowlistError(`socket limit ${MAX_SOCKETS_PER_OWNER} reached`);
    }

    const id = this.nextId++;
    const socket = this.createSocket({
      host: parsed.host,
      port: parsed.port,
      family: parsed.family,
    });
    socket.setNoDelay(true);

    const entry: OwnedSocket = {
      id,
      ownerId,
      socket,
      queuedBytes: 0,
      reservations: new Set(),
      opened: false,
      closed: false,
      destination,
      bytesSent: 0,
      bytesReceived: 0,
      openedAt: Date.now(),
    };
    this.sockets.set(id, entry);
    let set = this.byOwner.get(ownerId);
    if (!set) {
      set = new Set();
      this.byOwner.set(ownerId, set);
    }
    set.add(id);

    const timer = setTimeout(() => {
      if (!entry.opened && !entry.closed) {
        this.fail(entry, "timeout");
      }
    }, CONNECT_TIMEOUT_MS);

    socket.once("connect", () => {
      clearTimeout(timer);
      if (entry.closed) return;
      entry.opened = true;
      this.metrics?.count("socket.opened", 1, ownerId);
      this.metrics?.observe(
        "socket.connect",
        (Date.now() - entry.openedAt) * 1_000,
        ownerId,
      );
      this.emit(ownerId, { type: "open", socketId: id, port: parsed.port });
    });

    socket.on("data", (buf) => {
      if (entry.closed) return;
      entry.bytesReceived += buf.byteLength;
      this.metrics?.count("socket.bytesReceived", buf.byteLength, ownerId);
      this.emit(ownerId, {
        type: "data",
        socketId: id,
        data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      });
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      if (entry.closed) return;
      this.emit(ownerId, {
        type: "error",
        socketId: id,
        code: socketFailureCode(err),
      });
      this.finish(entry, "error");
    });

    socket.on("close", () => {
      clearTimeout(timer);
      this.finish(entry, "peer");
    });

    return id;
  }

  async send(socketId: number, data: Uint8Array, ownerId?: number): Promise<void> {
    const entry = this.require(socketId, ownerId);
    if (!entry.opened || entry.closed) {
      throw new ValidationError(`socket ${socketId} is not open`);
    }
    if (!(data instanceof Uint8Array)) {
      throw new ValidationError("socket send requires Uint8Array");
    }
    await new Promise<void>((resolve, reject) => {
      const reservation = this.reserve(entry, data.byteLength, resolve, reject);
      const started = process.hrtime.bigint();
      this.metrics?.count("socket.sendCalls", 1, entry.ownerId);
      this.metrics?.count("socket.sendPayloadBytes", data.byteLength, entry.ownerId);
      try {
        entry.socket.write(data, (err) => {
          if (!this.release(entry, reservation)) return;
          this.metrics?.observe(
            "socket.writeCallback",
            Number((process.hrtime.bigint() - started) / 1_000n),
            entry.ownerId,
          );
          if (err) {
            this.metrics?.count("socket.sendFailures", 1, entry.ownerId);
            reservation.reject(new ValidationError("socket send failed"));
          } else {
            entry.bytesSent += data.byteLength;
            this.metrics?.count("socket.bytesSent", data.byteLength, entry.ownerId);
            reservation.resolve();
          }
        });
      } catch {
        this.rejectReservation(
          entry,
          reservation,
          new ValidationError("socket send failed"),
        );
      }
    });
  }

  async close(socketId: number, ownerId?: number): Promise<void> {
    const entry = this.require(socketId, ownerId);
    if (entry.closed) return;
    entry.socket.destroy();
    this.finish(entry, "requested");
  }

  closeAll(ownerId?: number): void {
    const ids =
      ownerId === undefined
        ? [...this.sockets.keys()]
        : [...(this.byOwner.get(ownerId) ?? [])];
    for (const id of ids) {
      const entry = this.sockets.get(id);
      if (!entry || entry.closed) continue;
      entry.socket.destroy();
      this.finish(entry, "owner");
    }
  }

  size(ownerId?: number): number {
    if (ownerId === undefined) return this.sockets.size;
    return this.byOwner.get(ownerId)?.size ?? 0;
  }

  /**
   * Bytes reserved for in-flight writes, keyed by owner. An owner with nothing
   * outstanding has no key, so an idle manager returns an empty map.
   */
  queuedBytesByOwner(): Map<number, number> {
    return new Map(this.queuedByOwner);
  }

  /** Claim budget for one write, or refuse the write. Both ceilings apply. */
  private reserve(
    entry: OwnedSocket,
    bytes: number,
    resolve: () => void,
    reject: (error: Error) => void,
  ): Reservation {
    const ownerQueued = this.queuedByOwner.get(entry.ownerId) ?? 0;
    if (entry.queuedBytes + bytes > MAX_QUEUED_BYTES_PER_SOCKET) {
      this.metrics?.count("socket.sendFailures", 1, entry.ownerId);
      throw new AllowlistError(
        `socket send queue exceeds ${MAX_QUEUED_BYTES_PER_SOCKET} bytes`,
      );
    }
    if (ownerQueued + bytes > MAX_QUEUED_BYTES_PER_OWNER) {
      this.metrics?.count("socket.sendFailures", 1, entry.ownerId);
      throw new AllowlistError(
        `owner send queue exceeds ${MAX_QUEUED_BYTES_PER_OWNER} bytes`,
      );
    }
    const reservation: Reservation = {
      bytes,
      resolve,
      reject,
      settled: false,
    };
    entry.reservations.add(reservation);
    entry.queuedBytes += bytes;
    this.queuedByOwner.set(entry.ownerId, ownerQueued + bytes);
    this.activeWrites += 1;
    const total = this.publishQueueGauges();
    this.metrics?.peakGauge?.("socket.peakActiveWrites", this.activeWrites);
    this.metrics?.peakGauge?.("socket.peakQueuedBytes", total);
    return reservation;
  }

  /** Give budget back exactly once, whether the write settled or the socket died. */
  private release(entry: OwnedSocket, reservation: Reservation): boolean {
    if (reservation.settled) return false;
    reservation.settled = true;
    entry.reservations.delete(reservation);
    entry.queuedBytes = Math.max(0, entry.queuedBytes - reservation.bytes);
    const remaining =
      (this.queuedByOwner.get(entry.ownerId) ?? 0) - reservation.bytes;
    if (remaining > 0) this.queuedByOwner.set(entry.ownerId, remaining);
    else this.queuedByOwner.delete(entry.ownerId);
    this.activeWrites = Math.max(0, this.activeWrites - 1);
    this.publishQueueGauges();
    return true;
  }

  private rejectReservation(
    entry: OwnedSocket,
    reservation: Reservation,
    error: Error,
  ): void {
    if (!this.release(entry, reservation)) return;
    this.metrics?.count("socket.sendFailures", 1, entry.ownerId);
    reservation.reject(error);
  }

  private publishQueueGauges(): number {
    let total = 0;
    for (const bytes of this.queuedByOwner.values()) total += bytes;
    this.metrics?.gauge?.("socket.activeWrites", this.activeWrites);
    this.metrics?.gauge?.("socket.queuedBytes", total);
    return total;
  }

  private require(socketId: number, ownerId?: number): OwnedSocket {
    const entry = this.sockets.get(socketId);
    if (!entry || entry.closed) {
      throw new ValidationError(`unknown socket ${socketId}`);
    }
    if (ownerId !== undefined && entry.ownerId !== ownerId) {
      throw new AllowlistError(`socket ${socketId} is not owned by caller`);
    }
    return entry;
  }

  private fail(entry: OwnedSocket, code: SocketFailureCode): void {
    this.emit(entry.ownerId, {
      type: "error",
      socketId: entry.id,
      code,
    });
    entry.socket.destroy();
    this.finish(entry, code === "timeout" ? "timeout" : "error");
  }

  private finish(entry: OwnedSocket, reason: SocketCloseReason): void {
    if (entry.closed) return;
    entry.closed = true;
    // A destroyed socket may never fire the write callbacks it still owes.
    // Reject every pending send while reclaiming its reservation; a callback
    // arriving afterwards sees `settled` and changes neither state nor metrics.
    for (const reservation of [...entry.reservations]) {
      this.rejectReservation(
        entry,
        reservation,
        new ValidationError("socket closed before queued send completed"),
      );
    }
    this.metrics?.count("socket.closed", 1, entry.ownerId);
    this.metrics?.observe(
      "socket.lifetime",
      (Date.now() - entry.openedAt) * 1_000,
      entry.ownerId,
    );
    this.sockets.delete(entry.id);
    const set = this.byOwner.get(entry.ownerId);
    set?.delete(entry.id);
    if (set && set.size === 0) this.byOwner.delete(entry.ownerId);
    this.emit(entry.ownerId, {
      type: "close",
      socketId: entry.id,
      reason,
    });
  }
}
