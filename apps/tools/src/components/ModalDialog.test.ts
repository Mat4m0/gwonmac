import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ModalDialog from "./ModalDialog.vue";

afterEach(() => document.body.replaceChildren());

describe("ModalDialog", () => {
  it("uses one labelled modal, focuses its requested control, and closes on Escape", async () => {
    const invoker = document.createElement("button");
    invoker.textContent = "Open";
    document.body.append(invoker);
    invoker.focus();

    const wrapper = mount(ModalDialog, {
      attachTo: document.body,
      props: {
        open: false,
        labelledby: "dialog-title",
        describedby: "dialog-description",
        initialFocus: "#dialog-field",
      },
      slots: {
        default: `
          <h2 id="dialog-title">Import team</h2>
          <p id="dialog-description">Paste a team code.</p>
          <input id="dialog-field">
          <button>Import</button>
        `,
      },
    });

    await wrapper.setProps({ open: true });
    await flushPromises();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-labelledby")).toBe("dialog-title");
    expect(document.activeElement?.id).toBe("dialog-field");

    dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });
});
