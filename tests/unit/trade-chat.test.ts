import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import WebSocket from "ws";
import { TradeChatService } from "../../src/main/core/trade-chat-service.js";
import { TradeSavedStore } from "../../src/main/core/trade-saved-store.js";
import {
  parseTradePayload,
  parseTradeSavedState,
  parseTradeSearchRequest,
} from "../../src/shared/trade-chat.js";

describe("trade chat contracts", () => {
  it("accepts numeric and numeric-string timestamps plus replacements", () => {
    assert.deepEqual(parseTradePayload("kamadan", {
      t: "1787500323057",
      s: "Vii Vua",
      m: "wts 105 consets - 1e each",
      r: "1787500281247",
      ignored: "upstream metadata",
    }), {
      kind: "message",
      message: {
        source: "kamadan",
        timestamp: 1787500323057,
        sender: "Vii Vua",
        message: "wts 105 consets - 1e each",
        replacementTimestamp: 1787500281247,
      },
    });
  });

  it("bounds, validates, deduplicates and orders search results", () => {
    const result = parseTradePayload("pre-searing", {
      query: "dye",
      num_results: 3,
      results: [
        { t: 2, s: "B", m: "WTB dye" },
        { t: 1, s: "A", m: "WTS dye" },
        { t: 2, s: "duplicate", m: "ignored" },
        { t: "bad", s: "invalid", m: "ignored" },
      ],
    });
    assert.equal(result?.kind, "search");
    if (result?.kind !== "search") return;
    assert.deepEqual(result.messages.map((message) => message.timestamp), [2, 1]);
    assert.ok(result.messages.every((message) => message.source === "pre-searing"));
  });

  it("rejects malformed payloads and invalid searches", () => {
    assert.equal(parseTradePayload("kamadan", { t: 1, s: "", m: "WTS" }), null);
    assert.equal(parseTradePayload("kamadan", { t: -1, s: "A", m: "WTS" }), null);
    assert.throws(() => parseTradeSearchRequest({ source: "both", query: "ecto" }));
    assert.throws(() => parseTradeSearchRequest({ source: "kamadan", query: " " }));
    assert.throws(() => parseTradeSearchRequest({
      source: "kamadan",
      query: "x".repeat(129),
    }));
  });

  it("validates bounded saved offers and players without accepting duplicates", () => {
    const saved = parseTradeSavedState({
      offers: [{
        source: "kamadan",
        timestamp: 10,
        sender: "Angel Trader",
        message: "WTS Glacial Blade",
        savedAt: 20,
      }],
      players: [{ sender: "Angel Trader", savedAt: 20 }],
    });
    assert.equal(saved.offers[0]?.message, "WTS Glacial Blade");
    assert.equal(saved.players[0]?.sender, "Angel Trader");
    assert.throws(() => parseTradeSavedState({
      offers: [],
      players: [
        { sender: "Angel Trader", savedAt: 20 },
        { sender: "angel trader", savedAt: 21 },
      ],
    }));
  });

  it("persists saved trade state in one private atomic document", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "gwonmac-trade-saved-"));
    try {
      const store = new TradeSavedStore(path.join(directory, "trade-saved.json"));
      assert.deepEqual(await store.get(), { offers: [], players: [] });
      const expected = {
        offers: [{
          source: "kamadan" as const,
          timestamp: 10,
          sender: "Angel Trader",
          message: "WTS Glacial Blade",
          savedAt: 20,
        }],
        players: [{ sender: "Angel Trader", savedAt: 20 }],
      };
      assert.deepEqual(await store.set(expected), expected);
      assert.deepEqual(await new TradeSavedStore(
        path.join(directory, "trade-saved.json"),
      ).get(), expected);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

class FakeTradeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  pings = 0;
  terminated = false;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  message(value: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }

  send(value: string, callback?: (error?: Error) => void): void {
    this.sent.push(value);
    callback?.();
  }

  ping(): void { this.pings += 1; }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  terminate(): void {
    this.terminated = true;
    this.close();
  }
}

describe("trade chat service", () => {
  it("shares one connection and coalesces semantic offer and player searches", async () => {
    const socket = new FakeTradeSocket();
    const service = serviceWith([socket]);
    service.subscribe(1, "kamadan", () => undefined);
    service.subscribe(2, "kamadan", () => undefined);
    socket.open();
    assert.equal(socket.sent.length, 1);

    const first = service.search(1, "kamadan", "dye");
    const second = service.search(2, "kamadan", "dye");
    assert.deepEqual(socket.sent.slice(1).map(queryFrom), ["dye", "user:dye"]);
    socket.message({
      query: "dye",
      results: [
        { t: 3, s: "Spam Trader", m: "WTS dye" },
        { t: 2, s: "Spam Trader", m: "WTS another dye" },
      ],
    });
    socket.message({
      query: "user:dye",
      results: [{ t: 1, s: "Dye Collector", m: "WTB ectos" }],
    });

    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.equal(a.matches.length, 2);
    assert.equal(a.matches[0]?.message.sender, "Spam Trader");
    assert.equal(a.matches[0]?.postCount, 2);
    service.dispose();
  });

  it("bounds live history, applies replacements, and stops after the last subscriber", () => {
    const socket = new FakeTradeSocket();
    const service = serviceWith([socket]);
    service.subscribe(1, "kamadan", () => undefined);
    service.subscribe(2, "kamadan", () => undefined);
    socket.open();
    for (let timestamp = 1; timestamp <= 110; timestamp += 1) {
      socket.message({ t: timestamp, s: `Trader ${timestamp}`, m: "WTS item" });
    }
    socket.message({ t: 111, s: "Replacement", m: "WTS replacement", r: 110 });
    const snapshot = service.subscribe(3, "kamadan", () => undefined);
    assert.equal(snapshot.messages.length, 100);
    assert.equal(snapshot.messages[0]?.timestamp, 111);
    assert.ok(!snapshot.messages.some((message) => message.timestamp === 110));
    service.unsubscribe(1);
    service.unsubscribe(2);
    assert.equal(socket.readyState, WebSocket.OPEN);
    service.unsubscribe(3);
    assert.equal(socket.readyState, WebSocket.CLOSED);
  });

  it("times out unanswered searches and reconnects while subscribed", async () => {
    const first = new FakeTradeSocket();
    const second = new FakeTradeSocket();
    const service = serviceWith([first, second], {
      searchTimeoutMs: 5,
      reconnectDelaysMs: [1],
    });
    service.subscribe(1, "kamadan", () => undefined);
    first.open();
    await assert.rejects(service.search(1, "kamadan", "ecto"), /trade search failed/);
    first.close();
    await delay(10);
    assert.equal(second.listenerCount("open"), 1);
    service.dispose();
  });
});

function serviceWith(
  sockets: FakeTradeSocket[],
  timing: { searchTimeoutMs?: number; reconnectDelaysMs?: readonly number[] } = {},
): TradeChatService {
  return new TradeChatService({
    createSocket: () => {
      const socket = sockets.shift();
      assert.ok(socket, "unexpected WebSocket connection");
      return socket as unknown as WebSocket;
    },
    random: () => 0.5,
    timing,
  });
}

function queryFrom(value: string): string {
  return (JSON.parse(value) as { query: string }).query;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
