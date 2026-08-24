import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { TraderQuote } from "../../../../src/shared/trade-chat";
import PriceHistoryChart from "./PriceHistoryChart.vue";

const DAY = 24 * 60 * 60 * 1_000;
const TO = 1_787_600_000_000;
const POINTS: readonly TraderQuote[] = Object.freeze(Array.from(
  { length: 31 },
  (_, day) => Object.freeze({
    modelId: "0b039e",
    timestamp: TO - (30 - day) * DAY,
    price: 100 + day,
    side: day % 2 === 0 ? "buy" as const : "sell" as const,
  }),
));

describe("PriceHistoryChart", () => {
  it("uses smaller wheel zoom steps than the zoom buttons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TO);
    const wrapper = mount(PriceHistoryChart, {
      props: { points: POINTS, loading: false, itemName: "Bolt of Linen" },
    });
    const chart = wrapper.get(".price-chart-plot");
    chart.element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 800,
      height: 340,
      top: 0,
      right: 800,
      bottom: 340,
      left: 0,
      toJSON: () => ({}),
    });
    expect(renderedBuyPoints(wrapper)).toBe(16);

    await chart.trigger("wheel", {
      clientX: 400,
      clientY: 170,
      deltaY: -100,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });

    expect(renderedBuyPoints(wrapper)).toBe(14);

    await wrapper.get('button[aria-label="Zoom in"]').trigger("click");
    expect(renderedBuyPoints(wrapper)).toBe(12);
    wrapper.unmount();
    vi.useRealTimers();
  });
});

function renderedBuyPoints(wrapper: ReturnType<typeof mount>): number {
  const path = wrapper.get(".price-series-buy").attributes("d") ?? "";
  return path.match(/[ML]/gu)?.length ?? 0;
}
