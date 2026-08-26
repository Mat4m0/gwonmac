<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toRef,
  watch,
} from "vue";
import type { ToolsHost } from "./host";
import type { Build, Team } from "./model";
import {
  buildById,
  buildId,
  teamId,
} from "../../../src/shared/builds/library";
import type { AuthoringContext } from "./use-build-draft";
import {
  buildDifference,
  countLabel,
  teamMemberLabel,
} from "./model";
import { useLibrary } from "./use-library";
import BuildDetail from "./components/BuildDetail.vue";
import LiveParty from "./components/LiveParty.vue";
import SkillBar from "./components/SkillBar.vue";
import TeamDetail from "./components/TeamDetail.vue";
import UiDialog from "./ui/UiDialog.vue";
import { navigateRows, navigateTabs } from "./tab-keyboard";
import { useFloatingWindow } from "./use-floating-window";

const props = defineProps<{
  host: ToolsHost;
  mode: "standalone" | "embedded";
  visible: boolean;
  active: boolean;
}>();
const emit = defineEmits<{
  close: [];
  ready: [];
}>();

const controller = useLibrary(props.host);
const search = ref<HTMLInputElement | null>(null);
const mobileView = ref<"list" | "detail">("list");
const { panel, resizeGrip, panelStyle, startDrag } = useFloatingWindow({
  mode: props.mode,
  visible: toRef(props, "visible"),
  initialPosition: { left: 28, top: 42 },
  minWidth: 320,
  minHeight: 360,
});
const composer = ref<"build" | "team" | "import-team" | null>(null);
const draftCode = ref("");
const draftName = ref("");
const clipboardProblem = ref("");
const storageProblem = ref("");
const openingStorage = ref(false);
const buildContext = ref<AuthoringContext>("standalone");
const buildDetail = ref<InstanceType<typeof BuildDetail> | null>(null);
const teamDetail = ref<InstanceType<typeof TeamDetail> | null>(null);
const buildDirty = ref(false);
const pendingNavigation = shallowRef<null | (() => void)>(null);

const activeTotal = computed(() => {
  const library = controller.library.value;
  if (!library) return 0;
  return controller.kind.value === "team" ? library.teams.length : library.builds.length;
});
const filtersActive = computed(() =>
  controller.query.value.trim().length > 0 || controller.tag.value !== null
);
const summary = computed(() => {
  const noun = controller.kind.value === "team" ? "team" : "build";
  const visible = controller.items.value.length;
  return filtersActive.value
    ? `${visible} of ${countLabel(activeTotal.value, noun)}`
    : countLabel(activeTotal.value, noun);
});
const hasObservedParty = computed(() =>
  props.host.party.value.status === "ready"
  && (props.host.party.value.player !== null || props.host.party.value.heroes.length > 0)
);
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      requestAnimationFrame(() => {
        // The embedded palette opens over a running game and must leave the
        // keyboard with it. Explicitly clicking into a field still focuses the
        // field; only the standalone window chooses a typing target on show.
        if (props.mode === "standalone") search.value?.focus();
      });
    }
  },
);

watch(
  () => controller.loading.value,
  (loading) => {
    if (!loading) emit("ready");
  },
);

const select = (value: Build | Team) => {
  navigate(() => {
    if ("skills" in value) {
      buildContext.value = "standalone";
      controller.select({ kind: "build", id: value.id });
    } else {
      controller.select({ kind: "team", id: value.id });
    }
    mobileView.value = "detail";
  });
};

const openTeam = (id: string) => {
  navigate(() => {
    controller.select({ kind: "team", id: teamId(id) });
    mobileView.value = "detail";
  });
};

const openBuild = (id: string, context: "player" | "hero") => {
  navigate(() => {
    buildContext.value = context;
    controller.select({ kind: "build", id: buildId(id) });
    mobileView.value = "detail";
  });
};

function navigate(action: () => void): void {
  if (buildDirty.value && controller.selectedBuild.value) {
    pendingNavigation.value = action;
    return;
  }
  action();
}

const selectKind = (kind: "team" | "build") => navigate(() => {
  buildContext.value = "standalone";
  controller.selectKind(kind);
  mobileView.value = "list";
});

const finishNavigation = (discard: boolean) => {
  if (discard) buildDetail.value?.discard();
  const action = pendingNavigation.value;
  pendingNavigation.value = null;
  action?.();
};

const saveAndNavigate = async () => {
  const saved = await buildDetail.value?.requestSave();
  if (saved) finishNavigation(false);
};

const requestClose = () => navigate(() => emit("close"));
defineExpose({ requestClose });

const openStorage = async () => {
  storageProblem.value = "";
  openingStorage.value = true;
  try {
    await props.host.openStorage();
    emit("close");
  } catch (cause) {
    storageProblem.value = cause instanceof Error
      ? cause.message
      : "Storage could not be opened.";
  } finally {
    openingStorage.value = false;
  }
};

const captureCurrentParty = async () => {
  const captured = await controller.captureCurrentParty();
  if (!captured) return;
  mobileView.value = "detail";
  await nextTick();
  teamDetail.value?.focusName();
};

const finishCreate = async () => {
  if (composer.value === "build") {
    if (!(await controller.importBuild(draftCode.value, draftName.value))) return;
  } else if (composer.value === "import-team") {
    if (!(await controller.importTeamCode(draftCode.value))) return;
  } else if (composer.value === "team") {
    if (!(await controller.createTeam(draftName.value))) return;
  }
  composer.value = null;
  draftCode.value = "";
  draftName.value = "";
  mobileView.value = "detail";
};

const pasteTeamCode = async () => {
  clipboardProblem.value = "";
  try {
    draftCode.value = await controller.readClipboard();
  } catch {
    clipboardProblem.value = "Clipboard access was refused. Paste the code into the field instead.";
  }
};

const startBlankBuild = async () => {
  if (!(await controller.createBlankBuild(draftName.value))) return;
  composer.value = null;
  draftCode.value = "";
  draftName.value = "";
  mobileView.value = "detail";
};

const onKeydown = (event: KeyboardEvent) => {
  if (!props.visible || !props.active) return;
  const editable =
    event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
    || (event.target instanceof HTMLElement && event.target.isContentEditable);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    if (editable) return;
    event.preventDefault();
    void controller.undo();
  }
  if (
    event.key === "/"
    && !(event.target instanceof HTMLInputElement)
    && !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    search.value?.focus();
  }
};

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    v-show="visible"
    class="tools-stage"
    :data-mode="mode"
    :data-mobile-view="mobileView"
  >
    <section
      ref="panel"
      class="ui-frame ui-panel tools-window"
      :style="panelStyle"
      aria-label="Build Library"
      role="dialog"
    >
      <header class="ui-panel-head ui-window-head window-bar" @pointerdown="startDrag">
        <div class="window-brand" aria-hidden="true">GW</div>
        <div class="window-identity">
          <h1 class="ui-panel-title">Build Library</h1>
          <p class="ui-field-hint">{{ host.label }}</p>
        </div>
        <span v-if="controller.saving.value" class="ui-chip" data-level="warn" role="status">Saving…</span>
        <button
          class="ui-button window-storage"
          :disabled="openingStorage || host.storageUnavailable !== null"
          :title="host.storageUnavailable ?? 'Open Xunlai Storage'"
          :aria-label="host.storageUnavailable ?? 'Open Xunlai Storage'"
          @click="openStorage"
        >{{ openingStorage ? "Opening…" : "Storage" }}</button>
        <button
          v-if="mode === 'embedded'"
          class="ui-button window-close"
          data-icon
          aria-label="Close Build Library"
          @click="requestClose"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </button>
      </header>

      <div v-if="storageProblem" class="ui-banner" data-tone="warning" role="alert">
        {{ storageProblem }}
      </div>

      <div
        v-if="controller.skillProblem.value"
        class="ui-banner skill-recovery"
        data-tone="warning"
        role="status"
      >
        <span><strong>Skill details are unavailable.</strong> Saved teams and builds still work.</span>
        <button class="ui-button" @click="controller.retrySkills">Retry skill data</button>
      </div>

      <div v-if="controller.loading.value" class="loading-layout" aria-label="Loading build library">
        <div class="skeleton skeleton--rail" />
        <div class="skeleton skeleton--detail" />
      </div>

      <div v-else-if="controller.error.value" class="fatal-state" role="alert">
        <strong>The build library could not be opened.</strong>
        <p>{{ controller.error.value }}</p>
        <button v-if="host.reset" class="ui-button" @click="controller.reset">Restore demo data</button>
      </div>

      <div v-else-if="controller.library.value" class="workspace">
        <aside class="library-pane" aria-label="Library">
          <div class="library-toolbar">
            <div
              class="ui-segment"
              data-fill
              role="tablist"
              aria-label="Library type"
              @keydown="navigateTabs"
            >
              <button
                id="teams-library-tab"
                role="tab"
                aria-controls="library-items"
                :aria-selected="controller.kind.value === 'team'"
                :tabindex="controller.kind.value === 'team' ? 0 : -1"
                @click="selectKind('team')"
              >
                Teams
                <small>{{ controller.library.value.teams.length }}</small>
              </button>
              <button
                id="builds-library-tab"
                role="tab"
                aria-controls="library-items"
                :aria-selected="controller.kind.value === 'build'"
                :tabindex="controller.kind.value === 'build' ? 0 : -1"
                @click="selectKind('build')"
              >
                Builds
                <small>{{ controller.library.value.builds.length }}</small>
              </button>
            </div>

            <LiveParty
              v-if="controller.kind.value === 'team'"
              :party="host.party.value"
              :saving="controller.saving.value"
              :unavailable-reason="host.observationUnavailable"
              @capture="captureCurrentParty"
            />

            <div v-if="controller.kind.value === 'team'" class="create-actions">
              <button
                class="ui-button"
                :data-variant="hasObservedParty ? undefined : 'primary'"
                @click="composer = 'team'"
              >New team</button>
              <button class="ui-button" @click="composer = 'import-team'">Import team</button>
            </div>
            <details v-if="controller.kind.value === 'team'" class="library-help">
              <summary>How teams work</summary>
              <p>
                A team links each member to a saved build. Editing a shared build updates every
                team that uses it; create a related copy when only one team should differ.
              </p>
            </details>
            <div v-else class="create-actions create-actions--single">
              <button class="ui-button" data-variant="primary" @click="composer = 'build'">
                Import build
              </button>
            </div>

            <label class="ui-input-group">
              <span aria-hidden="true">⌕</span>
              <span class="ui-sr-only">Search library</span>
              <input
                ref="search"
                v-model="controller.query.value"
                type="search"
                placeholder="Search names, tags, heroes, skills"
              >
              <kbd class="ui-kbd">/</kbd>
            </label>

            <div class="tag-filters" role="group" aria-label="Filter by tag">
              <button
                class="ui-chip"
                :aria-pressed="controller.tag.value === null"
                @click="controller.tag.value = null"
              >
                All
              </button>
              <button
                v-for="value in controller.tags.value"
                :key="value"
                class="ui-chip"
                :aria-pressed="controller.tag.value === value"
                @click="controller.tag.value = controller.tag.value === value ? null : value"
              >
                {{ value }}
              </button>
            </div>
          </div>

          <div class="library-summary">
            <span>{{ summary }}</span>
            <button
              class="ui-link"
              :disabled="!controller.canUndo.value"
              @click="controller.undo"
            >
              Undo <kbd class="ui-kbd">⌘Z</kbd>
            </button>
          </div>

          <div
            id="library-items"
            class="library-list"
            role="tabpanel"
            :aria-labelledby="controller.kind.value === 'team' ? 'teams-library-tab' : 'builds-library-tab'"
            @keydown="navigateRows"
          >
            <button
              v-for="value in controller.items.value"
              :key="value.id"
              class="ui-row library-row"
              :data-child="'parent' in value && value.parent ? '' : undefined"
              :aria-current="controller.selectedId.value === value.id ? 'page' : undefined"
              @click="select(value)"
            >
              <span class="row-title">
                <span class="ui-row-title">
                  <svg v-if="value.favourite" class="favourite-mark" viewBox="0 0 20 20" aria-label="Favourite" role="img">
                    <path d="m10 2.4 2.25 4.56 5.03.73-3.64 3.55.86 5.01L10 13.88l-4.5 2.37.86-5.01L2.72 7.69l5.03-.73Z" fill="currentColor"/>
                  </svg>
                  {{ value.name }}
                </span>
                <em v-if="'mode' in value">{{ value.mode === "hard" ? "Hard" : value.mode === "normal" ? "Normal" : "Unspecified" }}</em>
                <em v-else>{{ value.professions.join("/") }}</em>
              </span>

              <template v-if="'skills' in value">
                <SkillBar :skills="value.skills" :catalogue="controller.skills" compact />
                <span v-if="value.parent" class="row-meta">
                  {{
                    buildById(controller.library.value, value.parent)
                      ? `Based on ${buildById(controller.library.value, value.parent)!.name} · ${countLabel(buildDifference(buildById(controller.library.value, value.parent)!, value), "change")}`
                      : "Related build"
                  }}
                </span>
                <span v-else class="row-meta">
                  Used by {{ countLabel(controller.usage(value.id).length, "team") }}
                </span>
              </template>

              <template v-else>
                <span class="team-professions" aria-label="Team professions">
                  <i
                    v-for="(slot, index) in value.slots"
                    :key="`${slot.hero}-${index}`"
                    class="ui-mark"
                    :data-profession="slot.build ? buildById(controller.library.value, slot.build)?.professions[0] : undefined"
                    :data-empty="slot.build ? undefined : ''"
                    :title="teamMemberLabel(slot.hero, index)"
                  >
                    {{ slot.build ? buildById(controller.library.value, slot.build)?.professions[0] : "–" }}
                  </i>
                </span>
                <span class="row-meta">
                  {{ value.slots.filter((slot) => slot.build).length }}/8 configured
                </span>
              </template>
            </button>

            <div v-if="!controller.items.value.length" class="ui-empty">
              <strong>
                {{ activeTotal === 0
                  ? controller.kind.value === "team" ? "No saved teams yet" : "No saved builds yet"
                  : "No matches" }}
              </strong>
              <p v-if="activeTotal > 0">
                No {{ controller.kind.value === "team" ? "teams" : "builds" }} match this search or tag.
              </p>
              <p v-else-if="controller.kind.value === 'team' && hasObservedParty">
                Save the party in Guild Wars above, or create or import a team.
              </p>
              <p v-else-if="controller.kind.value === 'team'">
                Create a team or import a GWonMac team code above.
              </p>
              <p v-else>Use Import build above to add a Guild Wars skill template.</p>
              <button
                v-if="activeTotal > 0 && filtersActive"
                class="ui-button"
                @click="controller.query.value = ''; controller.tag.value = null"
              >
                Clear filters
              </button>
            </div>
          </div>

          <footer v-if="host.reset" class="library-footer">
            <button class="ui-link" @click="controller.reset">
              Reset demo
            </button>
          </footer>
        </aside>

        <main class="detail-pane">
          <button class="mobile-back" @click="mobileView = 'list'">
            ← Library
          </button>
          <BuildDetail
            v-if="controller.selectedBuild.value"
            ref="buildDetail"
            :build="controller.selectedBuild.value"
            :controller="controller"
            :context="buildContext"
            @open-team="openTeam"
            @dirty-change="buildDirty = $event"
          />
          <TeamDetail
            v-else-if="controller.selectedTeam.value"
            ref="teamDetail"
            :team="controller.selectedTeam.value"
            :controller="controller"
            @edit-build="openBuild"
          />
          <div v-else class="ui-empty empty-state--detail">
            <strong>
              {{ activeTotal === 0
                ? controller.kind.value === "team" ? "No saved teams yet" : "No saved builds yet"
                : `Choose a ${controller.kind.value}` }}
            </strong>
            <p v-if="activeTotal === 0 && controller.kind.value === 'team' && hasObservedParty">
              Your party in Guild Wars is ready to save from the Library.
            </p>
            <p v-else-if="activeTotal === 0 && controller.kind.value === 'team'">
              Create a team or import a team code from the Library.
            </p>
            <p v-else-if="activeTotal === 0">
              Import a Guild Wars skill template from the Library.
            </p>
            <p v-else>Choose a {{ controller.kind.value }} in the Library to see and edit it.</p>
          </div>
        </main>
      </div>

      <Transition name="notice">
        <div
          v-if="controller.notice.value"
          class="ui-toast notice"
          :data-tone="controller.notice.value.tone"
          :role="controller.notice.value.tone === 'error' ? 'alert' : 'status'"
        >
          <span>{{ controller.notice.value.message }}</span>
          <button
            v-if="controller.canUndo.value && controller.notice.value.tone !== 'error'"
            class="ui-link"
            @click="controller.undo"
          >
            Undo
          </button>
          <button
            class="ui-button notice-dismiss"
            data-icon
            aria-label="Dismiss message"
            @click="controller.dismissNotice"
          ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></button>
        </div>
      </Transition>

      <UiDialog
        :open="pendingNavigation !== null"
        class="leave-dialog"
        labelledby="leave-title"
        describedby="leave-description"
        initial-focus="[data-initial-focus]"
        @close="pendingNavigation = null"
      >
        <section
        class="leave-sheet"
      >
        <div>
          <h2 id="leave-title">Save this draft?</h2>
          <p id="leave-description">Your changes have not been added to the local build library yet.</p>
        </div>
        <div class="action-row">
          <button class="ui-button" data-initial-focus @click="pendingNavigation = null">Continue editing</button>
          <button class="ui-button" @click="finishNavigation(true)">Discard changes</button>
          <button class="ui-button" data-variant="primary" @click="saveAndNavigate">
            Save changes
          </button>
        </div>
        </section>
      </UiDialog>

      <UiDialog
        :open="composer !== null"
        labelledby="composer-title"
        :initial-focus="composer === 'import-team' ? '.template-code' : '.ui-input'"
        @close="composer = null; clipboardProblem = ''"
      >
        <form
          class="ui-frame composer-dialog"
          @submit.prevent="finishCreate"
        >
          <header>
            <div>
                <h2 id="composer-title">{{ composer === "build"
                  ? "Import a build"
                  : composer === "import-team" ? "Import a team" : "Create a team" }}</h2>
              <p v-if="composer === 'build'">
                Paste the template code Guild Wars already understands.
              </p>
              <p v-else-if="composer === 'import-team'">
                Paste a full-fidelity GWonMac team code.
              </p>
              <p v-else>Start empty, then assign library builds to its eight slots.</p>
            </div>
            <button type="button" class="ui-button" data-icon aria-label="Close" @click="composer = null">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg>
            </button>
          </header>
          <label v-if="composer !== 'import-team'">
            <span>Name <small>optional</small></span>
            <input v-model="draftName" class="ui-input" placeholder="e.g. Story missions">
          </label>
          <label v-if="composer === 'build'">
            <span>Skill template code</span>
            <textarea
              v-model="draftCode"
              class="ui-textarea template-code"
              rows="3"
              required
              spellcheck="false"
              placeholder="OwAU0Kn8Q4FgMjrUgtEA3TnA"
            />
          </label>
          <label v-else-if="composer === 'import-team'">
            <span>GWonMac team code</span>
            <textarea
              v-model="draftCode"
              class="ui-textarea template-code"
              rows="5"
              required
              spellcheck="false"
              placeholder="gwonmac-team:…"
            />
            <small v-if="clipboardProblem" class="ui-field-error" role="alert">
              {{ clipboardProblem }}
            </small>
          </label>
          <footer>
            <button
              v-if="composer === 'build'"
              type="button"
              class="ui-button"
              @click="startBlankBuild"
            >
              Start blank
            </button>
            <button
              v-if="composer === 'import-team'"
              type="button"
              class="ui-button"
              @click="pasteTeamCode"
            >
              Paste from Clipboard
            </button>
            <button type="button" class="ui-button" @click="composer = null">Cancel</button>
            <button class="ui-button" data-variant="primary">
              {{ composer === "build"
                ? "Import build"
                : composer === "import-team" ? "Import team" : "Create team" }}
            </button>
          </footer>
        </form>
      </UiDialog>
      <button
        v-if="mode === 'embedded'"
        type="button"
        class="ui-resize-grip"
        aria-label="Resize Build Library"
        ref="resizeGrip"
      />
    </section>
  </div>
</template>
