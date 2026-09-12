<!-- The same character-owned filters drive results and both maps, even when collapsed. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { ELITE_REGIONS, type EliteViewPreferences } from "../../../../src/shared/elite-skills";
import { PROFESSIONS } from "../../../../src/shared/builds/heroes";
import { professionPresentation } from "../../../../src/shared/profession-assets";
import type { Profession, ProfessionPair } from "../../../../src/shared/builds/library";
const props = defineProps<{
  preferences: EliteViewPreferences; trackedCount: number; disabled: boolean;
  myProfessions: ProfessionPair | null; learnedAvailable: boolean;
}>();
const emit = defineEmits<{ change: [value: Partial<EliteViewPreferences>]; reset: [] }>();
const searchInput = ref<HTMLInputElement | null>(null);
const professions = Object.entries(PROFESSIONS).map(([code, facts]) => ({ ...facts, code: code as Profession, icon: professionPresentation(facts.id)!.icon }));
const selected = computed(() => {
  const filter = props.preferences.professions;
  return filter.kind === "all" ? professions.map(p => p.code) : filter.kind === "custom" ? filter.values
    : props.myProfessions?.filter((value): value is Profession => value !== null) ?? [];
});
const allSelected = computed(() => selected.value.length === professions.length);
const selectionLabel = computed(() => selected.value.length === 0
  ? props.preferences.professions.kind === "mine" ? "Your professions are unavailable. Select them manually." : "No professions selected"
  : allSelected.value ? "All professions" : selected.value.length <= 2
    ? selected.value.map(code => PROFESSIONS[code].name).join(" + ") : `${selected.value.length} professions selected`);
function toggleProfession(name: Profession) {
  const values = selected.value.includes(name) ? selected.value.filter(value => value !== name) : [...selected.value, name];
  emit("change", { professions: { kind: "custom", values }, focusedSkill: null });
}
defineExpose({ searchInput });
</script>
<template>
  <fieldset class="elite-search-controls" aria-label="Map filters" :disabled="disabled">
    <label class="elite-search"><span class="elite-search-label">Search skill, boss or area</span>
      <input ref="searchInput" type="search" class="ui-input" maxlength="200" placeholder="Find an elite skill…" :value="preferences.search"
        @input="emit('change', { search: ($event.target as HTMLInputElement).value, focusedSkill: null })" />
    </label>
    <div class="elite-profession-choices" role="group" aria-label="Professions">
      <button v-for="profession in professions" :key="profession.code" class="elite-profession" :data-profession="profession.code"
        :aria-label="profession.name" :aria-pressed="selected.includes(profession.code)" :title="profession.name" @click="toggleProfession(profession.code)">
        <img :src="profession.icon" alt="" draggable="false"><span aria-hidden="true">{{ profession.code }}</span>
        <span v-if="selected.includes(profession.code)" class="elite-profession-check" aria-hidden="true">✓</span>
        <span class="elite-profession-name" aria-hidden="true">{{ profession.name }}</span>
      </button>
    </div>
    <div class="elite-profession-shortcuts">
      <button class="ui-link" @click="emit('change', { professions: allSelected ? { kind: 'custom', values: [] } : { kind: 'all' }, focusedSkill: null })">{{ allSelected ? 'Deselect all' : 'Select all' }}</button>
      <button class="ui-link" :aria-pressed="preferences.professions.kind === 'mine'" title="Use this character’s primary and secondary professions"
        @click="emit('change', { professions: { kind: 'mine' }, focusedSkill: null })">Current class</button>
    </div>
    <p v-if="preferences.professions.kind === 'mine' || selected.length === 0" class="elite-support">{{ selectionLabel }}<span v-if="preferences.professions.kind === 'mine' && selected.length"> · primary &amp; secondary</span></p>
    <label class="elite-check"><input type="checkbox" :checked="preferences.hideLearned" @change="emit('change', { hideLearned: !preferences.hideLearned })">Hide already learned</label>
    <p v-if="!learnedAvailable" class="elite-support">Learned status unavailable. Matching skills stay visible.</p>
    <div class="elite-filter-bottom">
      <label><span class="elite-field-label">Show </span><select class="ui-select" aria-label="Skills to show" :value="preferences.mode"
        @change="emit('change', { mode: ($event.target as HTMLSelectElement).value as EliteViewPreferences['mode'], focusedSkill: null })">
        <option value="browse">All matching skills</option><option value="tracked">Saved skills ({{ trackedCount }})</option>
      </select></label>
      <details class="elite-more-filters" :open="!!preferences.region"><summary>More filters</summary>
        <label class="elite-search"><span class="elite-field-label">Capture region</span><select class="ui-select" :value="preferences.region"
          @change="emit('change', { region: ($event.target as HTMLSelectElement).value as EliteViewPreferences['region'], focusedSkill: null })">
          <option value="">All regions</option><option v-for="name in ELITE_REGIONS" :key="name">{{ name }}</option>
        </select></label><button class="ui-link" @click="emit('reset')">Reset filters</button>
      </details>
    </div>
    <button v-if="preferences.search || preferences.focusedSkill !== null" class="ui-link elite-clear-search" @click="emit('change', { search: '', focusedSkill: null })">Clear {{ preferences.focusedSkill !== null ? 'skill focus' : 'search' }}</button>
  </fieldset>
</template>
