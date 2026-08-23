import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
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
