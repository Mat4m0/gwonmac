<script setup lang="ts">
import { ref, useId } from "vue";

const props = defineProps<{
  tags: readonly string[];
  options: readonly string[];
  label: string;
}>();
const emit = defineEmits<{
  update: [tags: readonly string[]];
}>();

const draft = ref("");
const listId = `tags-${useId()}`;

const add = () => {
  const value = draft.value.trim();
  if (!value || value.length > 24) return;
  const exists = props.tags.some(
    (tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase(),
  );
  if (!exists) emit("update", [...props.tags, value]);
  draft.value = "";
};
</script>

<template>
  <div class="tag-editor" :aria-label="label">
    <button
      v-for="tag in tags"
      :key="tag"
      class="ui-chip"
      :aria-label="`Remove ${tag} tag`"
      :title="`Remove ${tag}`"
      @click="emit('update', tags.filter((value) => value !== tag))"
    >
      {{ tag }} <span aria-hidden="true">×</span>
    </button>
    <label class="tag-entry">
      <span class="ui-sr-only">Add tag</span>
      <input
        v-model="draft"
        class="ui-input"
        :list="listId"
        maxlength="24"
        placeholder="+ tag"
        @keydown.enter.prevent="add"
        @change="add"
      >
      <datalist :id="listId">
        <option
          v-for="option in options.filter((value) => !tags.includes(value))"
          :key="option"
          :value="option"
        />
      </datalist>
    </label>
  </div>
</template>
