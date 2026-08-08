<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { HEROES_IN_PANEL_ORDER } from "../../../../src/shared/builds/heroes";
import {
  heroId,
  mapTeamSlots,
  type TeamSlot,
} from "../../../../src/shared/builds/library";
import type { LibraryController } from "../use-library";
import {
  buildById,
  buildId,
  exclusiveTeamBuildIds,
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
const deleting = ref(false);
watch(
  () => props.team.id,
  () => {
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
const exclusiveBuildCount = computed(() =>
  props.controller.library.value
    ? exclusiveTeamBuildIds(props.controller.library.value, props.team.id).length
    : 0,
);
const currentApplyStatus = computed(() =>
  props.controller.applyStatus.value?.teamId === props.team.id
    ? props.controller.applyStatus.value
    : null,
);
const preview = (message: string, blocked = false) => ({ message, blocked });
const applyPreview = computed(() => {
  const party = props.controller.party.value;
  if (party.status !== "ready") {
    return preview("Waiting for a playable character and party observation.", true);
  }
  if (party.playRegion !== "pve") {
    return preview(party.playRegion === "pvp"
      ? "Core only in PvP and guild halls — Team Apply is unavailable."
      : "Core only until the current region is safely identified.", true);
  }
  if (party.inOutpost !== true) {
    return preview("Enter a PvE outpost to apply this team.", true);
  }

  const changes: string[] = [];
  if (props.team.mode !== "none") {
    if (party.hardMode === null) {
      return preview("Waiting for the current Normal or Hard Mode observation.", true);
    }
    const wantedHard = props.team.mode === "hard";
    if (party.hardMode !== wantedHard) {
      changes.push(`set ${wantedHard ? "Hard" : "Normal"} Mode`);
    }
  }
  const wantedHeroes = props.team.slots
    .slice(1)
    .flatMap((slot) => slot.hero === null ? [] : [slot.hero]);
  const presentHeroes = party.heroes.map(({ hero }) => hero);
  const leaving = presentHeroes.filter((hero) => !wantedHeroes.includes(hero));
  const joining = wantedHeroes.filter((hero) => !presentHeroes.includes(hero));
  if (leaving.length) changes.push(`remove ${leaving.length} ${leaving.length === 1 ? "hero" : "heroes"}`);
  if (joining.length) changes.push(`add ${joining.length} ${joining.length === 1 ? "hero" : "heroes"}`);

  let builds = 0;
  for (const [index, slot] of props.team.slots.entries()) {
    if (slot.build === null || !props.controller.library.value) continue;
    const build = buildById(props.controller.library.value, slot.build);
    const live = index === 0
      ? props.controller.party.value.player
      : props.controller.party.value.heroes.find(({ hero }) => hero === slot.hero);
    if (!build || !live) {
      builds += 1;
      continue;
    }
    const owner = index === 0
      ? "Your"
      : `${teamMemberLabel(slot.hero, index)}'s`;
    if (live.professions === null) {
      return preview(`${owner} professions have not been observed yet.`, true);
    }
    if (live.professions[0] !== build.professions[0]) {
      return preview(
        `${owner} assigned build is for ${build.professions[0]}, but the `
        + `observed primary is ${live.professions[0]}.`,
        true,
      );
    }
    const sameProfessions = live.professions[0] === build.professions[0]
      && live.professions[1] === build.professions[1];
    const sameSkills = live.skills !== null
      && live.skills.every((skill, skillIndex) => skill === build.skills[skillIndex]);
    const sameAttributes = live.attributes !== null
      && Object.entries(build.attributes).every(([name, rank]) =>
        live.attributes?.[name as keyof typeof live.attributes] === rank)
      && Object.entries(live.attributes).every(([name, rank]) =>
        build.attributes[name as keyof typeof build.attributes] === rank);
    const sameBehaviour = index === 0
      || ("behaviour" in live && slot.behaviour === live.behaviour);
    if (!sameProfessions || !sameSkills || !sameAttributes || !sameBehaviour) builds += 1;
  }
  if (builds) changes.push(`update ${builds} ${builds === 1 ? "build" : "builds"}`);
  return preview(
    changes.length
      ? `Preview: ${changes.join(" · ")}.`
      : "Team already matches the observed party.",
  );
});

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
    slots: mapTeamSlots(team.slots, (slot, slotIndex) =>
      slotIndex === index ? { ...slot, ...patch } : slot,
    ),
  }),
  label,
);

const chooseHero = (index: number, value: string) => {
  const hero = value ? heroId(Number(value)) : null;
  void updateSlot(index, { hero }, "Hero assignment updated");
};

const apply = () => props.controller.applyTeam(props.team);
</script>

<template>
  <article
    class="detail-view"
    aria-labelledby="team-title"
    :aria-busy="controller.saving.value"
  >
    <fieldset class="team-editor" :disabled="controller.saving.value">
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
            v-for="mode in (['none', 'normal', 'hard'] as const)"
            :key="mode"
            :aria-pressed="team.mode === mode"
            @click="controller.updateTeam(team.id, (draft) => ({ ...draft, mode }), `${mode} mode selected`)"
          >
            {{ mode === "none" ? "Keep current" : mode === "normal" ? "Normal" : "Hard" }}
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
          :class="{ 'team-slot--empty': !slot.build }"
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
              <option v-if="index === 0" value="">Player</option>
              <option value="fight">Fight</option>
              <option value="guard">Guard</option>
              <option value="avoid">Avoid</option>
            </select>
          </label>

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

    </div>

    <footer v-if="deleting" class="detail-actions detail-actions--explain delete-confirmation">
      <span>
        Delete “{{ team.name }}”? Shared builds are always kept.
      </span>
      <button class="ui-button" @click="deleting = false">Cancel</button>
      <button class="ui-button" data-variant="danger" @click="controller.deleteTeam(team.id)">
        Team only
      </button>
      <button
        v-if="exclusiveBuildCount > 0"
        class="ui-button"
        data-variant="danger"
        @click="controller.deleteTeam(team.id, true)"
      >
        Team + {{ exclusiveBuildCount }} {{ exclusiveBuildCount === 1 ? "build" : "builds" }}
      </button>
    </footer>
    <footer v-else class="detail-actions detail-actions--explain">
      <!--
        The reason replaces the description rather than joining it. Explaining
        what Apply would do, beside a control that cannot do it, is the sentence
        that made the button look ready in the first place.
      -->
      <span
        v-if="currentApplyStatus"
        class="apply-status"
        :data-tone="currentApplyStatus.tone"
        role="status"
        aria-live="polite"
      >
        {{ currentApplyStatus.message }}
      </span>
      <span v-else-if="controller.applyUnavailable" class="apply-unavailable">
        {{ controller.applyUnavailable }}
      </span>
      <span v-else>
        {{ applyPreview.message }}
      </span>
      <button class="ui-link" data-variant="danger" @click="deleting = true">Delete</button>
      <button
        class="ui-button"
        data-variant="primary"
        :disabled="
          controller.applyUnavailable !== null
            || applyPreview.blocked
            || configured === 0
            || team.slots.some((slot, index) => !assignmentValid(slot, index))
            || controller.saving.value
        "
        @click="apply"
      >
        {{ controller.saving.value ? "Applying…" : "Apply team" }}
      </button>
    </footer>
    </fieldset>
  </article>
</template>
