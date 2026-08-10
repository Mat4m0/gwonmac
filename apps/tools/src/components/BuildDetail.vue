<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  toRef,
  watch,
} from "vue";
import { PROFESSIONS } from "../../../../src/shared/builds/heroes";
import { encodeSkillTemplate } from "../../../../src/shared/builds/skill-template";
import type { Profession, SkillId } from "../../../../src/shared/builds/library";
import type { SkillUnlockObservation } from "../../../../src/shared/builds/live-party";
import type { BuildProblem } from "../../../../src/shared/builds/validate";
import type { LibraryController } from "../use-library";
import {
  type AuthoringContext,
  useBuildDraft,
} from "../use-build-draft";
import { buildDifference, type Build } from "../model";
import AttributeEditor from "./AttributeEditor.vue";
import SkillBar from "./SkillBar.vue";
import SkillCatalogue from "./SkillCatalogue.vue";
import TagEditor from "./TagEditor.vue";
import { navigateTabs } from "../tab-keyboard";
import { presentSkillPlacement } from "../skill-drop";
import { useSkillDragSession } from "../use-skill-drag-session";

const props = withDefaults(defineProps<{
  build: Build;
  controller: LibraryController;
  context?: AuthoringContext;
}>(), {
  context: "standalone",
});
const emit = defineEmits<{
  openTeam: [id: string];
  dirtyChange: [dirty: boolean];
}>();

const context = computed(() => props.context);
const editor = useBuildDraft(toRef(props, "build"), props.controller, context);
const view = ref<"build" | "details">("build");
const workspace = ref<"attributes" | "skills">("attributes");
const adaptCode = ref("");
const adaptError = ref(false);
const deleting = ref(false);
const merging = ref(false);
const publication = ref<{ fileName: string; location: string } | null>(null);
const exporting = ref(false);
const exportProblem = ref("");
const exportStatus = ref("");
const exportCodeInput = ref<HTMLTextAreaElement | null>(null);
const placementStatus = ref<{
  text: string;
  tone: "success" | "warning" | "error";
} | null>(null);
const dragSession = useSkillDragSession({
  name: (skill) => props.controller.skills.get(skill).name,
  previewPlacement: (skill, target) => presentSkillPlacement(
    skill,
    editor.previewSkillPlacement(target, skill, props.controller.skills),
    props.controller.skills,
  ).preview,
  place: (skill, target) => placeSkill(target, skill),
  reorder: editor.moveSkill,
  clearFeedback: () => { placementStatus.value = null; },
});
const catalogueOpen = computed(() =>
  view.value === "build"
  && workspace.value === "skills"
  && editor.activeSlot.value !== null
);
const unlockScope = computed<"account" | "character">(() =>
  context.value === "hero" ? "account" : "character"
);
const skillUnlocks = computed<SkillUnlockObservation | null>(() =>
  unlockScope.value === "account"
    ? props.controller.party.value.accountSkills
    : props.controller.party.value.characterSkills
);

watch(editor.dirty, (dirty) => emit("dirtyChange", dirty), { immediate: true });
watch(
  () => props.build.id,
  () => {
    view.value = "build";
    workspace.value = "attributes";
    adaptCode.value = "";
    adaptError.value = false;
    deleting.value = false;
    merging.value = false;
    publication.value = null;
    exporting.value = false;
    exportProblem.value = "";
    exportStatus.value = "";
    dragSession.cancel();
    placementStatus.value = null;
  },
);

const exportCode = computed(() => encodeSkillTemplate(editor.draft.value) ?? "");

async function startExporting(): Promise<void> {
  if (!exportCode.value || !editor.valid.value) return;
  exportProblem.value = "";
  exportStatus.value = "";
  exporting.value = true;
  await nextTick();
  exportCodeInput.value?.focus();
  exportCodeInput.value?.select();
}

async function copyBuildCode(): Promise<void> {
  exportProblem.value = "";
  exportStatus.value = "";
  try {
    await props.controller.writeClipboard(exportCode.value);
    exportStatus.value = "Build code copied.";
  } catch {
    exportProblem.value = "Clipboard access was refused. Select and copy the code instead.";
    await nextTick();
    exportCodeInput.value?.focus();
    exportCodeInput.value?.select();
  }
}

const parent = computed(() =>
  props.build.parent
    ? props.controller.library.value?.builds.find(
        (build) => build.id === props.build.parent,
      )
    : undefined,
);
const changedSlots = computed(() =>
  parent.value
    ? editor.draft.value.skills.flatMap((skill, index) =>
        skill === parent.value?.skills[index] ? [] : [index]
      )
    : [],
);
const invalidSlots = computed(() =>
  editor.verdict.value.valid
    ? []
    : editor.verdict.value.problems.flatMap((problem) =>
        "slot" in problem ? [problem.slot] : []
      ),
);
const heroUsage = computed(() =>
  editor.usage.value.some((team) =>
    team.slots.slice(1).some((slot) => slot.build === props.build.id)
  ),
);
const allowPlayerOnly = computed(() =>
  props.context === "player"
  || (props.context === "standalone" && !heroUsage.value)
);

function selectSlot(slot: number): void {
  editor.activeSlot.value = slot;
  workspace.value = "skills";
}

function closeCatalogue(): void {
  const slot = editor.activeSlot.value;
  editor.activeSlot.value = null;
  workspace.value = "attributes";
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(
      `.authoring-bar .skill[data-skill-slot="${slot ?? 0}"]`,
    )?.focus();
  });
}

function placeSkill(slot: number, skill: SkillId): void {
  const resolution = editor.placeSkill(slot, skill, props.controller.skills);
  placementStatus.value = presentSkillPlacement(
    skill,
    resolution,
    props.controller.skills,
  ).completion;
}

function problemText(problem: BuildProblem): string {
  switch (problem.rule) {
    case "secondary-repeats-primary":
      return "Primary and secondary professions must differ.";
    case "duplicate-skill":
      return `Slot ${problem.slot + 1} duplicates slot ${problem.firstSlot + 1}.`;
    case "second-elite":
      return `Slot ${problem.slot + 1} is a second elite skill.`;
    case "unknown-skill":
      return `Slot ${problem.slot + 1} is unknown to this client catalogue.`;
    case "skill-not-equippable":
      return `Slot ${problem.slot + 1} cannot be equipped in PvE.`;
    case "player-only-skill-on-hero":
      return `Slot ${problem.slot + 1} is player-only and cannot be used by a hero.`;
    case "skill-off-profession":
      return `Slot ${problem.slot + 1} belongs to ${PROFESSIONS[problem.profession].name}.`;
    case "attribute-off-profession":
      return `${humanize(problem.attribute)} does not belong to this profession pair.`;
    case "primary-attribute-of-secondary":
      return `${humanize(problem.attribute)} requires ${PROFESSIONS[problem.profession].name} as primary.`;
    case "rank-above-cap":
      return `${humanize(problem.attribute)} is above rank ${problem.cap}.`;
    case "over-budget":
      return `Attributes spend ${problem.spent} of ${problem.budget} points.`;
  }
}

const humanize = (value: string) => value.replace(/([a-z])([A-Z])/gu, "$1 $2");

function reviewFirstProblem(): void {
  if (editor.verdict.value.valid) return;
  const first = editor.verdict.value.problems[0];
  if ("slot" in first) {
    selectSlot(first.slot);
    return;
  }
  workspace.value = "attributes";
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(".attribute-workspace select, .attribute-workspace button")
      ?.focus();
  });
}

function importDraft(): void {
  adaptError.value = !editor.adaptFromCode(adaptCode.value);
  if (!adaptError.value) {
    adaptCode.value = "";
    view.value = "build";
    workspace.value = "attributes";
  }
}

async function writeTemplate(): Promise<void> {
  if (
    props.controller.publishUnavailable
    || editor.dirty.value
    || !props.controller.validate(props.build, props.context).valid
  ) return;
  publication.value = await props.controller.publish(props.build);
}

async function requestSave(): Promise<boolean> {
  return editor.requestSave();
}

function discard(): void {
  editor.reset();
}

defineExpose({
  requestSave,
  discard,
  dirty: editor.dirty,
});
</script>

<template>
  <article
    class="detail-view build-authoring"
    :data-catalogue-open="catalogueOpen ? '' : undefined"
    aria-label="Build editor"
  >
    <header class="detail-header authoring-header">
      <div class="detail-title-line">
        <div
          class="ui-mark profession-mark"
          :data-profession="editor.draft.value.professions[0]"
        >
          {{ editor.draft.value.professions[0] }}
        </div>
        <div class="title-editor">
          <label class="ui-sr-only" for="build-name">Build name</label>
          <input
            id="build-name"
            class="ui-input title-input"
            :value="editor.draft.value.name"
            @input="editor.setName(($event.target as HTMLInputElement).value)"
          >
          <p>
            {{ PROFESSIONS[editor.draft.value.professions[0]].name }}
            <template v-if="editor.draft.value.professions[1]">
              / {{ PROFESSIONS[editor.draft.value.professions[1] as Profession].name }}
            </template>
            · {{ context === "hero" ? "Hero build" : context === "player" ? "Player build" : "Library build" }}
          </p>
        </div>
        <span v-if="editor.dirty.value" class="ui-chip" data-level="warn">Unsaved draft</span>
        <button
          class="ui-button favourite"
          data-icon
          :aria-label="build.favourite ? 'Remove from favourites' : 'Add to favourites'"
          :aria-pressed="build.favourite"
          @click="controller.toggleBuildFavourite(build.id)"
        >{{ build.favourite ? "★" : "☆" }}</button>
      </div>

      <div
        class="authoring-tabs"
        role="tablist"
        aria-label="Build view"
        @keydown="navigateTabs"
      >
        <button
          id="build-view-tab"
          role="tab"
          aria-controls="build-view-panel"
          :aria-selected="view === 'build'"
          :tabindex="view === 'build' ? 0 : -1"
          @click="view = 'build'"
        >Build</button>
        <button
          id="build-details-tab"
          role="tab"
          aria-controls="build-details-panel"
          :aria-selected="view === 'details'"
          :tabindex="view === 'details' ? 0 : -1"
          @click="view = 'details'"
        >Details</button>
        <span v-if="editor.usage.value.length" class="ui-chip" data-level="info">
          {{ editor.usage.value.length }}
          {{ editor.usage.value.length === 1 ? "linked team" : "linked teams" }}
        </span>
      </div>
    </header>

    <template v-if="view === 'build'">
      <div
        id="build-view-panel"
        class="authoring-scroll"
        role="tabpanel"
        aria-labelledby="build-view-tab"
      >
        <section class="authoring-bar-section">
          <div class="workspace-heading">
            <div>
              <h2 id="build-title">Skill bar</h2>
              <p>Choose a slot to browse eligible PvE skills.</p>
            </div>
            <span v-if="parent" class="ui-chip">
              {{ buildDifference(parent, editor.draft.value) }}
              changes from {{ parent.name }}
            </span>
          </div>
          <SkillBar
            class="authoring-bar"
            :skills="editor.draft.value.skills"
            :catalogue="controller.skills"
            :active-slot="editor.activeSlot.value"
            :invalid-slots="invalidSlots"
            :changed-slots="changedSlots"
            :drag-session="dragSession"
            editable
            @select="selectSlot"
            @clear="editor.setSkill($event, null)"
            @move="editor.moveSkill"
          />
          <p class="bar-keyboard-hint">
            Drag skills onto slots; drag slots to reorder · Enter edits · Delete clears · ⌘← / ⌘→ moves
          </p>
          <p
            v-if="placementStatus"
            class="bar-drag-status"
            :data-tone="placementStatus.tone"
            role="status"
          >
            {{ placementStatus.text }}
          </p>
        </section>

        <div
          v-if="!editor.verdict.value.valid"
          class="ui-banner build-validation"
          data-tone="warning"
          role="status"
        >
          <span>
            <strong>
              {{ editor.verdict.value.problems.length }}
              {{ editor.verdict.value.problems.length === 1 ? "issue" : "issues" }}
            </strong>
            · {{ editor.verdict.value.problems.map(problemText).join(" ") }}
          </span>
          <button class="ui-link" @click="reviewFirstProblem">Review first issue</button>
        </div>

        <div
          class="workspace-switcher ui-segment"
          role="tablist"
          aria-label="Authoring workspace"
          @keydown="navigateTabs"
        >
          <button
            id="attributes-tab"
            role="tab"
            aria-controls="attributes-panel"
            :aria-selected="workspace === 'attributes'"
            :tabindex="workspace === 'attributes' ? 0 : -1"
            @click="workspace = 'attributes'; editor.activeSlot.value = null"
          >Attributes</button>
          <button
            id="skills-tab"
            role="tab"
            aria-controls="skills-panel"
            :aria-selected="workspace === 'skills'"
            :tabindex="workspace === 'skills' ? 0 : -1"
            @click="workspace = 'skills'"
          >Skill catalogue</button>
        </div>

        <AttributeEditor
          v-if="workspace === 'attributes'"
          id="attributes-panel"
          role="tabpanel"
          aria-labelledby="attributes-tab"
          :editor="editor"
        />
        <SkillCatalogue
          v-else-if="editor.activeSlot.value !== null"
          id="skills-panel"
          role="tabpanel"
          aria-labelledby="skills-tab"
          :editor="editor"
          :catalogue="controller.skills"
          :allow-player-only="allowPlayerOnly"
          :unlocks="skillUnlocks"
          :unlock-scope="unlockScope"
          :drag-session="dragSession"
          @close="closeCatalogue"
          @place="placeSkill"
        />
        <section
          v-else
          id="skills-panel"
          class="catalogue-prompt ui-empty"
          role="tabpanel"
          aria-labelledby="skills-tab"
        >
          <strong>Choose a skill slot</strong>
          <p>The catalogue opens here without covering the rest of the build.</p>
          <button class="ui-button" @click="selectSlot(0)">Choose slot 1</button>
        </section>
      </div>
    </template>

    <div
      v-else
      id="build-details-panel"
      class="detail-scroll build-details"
      role="tabpanel"
      aria-labelledby="build-details-tab"
    >
      <section v-if="parent" class="comparison-section">
        <div class="workspace-heading">
          <div>
            <h2>Variant of {{ parent.name }}</h2>
            <p>This variant keeps its own changes while remembering the original.</p>
          </div>
          <div class="lineage-actions">
            <button class="ui-link" @click="merging = true">Merge into original</button>
            <button class="ui-link" @click="controller.detachVariant(build.id)">Detach</button>
          </div>
        </div>
        <div class="comparison-bars">
          <div><span>Original</span><SkillBar :skills="parent.skills" :catalogue="controller.skills" :changed-slots="changedSlots" /></div>
          <div><span>Draft</span><SkillBar :skills="editor.draft.value.skills" :catalogue="controller.skills" :changed-slots="changedSlots" /></div>
        </div>
      </section>

      <section>
        <h2>Tags</h2>
        <TagEditor
          :tags="editor.draft.value.tags"
          :options="controller.tags.value"
          label="Build tags"
          @update="editor.setTags"
        />
      </section>

      <section class="notes-section">
        <label for="build-notes">Notes</label>
        <textarea
          id="build-notes"
          class="ui-textarea"
          rows="4"
          :value="editor.draft.value.notes"
          @input="editor.setNotes(($event.target as HTMLTextAreaElement).value)"
        />
      </section>

      <section class="adapt-section">
        <h2>Adapt from template code</h2>
        <p>Replace the draft’s professions, attributes, and bar while keeping its identity.</p>
        <textarea
          v-model="adaptCode"
          class="ui-textarea template-code"
          rows="3"
          spellcheck="false"
          placeholder="Paste a revised Guild Wars skill template code"
        />
        <p v-if="adaptError" class="ui-field-error" role="alert">That is not a valid skill template code.</p>
        <button class="ui-button" :disabled="!adaptCode.trim()" @click="importDraft">
          Load into draft
        </button>
      </section>

      <section v-if="editor.usage.value.length" class="usage-section">
        <h2>Used by</h2>
        <button
          v-for="team in editor.usage.value"
          :key="team.id"
          class="ui-row usage-row"
          @click="emit('openTeam', team.id)"
        >
          <span>
            <strong>{{ team.name }}</strong>
            <small>
              {{ team.slots.filter((slot) => slot.build === build.id).length }}
              linked slots
            </small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </section>

      <section v-if="merging && parent" class="inline-action">
        <div>
          <h2>Make this the new {{ parent.name }}?</h2>
          <p>The original receives this build and linked teams move back to it.</p>
        </div>
        <div class="action-row">
          <button class="ui-button" @click="merging = false">Keep variant</button>
          <button class="ui-button" data-variant="primary" @click="controller.mergeVariant(build.id)">
            Merge variant
          </button>
        </div>
      </section>

      <div class="details-danger-zone">
        <button class="ui-button" @click="controller.createFork(build.id, [])">
          Fork independent variant
        </button>
        <button class="ui-link" data-variant="danger" @click="deleting = true">Delete build</button>
      </div>
    </div>

    <section v-if="editor.commitPending.value" class="shared-commit-sheet">
      <div>
        <h2>This build is shared</h2>
        <p>Update every linked team, or move selected teams to a related variant.</p>
      </div>
      <div class="check-list">
        <label v-for="team in editor.usage.value" :key="team.id" class="ui-check">
          <input
            type="checkbox"
            :checked="editor.rebindTeams.value.includes(team.id)"
            @change="editor.toggleRebind(team.id)"
          >
          <span>Move {{ team.name }} to the variant</span>
        </label>
      </div>
      <div class="action-row">
        <button class="ui-button" @click="editor.commitPending.value = false">Cancel</button>
        <button
          class="ui-button"
          :disabled="editor.rebindTeams.value.length === 0"
          @click="editor.commit('fork')"
        >Fork selected</button>
        <button class="ui-button" data-variant="primary" @click="editor.commit('all')">
          Update all teams
        </button>
      </div>
    </section>

    <div v-if="publication" class="publication-result" role="status">
      <strong>Template written: {{ publication.fileName }}</strong>
      <span>In Guild Wars, open Skills and Attributes → Load Template.</span>
    </div>

    <footer v-if="deleting" class="detail-actions authoring-actions delete-confirmation">
      <span class="save-state">
        Delete “{{ build.name }}”? {{ editor.usage.value.length }} linked
        {{ editor.usage.value.length === 1 ? "team gets" : "teams get" }} an empty slot;
        variants are kept.
      </span>
      <button class="ui-button" @click="deleting = false">Cancel</button>
      <button class="ui-button" data-variant="danger" @click="controller.deleteBuild(build.id)">
        Delete build
      </button>
    </footer>
    <footer v-else-if="exporting" class="detail-actions authoring-actions build-export">
      <label>
        <span>Guild Wars skill template code</span>
        <textarea
          ref="exportCodeInput"
          class="ui-textarea template-code"
          rows="3"
          readonly
          spellcheck="false"
          :value="exportCode"
          @focus="($event.target as HTMLTextAreaElement).select()"
        />
        <small v-if="exportProblem" class="ui-field-error" role="alert">{{ exportProblem }}</small>
        <small v-else-if="exportStatus" class="share-success" role="status">{{ exportStatus }}</small>
        <small v-else-if="editor.dirty.value" class="ui-field-hint">
          This code includes the unsaved draft shown above.
        </small>
      </label>
      <button class="ui-button" @click="exporting = false">Done</button>
      <button
        class="ui-button"
        :title="editor.dirty.value ? 'Save changes before writing this template into Guild Wars' : undefined"
        :disabled="controller.publishUnavailable !== null || editor.dirty.value || controller.saving.value"
        @click="writeTemplate"
      >Save to Guild Wars</button>
      <small
        v-if="controller.publishUnavailable"
        class="ui-field-hint"
        role="status"
      >{{ controller.publishUnavailable }}</small>
      <button class="ui-button" data-variant="primary" @click="copyBuildCode">Copy code</button>
    </footer>
    <footer v-else class="detail-actions authoring-actions">
      <span class="save-state">
        {{ editor.dirty.value ? "Draft changes stay local until saved." : "Saved in your local build library." }}
      </span>
      <button
        class="ui-button"
        :disabled="!editor.dirty.value"
        @click="editor.reset"
      >Discard</button>
      <button
        class="ui-button"
        data-variant="primary"
        :disabled="!editor.dirty.value || !editor.valid.value || !editor.draft.value.name.trim() || controller.saving.value"
        @click="editor.requestSave"
      >Save changes</button>
      <button
        class="ui-button"
        :title="!editor.valid.value ? 'Repair this build before exporting it' : undefined"
        :disabled="!editor.valid.value"
        @click="startExporting"
      >Export build</button>
    </footer>
  </article>
</template>
