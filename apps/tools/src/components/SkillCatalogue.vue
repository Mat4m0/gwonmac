<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { SkillId } from "../model";
import type { SkillCatalogue, SkillPresentation } from "../skill-catalog";
import type { BuildDraftController } from "../use-build-draft";

const props = defineProps<{
  editor: BuildDraftController;
  catalogue: SkillCatalogue;
  allowPlayerOnly: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const search = ref("");
const filter = ref<"all" | "primary" | "secondary" | "elite" | "player">("all");
const inspected = ref<SkillPresentation | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const resultButtons = ref<HTMLButtonElement[]>([]);

const label = (value: string) => value.replace(/([a-z])([A-Z])/gu, "$1 $2");
const current = computed(() => {
  const slot = props.editor.activeSlot.value;
  if (slot === null) return null;
  const id = props.editor.draft.value.skills[slot];
  return id == null ? null : props.catalogue.get(id);
});

const results = computed(() => {
  const [primary, secondary] = props.editor.draft.value.professions;
  const needle = search.value.trim().toLocaleLowerCase();
  const invested = props.editor.draft.value.attributes;
  return props.catalogue.all()
    .filter((skill) => {
      const normal = skill.availability === "pve";
      const playerOnly = skill.availability === "player-only-pve";
      if (!normal && !(playerOnly && props.allowPlayerOnly)) return false;
      if (filter.value === "player" && !playerOnly) return false;
      if (filter.value !== "player" && playerOnly && props.editor.context.value !== "player") {
        return false;
      }
      if (
        skill.profession !== null
        && skill.profession !== primary
        && skill.profession !== secondary
      ) return false;
      if (filter.value === "primary" && skill.profession !== primary) return false;
      if (filter.value === "secondary" && skill.profession !== secondary) return false;
      if (filter.value === "elite" && !skill.elite) return false;
      return needle.length === 0
        || skill.name.toLocaleLowerCase().includes(needle)
        || skill.attribute?.toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => {
      const leftInvested = left.attribute !== null && (invested[left.attribute] ?? 0) > 0;
      const rightInvested = right.attribute !== null && (invested[right.attribute] ?? 0) > 0;
      if (leftInvested !== rightInvested) return leftInvested ? -1 : 1;
      if (left.profession !== right.profession) {
        if (left.profession === primary) return -1;
        if (right.profession === primary) return 1;
      }
      if (left.attribute !== right.attribute) {
        return (left.attribute ?? "zz").localeCompare(right.attribute ?? "zz");
      }
      return left.name.localeCompare(right.name);
    });
});

watch(
  () => props.editor.activeSlot.value,
  () => {
    inspected.value = current.value;
    void nextTick(() => searchInput.value?.focus());
  },
  { immediate: true },
);
watch(results, (values) => {
  if (inspected.value && !values.some((skill) => skill.id === inspected.value?.id)) {
    inspected.value = values[0] ?? null;
  }
});
function duplicateSlot(skill: SkillPresentation): number | null {
  const active = props.editor.activeSlot.value;
  const slot = props.editor.draft.value.skills.findIndex(
    (id, index) => id === skill.id && index !== active,
  );
  return slot < 0 ? null : slot;
}

function eliteSlot(skill: SkillPresentation): number | null {
  if (!skill.elite) return null;
  const active = props.editor.activeSlot.value;
  const slot = props.editor.draft.value.skills.findIndex((id, index) =>
    index !== active && id !== null && props.catalogue.get(id).elite
  );
  return slot < 0 ? null : slot;
}

function useSkill(skill: SkillPresentation): void {
  const slot = props.editor.activeSlot.value;
  if (slot === null || duplicateSlot(skill) !== null) return;
  const previousElite = eliteSlot(skill);
  if (previousElite !== null) props.editor.setSkill(previousElite, null);
  props.editor.setSkill(slot, skill.id);
  inspected.value = skill;
}

function focusResult(index: number): void {
  const buttons = resultButtons.value;
  if (!buttons.length) return;
  buttons[Math.max(0, Math.min(buttons.length - 1, index))]?.focus();
}

function onResultKeydown(index: number, event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  const movement = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    Home: 0,
    End: results.value.length - 1,
  }[event.key];
  if (movement === undefined) return;
  event.preventDefault();
  focusResult(movement);
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" && results.value.length) {
    event.preventDefault();
    focusResult(0);
  } else if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

function clear(): void {
  const slot = props.editor.activeSlot.value;
  if (slot !== null) props.editor.setSkill(slot, null);
}
</script>

<template>
  <section
    class="catalogue-workspace"
    aria-labelledby="catalogue-title"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <header class="workspace-heading">
      <div>
        <h2 id="catalogue-title">
          Choose skill {{ (editor.activeSlot.value ?? 0) + 1 }}
        </h2>
        <p>
          {{ editor.draft.value.professions[0] }}
          <template v-if="editor.draft.value.professions[1]">
            / {{ editor.draft.value.professions[1] }}
          </template>
          · PvE skills for this {{ editor.context.value === "hero" ? "hero" : "build" }}
        </p>
      </div>
      <button class="ui-button" @click="emit('close')">Done</button>
    </header>

    <div class="catalogue-tools">
      <label class="ui-input-group">
        <span aria-hidden="true">⌕</span>
        <span class="ui-sr-only">Search skills</span>
        <input
          ref="searchInput"
          v-model="search"
          type="search"
          placeholder="Search skill or attribute"
          @keydown="onSearchKeydown"
        >
      </label>
      <div class="ui-segment skill-filters" aria-label="Filter skills">
        <button :aria-pressed="filter === 'all'" @click="filter = 'all'">All</button>
        <button :aria-pressed="filter === 'primary'" @click="filter = 'primary'">
          {{ editor.draft.value.professions[0] }}
        </button>
        <button
          v-if="editor.draft.value.professions[1]"
          :aria-pressed="filter === 'secondary'"
          @click="filter = 'secondary'"
        >
          {{ editor.draft.value.professions[1] }}
        </button>
        <button :aria-pressed="filter === 'elite'" @click="filter = 'elite'">Elite</button>
        <button
          v-if="allowPlayerOnly"
          :aria-pressed="filter === 'player'"
          @click="filter = 'player'"
        >
          Player-only
        </button>
      </div>
      <span class="catalogue-count">{{ results.length }} skills</span>
    </div>

    <div class="catalogue-layout">
      <div class="skill-results" role="listbox" aria-label="Eligible PvE skills">
        <button
          v-for="(skill, index) in results"
          :key="skill.id"
          :ref="(element) => {
            if (element) resultButtons[index] = element as HTMLButtonElement;
          }"
          class="skill-result"
          role="option"
          :aria-selected="inspected?.id === skill.id"
          :disabled="duplicateSlot(skill) !== null"
          @focus="inspected = skill"
          @click="inspected = skill"
          @dblclick="useSkill(skill)"
          @keydown="onResultKeydown(index, $event)"
        >
          <span
            class="ui-slot skill"
            :data-elite="skill.elite ? '' : undefined"
            :data-profession="skill.profession"
          >
            <img v-if="skill.iconUrl" :src="skill.iconUrl" alt="" loading="lazy">
          </span>
          <span class="result-copy">
            <strong>{{ skill.name }}</strong>
            <small>
              {{ skill.profession ?? "PvE" }}
              <template v-if="skill.attribute"> · {{ label(skill.attribute) }}</template>
            </small>
          </span>
          <span class="result-mechanics">
            <span v-if="skill.elite" class="ui-chip" data-level="warn">Elite</span>
            <span v-if="skill.availability === 'player-only-pve'" class="ui-chip">Player</span>
            <small v-if="skill.energyCost">{{ skill.energyCost }}e</small>
            <small v-else-if="skill.adrenalineCost">{{ skill.adrenalineCost }}a</small>
            <small v-if="skill.activationSeconds">{{ skill.activationSeconds }}s cast</small>
            <small v-if="skill.rechargeSeconds">{{ skill.rechargeSeconds }}s recharge</small>
            <small v-if="duplicateSlot(skill) !== null">
              Slot {{ (duplicateSlot(skill) ?? 0) + 1 }}
            </small>
          </span>
        </button>
        <div v-if="!results.length" class="ui-empty">
          <strong>No eligible skills</strong>
          <p>Clear the search or choose another profession filter.</p>
          <button class="ui-button" @click="search = ''; filter = 'all'">
            Clear filters
          </button>
        </div>
      </div>

      <aside class="skill-inspector" aria-live="polite">
        <template v-if="inspected">
          <div class="inspector-identity">
            <span
              class="ui-slot skill"
              :data-elite="inspected.elite ? '' : undefined"
              :data-profession="inspected.profession"
            >
              <img v-if="inspected.iconUrl" :src="inspected.iconUrl" alt="">
            </span>
            <span>
              <strong>{{ inspected.name }}</strong>
              <small>
                {{ inspected.profession ?? "PvE" }}
                <template v-if="inspected.attribute"> · {{ label(inspected.attribute) }}</template>
              </small>
            </span>
          </div>
          <div class="mechanic-list">
            <span v-if="inspected.elite"><strong>Elite</strong><small>One per bar</small></span>
            <span v-if="inspected.availability === 'player-only-pve'">
              <strong>Player only</strong><small>Heroes cannot equip this skill</small>
            </span>
            <span v-if="inspected.energyCost"><strong>{{ inspected.energyCost }}</strong><small>Energy</small></span>
            <span v-if="inspected.adrenalineCost"><strong>{{ inspected.adrenalineCost }}</strong><small>Adrenaline</small></span>
            <span v-if="inspected.healthCost"><strong>{{ inspected.healthCost }}%</strong><small>Health</small></span>
            <span v-if="inspected.overcast"><strong>{{ inspected.overcast }}</strong><small>Overcast</small></span>
            <span v-if="inspected.activationSeconds"><strong>{{ inspected.activationSeconds }}s</strong><small>Activation</small></span>
            <span v-if="inspected.aftercastSeconds"><strong>{{ inspected.aftercastSeconds }}s</strong><small>Aftercast</small></span>
            <span v-if="inspected.rechargeSeconds"><strong>{{ inspected.rechargeSeconds }}s</strong><small>Recharge</small></span>
          </div>
          <div v-if="inspected.description" class="skill-description">
            <strong>Description</strong>
            <p>{{ inspected.description }}</p>
          </div>
          <p v-else class="description-unavailable">
            Description is unavailable from this installed client.
          </p>
          <p v-if="duplicateSlot(inspected) !== null" class="inspector-warning">
            Already used in slot {{ (duplicateSlot(inspected) ?? 0) + 1 }}.
          </p>
          <p v-else-if="eliteSlot(inspected) !== null" class="inspector-warning">
            This replaces {{ catalogue.get(editor.draft.value.skills[eliteSlot(inspected)!] as SkillId).name }}
            in slot {{ (eliteSlot(inspected) ?? 0) + 1 }}.
          </p>
          <button
            class="ui-button"
            data-variant="primary"
            :disabled="duplicateSlot(inspected) !== null"
            @click="useSkill(inspected)"
          >
            {{ eliteSlot(inspected) !== null ? "Replace current elite" : `Use in slot ${(editor.activeSlot.value ?? 0) + 1}` }}
          </button>
          <button class="ui-link" @click="clear">Clear slot</button>
        </template>
        <div v-else class="ui-empty">
          <strong>Select a skill</strong>
          <p>Mechanics and eligibility will appear here.</p>
        </div>
      </aside>
    </div>
  </section>
</template>
