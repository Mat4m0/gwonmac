<script setup lang="ts">
import { computed, ref } from "vue";
import { VueDraggable, type DraggableEvent } from "vue-draggable-plus";
import type { SkillId } from "../model";
import type { SkillCatalogue } from "../skill-catalog";

const props = defineProps<{
  skills: readonly (SkillId | null)[];
  catalogue: SkillCatalogue;
  compact?: boolean;
  changedSlots?: readonly number[];
  invalidSlots?: readonly number[];
  activeSlot?: number | null;
  editable?: boolean;
}>();
const emit = defineEmits<{
  select: [slot: number];
  clear: [slot: number];
  move: [from: number, to: number];
  reorder: [skills: readonly (SkillId | null)[]];
  moved: [from: number, to: number];
}>();

const announcement = ref("");
const sortableSkills = computed({
  get: () => [...props.skills],
  set: (skills: (SkillId | null)[]) => {
    if (skills.length === 8) emit("reorder", skills);
  },
});
const dragAnimation = typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ? 0
  : 180;

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

function dragEnded(event: DraggableEvent<SkillId | null>): void {
  const from = event.oldIndex;
  const to = event.newIndex;
  if (from === undefined || to === undefined || from === to) return;
  announceMove(from, to);
  emit("moved", from, to);
}
</script>

<template>
  <VueDraggable
    v-model="sortableSkills"
    class="skill-bar"
    :class="{ 'skill-bar--compact': compact }"
    aria-label="Skill bar"
    :disabled="!editable"
    draggable=".skill--editable"
    filter="[data-empty]"
    :prevent-on-filter="false"
    :animation="dragAnimation"
    easing="cubic-bezier(0.22, 1, 0.36, 1)"
    chosen-class="skill--chosen"
    ghost-class="skill--ghost"
    drag-class="skill--dragging"
    fallback-class="skill--fallback"
    :fallback-on-body="true"
    :fallback-tolerance="4"
    :delay="120"
    :delay-on-touch-only="true"
    :touch-start-threshold="4"
    @end="dragEnded"
  >
    <component
      :is="editable ? 'button' : 'span'"
      v-for="(skill, index) in skills"
      :key="`${skill ?? 'empty'}-${index}`"
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
      :data-empty="skill === null ? '' : undefined"
      :title="skill === null ? 'Empty skill slot' : catalogue.get(skill).name"
      :aria-label="[
        `${index + 1}. ${skill === null ? 'Empty skill slot' : catalogue.get(skill).name}`,
        skill !== null && catalogue.get(skill).elite ? 'Elite' : null,
        changedSlots?.includes(index) ? 'Changed' : null,
        invalidSlots?.includes(index) ? 'Invalid' : null,
      ].filter(Boolean).join('. ')"
      :aria-pressed="editable ? activeSlot === index : undefined"
      @click="editable && emit('select', index)"
      @keydown="editable && keydown($event, index)"
    >
      <img
        v-if="skill !== null && catalogue.get(skill).iconUrl"
        :src="catalogue.get(skill).iconUrl!"
        alt=""
      >
      <span v-else-if="skill !== null">
        {{ catalogue.get(skill).name.split(" ").map((part) => part[0]).join("").slice(0, 2) }}
      </span>
      <span v-if="editable" class="skill-slot-number" aria-hidden="true">{{ index + 1 }}</span>
    </component>
    <span class="ui-sr-only" aria-live="polite">{{ announcement }}</span>
  </VueDraggable>
</template>
