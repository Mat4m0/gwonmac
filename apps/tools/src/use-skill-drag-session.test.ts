import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillId } from "./model";
import { useSkillDragSession, type SkillDragSession } from "./use-skill-drag-session";

function pointer(
  element: HTMLElement,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    pointerId: 7,
    pointerType: "mouse",
    button: 0,
    clientX: 10,
    clientY: 10,
    currentTarget: element,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as PointerEvent;
}

function harness() {
  let session!: SkillDragSession;
  const place = vi.fn();
  const reorder = vi.fn();
  const wrapper = mount(defineComponent({
    setup() {
      session = useSkillDragSession({
        name: () => "Test skill",
        previewPlacement: (skill, target) => ({
          skill,
          target,
          outcome: "place",
          affectedSlots: [],
          label: `Place in ${target + 1}`,
        }),
        place,
        reorder,
        clearFeedback: vi.fn(),
      });
      return () => h("button");
    },
  }));
  const element = wrapper.element as HTMLElement;
  const setPointerCapture = vi.fn<(pointerId: number) => void>();
  const hasPointerCapture = vi.fn<(pointerId: number) => boolean>(() => true);
  const releasePointerCapture = vi.fn<(pointerId: number) => void>();
  element.setPointerCapture = setPointerCapture;
  element.hasPointerCapture = hasPointerCapture;
  element.releasePointerCapture = releasePointerCapture;
  return {
    wrapper,
    session,
    element,
    place,
    reorder,
    setPointerCapture,
    releasePointerCapture,
  };
}

function targetSlot(slot: number): HTMLElement {
  const bar = document.createElement("div");
  bar.dataset.skillBar = "";
  const target = document.createElement("button");
  target.dataset.skillSlot = String(slot);
  bar.append(target);
  document.body.append(bar);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
  return bar;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("useSkillDragSession", () => {
  it("uses one mouse session for catalogue placement and bar reordering", () => {
    const { wrapper, session, element, place, reorder } = harness();
    const bar = targetSlot(4);

    session.begin(pointer(element), { mode: "catalogue", skill: 12 as SkillId });
    session.move(pointer(element, { clientX: 13, clientY: 13 }));
    expect(session.dragging.value).toBe(false);
    session.move(pointer(element, { clientX: 30, clientY: 30 }));
    expect(session.preview.value?.label).toBe("Place in 5");
    session.finish(pointer(element, { clientX: 30, clientY: 30 }), true);
    expect(place).toHaveBeenCalledWith(12, 4);

    session.begin(pointer(element), { mode: "reorder", skill: 12 as SkillId, from: 1 });
    session.move(pointer(element, { clientX: 30, clientY: 30 }));
    expect(session.preview.value?.outcome).toBe("move");
    session.finish(pointer(element, { clientX: 30, clientY: 30 }), true);
    expect(reorder).toHaveBeenCalledWith(1, 4);
    bar.remove();
    wrapper.unmount();
  });

  it("allows touch scrolling before the delay and starts a later deliberate drag", () => {
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const { wrapper, session, element, place } = harness();
    targetSlot(2);
    const earlyMove = pointer(element, {
      pointerType: "touch",
      clientX: 30,
      clientY: 30,
    });

    session.begin(pointer(element, { pointerType: "touch" }), {
      mode: "catalogue",
      skill: 12 as SkillId,
    });
    elapsed = 80;
    session.move(earlyMove);
    expect(session.dragging.value).toBe(false);
    expect(earlyMove.preventDefault).not.toHaveBeenCalled();
    elapsed = 140;
    session.move(pointer(element, { pointerType: "touch", clientX: 31, clientY: 31 }));
    expect(session.dragging.value).toBe(true);
    session.finish(pointer(element, { pointerType: "touch" }), true);
    expect(place).toHaveBeenCalledWith(12, 2);
    wrapper.unmount();
  });

  it("cancels cleanly and releases capture on unmount", () => {
    const first = harness();
    targetSlot(0);
    first.session.begin(pointer(first.element), { mode: "reorder", skill: 12 as SkillId, from: 2 });
    first.session.move(pointer(first.element, { clientX: 30, clientY: 30 }));
    expect(first.session.cancel()).toBe(true);
    expect(first.reorder).not.toHaveBeenCalled();
    expect(first.releasePointerCapture).toHaveBeenCalledWith(7);
    first.wrapper.unmount();

    const second = harness();
    second.session.begin(pointer(second.element), { mode: "catalogue", skill: 12 as SkillId });
    second.wrapper.unmount();
    expect(second.releasePointerCapture).toHaveBeenCalledWith(7);
  });
});
