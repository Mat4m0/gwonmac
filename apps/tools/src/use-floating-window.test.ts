/** Lifecycle regression coverage for persistent embedded Tools geometry. */
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFloatingWindow } from "./use-floating-window";

const storageKey = "test.floating-window-placement";

function mountWindow() {
  return mount(defineComponent({
    setup() {
      const floating = useFloatingWindow({
        mode: "embedded",
        visible: ref(true),
        initialPosition: { left: 64, top: 54 },
        minWidth: 520,
        minHeight: 400,
        viewportMargin: 32,
        placementStorageKey: storageKey,
      });
      return () => h("section", {
        ref: floating.panel,
        style: floating.panelStyle.value,
      }, [
        h("header", { onPointerdown: floating.startDrag }),
        h("button", { ref: floating.resizeGrip }),
      ]);
    },
  }), { attachTo: document.body });
}

function giveWindowGeometry(element: HTMLElement) {
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    get: () => Number.parseFloat(element.style.width) || 800,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    get: () => Number.parseFloat(element.style.height) || 600,
  });
  element.getBoundingClientRect = () => ({
    x: Number.parseFloat(element.style.left),
    y: Number.parseFloat(element.style.top),
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
    right: Number.parseFloat(element.style.left) + element.offsetWidth,
    bottom: Number.parseFloat(element.style.top) + element.offsetHeight,
    width: element.offsetWidth,
    height: element.offsetHeight,
    toJSON: () => ({}),
  });
}

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("useFloatingWindow", () => {
  it("restores resized and moved geometry after the document unloads", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const wrapper = mountWindow();
    const panel = wrapper.get("section").element as HTMLElement;
    giveWindowGeometry(panel);

    await wrapper.get("button").trigger("keydown", { key: "ArrowLeft" });

    const header = wrapper.get("header").element as HTMLElement;
    Object.defineProperty(header, "setPointerCapture", { value: vi.fn() });
    header.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: 100,
      clientY: 70,
      pointerId: 1,
    }));
    header.dispatchEvent(new PointerEvent("pointermove", {
      clientX: 236,
      clientY: 140,
      pointerId: 1,
    }));
    header.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    wrapper.unmount();

    expect(localStorage.getItem(storageKey)).not.toBeNull();

    const restored = mountWindow();
    expect(restored.get("section").attributes("style")).toContain("left: 200px");
    expect(restored.get("section").attributes("style")).toContain("top: 124px");
    expect(restored.get("section").attributes("style")).toContain("width: 784px");
    expect(restored.get("section").attributes("style")).toContain("height: 600px");
    restored.unmount();
  });
});
