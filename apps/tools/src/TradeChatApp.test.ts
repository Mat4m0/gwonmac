import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import TradeChatApp from "./TradeChatApp.vue";
import { createDemoTradeHost, type TradeHost } from "./trade-host";
import type {
  TradeEvent,
  TradeMessage,
  TradeSavedState,
} from "../../../src/shared/trade-chat";

async function ledger(host: TradeHost = createDemoTradeHost()) {
  const wrapper = mount(TradeChatApp, {
    attachTo: document.body,
    props: {
      host,
      mode: "standalone",
      visible: true,
      active: true,
    },
  });
  await flushPromises();
  return wrapper;
}

describe("TradeChatApp", () => {
  it("opens trader prices and returns without losing the listing state", async () => {
    const wrapper = await ledger();
    await wrapper.get("input[type=search]").setValue("arms");
    await wrapper.get(".trade-search").trigger("submit");
    await flushPromises();
    const selected = wrapper.get(".trade-row[data-selected]").attributes("data-selected");

    await wrapper.get(".trader-prices-trigger").trigger("click");
    await flushPromises();

    expect(wrapper.get(".trader-prices").isVisible()).toBe(true);
    expect(wrapper.get(".trader-category-tabs").text()).toContain("Runes");
    expect(wrapper.get(".trader-catalogue").text()).toContain("Glob of Ectoplasm");
    expect(wrapper.get(".trader-price-detail").text()).toContain("20k");
    expect(wrapper.findAll(".price-series").length).toBe(2);

    await wrapper.get(".trader-back").trigger("click");
    await nextTick();
    expect(wrapper.get(".trade-ledger").isVisible()).toBe(true);
    expect(wrapper.get(".trade-search input[type=search]").element).toHaveProperty("value", "arms");
    expect(wrapper.get(".trade-row[data-selected]").attributes("data-selected")).toBe(selected);
    wrapper.unmount();
  });

  it("searches trader items across categories and exposes rune professions", async () => {
    const wrapper = await ledger();
    await wrapper.get(".trader-prices-trigger").trigger("click");
    await flushPromises();
    await wrapper.get(".trader-item-search input").setValue("vigor");
    expect(wrapper.get(".trader-catalogue").text()).toContain("Rune of Superior Vigor");
    await wrapper.get(".trader-category-tabs [role=tab]:nth-child(3)").trigger("click");
    expect(wrapper.findAll(".trader-professions button")).toHaveLength(11);
    wrapper.unmount();
  });

  it("debounces rapid trader navigation to the final history request", async () => {
    let calls = 0;
    const demo = createDemoTradeHost();
    const host: TradeHost = Object.freeze({
      ...demo,
      async getTraderPriceHistory(request) {
        calls += 1;
        return demo.getTraderPriceHistory(request);
      },
    });
    const wrapper = await ledger(host);
    await wrapper.get(".trader-prices-trigger").trigger("click");
    await flushPromises();
    expect(calls).toBe(1);

    vi.useFakeTimers();
    const rows = wrapper.findAll(".trader-item-row");
    await rows[1]!.trigger("click");
    await rows[2]!.trigger("click");
    await rows[1]!.trigger("click");
    await vi.advanceTimersByTimeAsync(149);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(calls).toBe(2);
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("explains a history rate limit and retries without an empty chart state", async () => {
    let calls = 0;
    const demo = createDemoTradeHost();
    const host: TradeHost = Object.freeze({
      ...demo,
      async getTraderPriceHistory(request) {
        calls += 1;
        if (calls === 1) return { status: "error", problem: "rate-limited" };
        return demo.getTraderPriceHistory(request);
      },
    });
    const wrapper = await ledger(host);
    await wrapper.get(".trader-prices-trigger").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Kamadan is receiving too many requests");
    expect(wrapper.text()).not.toContain("No price history");
    await wrapper.get(".trader-history-error button").trigger("click");
    await flushPromises();
    expect(wrapper.find(".trader-history-error").exists()).toBe(false);
    expect(wrapper.findAll(".price-series")).toHaveLength(2);
    wrapper.unmount();
  });

  it("switches isolated sources and applies intent filters", async () => {
    const wrapper = await ledger();
    expect(wrapper.text()).toContain("Tyria Cartographer");
    await wrapper.get(".source-segment button:last-child").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Vanguard Althea");
    expect(wrapper.text()).not.toContain("Tyria Cartographer");

    await wrapper.get(".intent-segment button:nth-child(2)").trigger("click");
    expect(wrapper.findAll(".trade-row").map((row) => row.text())).toEqual([
      expect.stringContaining("Northlands Scout"),
      expect.stringContaining("Ascalon Merchant"),
    ]);
    wrapper.unmount();
  });

  it("submits search and returns to the live feed", async () => {
    const wrapper = await ledger();
    await wrapper.get("input[type=search]").setValue("Polar Bear");
    await wrapper.get(".trade-search").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Quiet Ember");
    expect(wrapper.text()).not.toContain("Silver Wayfarer");
    await wrapper.get("input[type=search]").setValue("");
    expect(wrapper.text()).toContain("Silver Wayfarer");
    expect(wrapper.text()).toContain("Latest messages");
    wrapper.unmount();
  });

  it("shows every matching listing instead of grouping by player", async () => {
    const wrapper = await ledger();
    await wrapper.get("input[type=search]").setValue("Tyria Cartographer");
    await wrapper.get(".trade-search").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Tyria Cartographer");
    expect(wrapper.text()).not.toContain("Silver Wayfarer");
    expect(wrapper.findAll(".trade-row")).toHaveLength(2);
    expect(wrapper.findAll(".trade-row")[0]!.text()).toContain("WTS arms 29e each");
    expect(wrapper.findAll(".trade-row")[1]!.text()).toContain("Earlier trade listing");
    expect(wrapper.get(".trade-summary").text()).toContain("2 offers");
    wrapper.unmount();
  });

  it("opens exact player listings and returns to the preserved ledger", async () => {
    const wrapper = await ledger();
    const list = wrapper.get(".trade-list");
    Object.defineProperty(list.element, "scrollTop", {
      configurable: true,
      writable: true,
      value: 64,
    });
    const originalSelection = wrapper.findAll(".trade-row")[0]!.attributes("data-selected");

    await wrapper.findAll(".character-cell")[0]!.trigger("click");
    await flushPromises();

    expect(wrapper.get(".player-summary").text()).toContain("Tyria Cartographer");
    expect(wrapper.findAll(".trade-row")).toHaveLength(2);
    expect(wrapper.findAll(".trade-row").every(
      (row) => row.text().includes("Tyria Cartographer"),
    )).toBe(true);

    await wrapper.get(".player-summary .ui-link").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".trade-row")).toHaveLength(7);
    expect(wrapper.findAll(".trade-row")[0]!.attributes("data-selected")).toBe(originalSelection);
    expect((wrapper.get(".trade-list").element as HTMLElement).scrollTop).toBe(64);
    wrapper.unmount();
  });

  it("uses the active window ownership for the slash search shortcut", async () => {
    const wrapper = await ledger();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    expect(document.activeElement).toBe(wrapper.get("input[type=search]").element);
    await wrapper.setProps({ active: false });
    (document.activeElement as HTMLElement).blur();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    expect(document.activeElement).not.toBe(wrapper.get("input[type=search]").element);
    wrapper.unmount();
  });

  it("reveals 25 more rows near the bottom and silently merges new messages at the top", async () => {
    const messages = Array.from({ length: 60 }, (_, index): TradeMessage => ({
      source: "kamadan",
      timestamp: Date.now() - index * 1_000,
      sender: `Trader ${index + 1}`,
      message: index % 2 ? "WTB testing materials" : "WTS testing materials",
    }));
    const events: { publish: ((event: TradeEvent) => void) | null } = { publish: null };
    const host: TradeHost = {
      ...createDemoTradeHost(),
      async subscribe(source) {
        return { source, status: "live", messages };
      },
      async unsubscribe() {},
      async search(request) {
        return {
          ...request,
          messages,
        };
      },
      async retry() {},
      onEvent(callback) {
        events.publish = callback;
        return () => { events.publish = null; };
      },
      async copy() {},
      async openSource() {},
      async getSaved() { return { offers: [], players: [] }; },
      async setSaved(value) { return value; },
    };
    const wrapper = mount(TradeChatApp, {
      attachTo: document.body,
      props: { host, mode: "standalone", visible: true, active: true },
    });
    await flushPromises();
    expect(wrapper.findAll(".trade-row")).toHaveLength(25);

    const list = wrapper.get(".trade-list");
    Object.defineProperties(list.element, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, writable: true, value: 720 },
    });
    await list.trigger("scroll");
    expect(wrapper.findAll(".trade-row")).toHaveLength(50);

    const arrivalBase = Date.now() + 1_000;
    for (let index = 0; index < 150; index += 1) {
      events.publish?.({
        type: "message",
        source: "kamadan",
        message: {
          source: "kamadan",
          timestamp: arrivalBase + index,
          sender: `Newest Trader ${index}`,
          message: "WTS a newly arrived offer",
        },
      });
    }
    await flushPromises();
    expect(wrapper.find(".pending-messages").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("new message");

    (list.element as HTMLElement).scrollTop = 0;
    await list.trigger("scroll");
    expect(wrapper.find(".pending-messages").exists()).toBe(false);
    expect(wrapper.get(".trade-row").text()).toContain("Newest Trader 149");
    expect(wrapper.get(".trade-summary").text()).toContain("100 offers");
    wrapper.unmount();
  });

  it("saves offers and players, highlights them, and exposes both drawer lists", async () => {
    const wrapper = await ledger();
    await wrapper.get(".inspector-actions button:first-child").trigger("click");
    await flushPromises();
    expect(wrapper.get(".trade-row").attributes("data-saved-offer")).toBe("");

    await wrapper.get(".inspector-actions button:nth-child(2)").trigger("click");
    await flushPromises();
    expect(wrapper.get(".trade-row").attributes("data-saved-player")).toBe("");

    await wrapper.get(".saved-trigger").trigger("click");
    expect(wrapper.get(".trade-saved-drawer").text()).toContain("Tyria Cartographer");
    await wrapper.get(".saved-tabs button:last-child").trigger("click");
    expect(wrapper.get(".trade-saved-drawer").text()).toContain("2 current offers");
    wrapper.unmount();
  });

  it("restores confirmed saved state when persistence fails", async () => {
    const demo = createDemoTradeHost();
    const host: TradeHost = {
      ...demo,
      async setSaved() { throw new Error("disk unavailable"); },
    };
    const wrapper = mount(TradeChatApp, {
      attachTo: document.body,
      props: { host, mode: "standalone", visible: true, active: true },
    });
    await flushPromises();

    await wrapper.get(".row-quick-action").trigger("click");
    await flushPromises();

    expect(wrapper.get(".trade-notice").text()).toBe("Saved items could not be updated. Try again.");
    expect(wrapper.get(".trade-row").attributes("data-saved-offer")).toBeUndefined();
    wrapper.unmount();
  });

  it("serializes rapid saved actions without losing either change", async () => {
    const demo = createDemoTradeHost();
    const writes: Array<{
      value: TradeSavedState;
      resolve: (value: TradeSavedState) => void;
    }> = [];
    const setSaved = vi.fn((value: TradeSavedState) => new Promise<TradeSavedState>((resolve) => {
      writes.push({ value, resolve });
    }));
    const wrapper = mount(TradeChatApp, {
      attachTo: document.body,
      props: {
        host: { ...demo, setSaved },
        mode: "standalone",
        visible: true,
        active: true,
      },
    });
    await flushPromises();

    await wrapper.get(".inspector-actions button:first-child").trigger("click");
    await wrapper.get(".inspector-actions button:nth-child(2)").trigger("click");
    await flushPromises();
    expect(setSaved).toHaveBeenCalledTimes(1);
    writes[0]!.resolve(writes[0]!.value);
    await flushPromises();
    expect(setSaved).toHaveBeenCalledTimes(2);
    expect(writes[1]!.value.offers).toHaveLength(1);
    expect(writes[1]!.value.players).toHaveLength(1);
    writes[1]!.resolve(writes[1]!.value);
    await flushPromises();
    expect(wrapper.get(".trade-row").attributes("data-saved-offer")).toBe("");
    expect(wrapper.get(".trade-row").attributes("data-saved-player")).toBe("");
    wrapper.unmount();
  });

  it("keeps the inspector aligned with the active intent filter", async () => {
    const wrapper = await ledger();
    expect(wrapper.get(".trade-inspector").text()).toContain("WTS arms");
    await wrapper.get(".intent-segment button:last-child").trigger("click");
    await flushPromises();
    expect(wrapper.get(".trade-inspector").text()).toContain("WTB cupcakes");
    expect(wrapper.get(".trade-inspector").text()).not.toContain("WTS arms");
    wrapper.unmount();
  });

  it("keeps a saved offer selected while switching its source", async () => {
    const demo = createDemoTradeHost();
    const savedOffer = {
      source: "pre-searing" as const,
      timestamp: 99,
      sender: "Archived Trader",
      message: "WTS an archived Charr kit",
      savedAt: Date.now(),
    };
    const wrapper = mount(TradeChatApp, {
      attachTo: document.body,
      props: {
        host: {
          ...demo,
          async getSaved() { return { offers: [savedOffer], players: [] }; },
        },
        mode: "standalone",
        visible: true,
        active: true,
      },
    });
    await flushPromises();
    await wrapper.get(".saved-trigger").trigger("click");
    await wrapper.get(".saved-card-main").trigger("click");
    await flushPromises();
    expect(wrapper.get(".ui-panel-title").text()).toBe("Pre-Searing Trade");
    expect(wrapper.get(".trade-inspector").text()).toContain("archived Charr kit");
    wrapper.unmount();
  });
});
