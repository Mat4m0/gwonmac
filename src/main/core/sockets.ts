// Main-process TCP ownership: public unicast only, ports 6112/80/443.
import net from "node:net";
import type { SocketEvent } from "../../shared/contracts.js";
import { AllowlistError, ValidationError } from "../../shared/errors.js";
import {
  assertPublicDestination,
  parseDestination as parseAllowedDestination,
} from "./allowlists.js";

export const CONNECT_TIMEOUT_MS = 10_000;
export const MAX_SOCKETS_PER_OWNER = 64;
export const MAX_QUEUED_BYTES = 4 * 1024 * 1024;

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

interface OwnedSocket {
  id: number;
  ownerId: number;
  socket: net.Socket;
  queuedBytes: number;
  opened: boolean;
  closed: boolean;
  destination: string;
  bytesSent: number;
  bytesReceived: number;
  openedAt: number;
}

export type SocketEventSink = (ownerId: number, event: SocketEvent) => void;
export interface SocketMetrics {
  count(name: string, delta?: number): void;
  observe(name: string, durationUs: number): void;
  gauge?(name: string, value: number): void;
  peakGauge?(name: string, value: number): void;
}

export class SocketManager {
  private readonly sockets = new Map<number, OwnedSocket>();
  private readonly byOwner = new Map<number, Set<number>>();
  private nextId = 1;
  private activeWrites = 0;
  private queuedBytes = 0;
  private readonly emit: SocketEventSink;
  private readonly metrics: SocketMetrics | null;

  constructor(emit: SocketEventSink, metrics: SocketMetrics | null = null) {
    this.emit = emit;
    this.metrics = metrics;
  }

  async connect(ownerId: number, destination: string): Promise<number> {
    const parsed = parseDestination(destination);
    const owned = this.byOwner.get(ownerId);
    if (owned && owned.size >= MAX_SOCKETS_PER_OWNER) {
      throw new AllowlistError(`socket limit ${MAX_SOCKETS_PER_OWNER} reached`);
    }

    const id = this.nextId++;
    const socket = net.connect({
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
        this.fail(entry, "connect timeout");
      }
    }, CONNECT_TIMEOUT_MS);

    socket.once("connect", () => {
      clearTimeout(timer);
      if (entry.closed) return;
      entry.opened = true;
      this.metrics?.count("socket.opened");
      this.metrics?.observe("socket.connect", (Date.now() - entry.openedAt) * 1_000);
      this.emit(ownerId, { type: "open", socketId: id });
    });

    socket.on("data", (buf) => {
      if (entry.closed) return;
      entry.bytesReceived += buf.byteLength;
      this.metrics?.count("socket.bytesReceived", buf.byteLength);
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
        message: err.message,
      });
      this.finish(entry, err.message);
    });

    socket.on("close", () => {
      clearTimeout(timer);
      this.finish(entry, "closed");
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
    if (entry.queuedBytes + data.byteLength > MAX_QUEUED_BYTES) {
      this.metrics?.count("socket.sendFailures");
      throw new AllowlistError(`socket send queue exceeds ${MAX_QUEUED_BYTES} bytes`);
    }
    const started = process.hrtime.bigint();
    this.metrics?.count("socket.sendCalls");
    this.metrics?.count("socket.sendPayloadBytes", data.byteLength);
    entry.queuedBytes += data.byteLength;
    this.activeWrites += 1;
    this.queuedBytes += data.byteLength;
    this.metrics?.gauge?.("socket.activeWrites", this.activeWrites);
    this.metrics?.gauge?.("socket.queuedBytes", this.queuedBytes);
    this.metrics?.peakGauge?.("socket.peakActiveWrites", this.activeWrites);
    this.metrics?.peakGauge?.("socket.peakQueuedBytes", this.queuedBytes);
    await new Promise<void>((resolve, reject) => {
      entry.socket.write(Buffer.from(data), (err) => {
        entry.queuedBytes = Math.max(0, entry.queuedBytes - data.byteLength);
        this.activeWrites = Math.max(0, this.activeWrites - 1);
        this.queuedBytes = Math.max(0, this.queuedBytes - data.byteLength);
        this.metrics?.gauge?.("socket.activeWrites", this.activeWrites);
        this.metrics?.gauge?.("socket.queuedBytes", this.queuedBytes);
        this.metrics?.observe(
          "socket.writeCallback",
          Number((process.hrtime.bigint() - started) / 1_000n),
        );
        if (err) {
          this.metrics?.count("socket.sendFailures");
          reject(err);
        } else {
          entry.bytesSent += data.byteLength;
          this.metrics?.count("socket.bytesSent", data.byteLength);
          resolve();
        }
      });
    });
  }

  async close(socketId: number, ownerId?: number): Promise<void> {
    const entry = this.require(socketId, ownerId);
    if (entry.closed) return;
    entry.socket.destroy();
    this.finish(entry, "closed by peer");
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
      this.finish(entry, "owner closed");
    }
  }

  size(ownerId?: number): number {
    if (ownerId === undefined) return this.sockets.size;
    return this.byOwner.get(ownerId)?.size ?? 0;
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

  private fail(entry: OwnedSocket, reason: string): void {
    this.emit(entry.ownerId, {
      type: "error",
      socketId: entry.id,
      message: reason,
    });
    entry.socket.destroy();
    this.finish(entry, reason);
  }

  private finish(entry: OwnedSocket, reason: string): void {
    if (entry.closed) return;
    entry.closed = true;
    this.metrics?.count("socket.closed");
    this.metrics?.observe("socket.lifetime", (Date.now() - entry.openedAt) * 1_000);
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
