import { isProxy, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { GwNativeApi } from "../../../src/shared/contracts";
import type { TradeSavedState } from "../../../src/shared/trade-chat";
import { createNativeTradeHost } from "./trade-host";

describe("native trade host", () => {
  it("normalizes reactive saved state before crossing IPC", async () => {
    const setSaved = vi.fn(async (value: TradeSavedState) => value);
    const trade: GwNativeApi["trade"] = {
      async subscribe(source) { return { source, status: "live", messages: [] }; },
      async unsubscribe() {},
      async search(request) { return { ...request, matches: [] }; },
      async retry() {},
      onEvent() { return () => undefined; },
      async getSaved() { return { offers: [], players: [] }; },
      setSaved,
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
