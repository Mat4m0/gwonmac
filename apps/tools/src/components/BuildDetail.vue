<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import {
  attributePointsRemaining,
  attributePointsSpent,
  availableAttributes,
  canSetAttributeRank,
  withAttributeRank,
} from "../../../../src/shared/builds/authoring";
import {
  ATTRIBUTE_POINT_COST,
  ATTRIBUTES,
  PROFESSIONS,
} from "../../../../src/shared/builds/heroes";
import type {
  Attribute,
  AttributeRank,
  Profession,
  SkillId,
} from "../../../../src/shared/builds/library";
import { LEVEL_20_ATTRIBUTE_BUDGET } from "../../../../src/shared/builds/validate";
import type { BuildProblem } from "../../../../src/shared/builds/validate";
import type { LibraryController } from "../use-library";
import { buildDifference, type Build } from "../model";
import SkillBar from "./SkillBar.vue";
import SkillPicker from "./SkillPicker.vue";
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
const pickingSlot = ref<number | null>(null);
const pendingEdit = shallowRef<Pick<Build, "professions" | "attributes" | "skills"> | null>(null);
const editTeams = ref<string[]>([]);
const professions = Object.entries(PROFESSIONS) as readonly [Profession, { id: number; name: string }][];
const ranks = Object.keys(ATTRIBUTE_POINT_COST).map(Number) as AttributeRank[];

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
    pickingSlot.value = null;
    pendingEdit.value = null;
    editTeams.value = [];
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
const editableAttributes = computed(() => {
  const available = availableAttributes(props.build.professions);
  const invested = Object.keys(props.build.attributes) as Attribute[];
  return [...new Set([...available, ...invested])];
});
const pointsSpent = computed(() => attributePointsSpent(props.build.attributes));
const pointsRemaining = computed(() => attributePointsRemaining(props.build.attributes));

const attributeLabel = (attribute: Attribute) =>
  attribute.replace(/([a-z])([A-Z])/gu, "$1 $2");

const requestEdit = async (
  content: Pick<Build, "professions" | "attributes" | "skills">,
) => {
  if (usage.value.length > 1) {
    pendingEdit.value = content;
    editTeams.value = usage.value[0] ? [usage.value[0].id] : [];
    return;
  }
  await props.controller.updateBuildContent(props.build.id, content);
};

const chooseSkill = async (skill: SkillId | null) => {
  if (pickingSlot.value === null) return;
  const skills = [...props.build.skills] as unknown as Build["skills"];
  (skills as unknown as Array<SkillId | null>)[pickingSlot.value] = skill;
  pickingSlot.value = null;
  await requestEdit({
    professions: props.build.professions,
    attributes: props.build.attributes,
    skills,
  });
};

const changePrimary = async (event: Event) => {
  const primary = (event.target as HTMLSelectElement).value as Profession;
  const [previousPrimary, secondary] = props.build.professions;
  const nextSecondary = secondary === primary ? previousPrimary : secondary;
  await requestEdit({
    professions: [primary, nextSecondary],
    attributes: props.build.attributes,
    skills: props.build.skills,
  });
};

const changeSecondary = async (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  await requestEdit({
    professions: [props.build.professions[0], value === "" ? null : value as Profession],
    attributes: props.build.attributes,
    skills: props.build.skills,
  });
};

const changeRank = async (attribute: Attribute, event: Event) => {
  const rank = Number((event.target as HTMLSelectElement).value) as AttributeRank;
  await requestEdit({
    professions: props.build.professions,
    attributes: withAttributeRank(props.build.attributes, attribute, rank),
    skills: props.build.skills,
  });
};

const finishPendingEdit = async (mode: "all" | "fork") => {
  if (!pendingEdit.value) return;
  await props.controller.updateBuildContent(
    props.build.id,
    pendingEdit.value,
    mode,
    editTeams.value,
  );
  pendingEdit.value = null;
};

const toggleEditTeam = (id: string) => {
  editTeams.value = editTeams.value.includes(id)
    ? editTeams.value.filter((value) => value !== id)
    : [...editTeams.value, id];
};

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
        <SkillBar
          :skills="build.skills"
          :catalogue="controller.skills"
          editable
          @select="pickingSlot = $event"
        />
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
        <div class="section-heading">
          <div>
            <h2>Professions & attributes</h2>
            <p>Invested ranks use Guild Wars’ nonlinear level-20 point costs. Runes and bonuses are not included.</p>
          </div>
          <div class="attribute-budget" :data-over="pointsRemaining < 0 ? '' : undefined">
            <strong>{{ pointsRemaining }}</strong>
            <span>of {{ LEVEL_20_ATTRIBUTE_BUDGET }} points left</span>
          </div>
        </div>
        <div class="profession-editor">
          <label>
            <span>Primary profession</span>
            <select class="ui-select" :value="build.professions[0]" @change="changePrimary">
              <option v-for="[key, facts] in professions" :key="key" :value="key">
                {{ facts.name }}
              </option>
            </select>
          </label>
          <label>
            <span>Secondary profession</span>
            <select class="ui-select" :value="build.professions[1] ?? ''" @change="changeSecondary">
              <option value="">None</option>
              <option
                v-for="[key, facts] in professions"
                :key="key"
                :value="key"
                :disabled="key === build.professions[0]"
              >
                {{ facts.name }}
              </option>
            </select>
          </label>
        </div>
        <div class="attribute-editor">
          <label
            v-for="attribute in editableAttributes"
            :key="attribute"
            :data-invalid="!availableAttributes(build.professions).includes(attribute) ? '' : undefined"
          >
            <span>
              <strong>{{ attributeLabel(attribute) }}</strong>
              <small>
                {{ PROFESSIONS[ATTRIBUTES[attribute].profession].name }}
                <template v-if="!availableAttributes(build.professions).includes(attribute)"> · unavailable</template>
              </small>
            </span>
            <select
              class="ui-select rank-select"
              :value="build.attributes[attribute] ?? 0"
              :aria-label="`${attributeLabel(attribute)} rank`"
              @change="changeRank(attribute, $event)"
            >
              <option
                v-for="rank in ranks"
                :key="rank"
                :value="rank"
                :disabled="rank > (build.attributes[attribute] ?? 0) && !canSetAttributeRank(build.attributes, attribute, rank)"
              >
                {{ rank }} · {{ ATTRIBUTE_POINT_COST[rank] }} pt
              </option>
            </select>
          </label>
        </div>
        <p class="attribute-total">{{ pointsSpent }} points invested</p>
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

    <SkillPicker
      v-if="pickingSlot !== null"
      :build="build"
      :slot-index="pickingSlot"
      :catalogue="controller.skills"
      @choose="chooseSkill"
      @close="pickingSlot = null"
    />

    <div v-if="pendingEdit" class="skill-picker-backdrop" @click.self="pendingEdit = null">
      <section class="ui-frame shared-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="shared-edit-title">
        <h2 id="shared-edit-title">This build is shared</h2>
        <p>Apply this change to all {{ usage.length }} linked teams, or keep the original and move selected teams to a related variant.</p>
        <div class="check-list">
          <label v-for="team in usage" :key="team.id" class="ui-check">
            <input type="checkbox" :checked="editTeams.includes(team.id)" @change="toggleEditTeam(team.id)">
            <span>Move {{ team.name }} to the variant</span>
          </label>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="pendingEdit = null">Cancel</button>
          <button class="ui-button" :disabled="editTeams.length === 0" @click="finishPendingEdit('fork')">Fork selected</button>
          <button class="ui-button" data-variant="primary" @click="finishPendingEdit('all')">Update all</button>
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
