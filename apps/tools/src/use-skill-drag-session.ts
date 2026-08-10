import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from "vue";
import type { SkillId } from "./model";
import type { SkillDropPreview } from "./skill-drop";

export type SkillDragSource =
  | Readonly<{ mode: "catalogue"; skill: SkillId }>
  | Readonly<{ mode: "reorder"; skill: SkillId; from: number }>;

type ActiveSkillDrag = {
  pointerId: number;
  pointerType: string;
  source: SkillDragSource;
  element: HTMLElement;
  startX: number;
  startY: number;
  startedAt: number;
  x: number;
  y: number;
  started: boolean;
  target: number | null;
};

export type SkillDragSession = Readonly<{
  active: Ref<ActiveSkillDrag | null>;
  preview: Ref<SkillDropPreview | null>;
  announcement: Ref<string>;
  suppressClick: Ref<boolean>;
  dragging: ComputedRef<boolean>;
  begin: (event: PointerEvent, source: SkillDragSource) => void;
  move: (event: PointerEvent) => void;
  finish: (event: PointerEvent, commit: boolean) => void;
  cancel: () => boolean;
  announce: (message: string) => void;
}>;

type SkillDragCallbacks = Readonly<{
  name: (skill: SkillId) => string;
  previewPlacement: (skill: SkillId, target: number) => SkillDropPreview;
  place: (skill: SkillId, target: number) => void;
  reorder: (from: number, to: number) => void;
  clearFeedback: () => void;
}>;

const DRAG_THRESHOLD_PX = 5;
const TOUCH_DELAY_MS = 120;

function slotAt(x: number, y: number): number | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(
    "[data-skill-bar] [data-skill-slot]",
  );
  const slot = Number(element?.dataset.skillSlot);
  return Number.isInteger(slot) && slot >= 0 && slot < 8 ? slot : null;
}

export function useSkillDragSession(callbacks: SkillDragCallbacks): SkillDragSession {
  const active = ref<ActiveSkillDrag | null>(null);
  const preview = ref<SkillDropPreview | null>(null);
  const announcement = ref("");
  const suppressClick = ref(false);
  const dragging = computed(() => active.value?.started === true);

  function release(drag: ActiveSkillDrag): void {
    if (drag.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
  }

  function reset(drag: ActiveSkillDrag, suppress: boolean): void {
    active.value = null;
    preview.value = null;
    release(drag);
    if (!suppress) return;
    suppressClick.value = true;
    setTimeout(() => { suppressClick.value = false; }, 0);
  }

  function begin(event: PointerEvent, source: SkillDragSource): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    callbacks.clearFeedback();
    active.value = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      source,
      element,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      x: event.clientX,
      y: event.clientY,
      started: false,
      target: null,
    };
  }

  function move(event: PointerEvent): void {
    const drag = active.value;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      if (drag.pointerType === "touch" && performance.now() - drag.startedAt < TOUCH_DELAY_MS) {
        return;
      }
      drag.started = true;
      announcement.value = `${drag.source.mode === "reorder" ? "Moving" : "Placing"} ${callbacks.name(drag.source.skill)}. Choose a skill slot.`;
      preview.value = {
        skill: drag.source.skill,
        target: null,
        outcome: "pending",
        affectedSlots: [],
        label: "Choose a skill slot",
      };
    }
    event.preventDefault();
    drag.x = event.clientX;
    drag.y = event.clientY;
    const target = slotAt(event.clientX, event.clientY);
    if (target === drag.target) return;
    drag.target = target;
    preview.value = target === null
      ? {
          skill: drag.source.skill,
          target: null,
          outcome: "pending",
          affectedSlots: [],
          label: "Choose a skill slot",
        }
      : drag.source.mode === "reorder"
        ? {
            skill: drag.source.skill,
            target,
            outcome: "move",
            affectedSlots: [drag.source.from],
            label: `Move to ${target + 1}`,
          }
        : callbacks.previewPlacement(drag.source.skill, target);
    announcement.value = preview.value.label;
  }

  function finish(event: PointerEvent, commit: boolean): void {
    const drag = active.value;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.target;
    const started = drag.started;
    if (commit && started && target !== null) {
      if (drag.source.mode === "reorder") {
        if (target !== drag.source.from) {
          callbacks.reorder(drag.source.from, target);
          announcement.value = `Skill moved from slot ${drag.source.from + 1} to slot ${target + 1}.`;
        }
      } else {
        callbacks.place(drag.source.skill, target);
      }
    }
    reset(drag, started);
  }

  function cancel(): boolean {
    const drag = active.value;
    if (!drag) return false;
    if (drag.started) {
      announcement.value = drag.source.mode === "reorder"
        ? "Skill move cancelled."
        : "Skill placement cancelled.";
    }
    reset(drag, drag.started);
    return true;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !cancel()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  onMounted(() => window.addEventListener("keydown", onKeydown, true));
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeydown, true);
    const drag = active.value;
    if (drag) reset(drag, false);
  });

  return {
    active,
    preview,
    announcement,
    suppressClick,
    dragging,
    begin,
    move,
    finish,
    cancel,
    announce: (message) => { announcement.value = message; },
  };
}
