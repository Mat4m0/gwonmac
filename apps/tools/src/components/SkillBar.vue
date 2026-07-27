<script setup lang="ts">
import type { Skill } from "../model";

defineProps<{
  skills: readonly Skill[];
  compact?: boolean;
}>();
</script>

<template>
  <div class="skill-bar" :class="{ 'skill-bar--compact': compact }" aria-label="Skill bar">
    <span
      v-for="skill in skills"
      :key="skill.id"
      class="skill"
      :class="{ 'skill--elite': skill.elite }"
      :data-profession="skill.profession"
      :title="skill.name"
    >
      <span>{{ skill.short }}</span>
      <i v-if="skill.elite" aria-hidden="true" />
    </span>
  </div>
</template>
