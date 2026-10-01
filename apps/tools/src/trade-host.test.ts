import { isProxy, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type { TradeSavedState } from "../../../src/shared/trade-chat";
import { createDemoTradeHost, createNativeTradeHost } from "./trade-host";

describe("native trade host", () => {
  it("normalizes reactive saved state before crossing IPC", async () => {
    const setSaved = vi.fn(async (value: TradeSavedState) => value);
    const trade: GwNativeApi["trade"] = {
      async subscribe(source) { return { source, status: "live", messages: [] }; },
      async unsubscribe() {},
      async search(request) { return { ...request, messages: [] }; },
      async retry() {},
      onEvent() { return () => undefined; },
      async getSaved() { return { offers: [], players: [] }; },
      setSaved,
      async getMarketRates() { return { fetchedAt: 1, quotes: [] }; },
      async getTraderQuotes() { return { updatedAt: 1, quotes: [] }; },
      async getTraderPriceHistory() { return { status: "ok" as const, points: [] }; },
    };
    const api = {
      trade,
      clipboard: { async writeText() {} },
      app: { async openExternal() {} },
    };
    const value = reactive<TradeSavedState>({
      offers: [{
        source: "kamadan",
        timestamp: 10,
        sender: "Test Trader",
        message: "WTS test item",
        savedAt: 20,
      }],
      players: [],
    });
    expect(isProxy(value)).toBe(true);

    await createNativeTradeHost(api).setSaved(value);

    const sent = setSaved.mock.calls[0]?.[0];
    expect(sent).toEqual(value);
    expect(isProxy(sent)).toBe(false);
    expect(isProxy(sent?.offers)).toBe(false);
    expect(isProxy(sent?.offers[0])).toBe(false);
  });
});

describe("demo trade host", () => {
  it("dates a live arrival now, like a real Kamadan message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    try {
      const host = createDemoTradeHost();
      const arrivals: number[] = [];
      host.onEvent((event) => { if (event.type === "message") arrivals.push(event.message.timestamp); });
      await host.subscribe("kamadan");
      vi.advanceTimersByTime(18_000);
      expect(arrivals).toEqual([Date.parse("2026-09-26T12:00:18Z")]);
    } finally { vi.useRealTimers(); }
  });
});
