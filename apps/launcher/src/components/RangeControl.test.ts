import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RangeControl from "./RangeControl.vue";

describe("numeric settings", () => {
  it("previews the slider value while dragging and saves on release", async () => {
    const wrapper = mount(RangeControl, { props: { label: "Grid opacity", value: 50, min: 0, max: 100, unit: "%" } });
    const slider = wrapper.get<HTMLInputElement>('input[type="range"]');
    slider.element.value = "75";
    await slider.trigger("input");
    expect(wrapper.get<HTMLInputElement>('input[type="number"]').element.value).toBe("75");
    expect(wrapper.emitted("change")).toBeUndefined();
    await slider.trigger("change");
    expect(wrapper.emitted("change")).toEqual([[75]]);
  });

  it("accepts zero widths and rejects empty, fractional and out-of-range values", async () => {
    const wrapper = mount(RangeControl, { props: { label: "Line width", value: 2, min: 0, max: 4, unit: "px" } });
    const number = wrapper.get('input[type="number"]');
    for (const value of ["", "1.5", "5", "-1"]) {
      await number.setValue(value);
      expect(wrapper.emitted("change")).toBeUndefined();
      expect(wrapper.get('[role="alert"]').text()).toContain("whole number from 0 to 4");
    }
    await number.setValue("0");
    expect(wrapper.emitted("change")).toEqual([[0]]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
