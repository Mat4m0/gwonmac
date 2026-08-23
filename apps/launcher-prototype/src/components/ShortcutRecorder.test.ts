import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import ShortcutRecorder from "./ShortcutRecorder.vue";

enableAutoUnmount(afterEach);

const mountRecorder = (initial = "⌃⇧T", unavailableShortcuts: string[] = []) => {
  const shortcut = ref(initial);
  const wrapper = mount(ShortcutRecorder, {
    props: {
      label: "Quick Travel",
      modelValue: shortcut.value,
      unavailableShortcuts,
      "onUpdate:modelValue": (value: string) => {
        shortcut.value = value;
      },
    },
  });
  return { shortcut, wrapper };
};

describe("ShortcutRecorder", () => {
  it("records a valid shortcut", async () => {
    const { shortcut, wrapper } = mountRecorder();
    await wrapper.get(".shortcut-record-button").trigger("click");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyG", key: "G", ctrlKey: true, shiftKey: true }),
    );
    await nextTick();

    expect(shortcut.value).toBe("⌃⇧G");
    expect(wrapper.text()).toContain("⌃⇧G saved.");
  });

  it("keeps recording after a reserved shortcut", async () => {
    const { shortcut, wrapper } = mountRecorder();
    await wrapper.get(".shortcut-record-button").trigger("click");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyC", key: "c", metaKey: true }),
    );
    await nextTick();

    expect(shortcut.value).toBe("⌃⇧T");
    expect(wrapper.text()).toContain("reserved for Copy");
    expect(wrapper.get(".shortcut-record-button").attributes("aria-invalid")).toBe("true");
  });

  it("rejects a shortcut used by another Tool", async () => {
    const { shortcut, wrapper } = mountRecorder("⌃⇧T", ["⌃⇧G"]);
    await wrapper.get(".shortcut-record-button").trigger("click");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyG", key: "G", ctrlKey: true, shiftKey: true }),
    );
    await nextTick();

    expect(shortcut.value).toBe("⌃⇧T");
    expect(wrapper.text()).toContain("already used by another Tool");
  });

  it("cancels recording with Escape", async () => {
    const { wrapper } = mountRecorder();
    await wrapper.get(".shortcut-record-button").trigger("click");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));
    await nextTick();

    expect(wrapper.get(".shortcut-record-button").text()).toBe("Change");
    expect(wrapper.find(".shortcut-message").text()).toBe("");
  });

  it("keeps only one recorder active", async () => {
    const first = mountRecorder("⌃⇧T").wrapper;
    const second = mountRecorder("⌃⇧C").wrapper;

    await first.get(".shortcut-record-button").trigger("click");
    await second.get(".shortcut-record-button").trigger("click");

    expect(first.get(".shortcut-record-button").text()).toBe("Change");
    expect(second.get(".shortcut-record-button").text()).toBe("Cancel");
  });

  it("clears an existing shortcut", async () => {
    const { shortcut, wrapper } = mountRecorder();
    await wrapper.get(".shortcut-clear-button").trigger("click");

    expect(shortcut.value).toBe("");
  });
});
