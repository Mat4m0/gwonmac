<script setup lang="ts">
import type { SkillId } from "../model";
import type { SkillCatalogue } from "../skill-catalog";

defineProps<{
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
}>();

const keydown = (event: KeyboardEvent, index: number) => {
  if (!event.currentTarget || !("closest" in event.currentTarget)) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    emit("clear", index);
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
    event.preventDefault();
    emit("move", index, Math.max(0, index - 1));
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
    event.preventDefault();
    emit("move", index, Math.min(7, index + 1));
  }
};

const dragstart = (event: DragEvent, index: number) => {
  event.dataTransfer?.setData("text/plain", String(index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const drop = (event: DragEvent, index: number) => {
  const from = Number(event.dataTransfer?.getData("text/plain"));
  if (Number.isInteger(from)) emit("move", from, index);
};
</script>

<template>
  <div class="skill-bar" :class="{ 'skill-bar--compact': compact }" aria-label="Skill bar">
    <button
      v-for="(skill, index) in skills"
      :key="`${skill ?? 'empty'}-${index}`"
      class="ui-slot skill"
      :class="{ 'skill--editable': editable }"
      :type="editable ? 'button' : undefined"
      :disabled="!editable"
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
      :draggable="editable && skill !== null"
      @click="editable && emit('select', index)"
      @keydown="editable && keydown($event, index)"
      @dragstart="editable && dragstart($event, index)"
      @dragover.prevent
      @drop.prevent="editable && drop($event, index)"
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
    </button>
  </div>
</template>
