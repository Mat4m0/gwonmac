<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { Build, SkillId } from "../model";
import type { SkillCatalogue, SkillPresentation } from "../skill-catalog";

const props = defineProps<{
  build: Build;
  slotIndex: number;
  catalogue: SkillCatalogue;
}>();
const emit = defineEmits<{
  choose: [skill: SkillId | null];
  close: [];
}>();

const search = ref("");
const filter = ref<"all" | "primary" | "secondary" | "elite">("all");
const searchInput = ref<HTMLInputElement | null>(null);
const LIMIT = 160;

const legal = computed(() => {
  const [primary, secondary] = props.build.professions;
  const needle = search.value.trim().toLocaleLowerCase();
  return props.catalogue.all()
    .filter((skill) =>
      (skill.availability === "pve" || skill.availability === "player-only-pve")
      && skill.id !== 0
      && (skill.profession === null || skill.profession === primary || skill.profession === secondary)
      && (
        filter.value === "all"
        || (filter.value === "primary" && skill.profession === primary)
        || (filter.value === "secondary" && skill.profession === secondary)
        || (filter.value === "elite" && skill.elite)
      )
      && (
        needle.length === 0
        || skill.name.toLocaleLowerCase().includes(needle)
        || skill.attribute?.toLocaleLowerCase().includes(needle)
      )
    )
    .sort(compareSkills);
});
const shown = computed(() => legal.value.slice(0, LIMIT));
const current = computed(() => props.build.skills[props.slotIndex] ?? null);

function compareSkills(left: SkillPresentation, right: SkillPresentation): number {
  if (left.elite !== right.elite) return left.elite ? -1 : 1;
  return left.name.localeCompare(right.name);
}

void nextTick(() => searchInput.value?.focus());
</script>

<template>
  <div
    class="skill-picker-backdrop"
    role="presentation"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <section class="ui-frame skill-picker" role="dialog" aria-modal="true" aria-labelledby="skill-picker-title">
      <header>
        <div>
          <h2 id="skill-picker-title">Choose skill {{ slotIndex + 1 }}</h2>
          <p>
            {{ build.professions[0] }}<template v-if="build.professions[1]"> / {{ build.professions[1] }}</template>
            · only equippable skills for this build
          </p>
        </div>
        <button class="ui-button" data-icon aria-label="Close skill catalogue" @click="emit('close')">×</button>
      </header>

      <label class="ui-input-group">
        <span aria-hidden="true">⌕</span>
        <span class="ui-sr-only">Search skills</span>
        <input ref="searchInput" v-model="search" type="search" placeholder="Search skill or attribute">
      </label>

      <div class="ui-segment skill-filters" aria-label="Filter skills">
        <button :aria-pressed="filter === 'all'" @click="filter = 'all'">All</button>
        <button :aria-pressed="filter === 'primary'" @click="filter = 'primary'">{{ build.professions[0] }}</button>
        <button
          v-if="build.professions[1]"
          :aria-pressed="filter === 'secondary'"
          @click="filter = 'secondary'"
        >
          {{ build.professions[1] }}
        </button>
        <button :aria-pressed="filter === 'elite'" @click="filter = 'elite'">Elite</button>
      </div>

      <div class="skill-picker-summary">
        <span>{{ legal.length }} usable skills</span>
        <span v-if="legal.length > shown.length">Showing {{ shown.length }} · refine the search for more</span>
      </div>

      <div class="skill-grid" role="listbox" :aria-label="`Skills for slot ${slotIndex + 1}`">
        <button
          v-for="skill in shown"
          :key="skill.id"
          class="skill-choice"
          :data-elite="skill.elite ? '' : undefined"
          :aria-selected="current === skill.id"
          role="option"
          :title="skill.name"
          @click="emit('choose', skill.id)"
        >
          <span class="ui-slot skill" :data-elite="skill.elite ? '' : undefined" :data-profession="skill.profession">
            <img v-if="skill.iconUrl" :src="skill.iconUrl" alt="" loading="lazy">
          </span>
          <span>
            <strong>{{ skill.name }}</strong>
            <small>{{ skill.profession ?? "Any" }}<template v-if="skill.attribute"> · {{ skill.attribute }}</template></small>
          </span>
        </button>
      </div>

      <footer>
        <button class="ui-button" @click="emit('choose', null)">Clear slot</button>
        <button class="ui-button" @click="emit('close')">Cancel</button>
      </footer>
    </section>
  </div>
</template>
