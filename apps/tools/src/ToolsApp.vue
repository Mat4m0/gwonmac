<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { ToolsHost } from "./host";
import type { Build, Team } from "./model";
import { buildDifference, buildById, heroLabel, teamId } from "./model";
import { useLibrary } from "./use-library";
import BuildDetail from "./components/BuildDetail.vue";
import SkillBar from "./components/SkillBar.vue";
import TeamDetail from "./components/TeamDetail.vue";

const props = defineProps<{
  host: ToolsHost;
  mode: "standalone" | "embedded";
  visible: boolean;
}>();
const emit = defineEmits<{
  close: [];
  ready: [];
}>();

const controller = useLibrary(props.host);
const panel = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const mobileView = ref<"list" | "detail">("list");
const position = ref({ left: 28, top: 42 });

const count = computed(() => controller.items.value.length);
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      requestAnimationFrame(() => search.value?.focus());
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
  if ("skills" in value) controller.select({ kind: "build", id: value.id });
  else controller.select({ kind: "team", id: value.id });
  mobileView.value = "detail";
};

const openTeam = (id: string) => {
  controller.select({ kind: "team", id: teamId(id) });
  mobileView.value = "detail";
};

const startDrag = (event: PointerEvent) => {
  if (props.mode !== "embedded" || !panel.value) return;
  if ((event.target as Element).closest("button, input, select")) return;
  const element = panel.value;
  const box = element.getBoundingClientRect();
  const offsetX = event.clientX - box.left;
  const offsetY = event.clientY - box.top;
  element.setPointerCapture(event.pointerId);
  element.dataset.dragging = "";
  const move = (next: PointerEvent) => {
    const left = Math.max(
      0,
      Math.min(window.innerWidth - element.offsetWidth, next.clientX - offsetX),
    );
    const top = Math.max(
      0,
      Math.min(window.innerHeight - element.offsetHeight, next.clientY - offsetY),
    );
    position.value = { left, top };
  };
  const finish = () => {
    delete element.dataset.dragging;
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", finish);
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", finish);
};

const onKeydown = (event: KeyboardEvent) => {
  if (!props.visible) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
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
  if (event.key === "Escape" && props.mode === "embedded") emit("close");
};

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
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
      :style="mode === 'embedded' ? { left: `${position.left}px`, top: `${position.top}px` } : undefined"
      aria-label="GWonMac Tools"
    >
      <header class="ui-panel-head window-bar" @pointerdown="startDrag">
        <div class="window-brand" aria-hidden="true">GW</div>
        <div class="window-identity">
          <h1 class="ui-panel-title">GWonMac Tools</h1>
          <p class="ui-field-hint">{{ host.label }} · Vue workbench</p>
        </div>
        <span v-if="controller.saving.value" class="ui-chip" data-level="warn" role="status">Saving…</span>
        <span v-else class="ui-chip" data-level="good">Ready</span>
        <button
          v-if="mode === 'embedded'"
          class="ui-button window-close"
          data-icon
          aria-label="Close GWonMac Tools"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

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
            <div class="ui-segment" data-fill role="tablist" aria-label="Library type">
              <button
                role="tab"
                :aria-selected="controller.kind.value === 'team'"
                @click="controller.selectKind('team')"
              >
                Teams
                <small>{{ controller.library.value.teams.length }}</small>
              </button>
              <button
                role="tab"
                :aria-selected="controller.kind.value === 'build'"
                @click="controller.selectKind('build')"
              >
                Builds
                <small>{{ controller.library.value.builds.length }}</small>
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

            <div class="tag-filters" aria-label="Filter by tag">
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
            <span>{{ count }} {{ controller.kind.value === "build" ? "builds" : "teams" }}</span>
            <button
              class="ui-link"
              :disabled="!controller.canUndo.value"
              @click="controller.undo"
            >
              Undo <kbd class="ui-kbd">⌘Z</kbd>
            </button>
          </div>

          <div class="library-list" role="listbox" :aria-label="`${controller.kind.value} library`">
            <button
              v-for="value in controller.items.value"
              :key="value.id"
              class="ui-row library-row"
            :data-child="'parent' in value && value.parent ? '' : undefined"
              role="option"
              :aria-selected="controller.selectedId.value === value.id"
              @click="select(value)"
            >
              <span class="row-title">
                <span class="ui-row-title">
                  <i v-if="value.favourite" aria-label="Favourite">★</i>
                  {{ value.name }}
                </span>
                <em v-if="'mode' in value">{{ value.mode === "hard" ? "Hard" : value.mode === "normal" ? "Normal" : "Unspecified" }}</em>
                <em v-else>{{ value.professions[0] }}</em>
              </span>

              <template v-if="'skills' in value">
                <SkillBar :skills="value.skills" :catalogue="controller.skills" compact />
                <span v-if="value.parent" class="row-meta">
                  {{
                    buildById(controller.library.value, value.parent)
                      ? `${buildDifference(buildById(controller.library.value, value.parent)!, value)} changes`
                      : "independent"
                  }}
                </span>
                <span v-else class="row-meta">
                  {{ controller.usage(value.id).length }} linked teams
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
                    :title="heroLabel(slot.hero)"
                  >
                    {{ slot.build ? buildById(controller.library.value, slot.build)?.professions[0] : "–" }}
                  </i>
                </span>
                <span class="row-meta">
                  {{ value.slots.filter((slot) => slot.build).length }}/8 ready
                </span>
              </template>
            </button>

            <div v-if="!controller.items.value.length" class="ui-empty">
              <strong>No matches</strong>
              <p>Try another skill, hero, build name, or clear the selected tag.</p>
              <button class="ui-button" @click="controller.query.value = ''; controller.tag.value = null">
                Clear filters
              </button>
            </div>
          </div>

          <footer class="library-footer">
            <button v-if="host.reset" class="ui-link" @click="controller.reset">
              Reset demo
            </button>
            <span>Changes stay local</span>
          </footer>
        </aside>

        <main class="detail-pane">
          <button class="mobile-back" @click="mobileView = 'list'">
            ← Library
          </button>
          <BuildDetail
            v-if="controller.selectedBuild.value"
            :build="controller.selectedBuild.value"
            :controller="controller"
            @open-team="openTeam"
          />
          <TeamDetail
            v-else-if="controller.selectedTeam.value"
            :team="controller.selectedTeam.value"
            :controller="controller"
          />
          <div v-else class="ui-empty empty-state--detail">
            <strong>Select something to inspect</strong>
            <p>The library and detail view stay connected without duplicating state.</p>
          </div>
        </main>
      </div>

      <Transition name="notice">
        <div
          v-if="controller.notice.value"
          class="ui-toast notice"
          :data-tone="controller.notice.value.tone"
          role="status"
        >
          <span>{{ controller.notice.value.message }}</span>
          <button
            v-if="controller.canUndo.value && controller.notice.value.tone !== 'error'"
            class="ui-link"
            @click="controller.undo"
          >
            Undo
          </button>
        </div>
      </Transition>
    </section>
  </div>
</template>
