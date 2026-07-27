<script setup lang="ts">
import { ref, watch } from "vue";
import type { LibraryController } from "../use-library";
import { buildById, type Team } from "../model";
import SkillBar from "./SkillBar.vue";

const props = defineProps<{
  team: Team;
  controller: LibraryController;
}>();
const name = ref(props.team.name);
watch(
  () => props.team,
  (team) => {
    name.value = team.name;
  },
);

const rename = () => {
  if (!name.value.trim() || name.value.trim() === props.team.name) return;
  void props.controller.updateTeam(
    props.team.id,
    (team) => {
      team.name = name.value.trim();
    },
    "Team renamed",
  );
};
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
          <p>{{ team.slots.filter((slot) => slot.buildId).length }} of 8 slots configured</p>
        </div>
        <button
          class="ui-button favourite" data-icon
          :aria-label="team.favourite ? 'Remove from favourites' : 'Add to favourites'"
          :aria-pressed="team.favourite"
          @click="controller.updateTeam(team.id, (draft) => { draft.favourite = !draft.favourite }, 'Favourite updated')"
        >
          ★
        </button>
      </div>
      <div class="team-controls">
        <div class="ui-segment" aria-label="Difficulty">
          <button
            v-for="mode in (['Normal', 'Hard'] as const)"
            :key="mode"
            :aria-pressed="team.mode === mode"
            @click="controller.updateTeam(team.id, (draft) => { draft.mode = mode }, `${mode} mode selected`)"
          >
            {{ mode }}
          </button>
        </div>
        <div class="tag-row">
          <span v-for="value in team.tags" :key="value" class="ui-chip">{{ value }}</span>
        </div>
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
          :class="{ 'team-slot--empty': !slot.buildId }"
        >
          <span class="slot-number">{{ index + 1 }}</span>
          <div class="hero-cell">
            <span class="ui-mark hero-avatar" :data-profession="slot.profession">
              {{ slot.hero === "You" ? "Y" : slot.hero[0] }}
            </span>
            <span>
              <strong>{{ slot.hero }}</strong>
              <small>{{ slot.profession }}</small>
            </span>
          </div>

          <label class="build-picker">
            <span class="ui-sr-only">Build for {{ slot.hero }}</span>
            <select class="ui-select"
              :value="slot.buildId ?? ''"
              @change="controller.updateTeam(
                team.id,
                (draft) => {
                  draft.slots[index]!.buildId = ($event.target as HTMLSelectElement).value || null;
                },
                `${slot.hero}'s build updated`,
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
              v-if="slot.buildId"
              class="ui-link"
              @click="controller.select({ kind: 'build', id: slot.buildId })"
            >
              Open build
            </button>
          </label>

          <SkillBar
            v-if="slot.buildId && controller.library.value"
            :skills="buildById(controller.library.value, slot.buildId)?.skills ?? []"
            compact
          />
          <span v-else class="empty-bar">Empty slot</span>

          <label class="behavior-picker">
            <span class="ui-sr-only">Behavior for {{ slot.hero }}</span>
            <select class="ui-select"
              :value="slot.behavior"
              @change="controller.updateTeam(
                team.id,
                (draft) => {
                  draft.slots[index]!.behavior = ($event.target as HTMLSelectElement).value as typeof slot.behavior;
                },
                `${slot.hero}'s behavior updated`,
              )"
            >
              <option>Fight</option>
              <option>Guard</option>
              <option>Avoid</option>
            </select>
          </label>
        </li>
      </ol>
    </div>

    <footer class="detail-actions detail-actions--explain">
      <span>The demo simulates publication. GWonMac never presses Load for you.</span>
      <button class="ui-button" data-variant="primary" disabled>Prepare team handoff</button>
    </footer>
  </article>
</template>
