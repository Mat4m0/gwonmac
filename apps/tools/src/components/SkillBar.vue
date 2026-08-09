<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SkillId } from "../model";
import type { SkillCatalogue } from "../skill-catalog";
import type { SkillDropPreview } from "../skill-drop";

const props = defineProps<{
  skills: readonly (SkillId | null)[];
  catalogue: SkillCatalogue;
  compact?: boolean;
  changedSlots?: readonly number[];
  invalidSlots?: readonly number[];
  activeSlot?: number | null;
  editable?: boolean;
  dropPreview?: SkillDropPreview | null;
}>();
const emit = defineEmits<{
  select: [slot: number];
  clear: [slot: number];
  move: [from: number, to: number];
}>();

const announcement = ref("");
const moveTarget = ref<number | null>(null);
const suppressClick = ref(false);

type SkillDrag = {
  pointerId: number;
  pointerType: string;
  from: number;
  skill: SkillId;
  source: HTMLElement;
  startX: number;
  startY: number;
  startedAt: number;
  x: number;
  y: number;
  started: boolean;
  target: number | null;
};

const pointerDrag = ref<SkillDrag | null>(null);

function announceMove(from: number, to: number): void {
  announcement.value = `Skill moved from slot ${from + 1} to slot ${to + 1}.`;
}

const keydown = (event: KeyboardEvent, index: number) => {
  if (!event.currentTarget || !("closest" in event.currentTarget)) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("clear", index);
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
    event.preventDefault();
    const target = Math.max(0, index - 1);
    if (target === index) return;
    emit("move", index, target);
    announceMove(index, target);
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
    event.preventDefault();
    const target = Math.min(7, index + 1);
    if (target === index) return;
    emit("move", index, target);
    announceMove(index, target);
  }
};

function slotAt(drag: SkillDrag, x: number, y: number): number | null {
  const bar = drag.source.closest<HTMLElement>("[data-skill-bar]");
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-skill-slot]");
  if (!bar || !element || !bar.contains(element)) return null;
  const slot = Number(element.dataset.skillSlot);
  return Number.isInteger(slot) && slot >= 0 && slot < 8 ? slot : null;
}

function beginSkillDrag(event: PointerEvent, from: number, skill: SkillId | null): void {
  if (!props.editable || skill === null) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const source = event.currentTarget as HTMLElement;
  source.setPointerCapture(event.pointerId);
  pointerDrag.value = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    from,
    skill,
    source,
    startX: event.clientX,
    startY: event.clientY,
    startedAt: performance.now(),
    x: event.clientX,
    y: event.clientY,
    started: false,
    target: null,
  };
}

function moveSkillDrag(event: PointerEvent): void {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.started) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    if (drag.pointerType === "touch" && performance.now() - drag.startedAt < 120) return;
    drag.started = true;
    announcement.value = `Moving ${props.catalogue.get(drag.skill).name}. Choose a skill slot.`;
  }
  event.preventDefault();
  drag.x = event.clientX;
  drag.y = event.clientY;
  const target = slotAt(drag, event.clientX, event.clientY);
  if (target !== drag.target) {
    drag.target = target;
    moveTarget.value = target;
  }
}

function finishSkillDrag(event: PointerEvent, place: boolean): void {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const started = drag.started;
  if (place && started && drag.target !== null && drag.target !== drag.from) {
    emit("move", drag.from, drag.target);
    announceMove(drag.from, drag.target);
  }
  pointerDrag.value = null;
  moveTarget.value = null;
  if (started) {
    suppressClick.value = true;
    setTimeout(() => { suppressClick.value = false; }, 0);
  }
  if (drag.source.hasPointerCapture(event.pointerId)) {
    drag.source.releasePointerCapture(event.pointerId);
  }
}

function cancelSkillDrag(): boolean {
  const drag = pointerDrag.value;
  if (!drag?.started) return false;
  pointerDrag.value = null;
  moveTarget.value = null;
  announcement.value = "Skill move cancelled.";
  suppressClick.value = true;
  setTimeout(() => { suppressClick.value = false; }, 0);
  if (drag.source.hasPointerCapture(drag.pointerId)) {
    drag.source.releasePointerCapture(drag.pointerId);
  }
  return true;
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !cancelSkillDrag()) return;
  event.preventDefault();
  event.stopPropagation();
}

function selectSlot(event: MouseEvent, index: number): void {
  if (suppressClick.value) {
    event.preventDefault();
    return;
  }
  emit("select", index);
}

onMounted(() => window.addEventListener("keydown", onWindowKeydown, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKeydown, true));

const dropAnnouncement = computed(() =>
  props.dropPreview?.label
  ?? (moveTarget.value === null ? "" : `Move to ${moveTarget.value + 1}`)
);

function skillKey(skills: readonly (SkillId | null)[], index: number): string {
  const skill = skills[index];
  if (skill === null) return `empty-${index}`;
  let occurrence = 0;
  for (let before = 0; before < index; before += 1) {
    if (skills[before] === skill) occurrence += 1;
  }
  return `skill-${skill}-${occurrence}`;
}

function hideBrokenIcon(event: Event): void {
  const image = event.currentTarget;
  if (!(image instanceof HTMLImageElement)) return;
  image.closest(".skill")?.setAttribute("data-icon-missing", "");
  image.remove();
}
</script>

<template>
  <div
    class="skill-bar"
    :class="{
      'skill-bar--compact': compact,
      'skill-bar--receiving': editable && (dropPreview != null || moveTarget !== null),
    }"
    aria-label="Skill bar"
    :data-skill-bar="editable ? '' : undefined"
  >
    <component
      :is="editable ? 'button' : 'span'"
      v-for="(skill, index) in skills"
      :key="skillKey(skills, index)"
      class="ui-slot skill"
      :class="{
        'skill--editable': editable,
        'skill--draggable': editable && skill !== null,
      }"
      :type="editable ? 'button' : undefined"
      :role="editable ? undefined : 'img'"
      :data-changed="changedSlots?.includes(index) ? '' : undefined"
      :data-invalid="invalidSlots?.includes(index) ? '' : undefined"
      :data-active="activeSlot === index ? '' : undefined"
      :data-elite="skill !== null && catalogue.get(skill).elite ? '' : undefined"
      :data-profession="skill === null ? undefined : catalogue.get(skill).profession"
      :data-icon-missing="skill !== null && !catalogue.get(skill).iconUrl ? '' : undefined"
      :data-empty="skill === null ? '' : undefined"
      :data-skill-slot="editable ? index : undefined"
      :data-pointer-dragging="pointerDrag?.from === index && pointerDrag.started ? '' : undefined"
      :data-drop-target="dropPreview?.target === index || moveTarget === index ? '' : undefined"
      :data-drop-outcome="dropPreview?.target === index ? dropPreview.outcome : moveTarget === index ? 'move' : undefined"
      :data-drop-affected="dropPreview?.affectedSlots.includes(index) ? '' : undefined"
      :title="skill === null ? 'Empty skill slot' : catalogue.get(skill).name"
      :aria-label="[
        `${index + 1}. ${skill === null ? 'Empty skill slot' : catalogue.get(skill).name}`,
        skill !== null && catalogue.get(skill).elite ? 'Elite' : null,
        changedSlots?.includes(index) ? 'Changed' : null,
        invalidSlots?.includes(index) ? 'Invalid' : null,
      ].filter(Boolean).join('. ')"
      :aria-pressed="editable ? activeSlot === index : undefined"
      @click="editable && selectSlot($event, index)"
      @keydown="editable && keydown($event, index)"
      @pointerdown="beginSkillDrag($event, index, skill)"
      @pointermove="moveSkillDrag"
      @pointerup="finishSkillDrag($event, true)"
      @pointercancel="finishSkillDrag($event, false)"
      @lostpointercapture="finishSkillDrag($event, false)"
    >
      <img
        v-if="skill !== null && catalogue.get(skill).iconUrl"
        :src="catalogue.get(skill).iconUrl!"
        alt=""
        draggable="false"
        @error="hideBrokenIcon"
      >
      <span v-if="skill !== null" class="skill-fallback" aria-hidden="true">
        {{ catalogue.get(skill).name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
      </span>
      <span
        v-if="dropPreview?.target === index || moveTarget === index"
        class="skill-drop-label"
        aria-hidden="true"
      >{{ dropPreview?.target === index ? dropPreview.label : `Move to ${index + 1}` }}</span>
      <span v-if="editable" class="skill-slot-number" aria-hidden="true">{{ index + 1 }}</span>
    </component>
    <span class="ui-sr-only" aria-live="polite">{{ dropAnnouncement || announcement }}</span>
    <div
      v-if="pointerDrag?.started"
      class="skill-reorder-preview"
      :style="{ left: `${pointerDrag.x + 12}px`, top: `${pointerDrag.y + 12}px` }"
      aria-hidden="true"
    >
      <span
        class="ui-slot skill"
        :data-elite="catalogue.get(pointerDrag.skill).elite ? '' : undefined"
        :data-profession="catalogue.get(pointerDrag.skill).profession"
        :data-icon-missing="catalogue.get(pointerDrag.skill).iconUrl ? undefined : ''"
      >
        <img
          v-if="catalogue.get(pointerDrag.skill).iconUrl"
          :src="catalogue.get(pointerDrag.skill).iconUrl!"
          alt=""
          draggable="false"
          @error="hideBrokenIcon"
        >
        <span class="skill-fallback">
          {{ catalogue.get(pointerDrag.skill).name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
        </span>
      </span>
      <small>{{ moveTarget === null ? "Choose a slot" : `Move to ${moveTarget + 1}` }}</small>
    </div>
  </div>
</template>
