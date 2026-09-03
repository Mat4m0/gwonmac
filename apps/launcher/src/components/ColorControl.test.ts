import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ColorControl from "./ColorControl.vue";

describe("color controls", () => {
  it("accepts the picker and normalizes typed hex with or without a hash", async () => {
    const wrapper = mount(ColorControl, { props: { label: "Veil color", value: "#112233" } });
    await wrapper.get('input[type="color"]').setValue("#abcdef");
    expect(wrapper.emitted("change")?.at(-1)).toEqual(["#abcdef"]);
    await wrapper.get('input[type="text"]').setValue("  AABBCC  ");
    expect(wrapper.emitted("change")?.at(-1)).toEqual(["#aabbcc"]);
    await wrapper.setProps({ value: "#445566" });
    expect(wrapper.get<HTMLInputElement>('input[type="text"]').element.value).toBe("#445566");
    expect(wrapper.get<HTMLInputElement>('input[type="color"]').element.value).toBe("#445566");
  });

  it("keeps incomplete hex local and explains invalid input without saving it", async () => {
    const wrapper = mount(ColorControl, { props: { label: "Grid color", value: "#112233" } });
    const hex = wrapper.get('input[type="text"]');
    await hex.setValue("#oops");
    expect(wrapper.emitted("change")).toBeUndefined();
    expect(hex.attributes("aria-invalid")).toBe("true");
    expect(wrapper.get('[role="alert"]').text()).toContain("six hex digits");
    await hex.trigger("keydown", { key: "Escape" });
    expect(wrapper.get<HTMLInputElement>('input[type="text"]').element.value).toBe("#112233");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
