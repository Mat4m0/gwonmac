import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { TraderPricePoint } from "../../../../src/shared/trade-chat";
import PriceHistoryChart from "./PriceHistoryChart.vue";

const DAY = 24 * 60 * 60 * 1_000;
const TO = 1_787_600_000_000;
const POINTS: readonly TraderPricePoint[] = Object.freeze(Array.from(
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
    const state = wrapper.vm as unknown as {
      visibleRange: Readonly<{ from: number; to: number }>;
    };
    const fullDuration = state.visibleRange.to - state.visibleRange.from;

    await chart.trigger("wheel", {
      clientX: 400,
      clientY: 170,
      deltaY: -100,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });

    const wheelDuration = state.visibleRange.to - state.visibleRange.from;
    expect(wheelDuration / fullDuration).toBeCloseTo(Math.exp(-0.08), 5);

    await wrapper.get('button[aria-label="Zoom in"]').trigger("click");
    const buttonDuration = state.visibleRange.to - state.visibleRange.from;
    expect(buttonDuration / wheelDuration).toBeCloseTo(0.82, 5);
    wrapper.unmount();
  });
});
