<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, ref, watch } from "vue";
import type { SkillId } from "../model";
import type { SkillCatalogue, SkillPresentation } from "../skill-catalog";
import type { BuildDraftController } from "../use-build-draft";
import type { SkillDropPreview } from "../skill-drop";

const props = defineProps<{
  editor: BuildDraftController;
  catalogue: SkillCatalogue;
  allowPlayerOnly: boolean;
  dropPreview?: SkillDropPreview | null;
}>();
const emit = defineEmits<{
  close: [];
  dragStart: [skill: SkillId];
  dragOver: [slot: number | null];
  dragEnd: [];
  place: [slot: number, skill: SkillId];
}>();

const search = ref("");
const filter = ref<"all" | "primary" | "secondary" | "elite" | "player">("all");
const inspected = ref<SkillPresentation | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const resultButtons = ref<HTMLButtonElement[]>([]);
const focusedResult = ref<number | null>(null);
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
  if (!values.length) focusedResult.value = null;
  else if (focusedResult.value !== null) {
    focusedResult.value = Math.min(focusedResult.value, values.length - 1);
  }
});
function duplicateSlot(skill: SkillPresentation): number | null {
  const slot = props.editor.draft.value.skills.findIndex((id) => id === skill.id);
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
  if (slot === null) return;
  emit("place", slot, skill.id);
  inspected.value = skill;
}

type PointerSkillDrag = {
  pointerId: number;
  skill: SkillPresentation;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  target: number | null;
  source: HTMLElement;
};

const pointerDrag = ref<PointerSkillDrag | null>(null);

function slotAt(x: number, y: number): number | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(
    "[data-skill-bar] [data-skill-slot]",
  );
  const slot = Number(element?.dataset.skillSlot);
  return Number.isInteger(slot) && slot >= 0 && slot < 8 ? slot : null;
}

function beginPointerDrag(event: PointerEvent, skill: SkillPresentation): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  pointerDrag.value = {
    pointerId: event.pointerId,
    skill,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    started: false,
    target: null,
    source: event.currentTarget as HTMLElement,
  };
}

function movePointerDrag(event: PointerEvent): void {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (
    !drag.started
    && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5
  ) return;
  event.preventDefault();
  if (!drag.started) {
    drag.started = true;
    emit("dragStart", drag.skill.id);
  }
  drag.x = event.clientX;
  drag.y = event.clientY;
  const target = slotAt(event.clientX, event.clientY);
  if (target !== drag.target) {
    drag.target = target;
    emit("dragOver", target);
  }
}

function finishPointerDrag(event: PointerEvent, place: boolean): void {
  const drag = pointerDrag.value;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const target = event.currentTarget as HTMLElement;
  const started = drag.started;
  if (place && started && drag.target !== null) {
    emit("place", drag.target, drag.skill.id);
  }
  pointerDrag.value = null;
  if (started) {
    emit("dragOver", null);
    emit("dragEnd");
  }
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId);
  }
}

function cancelPointerDrag(): boolean {
  const drag = pointerDrag.value;
  if (!drag?.started) return false;
  pointerDrag.value = null;
  emit("dragOver", null);
  emit("dragEnd");
  if (drag.source.hasPointerCapture(drag.pointerId)) {
    drag.source.releasePointerCapture(drag.pointerId);
  }
  return true;
}

function closeOrCancel(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (!cancelPointerDrag()) emit("close");
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
    closeOrCancel(event);
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
          :tabindex="focusedResult === index || (focusedResult === null && index === 0) ? 0 : -1"
          :aria-disabled="duplicateSlot(skill) !== null"
          :data-unavailable="duplicateSlot(skill) !== null ? '' : undefined"
          @focus="focusedResult = index; inspected = skill"
          @click="inspected = skill"
          @dblclick="useSkill(skill)"
          @keydown="onResultKeydown(index, skill, $event)"
        >
          <span
            class="ui-slot skill catalogue-drag-handle"
            :data-elite="skill.elite ? '' : undefined"
            :data-profession="skill.profession"
            :data-icon-missing="skill.iconUrl ? undefined : ''"
            :data-pointer-dragging="pointerDrag?.skill.id === skill.id ? '' : undefined"
            :title="`Drag ${skill.name} to a skill slot`"
            @pointerdown="beginPointerDrag($event, skill)"
            @pointermove="movePointerDrag"
            @pointerup="finishPointerDrag($event, true)"
            @pointercancel="finishPointerDrag($event, false)"
            @lostpointercapture="finishPointerDrag($event, false)"
          >
            <img v-if="skill.iconUrl" :src="skill.iconUrl" alt="" loading="lazy">
            <span v-else class="skill-fallback" aria-hidden="true">
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
              :data-icon-missing="inspected.iconUrl ? undefined : ''"
            >
              <img v-if="inspected.iconUrl" :src="inspected.iconUrl" alt="">
              <span v-else class="skill-fallback" aria-hidden="true">
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
    <Teleport to="body">
      <div
        v-if="pointerDrag?.started"
        class="catalogue-pointer-preview"
        :style="{
          transform: `translate3d(${pointerDrag.x + 14}px, ${pointerDrag.y + 14}px, 0)`,
        }"
        aria-hidden="true"
      >
        <span
          class="ui-slot skill"
          :data-elite="pointerDrag.skill.elite ? '' : undefined"
          :data-profession="pointerDrag.skill.profession"
          :data-icon-missing="pointerDrag.skill.iconUrl ? undefined : ''"
        >
          <img v-if="pointerDrag.skill.iconUrl" :src="pointerDrag.skill.iconUrl" alt="">
          <span v-else class="skill-fallback" aria-hidden="true">
            {{ pointerDrag.skill.name.split(" ").map((part) => part[0]).join("").slice(0, 3) }}
          </span>
        </span>
        <span class="catalogue-pointer-copy">
          <strong>{{ pointerDrag.skill.name }}</strong>
          <small v-if="dropPreview">{{ dropPreview.label }}</small>
        </span>
      </div>
    </Teleport>
  </section>
</template>
