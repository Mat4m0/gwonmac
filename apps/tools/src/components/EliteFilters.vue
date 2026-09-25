<!-- Discovery filters for All matches; each filter has exactly one control. The Hunt list ignores them. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { ELITE_REGIONS, type EliteLearnedFilter, type EliteViewPreferences } from "../../../../src/shared/elite-skills";
import { PROFESSIONS } from "../../../../src/shared/builds/heroes";
import { professionPresentation } from "../../../../src/shared/profession-assets";
import type { Profession, ProfessionPair } from "../../../../src/shared/builds/library";
const props = defineProps<{
  preferences: EliteViewPreferences; disabled: boolean;
  myProfessions: ProfessionPair | null; learnedAvailable: boolean;
}>();
const emit = defineEmits<{ change: [value: Partial<EliteViewPreferences>] }>();
const searchInput = ref<HTMLInputElement | null>(null);
const professions = Object.entries(PROFESSIONS).map(([code, facts]) => ({ ...facts, code: code as Profession, icon: professionPresentation(facts.id)!.icon }));
const mine = computed(() => props.myProfessions?.filter((value): value is Profession => value !== null) ?? []);
const selected = computed(() => {
  const filter = props.preferences.professions;
  return filter.kind === "all" ? [] : filter.kind === "custom" ? filter.values : mine.value;
});
function toggleProfession(name: Profession) {
  const values = selected.value.includes(name) ? selected.value.filter(value => value !== name) : [...selected.value, name];
  emit("change", { professions: values.length ? { kind: "custom", values } : { kind: "all" }, focusedSkill: null });
}
const LEARNED: readonly [EliteLearnedFilter, string][] = [["missing", "Not learned"], ["learned", "Learned"], ["any", "Any"]];
defineExpose({ searchInput });
</script>
<template>
  <fieldset class="elite-search-controls" aria-label="Filters" :disabled="disabled">
    <input ref="searchInput" type="search" class="ui-input" maxlength="200" placeholder="Find a skill, boss or area…" aria-label="Search skill, boss or area"
      :value="preferences.search" @input="emit('change', { search: ($event.target as HTMLInputElement).value, focusedSkill: null })" />
    <div class="elite-profession-choices" role="group" aria-label="Professions">
      <button v-for="profession in professions" :key="profession.code" class="elite-profession" :data-profession="profession.code"
        :aria-label="profession.name" :aria-pressed="selected.includes(profession.code)" :title="profession.name" @click="toggleProfession(profession.code)">
        <img :src="profession.icon" alt="" draggable="false">
      </button>
    </div>
    <div class="elite-filter-line">
      <span class="elite-quick-classes">Classes:
        <button class="ui-link" :aria-pressed="preferences.professions.kind === 'mine'" :title="mine.length ? mine.map(code => PROFESSIONS[code].name).join(' / ') : 'Your professions are unavailable'"
          @click="emit('change', { professions: { kind: 'mine' }, focusedSkill: null })">Mine</button> ·
        <button class="ui-link" :aria-pressed="preferences.professions.kind === 'all'" @click="emit('change', { professions: { kind: 'all' }, focusedSkill: null })">All</button>
      </span>
      <div class="ui-segment elite-learned" role="group" aria-label="Learned status" :title="learnedAvailable ? undefined : 'Learned status is unavailable, so every skill is shown'">
        <button v-for="[value, label] in LEARNED" :key="value" :aria-pressed="preferences.learned === value" :disabled="!learnedAvailable && value !== 'any'"
          @click="emit('change', { learned: value, focusedSkill: null })">{{ label }}</button>
      </div>
    </div>
    <select class="ui-select" aria-label="Capture region" :value="preferences.region"
      @change="emit('change', { region: ($event.target as HTMLSelectElement).value as EliteViewPreferences['region'], focusedSkill: null })">
      <option value="">All regions</option><option v-for="name in ELITE_REGIONS" :key="name">{{ name }}</option>
    </select>
    <p v-if="preferences.professions.kind === 'mine' && !mine.length" class="elite-support">Your professions are unavailable. Choose classes above.</p>
  </fieldset>
</template>
