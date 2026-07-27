<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BuildProblem } from "../../../../src/shared/builds/validate";
import type { LibraryController } from "../use-library";
import { buildDifference, type Build } from "../model";
import SkillBar from "./SkillBar.vue";
import TagEditor from "./TagEditor.vue";

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
const adapting = ref(false);
const replacementCode = ref("");
const replacementMode = ref<"all" | "fork">("all");
const replacementTeams = ref<string[]>([]);
const merging = ref(false);

watch(
  () => props.build.id,
  () => {
    forking.value = false;
    deleting.value = false;
    rebind.value = [];
    adapting.value = false;
    replacementCode.value = "";
    replacementMode.value = "all";
    replacementTeams.value = [];
    merging.value = false;
  },
);
watch(
  () => [props.build.name, props.build.notes] as const,
  ([nextName, nextNotes]) => {
    name.value = nextName;
    notes.value = nextNotes;
  },
);

const usage = computed(() => props.controller.usage(props.build.id));
const verdict = computed(() => props.controller.validate(props.build));
const parent = computed(() =>
  props.build.parent
    ? props.controller.library.value?.builds.find(
        (build) => build.id === props.build.parent,
      )
    : undefined,
);
const changedSlots = computed(() =>
  parent.value
    ? props.build.skills.flatMap((skill, index) =>
        skill === parent.value?.skills[index] ? [] : [index]
      )
    : [],
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

const startAdapting = () => {
  adapting.value = true;
  replacementMode.value = usage.value.length > 1 ? "fork" : "all";
  replacementTeams.value = usage.value[0] ? [usage.value[0].id] : [];
};

const toggleReplacementTeam = (id: string) => {
  replacementTeams.value = replacementTeams.value.includes(id)
    ? replacementTeams.value.filter((value) => value !== id)
    : [...replacementTeams.value, id];
};

const applyReplacement = async () => {
  const changed = await props.controller.updateBuildFromCode(
    props.build.id,
    replacementCode.value,
    replacementMode.value,
    replacementTeams.value,
  );
  if (changed) adapting.value = false;
};

const problemText = (problem: BuildProblem): string => {
  switch (problem.rule) {
    case "secondary-repeats-primary": return "Primary and secondary profession are the same.";
    case "duplicate-skill": return `Skill ${problem.slot + 1} duplicates slot ${problem.firstSlot + 1}.`;
    case "second-elite": return `Skill ${problem.slot + 1} is a second elite skill.`;
    case "unknown-skill": return `Skill ${problem.slot + 1} is not in this client catalogue.`;
    case "skill-off-profession": return `Skill ${problem.slot + 1} belongs to ${problem.profession}.`;
    case "attribute-off-profession": return `${problem.attribute} does not belong to this profession pair.`;
    case "primary-attribute-of-secondary": return `${problem.attribute} requires ${problem.profession} as primary.`;
    case "rank-above-cap": return `${problem.attribute} is above rank ${problem.cap}.`;
    case "over-budget": return `Attributes spend ${problem.spent} of ${problem.budget} available points.`;
  }
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
        <TagEditor
          :tags="build.tags"
          :options="controller.tags.value"
          label="Build tags"
          @update="controller.setTags({ kind: 'build', id: build.id }, $event)"
        />
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
      <span class="lineage-actions">
        <button class="ui-link" @click="merging = true">Merge into original</button>
        <button class="ui-link" @click="controller.detachVariant(build.id)">Detach</button>
      </span>
    </div>

    <div v-if="usage.length > 1" class="ui-banner" data-tone="warning">
      <span>Editing this build changes every linked team.</span>
      <button class="ui-link" @click="forking = true">Fork before editing</button>
    </div>

    <div
      v-if="!verdict.valid"
      class="ui-banner build-validation"
      data-tone="warning"
      role="status"
    >
      <span>
        <strong>{{ verdict.problems.length }} build issue{{ verdict.problems.length === 1 ? "" : "s" }}</strong>
        · {{ verdict.problems.map(problemText).join(" ") }}
      </span>
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

      <section v-if="parent" class="comparison-section">
        <div class="section-heading">
          <div>
            <h2>Compared with {{ parent.name }}</h2>
            <p>Outlined slots differ. The relationship stays one level deep.</p>
          </div>
          <button class="ui-link" @click="controller.select({ kind: 'build', id: parent.id })">
            Open original
          </button>
        </div>
        <div class="comparison-bars">
          <div><span>Original</span><SkillBar :skills="parent.skills" :catalogue="controller.skills" :changed-slots="changedSlots" /></div>
          <div><span>Variant</span><SkillBar :skills="build.skills" :catalogue="controller.skills" :changed-slots="changedSlots" /></div>
        </div>
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

      <section v-if="adapting" class="inline-action" aria-labelledby="adapt-title">
        <div>
          <h2 id="adapt-title">Adapt this build</h2>
          <p>
            Paste the revised Guild Wars template. Metadata stays with the
            build; only professions, attributes, and the eight skills change.
          </p>
        </div>
        <label>
          <span>Replacement template code</span>
          <textarea
            v-model="replacementCode"
            class="ui-textarea template-code"
            rows="3"
            required
            spellcheck="false"
            placeholder="Paste the revised code"
          />
        </label>
        <div v-if="usage.length > 1" class="ui-segment" data-fill aria-label="Shared build update">
          <button
            :aria-pressed="replacementMode === 'fork'"
            @click="replacementMode = 'fork'"
          >
            Fork a variant
          </button>
          <button
            :aria-pressed="replacementMode === 'all'"
            @click="replacementMode = 'all'"
          >
            Update all {{ usage.length }} teams
          </button>
        </div>
        <div v-if="replacementMode === 'fork' && usage.length" class="check-list">
          <label v-for="team in usage" :key="team.id" class="ui-check">
            <input
              type="checkbox"
              :checked="replacementTeams.includes(team.id)"
              @change="toggleReplacementTeam(team.id)"
            >
            <span>Move {{ team.name }} to the variant</span>
            <small>{{ team.slots.filter((slot) => slot.build === build.id).length }} linked slot(s)</small>
          </label>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="adapting = false">Cancel</button>
          <button
            class="ui-button"
            data-variant="primary"
            :disabled="!replacementCode.trim() || (replacementMode === 'fork' && usage.length > 0 && replacementTeams.length === 0)"
            @click="applyReplacement"
          >
            {{ replacementMode === "fork" ? "Create adapted variant" : "Update shared build" }}
          </button>
        </div>
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

      <section v-if="merging && parent" class="inline-action" aria-labelledby="merge-title">
        <div>
          <h2 id="merge-title">Make this the new {{ parent.name }}?</h2>
          <p>
            The original receives this bar, every linked team moves back to it,
            and this variant disappears. The operation is undoable.
          </p>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="merging = false">Keep variant</button>
          <button class="ui-button" data-variant="primary" @click="controller.mergeVariant(build.id)">
            Merge variant
          </button>
        </div>
      </section>
    </div>

    <footer class="detail-actions">
      <button class="ui-button" data-variant="primary" @click="startAdapting">
        Adapt from code
      </button>
      <button class="ui-button" @click="forking = true">Fork variant</button>
      <button class="ui-link" data-variant="danger" @click="deleting = true">Delete</button>
    </footer>
  </article>
</template>
