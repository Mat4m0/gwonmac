import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TravelDestinationPicker from "./TravelDestinationPicker.vue";

describe("TravelDestinationPicker", () => {
  it("searches the catalogue without rendering a 199-item native select", async () => {
    const wrapper = mount(TravelDestinationPicker, {
      props: { modelValue: null, label: "Destination for new search phrase" },
    });
    const details = wrapper.get("details");
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger("toggle");
    await wrapper.get('[role="combobox"]').setValue("ruins morah");

    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.findAll('[role="option"]').length).toBeGreaterThan(0);
    expect(wrapper.findAll('[role="option"]').length).toBeLessThanOrEqual(8);
    await wrapper.get('[data-map-id="480"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([[480]]);
    expect((details.element as HTMLDetailsElement).open).toBe(false);
    wrapper.unmount();
  });

  it("resets keyboard selection when a query narrows its result set", async () => {
    const wrapper = mount(TravelDestinationPicker, {
      props: { modelValue: null, label: "Destination for new search phrase" },
    });
    const details = wrapper.get("details");
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger("toggle");
    const search = wrapper.get('[role="combobox"]');
    await search.setValue("a");
    await search.trigger("keydown", { key: "ArrowDown" });
    await search.trigger("keydown", { key: "ArrowDown" });

    await search.setValue("ruins morah");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    expect(wrapper.get('[role="option"]').attributes("aria-selected")).toBe("true");
    expect(search.attributes("aria-activedescendant")).toContain("-480");

    await search.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([[480]]);
    wrapper.unmount();
  });
});
