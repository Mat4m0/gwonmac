import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TradeChatApp from "./TradeChatApp.vue";
import { createDemoTradeHost, type TradeHost } from "./trade-host";
import type { TradeEvent, TradeMessage } from "../../../src/shared/trade-chat";

async function ledger() {
  const wrapper = mount(TradeChatApp, {
    attachTo: document.body,
    props: {
      host: createDemoTradeHost(),
      mode: "standalone",
      visible: true,
      active: true,
    },
  });
  await flushPromises();
  return wrapper;
}

describe("TradeChatApp", () => {
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
    await wrapper.get(".trade-search button:last-child").trigger("click");
    expect(wrapper.text()).toContain("Silver Wayfarer");
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
      async subscribe(source) {
        return { source, status: "live", messages };
      },
      async unsubscribe() {},
      async search(request) { return { ...request, messages }; },
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

    events.publish?.({
      type: "message",
      source: "kamadan",
      message: {
        source: "kamadan",
        timestamp: Date.now() + 1_000,
        sender: "Newest Trader",
        message: "WTS a newly arrived offer",
      },
    });
    await flushPromises();
    expect(wrapper.find(".pending-messages").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("new message");

    (list.element as HTMLElement).scrollTop = 0;
    await list.trigger("scroll");
    expect(wrapper.find(".pending-messages").exists()).toBe(false);
    expect(wrapper.get(".trade-row").text()).toContain("Newest Trader");
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
    expect(wrapper.get(".trade-saved-drawer").text()).toContain("1 current offer");
    wrapper.unmount();
  });

  it("explains when a restart is required for the saved-items bridge", async () => {
    const demo = createDemoTradeHost();
    const host: TradeHost = {
      ...demo,
      async setSaved() { throw new Error("trade_saved_restart_required"); },
    };
    const wrapper = mount(TradeChatApp, {
      attachTo: document.body,
      props: { host, mode: "standalone", visible: true, active: true },
    });
    await flushPromises();

    await wrapper.get(".row-quick-action").trigger("click");
    await flushPromises();

    expect(wrapper.get(".trade-notice").text()).toBe("Restart GWonMac once to enable Saved items.");
    expect(wrapper.get(".trade-row").attributes("data-saved-offer")).toBeUndefined();
    wrapper.unmount();
  });
});
