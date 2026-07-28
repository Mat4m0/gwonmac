<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { HEROES_IN_PANEL_ORDER } from "../../../../src/shared/builds/heroes";
import {
  heroId,
  type SkillSlotIndex,
  type TeamSlot,
} from "../../../../src/shared/builds/library";
import type { LibraryController } from "../use-library";
import {
  buildById,
  buildId,
  teamMemberLabel,
  type Team,
} from "../model";
import SkillBar from "./SkillBar.vue";
import TagEditor from "./TagEditor.vue";

const props = defineProps<{
  team: Team;
  controller: LibraryController;
}>();
const emit = defineEmits<{
  editBuild: [id: string, context: "player" | "hero"];
}>();
const name = ref(props.team.name);
const notes = ref(props.team.notes);
const expandedSlot = ref<number | null>(null);
const deleting = ref(false);
watch(
  () => props.team.id,
  () => {
    expandedSlot.value = null;
    deleting.value = false;
  },
);
watch(
  () => props.team.name,
  (next) => {
    name.value = next;
  },
);
watch(
  () => props.team.notes,
  (next) => {
    notes.value = next;
  },
);

const usedHeroes = computed(() =>
  new Set(props.team.slots.flatMap((slot) => slot.hero === null ? [] : [slot.hero])),
);
const configured = computed(() =>
  props.team.slots.filter(
    (slot, index) => slot.build !== null || (index > 0 && slot.hero !== null),
  ).length,
);

const assignmentValid = (slot: TeamSlot, index: number): boolean => {
  if (slot.build === null || !props.controller.library.value) return true;
  const build = buildById(props.controller.library.value, slot.build);
  return build
    ? props.controller.validate(build, index === 0 ? "player" : "hero").valid
    : false;
};

const rename = () => {
  if (!name.value.trim() || name.value.trim() === props.team.name) return;
  void props.controller.updateTeam(
    props.team.id,
    (team) => {
      return { ...team, name: name.value.trim() };
    },
    "Team renamed",
  );
};

const updateSlot = (
  index: number,
  patch: Partial<TeamSlot>,
  label: string,
) => props.controller.updateTeam(
  props.team.id,
  (team) => ({
    ...team,
    slots: team.slots.map((slot, slotIndex) =>
      slotIndex === index ? { ...slot, ...patch } : slot,
    ) as unknown as Team["slots"],
  }),
  label,
);

const chooseHero = (index: number, value: string) => {
  const hero = value ? heroId(Number(value)) : null;
  void updateSlot(index, { hero }, "Hero assignment updated");
};

const toggleDisabled = (index: number, skillSlot: SkillSlotIndex) => {
  const slot = props.team.slots[index];
  if (!slot) return;
  const disabled = slot.disabled.includes(skillSlot)
    ? slot.disabled.filter((value) => value !== skillSlot)
    : [...slot.disabled, skillSlot].sort((left, right) => left - right);
  void updateSlot(index, { disabled }, "Hero skill automation updated");
};

const apply = () => props.controller.applyTeam(props.team);
</script>

<template>
  <article class="detail-view" aria-labelledby="team-title">
    <header class="detail-header">
      <div class="detail-title-line">
        <div class="ui-mark profession-mark">8</div>
        <div class="title-editor">
          <label class="ui-sr-only" for="team-name">Team name</label>
          <input
            id="team-name"
            v-model="name"
            class="ui-input title-input"
            @change="rename"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <p>{{ configured }} of 8 slots configured</p>
        </div>
        <button
          class="ui-button favourite" data-icon
          :aria-label="team.favourite ? 'Remove from favourites' : 'Add to favourites'"
          :aria-pressed="team.favourite"
          @click="controller.updateTeam(team.id, (draft) => ({ ...draft, favourite: !draft.favourite }), 'Favourite updated')"
        >
          ★
        </button>
      </div>
      <div class="team-controls">
        <div class="ui-segment" aria-label="Difficulty">
          <button
            v-for="mode in (['normal', 'hard'] as const)"
            :key="mode"
            :aria-pressed="team.mode === mode"
            @click="controller.updateTeam(team.id, (draft) => ({ ...draft, mode }), `${mode} mode selected`)"
          >
            {{ mode === "hard" ? "Hard" : "Normal" }}
          </button>
        </div>
        <TagEditor
          :tags="team.tags"
          :options="controller.tags.value"
          label="Team tags"
          @update="controller.setTags({ kind: 'team', id: team.id }, $event)"
        />
      </div>
    </header>

    <div class="ui-banner">
      <span>
        Teams reference library builds. Edit a shared bar once, or fork it for
        only this team.
      </span>
    </div>

    <div class="detail-scroll team-scroll">
      <div class="section-heading">
        <div>
          <h2 id="team-title">Team composition</h2>
          <p>Hero, build, and behavior remain visible in one scan.</p>
        </div>
        <button class="ui-button" @click="controller.duplicateTeam(team.id)">
          Duplicate team
        </button>
      </div>

      <ol class="team-slots">
        <li
          v-for="(slot, index) in team.slots"
          :key="`${slot.hero}-${index}`"
          :class="{ 'team-slot--empty': !slot.build, 'team-slot--expanded': expandedSlot === index }"
          :data-invalid="!assignmentValid(slot, index) ? '' : undefined"
        >
          <span class="slot-number">{{ index + 1 }}</span>
          <div class="hero-cell">
            <span
              class="ui-mark hero-avatar"
              :data-profession="slot.build && controller.library.value
                ? buildById(controller.library.value, slot.build)?.professions[0]
                : undefined"
            >
              {{ teamMemberLabel(slot.hero, index)[0] }}
            </span>
            <span v-if="index === 0">
              <strong>You</strong>
              <small>
                {{ slot.build && controller.library.value
                  ? buildById(controller.library.value, slot.build)?.professions.join(" / ")
                  : "No build" }}
              </small>
            </span>
            <label v-else class="hero-picker">
              <span class="ui-sr-only">Hero in slot {{ index + 1 }}</span>
              <select
                class="ui-select"
                :value="slot.hero ?? ''"
                @change="chooseHero(index, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Choose hero</option>
                <option
                  v-for="hero in HEROES_IN_PANEL_ORDER"
                  :key="hero.id"
                  :value="hero.id"
                  :disabled="usedHeroes.has(hero.id) && hero.id !== slot.hero"
                >
                  {{ teamMemberLabel(hero.id, index) }}
                </option>
              </select>
              <small>
                {{ slot.build && controller.library.value
                  ? buildById(controller.library.value, slot.build)?.professions.join(" / ")
                  : "No build" }}
              </small>
            </label>
          </div>

          <label class="build-picker">
            <span class="ui-sr-only">Build for {{ teamMemberLabel(slot.hero, index) }}</span>
            <select class="ui-select"
              :value="slot.build ?? ''"
              @change="updateSlot(
                index,
                { build: ($event.target as HTMLSelectElement).value
                  ? buildId(($event.target as HTMLSelectElement).value)
                  : null },
                `${teamMemberLabel(slot.hero, index)}'s build updated`,
              )"
            >
              <option value="">No build</option>
              <option
                v-for="build in controller.library.value?.builds"
                :key="build.id"
                :value="build.id"
              >
                {{ build.name }}
              </option>
            </select>
            <button
              v-if="slot.build"
              class="ui-link"
              @click="emit('editBuild', slot.build, index === 0 ? 'player' : 'hero')"
            >
              Open build
            </button>
            <small v-if="!assignmentValid(slot, index)" class="assignment-error">
              This build has skills this member cannot equip.
            </small>
          </label>

          <SkillBar
            v-if="slot.build && controller.library.value"
            :skills="buildById(controller.library.value, slot.build)?.skills ?? []"
            :catalogue="controller.skills"
            compact
          />
          <span v-else class="empty-bar">Empty slot</span>

          <label class="behavior-picker">
            <span class="ui-sr-only">Behavior for {{ teamMemberLabel(slot.hero, index) }}</span>
            <select class="ui-select"
              :value="slot.behaviour ?? ''"
              :disabled="index === 0 || slot.hero === null"
              @change="updateSlot(
                index,
                { behaviour: ($event.target as HTMLSelectElement).value as typeof slot.behaviour },
                `${teamMemberLabel(slot.hero, index)}'s behavior updated`,
              )"
            >
              <option value="">Player</option>
              <option value="fight">Fight</option>
              <option value="guard">Guard</option>
              <option value="avoid">Avoid</option>
            </select>
          </label>

          <button
            v-if="index > 0"
            class="ui-button slot-settings"
            data-icon
            :disabled="slot.hero === null"
            :aria-expanded="expandedSlot === index"
            :aria-label="`Hero controls for ${teamMemberLabel(slot.hero, index)}`"
            @click="expandedSlot = expandedSlot === index ? null : index"
          >
            ⚙
          </button>

          <div v-if="expandedSlot === index && slot.hero !== null" class="slot-options">
            <label class="ui-check">
              <input
                type="checkbox"
                :checked="slot.panel"
                @change="updateSlot(index, { panel: !slot.panel }, 'Hero panel preference updated')"
              >
              <span>Keep this hero’s skill panel open</span>
            </label>
            <div v-if="slot.build && controller.library.value" class="disabled-skills">
              <span>Hero may use</span>
              <button
                v-for="(skill, skillIndex) in buildById(controller.library.value, slot.build)?.skills ?? []"
                :key="`${skill}-${skillIndex}`"
                class="ui-chip"
                :aria-pressed="!slot.disabled.includes(skillIndex as SkillSlotIndex)"
                :title="skill === null ? 'Empty skill slot' : controller.skills.get(skill).name"
                :disabled="skill === null"
                @click="toggleDisabled(index, skillIndex as SkillSlotIndex)"
              >
                {{ skillIndex + 1 }}
                <span>{{ skill === null ? "Empty" : controller.skills.get(skill).name }}</span>
              </button>
            </div>
          </div>
        </li>
      </ol>

      <section class="notes-section team-notes">
        <label for="team-notes">Team notes</label>
        <textarea
          id="team-notes"
          v-model="notes"
          class="ui-textarea"
          rows="3"
          placeholder="Consumables, route notes, substitutions…"
          @change="controller.updateTeam(team.id, (draft) => ({ ...draft, notes }), 'Team notes saved')"
        />
      </section>

      <section v-if="deleting" class="inline-action inline-action--danger">
        <div>
          <h2>Delete {{ team.name }}?</h2>
          <p>The builds stay in the library. Only this composition is removed.</p>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="deleting = false">Keep team</button>
          <button class="ui-button" data-variant="danger" @click="controller.deleteTeam(team.id)">
            Delete team
          </button>
        </div>
      </section>
    </div>

    <footer class="detail-actions detail-actions--explain">
      <span>Applies the roster, difficulty, builds, behavior, disabled skills, and pinned hero panels.</span>
      <button class="ui-link" data-variant="danger" @click="deleting = true">Delete</button>
      <button
        class="ui-button"
        data-variant="primary"
        :disabled="configured === 0 || controller.saving.value"
        @click="apply"
      >
        {{ controller.saving.value ? "Applying…" : "Apply team" }}
      </button>
    </footer>
  </article>
</template>
