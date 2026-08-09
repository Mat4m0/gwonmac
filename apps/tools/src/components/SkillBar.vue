<script setup lang="ts">
import { computed, ref } from "vue";
import { VueDraggable, type DraggableEvent, type MoveEvent } from "vue-draggable-plus";
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
  reorder: [skills: readonly (SkillId | null)[]];
  moved: [from: number, to: number];
}>();

const announcement = ref("");
const moveTarget = ref<number | null>(null);
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
  moveTarget.value = null;
  const from = event.oldIndex;
  const to = event.newIndex;
  if (from === undefined || to === undefined || from === to) return;
  announceMove(from, to);
  emit("moved", from, to);
}

function dragMoved(event: MoveEvent): void {
  const related = Number(event.related.dataset.skillSlot);
  moveTarget.value = Number.isInteger(related) ? related : null;
}

const dropAnnouncement = computed(() =>
  props.dropPreview?.label
  ?? (moveTarget.value === null ? "" : `Move to ${moveTarget.value + 1}`)
);
</script>

<template>
  <VueDraggable
    v-model="sortableSkills"
    class="skill-bar"
    :class="{
      'skill-bar--compact': compact,
      'skill-bar--receiving': editable && (dropPreview != null || moveTarget !== null),
    }"
    aria-label="Skill bar"
    :data-skill-bar="editable ? '' : undefined"
    :disabled="!editable"
    draggable=".skill--editable"
    filter="[data-empty]"
    :prevent-on-filter="false"
    :animation="dragAnimation"
    :force-fallback="true"
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
    :on-move="dragMoved"
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
      :data-icon-missing="skill !== null && !catalogue.get(skill).iconUrl ? '' : undefined"
      :data-empty="skill === null ? '' : undefined"
      :data-skill-slot="editable ? index : undefined"
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
      @click="editable && emit('select', index)"
      @keydown="editable && keydown($event, index)"
    >
      <img
        v-if="skill !== null && catalogue.get(skill).iconUrl"
        :src="catalogue.get(skill).iconUrl!"
        alt=""
      >
      <span v-else-if="skill !== null" class="skill-fallback" aria-hidden="true">
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
  </VueDraggable>
</template>
