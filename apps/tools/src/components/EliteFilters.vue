<!-- Filter choices apply to both maps whether the planner is expanded or collapsed. -->
<script setup lang="ts">
import { ref } from "vue";
import { ELITE_REGIONS, type EliteViewPreferences } from "../../../../src/shared/elite-skills";
import { PROFESSIONS } from "../../../../src/shared/builds/heroes";
import type { Profession, ProfessionPair } from "../../../../src/shared/builds/library";
const props = defineProps<{
  preferences: EliteViewPreferences; trackedCount: number; disabled: boolean;
  myProfessions: ProfessionPair | null; learnedAvailable: boolean; summary: string;
}>();
const emit = defineEmits<{ change: [value: Partial<EliteViewPreferences>]; reset: [] }>();
const searchInput = ref<HTMLInputElement | null>(null);
const chooseProfessions = ref(props.preferences.professions.kind === "custom");
function toggleProfession(name: Profession) {
  const filter = props.preferences.professions;
  const selected = filter.kind === "custom" ? filter.values : [];
  const values = selected.includes(name) ? selected.filter(value => value !== name) : [...selected, name];
  emit("change", { professions: values.length ? { kind: "custom", values } : { kind: "all" }, focusedSkill: null });
}
defineExpose({ searchInput });
</script>
<template>
  <fieldset class="elite-search-controls" aria-label="Map filters" :disabled="disabled">

    <label class="elite-search"><span class="elite-field-label">Search skill, boss or area</span>
      <input ref="searchInput" type="search" class="ui-input" maxlength="200" placeholder="Try Hundred Blades or a boss name" :value="preferences.search"
        @input="emit('change', { search: ($event.target as HTMLInputElement).value, focusedSkill: null })" />
    </label>
    <div class="elite-modes" role="group" aria-label="Skills to show">
      <button class="ui-button" :aria-pressed="preferences.mode === 'browse'" @click="emit('change', { mode: 'browse', focusedSkill: null })">All skills</button>
      <button class="ui-button" :aria-pressed="preferences.mode === 'tracked'" @click="emit('change', { mode: 'tracked', focusedSkill: null })">Tracked <span>{{ trackedCount }}</span></button>
    </div>
    <div class="elite-profession-controls">
      <span class="elite-field-label" id="elite-profession-label">Professions</span>
      <div class="elite-modes" role="group" aria-labelledby="elite-profession-label">
        <button class="ui-button" :aria-pressed="preferences.professions.kind === 'all'" @click="chooseProfessions = false; emit('change', { professions: { kind: 'all' }, focusedSkill: null })">All</button>
        <button class="ui-button" :aria-pressed="preferences.professions.kind === 'mine'" @click="chooseProfessions = false; emit('change', { professions: { kind: 'mine' }, focusedSkill: null })">My professions</button>
        <button class="ui-button" :aria-expanded="chooseProfessions" aria-controls="elite-profession-choices" @click="chooseProfessions = !chooseProfessions">Choose…</button>
      </div>
      <div v-if="chooseProfessions" id="elite-profession-choices" class="elite-profession-choices" role="group" aria-label="Choose professions">
        <label v-for="(facts, name) in PROFESSIONS" :key="name" class="elite-check"><input type="checkbox"
          :checked="preferences.professions.kind === 'custom' && preferences.professions.values.includes(name)" @change="toggleProfession(name)">{{ facts.name }}</label>
      </div>
      <p v-if="preferences.professions.kind === 'mine' && !myProfessions" class="elite-support">Your professions are unavailable. Choose professions manually, or show all.</p>
    </div>
    <label class="elite-check"><input type="checkbox" :checked="preferences.hideLearned" @change="emit('change', { hideLearned: !preferences.hideLearned })">Hide learned skills</label>
    <p v-if="!learnedAvailable" class="elite-support">Learned status unavailable. All matching skills stay visible.</p>
    <details class="elite-more-filters" :open="!!preferences.region"><summary>More filters<span v-if="preferences.region"> · {{ preferences.region }}</span></summary>
      <label class="elite-search"><span class="elite-field-label">Capture region</span><select class="ui-select" :value="preferences.region"
        @change="emit('change', { region: ($event.target as HTMLSelectElement).value as EliteViewPreferences['region'], focusedSkill: null })">
        <option value="">All regions</option><option v-for="name in ELITE_REGIONS" :key="name">{{ name }}</option>
      </select></label>
    </details>
    <div class="elite-active-filters"><span>{{ summary }}</span><button class="ui-link" @click="emit('reset')">Reset filters</button></div>
    <button v-if="preferences.search || preferences.focusedSkill !== null" class="ui-link elite-clear-search" @click="emit('change', { search: '', focusedSkill: null })">Clear {{ preferences.focusedSkill !== null ? 'skill focus' : 'search' }}</button>
  </fieldset>
</template>
