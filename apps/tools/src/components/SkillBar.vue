<script setup lang="ts">
import type { SkillId } from "../model";
import type { SkillCatalogue } from "../skill-catalog";
import type { SkillDragSession } from "../use-skill-drag-session";

const props = defineProps<{
  skills: readonly (SkillId | null)[];
  catalogue: SkillCatalogue;
  compact?: boolean;
  changedSlots?: readonly number[];
  invalidSlots?: readonly number[];
  activeSlot?: number | null;
  editable?: boolean;
  dragSession?: SkillDragSession;
}>();
const emit = defineEmits<{
  select: [slot: number];
  clear: [slot: number];
  move: [from: number, to: number];
}>();

function announceMove(from: number, to: number): void {
  if (props.dragSession) {
    props.dragSession.announce(`Skill moved from slot ${from + 1} to slot ${to + 1}.`);
  }
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

function selectSlot(event: MouseEvent, index: number): void {
  if (props.dragSession?.suppressClick.value) {
    event.preventDefault();
    return;
  }
  emit("select", index);
}

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
      'skill-bar--receiving': editable && dragSession?.preview.value != null,
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
      :data-pointer-dragging="dragSession?.active.value?.source.mode === 'reorder' && dragSession.active.value.source.from === index && dragSession.active.value.started ? '' : undefined"
      :data-drop-target="dragSession?.preview.value?.target === index ? '' : undefined"
      :data-drop-outcome="dragSession?.preview.value?.target === index ? dragSession.preview.value.outcome : undefined"
      :data-drop-affected="dragSession?.preview.value?.affectedSlots.includes(index) ? '' : undefined"
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
      @pointerdown="editable && skill !== null && dragSession?.begin($event, { mode: 'reorder', from: index, skill })"
      @pointermove="dragSession?.move($event)"
      @pointerup="dragSession?.finish($event, true)"
      @pointercancel="dragSession?.finish($event, false)"
      @lostpointercapture="dragSession?.finish($event, false)"
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
        v-if="dragSession?.preview.value?.target === index"
        class="skill-drop-label"
        aria-hidden="true"
      >{{ dragSession.preview.value?.label }}</span>
      <span v-if="editable" class="skill-slot-number" aria-hidden="true">{{ index + 1 }}</span>
    </component>
    <span class="ui-sr-only" aria-live="polite">{{ dragSession?.announcement.value }}</span>
    <div
      v-if="dragSession?.active.value?.started && dragSession.active.value.source.mode === 'reorder'"
      class="skill-reorder-preview"
      :style="{ left: `${dragSession.active.value.x + 12}px`, top: `${dragSession.active.value.y + 12}px` }"
      aria-hidden="true"
    >
      <span
        class="ui-slot skill"
        :data-elite="catalogue.get(dragSession.active.value.source.skill).elite ? '' : undefined"
        :data-profession="catalogue.get(dragSession.active.value.source.skill).profession"
        :data-icon-missing="catalogue.get(dragSession.active.value.source.skill).iconUrl ? undefined : ''"
      >
        <img
          v-if="catalogue.get(dragSession.active.value.source.skill).iconUrl"
          :src="catalogue.get(dragSession.active.value.source.skill).iconUrl!"
          alt=""
          draggable="false"
          @error="hideBrokenIcon"
        >
        <span class="skill-fallback">
          {{ catalogue.get(dragSession.active.value.source.skill).name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
        </span>
      </span>
      <small>{{ dragSession.preview.value?.label ?? "Choose a slot" }}</small>
    </div>
  </div>
</template>
