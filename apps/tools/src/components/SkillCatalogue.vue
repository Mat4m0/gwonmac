<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUpdate,
  ref,
  watch,
} from "vue";
import type { SkillCatalogue, SkillPresentation } from "../skill-catalog";
import type { BuildDraftController } from "../use-build-draft";
import type { SkillUnlockObservation } from "../../../../src/shared/builds/live-party";
import { ATTRIBUTES } from "../../../../src/shared/builds/heroes";
import { presentSkillPlacement, type SkillPlacementPresentation } from "../skill-drop";
import type { SkillDragSession } from "../use-skill-drag-session";
import {
  loadCataloguePreferences,
  saveCataloguePreferences,
} from "../catalogue-preferences";

const props = defineProps<{
  editor: BuildDraftController;
  catalogue: SkillCatalogue;
  allowPlayerOnly: boolean;
  unlocks: SkillUnlockObservation | null;
  unlockScope: "account" | "character";
  dragSession: SkillDragSession;
}>();
const emit = defineEmits<{
  close: [];
  place: [slot: number, skill: SkillPresentation["id"]];
}>();

const search = ref("");
const filter = ref<"all" | "primary" | "secondary" | "elite" | "player">("all");
const savedPreferences = loadCataloguePreferences();
const placeableOnly = ref(savedPreferences.placeableOnly);
const unlockedOnly = ref(savedPreferences.unlockedOnly);
const inspected = ref<SkillPresentation | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const resultButtons = ref<HTMLButtonElement[]>([]);
const focusedResult = ref<number | null>(null);
const collapsedGroups = ref(new Set<string>());
// The `:ref` callback below only ever writes, so narrowing a search left the
// buttons for every index ever rendered — detached subtrees, each holding a
// decoded icon — and `focusResult` read a stale length off the end.
onBeforeUpdate(() => {
  resultButtons.value = [];
});

const label = (value: string) => value.replace(/([a-z])([A-Z])/gu, "$1 $2");
const current = computed(() => {
  const slot = props.editor.activeSlot.value;
  if (slot === null) return null;
  const id = props.editor.draft.value.skills[slot];
  return id == null ? null : props.catalogue.get(id);
});
const unlocksAvailable = computed(() =>
  props.unlocks !== null && props.unlocks.knownThrough > 0
);
const effectiveUnlockedOnly = computed(() => unlockedOnly.value && unlocksAvailable.value);

const results = computed(() => {
  const [primary, secondary] = props.editor.draft.value.professions;
  const needle = search.value.trim().toLocaleLowerCase();
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
      if (placeableOnly.value && placement(skill)?.blocked) return false;
      if (
        effectiveUnlockedOnly.value
        && !props.unlocks?.unlocked.has(skill.id)
      ) return false;
      return needle.length === 0
        || skill.name.toLocaleLowerCase().includes(needle)
        || skill.attribute?.toLocaleLowerCase().includes(needle);
    })
    .sort((left, right) => {
      if ((left.attribute === null) !== (right.attribute === null)) {
        return left.attribute === null ? 1 : -1;
      }
      if (left.profession !== right.profession) {
        if (left.profession === primary) return -1;
        if (right.profession === primary) return 1;
        if (left.profession === secondary) return -1;
        if (right.profession === secondary) return 1;
      }
      if (left.attribute !== right.attribute) {
        return (left.attribute === null ? Number.MAX_SAFE_INTEGER : ATTRIBUTES[left.attribute].id)
          - (right.attribute === null ? Number.MAX_SAFE_INTEGER : ATTRIBUTES[right.attribute].id);
      }
      return left.name.localeCompare(right.name);
    });
});

interface SkillGroup {
  readonly key: string;
  readonly label: string;
  readonly skills: readonly SkillPresentation[];
}

const groups = computed<readonly SkillGroup[]>(() => {
  const grouped = new Map<string, SkillPresentation[]>();
  for (const skill of results.value) {
    const key = skill.attribute ?? "no-attribute";
    const group = grouped.get(key);
    if (group) group.push(skill);
    else grouped.set(key, [skill]);
  }
  return [...grouped].map(([key, skills]) => ({
    key,
    label: key === "no-attribute" ? "No attribute" : label(key),
    skills,
  }));
});
const searching = computed(() => search.value.trim().length > 0);
const groupExpanded = (group: SkillGroup): boolean =>
  searching.value || !collapsedGroups.value.has(group.key);
const groupSkills = (group: SkillGroup): readonly SkillPresentation[] => {
  if (groupExpanded(group)) return group.skills;
  const selected = group.skills.find((skill) => skill.id === inspected.value?.id);
  return selected ? [selected] : [];
};
const visibleResults = computed(() => groups.value.flatMap(groupSkills));
const visibleIndex = computed(() => new Map(
  visibleResults.value.map((skill, index) => [skill.id, index]),
));
const groupId = (group: SkillGroup): string => `skill-group-${group.key}`;
const toggleGroup = (group: SkillGroup): void => {
  const next = new Set(collapsedGroups.value);
  if (next.has(group.key)) next.delete(group.key);
  else next.add(group.key);
  collapsedGroups.value = next;
};
const collapseAll = (): void => {
  collapsedGroups.value = new Set(groups.value.map((group) => group.key));
};
const expandAll = (): void => {
  collapsedGroups.value = new Set();
};

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
    const inspectorHadFocus = document.activeElement?.closest(".skill-inspector") != null;
    inspected.value = values[0] ?? null;
    if (inspectorHadFocus) void nextTick(() => searchInput.value?.focus());
  }
});
watch(visibleResults, (values) => {
  if (!values.length) focusedResult.value = null;
  else if (focusedResult.value !== null) {
    focusedResult.value = Math.min(focusedResult.value, values.length - 1);
  }
});
watch([placeableOnly, unlockedOnly], ([nextPlaceable, nextUnlocked]) => {
  saveCataloguePreferences({
    placeableOnly: nextPlaceable,
    unlockedOnly: nextUnlocked,
  });
});
function placement(skill: SkillPresentation): SkillPlacementPresentation | null {
  const active = props.editor.activeSlot.value;
  return active === null ? null : presentSkillPlacement(
    skill.id,
    props.editor.previewSkillPlacement(active, skill.id, props.catalogue),
    props.catalogue,
  );
}

function useSkill(skill: SkillPresentation): void {
  const slot = props.editor.activeSlot.value;
  if (slot === null) return;
  if (placement(skill)?.blocked) {
    inspected.value = skill;
  }
  emit("place", slot, skill.id);
  inspected.value = skill;
}

function closeOrCancel(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (!props.dragSession.cancel()) emit("close");
}

function focusResult(index: number): void {
  const buttons = resultButtons.value;
  if (!buttons.length) return;
  const next = Math.max(0, Math.min(buttons.length - 1, index));
  focusedResult.value = next;
  buttons[next]?.focus();
}

function onResultKeydown(
  index: number,
  skill: SkillPresentation,
  event: KeyboardEvent,
): void {
  if (event.key === "Escape") {
    closeOrCancel(event);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    useSkill(skill);
    return;
  }
  const movement = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    Home: 0,
    End: visibleResults.value.length - 1,
  }[event.key];
  if (movement === undefined) return;
  event.preventDefault();
  focusResult(movement);
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" && visibleResults.value.length) {
    event.preventDefault();
    focusResult(0);
  } else if (event.key === "Escape") {
    closeOrCancel(event);
  }
}

function clear(): void {
  const slot = props.editor.activeSlot.value;
  if (slot !== null) props.editor.setSkill(slot, null);
}

function recoverEmptyResults(): void {
  if (effectiveUnlockedOnly.value) unlockedOnly.value = false;
  else if (placeableOnly.value) placeableOnly.value = false;
  else {
    search.value = "";
    filter.value = "all";
  }
}

const unlockFilterHelp = computed(() => unlocksAvailable.value
  ? props.unlockScope === "account"
    ? "Show skills unlocked for this account and usable by heroes."
    : "Show skills learned by the current Guild Wars character."
  : "Skill unlocks are unavailable until Guild Wars is in a supported PvE area."
);

function hideBrokenIcon(event: Event): void {
  const image = event.currentTarget;
  if (!(image instanceof HTMLImageElement)) return;
  image.closest(".skill")?.setAttribute("data-icon-missing", "");
  image.remove();
}
</script>

<template>
  <section
    class="catalogue-workspace"
    aria-labelledby="catalogue-title"
    @keydown.esc="closeOrCancel"
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
      <div class="catalogue-heading-actions">
        <button
          class="ui-chip catalogue-placeable"
          :aria-pressed="placeableOnly"
          aria-label="Show placeable skills only"
          title="Hide skills that cannot be placed in this slot."
          @click="placeableOnly = !placeableOnly"
        >
          Placeable
        </button>
        <button
          class="ui-chip catalogue-unlocked"
          :aria-pressed="unlockedOnly"
          aria-label="Show unlocked skills only"
          :disabled="!unlocksAvailable"
          :title="unlockFilterHelp"
          @click="unlockedOnly = !unlockedOnly"
        >
          Unlocked
        </button>
        <button class="ui-button" @click="emit('close')">Done</button>
      </div>
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
      <span class="catalogue-count">
        {{ results.length }} {{ results.length === 1 ? "skill" : "skills" }}
      </span>
    </div>

    <div class="catalogue-layout">
      <div class="skill-results" aria-label="Eligible PvE skills by attribute">
        <div v-if="groups.length >= 3" class="catalogue-group-actions" aria-label="Attribute sections">
          <button class="ui-link" type="button" @click="collapseAll">Collapse all</button>
          <span aria-hidden="true">·</span>
          <button class="ui-link" type="button" @click="expandAll">Expand all</button>
        </div>
        <section
          v-for="group in groups"
          :key="group.key"
          class="skill-group"
          :aria-labelledby="`${groupId(group)}-heading`"
        >
          <button
            :id="`${groupId(group)}-heading`"
            class="skill-group-heading"
            type="button"
            :aria-controls="groupId(group)"
            :aria-expanded="groupExpanded(group)"
            @click="toggleGroup(group)"
          >
            <span class="skill-group-chevron" aria-hidden="true">⌄</span>
            <span>{{ group.label }}</span>
            <span class="skill-group-count">{{ group.skills.length }}</span>
          </button>
          <div :id="groupId(group)" class="skill-group-results">
            <button
              v-for="skill in groupSkills(group)"
              :key="skill.id"
              :ref="(element) => {
                const index = visibleIndex.get(skill.id);
                if (element && index !== undefined) resultButtons[index] = element as HTMLButtonElement;
              }"
              class="skill-result ui-row"
              :aria-pressed="inspected?.id === skill.id"
              :tabindex="focusedResult === visibleIndex.get(skill.id)
                || (focusedResult === null && visibleIndex.get(skill.id) === 0) ? 0 : -1"
              :aria-disabled="placement(skill)?.blocked || undefined"
              :data-unavailable="placement(skill)?.blocked ? '' : undefined"
              @focus="focusedResult = visibleIndex.get(skill.id) ?? 0; inspected = skill"
              @click="inspected = skill"
              @dblclick="useSkill(skill)"
              @keydown="onResultKeydown(visibleIndex.get(skill.id) ?? 0, skill, $event)"
            >
              <span
                class="ui-slot skill catalogue-drag-handle"
                :data-elite="skill.elite ? '' : undefined"
                :data-profession="skill.profession"
                :data-icon-missing="skill.iconUrl ? undefined : ''"
                :data-pointer-dragging="dragSession.active.value?.source.mode === 'catalogue' && dragSession.active.value.source.skill === skill.id && dragSession.active.value.started ? '' : undefined"
                :title="`Drag ${skill.name} to a skill slot`"
                @pointerdown="dragSession.begin($event, { mode: 'catalogue', skill: skill.id })"
                @pointermove="dragSession.move($event)"
                @pointerup="dragSession.finish($event, true)"
                @pointercancel="dragSession.finish($event, false)"
                @lostpointercapture="dragSession.finish($event, false)"
              >
                <img
                  v-if="skill.iconUrl"
                  :src="skill.iconUrl"
                  alt=""
                  draggable="false"
                  loading="lazy"
                  @error="hideBrokenIcon"
                >
                <span class="skill-fallback" aria-hidden="true">
                  {{ skill.name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
                </span>
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
                <small v-if="placement(skill)?.blocked">
                  {{ placement(skill)?.actionLabel }}
                </small>
              </span>
            </button>
          </div>
        </section>
        <div v-if="!results.length" class="ui-empty">
          <strong>
            {{ effectiveUnlockedOnly
              ? "No unlocked skills"
              : placeableOnly ? "No placeable skills" : "No eligible skills" }}
          </strong>
          <p v-if="effectiveUnlockedOnly">
            No matching skill is unlocked for this
            {{ unlockScope === "account" ? "account" : "character" }}.
          </p>
          <p v-else-if="placeableOnly">
            No matching skill can be placed in this slot. Show all skills to inspect why.
          </p>
          <p v-else>Clear the search or choose another profession filter.</p>
          <button class="ui-button" @click="recoverEmptyResults">
            {{ effectiveUnlockedOnly || placeableOnly ? "Show all skills" : "Clear filters" }}
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
              :data-icon-missing="inspected.iconUrl ? undefined : ''"
            >
              <img
                v-if="inspected.iconUrl"
                :src="inspected.iconUrl"
                alt=""
                draggable="false"
                @error="hideBrokenIcon"
              >
              <span class="skill-fallback" aria-hidden="true">
                {{ inspected.name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
              </span>
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
          <p v-if="placement(inspected)?.explanation" class="inspector-warning">
            {{ placement(inspected)?.explanation }}
          </p>
          <button
            class="ui-button"
            data-variant="primary"
            :aria-disabled="placement(inspected)?.blocked || undefined"
            @click="useSkill(inspected)"
          >
            {{ placement(inspected)?.actionLabel }}
          </button>
          <button class="ui-link" @click="clear">Clear slot</button>
        </template>
        <div v-else class="ui-empty">
          <strong>Select a skill</strong>
          <p>Mechanics and eligibility will appear here.</p>
        </div>
      </aside>
    </div>
    <div
      v-if="dragSession.active.value?.started && dragSession.active.value.source.mode === 'catalogue'"
      class="catalogue-pointer-preview"
      :style="{
        left: `${dragSession.active.value.x + 14}px`,
        top: `${dragSession.active.value.y + 14}px`,
      }"
      aria-hidden="true"
    >
        <span
          class="ui-slot skill"
          :data-elite="catalogue.get(dragSession.active.value.source.skill).elite ? '' : undefined"
          :data-profession="catalogue.get(dragSession.active.value.source.skill).profession"
          :data-icon-missing="catalogue.get(dragSession.active.value.source.skill).iconUrl ? undefined : ''"
        >
          <img
            v-if="catalogue.get(dragSession.active.value.source.skill).iconUrl"
            :src="catalogue.get(dragSession.active.value.source.skill).iconUrl!"
            alt=""
            draggable="false"
            @error="hideBrokenIcon"
          >
          <span class="skill-fallback" aria-hidden="true">
            {{ catalogue.get(dragSession.active.value.source.skill).name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
          </span>
        </span>
        <span class="catalogue-pointer-copy">
          <strong>{{ catalogue.get(dragSession.active.value.source.skill).name }}</strong>
          <small>{{ dragSession.preview.value?.label ?? "Choose a skill slot" }}</small>
        </span>
    </div>
  </section>
</template>
