<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { LibraryController } from "../use-library";
import { buildDifference, type Build } from "../model";
import SkillBar from "./SkillBar.vue";

const props = defineProps<{
  build: Build;
  controller: LibraryController;
}>();
const emit = defineEmits<{
  openTeam: [id: string];
}>();

const name = ref(props.build.name);
const notes = ref(props.build.notes);
const forking = ref(false);
const deleting = ref(false);
const rebind = ref<string[]>([]);

watch(
  () => props.build,
  (build) => {
    name.value = build.name;
    notes.value = build.notes;
    forking.value = false;
    deleting.value = false;
    rebind.value = [];
  },
);

const usage = computed(() => props.controller.usage(props.build.id));
const parent = computed(() =>
  props.build.parent
    ? props.controller.library.value?.builds.find(
        (build) => build.id === props.build.parent,
      )
    : undefined,
);

const commitName = () => {
  if (name.value.trim() && name.value.trim() !== props.build.name) {
    void props.controller.renameBuild(props.build.id, name.value);
  }
};

const toggleTeam = (id: string) => {
  rebind.value = rebind.value.includes(id)
    ? rebind.value.filter((value) => value !== id)
    : [...rebind.value, id];
};
</script>

<template>
  <article class="detail-view" aria-labelledby="build-title">
    <header class="detail-header">
      <div class="detail-title-line">
        <div class="ui-mark profession-mark" :data-profession="build.professions[0]">
          {{ build.professions[0][0] }}
        </div>
        <div class="title-editor">
          <label class="ui-sr-only" for="build-name">Build name</label>
          <input
            id="build-name"
            v-model="name"
            class="ui-input title-input"
            @change="commitName"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          >
          <p>
            {{ build.professions[0] }}
            <template v-if="build.professions[1]"> / {{ build.professions[1] }}</template>
          </p>
        </div>
        <button
          class="ui-button favourite" data-icon
          :aria-label="build.favourite ? 'Remove from favourites' : 'Add to favourites'"
          :aria-pressed="build.favourite"
          @click="controller.toggleBuildFavourite(build.id)"
        >
          ★
        </button>
      </div>

      <div class="tag-row">
        <span v-for="value in build.tags" :key="value" class="ui-chip">{{ value }}</span>
        <span v-if="usage.length" class="ui-chip" data-level="info">
          shared across {{ usage.length }} {{ usage.length === 1 ? "team" : "teams" }}
        </span>
      </div>
    </header>

    <div v-if="parent" class="ui-banner">
      <span>
        Variant of <strong>{{ parent.name }}</strong>
        · {{ buildDifference(parent, build) }}
        {{ buildDifference(parent, build) === 1 ? "change" : "changes" }}
      </span>
      <button
        class="ui-link"
        @click="controller.select({ kind: 'build', id: parent.id })"
      >
        Compare with original
      </button>
    </div>

    <div v-if="usage.length > 1" class="ui-banner" data-tone="warning">
      <span>Editing this build changes every linked team.</span>
      <button class="ui-link" @click="forking = true">Fork before editing</button>
    </div>

    <div class="detail-scroll">
      <section class="bar-section">
        <div class="section-heading">
          <div>
            <h2 id="build-title">Skill bar</h2>
            <p>Skill IDs are stored once; names, elite state, and artwork come from the local client catalogue.</p>
          </div>
          <button
            class="ui-button" data-variant="primary"
            :disabled="controller.saving.value"
            @click="controller.publish(build)"
          >
            Save to Guild Wars
          </button>
        </div>
        <SkillBar :skills="build.skills" :catalogue="controller.skills" />
        <ol class="skill-list">
          <li v-for="(skill, index) in build.skills" :key="`${skill ?? 'empty'}-${index}`">
            <span>{{ index + 1 }}</span>
            <strong>{{ skill === null ? "Empty slot" : controller.skills.get(skill).name }}</strong>
            <em v-if="skill !== null">
              {{ controller.skills.get(skill).profession ?? "Any" }}
              <template v-if="controller.skills.get(skill).elite"> · Elite</template>
            </em>
          </li>
        </ol>
      </section>

      <section class="attributes-section">
        <h2>Attributes</h2>
        <div class="attribute-list">
          <div v-for="(rank, attribute) in build.attributes" :key="attribute">
            <span>{{ attribute }}</span>
            <strong>{{ rank }}</strong>
          </div>
        </div>
      </section>

      <section v-if="usage.length" class="usage-section">
        <h2>Used by</h2>
        <button
          v-for="team in usage"
          :key="team.id"
          class="ui-row usage-row"
          @click="emit('openTeam', team.id)"
        >
          <span>
            <strong>{{ team.name }}</strong>
            <small>
              {{ team.slots.filter((slot) => slot.build === build.id).length }} linked slot(s)
            </small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </section>

      <section class="notes-section">
        <label for="build-notes">Notes</label>
        <textarea class="ui-textarea"
          id="build-notes"
          v-model="notes"
          rows="3"
          @change="controller.updateBuildNotes(build.id, notes)"
        />
      </section>

      <section v-if="forking" class="inline-action" aria-labelledby="fork-title">
        <div>
          <h2 id="fork-title">Fork a linked variant</h2>
          <p>
            The relationship is kept. Choose which teams should move to the
            variant; the others stay on the original.
          </p>
        </div>
        <div v-if="usage.length" class="check-list">
          <label v-for="team in usage" :key="team.id" class="ui-check">
            <input
              type="checkbox"
              :checked="rebind.includes(team.id)"
              @change="toggleTeam(team.id)"
            >
            <span>{{ team.name }}</span>
            <small>{{ team.slots.filter((slot) => slot.build === build.id).length }} linked slot(s)</small>
          </label>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="forking = false">Cancel</button>
          <button
            class="ui-button" data-variant="primary"
            @click="controller.createFork(build.id, rebind)"
          >
            Create variant
          </button>
        </div>
      </section>

      <section v-if="deleting" class="inline-action inline-action--danger">
        <div>
          <h2>Delete {{ build.name }}?</h2>
          <p v-if="usage.length">
            {{ usage.length }} linked {{ usage.length === 1 ? "team" : "teams" }}
            will receive an empty slot. Variants are promoted, never deleted.
          </p>
          <p v-else>Variants are promoted to independent builds.</p>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="deleting = false">Keep build</button>
          <button class="ui-button" data-variant="danger" @click="controller.deleteBuild(build.id)">
            Delete build
          </button>
        </div>
      </section>
    </div>

    <footer class="detail-actions">
      <button class="ui-button" @click="forking = true">Fork variant</button>
      <button class="ui-link" data-variant="danger" @click="deleting = true">Delete</button>
    </footer>
  </article>
</template>
