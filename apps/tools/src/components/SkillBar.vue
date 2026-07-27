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
      class="ui-slot skill"
      :data-elite="skill.elite ? '' : undefined"
      :data-profession="skill.profession"
      :title="skill.name"
    >
      <span>{{ skill.short }}</span>
    </span>
  </div>
</template>
