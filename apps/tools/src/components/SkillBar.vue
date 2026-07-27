<script setup lang="ts">
import type { SkillId } from "../model";
import type { SkillCatalogue } from "../skill-catalog";

defineProps<{
  skills: readonly (SkillId | null)[];
  catalogue: SkillCatalogue;
  compact?: boolean;
  changedSlots?: readonly number[];
}>();
</script>

<template>
  <div class="skill-bar" :class="{ 'skill-bar--compact': compact }" aria-label="Skill bar">
    <span
      v-for="(skill, index) in skills"
      :key="`${skill ?? 'empty'}-${index}`"
      class="ui-slot skill"
      :data-changed="changedSlots?.includes(index) ? '' : undefined"
      :data-elite="skill !== null && catalogue.get(skill).elite ? '' : undefined"
      :data-profession="skill === null ? undefined : catalogue.get(skill).profession"
      :data-empty="skill === null ? '' : undefined"
      :title="skill === null ? 'Empty skill slot' : catalogue.get(skill).name"
    >
      <img
        v-if="skill !== null && catalogue.get(skill).iconUrl"
        :src="catalogue.get(skill).iconUrl!"
        alt=""
      >
      <span v-else-if="skill !== null">
        {{ catalogue.get(skill).name.split(" ").map((part) => part[0]).join("").slice(0, 2) }}
      </span>
    </span>
  </div>
</template>
