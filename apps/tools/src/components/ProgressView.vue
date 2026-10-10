<script setup lang="ts">
/**
 * The Hub's Progress page: one title goal at a time, and only what that goal
 * still needs. Every count comes from the same entries the list shows.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { HUB_SEARCH_GLYPH } from "../../../../src/shared/ui/hub-search";
import { listIndexAfter, listKeyStep, listPage } from "../../../../src/shared/ui/list-keys";
import { hubTier, normaliseHubQuery, type HubViewFooter } from "../../../../src/shared/hub";
import { isHubBackKey } from "../../../../src/shared/keyboard-shortcuts";
import {
  PROGRESS_CAMPAIGNS,
  PROGRESS_GOAL_WORDS,
  currentProgressCampaign,
  progressGoals,
  progressTravelTarget,
  type GameProgressState,
  type ProgressCampaignId,
  type ProgressEntry,
  type ProgressGoal,
  type ProgressGoalId,
  type ProgressInputs,
} from "../../../../src/shared/game-progress";
import type { TravelGameState } from "../../../../src/shared/travel-command";

export type ProgressViewResume = Readonly<{
  campaign: ProgressCampaignId | null;
  goal: ProgressGoalId | null;
  query: string;
  showFinished: boolean;
}>;

const props = defineProps<{
  progress: Ref<GameProgressState>;
  travelState: Ref<TravelGameState>;
  footer: HubViewFooter;
  hubParent: boolean;
  resume?: ProgressViewResume;
  /** Goal last chosen per campaign, a reactive map the host keeps while the game runs. */
  goalChoice: Map<ProgressCampaignId, ProgressGoalId>;
  travel(mapId: number): Promise<void>;
  showInTravel(name: string): void;
}>();
const emit = defineEmits<{ close: []; travelled: []; remember: [state: ProgressViewResume] }>();

const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const query = ref(props.resume?.query ?? "");
const showFinished = ref(props.resume?.showFinished ?? false);
const active = ref(0);
const feedback = ref("");

const ready = computed(() => {
  const value = props.progress.value;
  return value.status === "ready" ? value : null;
});
const inputs = computed<ProgressInputs | null>(() => {
  const progress = ready.value;
  if (progress === null) return null;
  const travel = props.travelState.value;
  return { progress, unlockedMapWords: travel.status === "ready" ? travel.unlockedMapWords : null };
});
const here = computed(() => ready.value === null ? null : currentProgressCampaign(ready.value));
const campaign = ref<ProgressCampaignId>(props.resume?.campaign ?? here.value ?? "prophecies");
// The page opens where the player is until the player picks a campaign.
let campaignChosen = props.resume?.campaign != null;
watch(here, (next) => { if (!campaignChosen && next !== null) campaign.value = next; });

const goals = computed<readonly ProgressGoal[]>(() =>
  inputs.value === null ? [] : progressGoals(campaign.value, inputs.value));
const goal = computed<ProgressGoal | null>(() => {
  const wanted = props.goalChoice.get(campaign.value) ?? props.resume?.goal;
  return goals.value.find((candidate) => candidate.id === wanted) ?? goals.value[0] ?? null;
});
function chooseGoal(id: ProgressGoalId): void {
  props.goalChoice.set(campaign.value, id);
  active.value = 0;
}
const selectedGoal = goal;
function chooseCampaign(id: ProgressCampaignId): void {
  campaignChosen = true;
  campaign.value = id;
  active.value = 0;
}

type Row =
  | Readonly<{ kind: "suggestion"; key: string; campaign: ProgressCampaignId; goal: ProgressGoal }>
  | Readonly<{ kind: "entry"; key: string; region: string; campaign: ProgressCampaignId; entry: ProgressEntry }>;

const hasQuery = computed(() => normaliseHubQuery(query.value).length > 0);
/** Search covers every campaign; a goal word first offers that goal. */
const rows = computed<readonly Row[]>(() => {
  const current = inputs.value;
  if (current === null) return [];
  if (!hasQuery.value) {
    const chosen = selectedGoal.value;
    if (chosen === null) return [];
    // One heading per region: regions keep the order they first appear in.
    const regions = [...new Set(chosen.entries.map((entry) => entry.item.region))];
    return chosen.entries
      .filter((entry) => showFinished.value || entry.status !== "done")
      .map((entry) => ({ kind: "entry" as const, key: `${chosen.id}:${entry.item.mapId}`, region: entry.item.region, campaign: campaign.value, entry }))
      .sort((a, b) => regions.indexOf(a.region) - regions.indexOf(b.region));
  }
  const term = normaliseHubQuery(query.value);
  const suggestions: Row[] = [];
  const found: Row[] = [];
  const seen = new Set<string>();
  for (const candidate of PROGRESS_CAMPAIGNS) {
    for (const each of progressGoals(candidate.id, current)) {
      if (candidate.id === campaign.value && hubTier({ title: each.name, aliases: PROGRESS_GOAL_WORDS[each.id] }, term) !== null) {
        suggestions.push({ kind: "suggestion", key: `goal:${each.id}`, campaign: candidate.id, goal: each });
      }
      for (const entry of each.entries) {
        const key = `${candidate.id}:${entry.item.kind}:${entry.item.mapId}`;
        if (seen.has(key) || hubTier({ title: entry.item.name }, term) === null) continue;
        seen.add(key);
        found.push({ kind: "entry", key: `${each.id}:${entry.item.mapId}`, region: `${candidate.name} · ${entry.item.region}`, campaign: candidate.id, entry });
      }
    }
  }
  return [...suggestions, ...found];
});
watch(rows, (next) => { if (active.value >= next.length) active.value = Math.max(0, next.length - 1); });
watch(query, () => { active.value = 0; });
const activeRow = computed(() => rows.value[active.value] ?? null);

/** Region headings sit above the first row of each region. */
const headingBefore = (index: number) => {
  const row = rows.value[index];
  if (!row || row.kind !== "entry") return null;
  const previous = rows.value[index - 1];
  return previous?.kind === "entry" && previous.region === row.region ? null : row.region;
};

const target = computed(() => {
  const row = activeRow.value;
  return row?.kind === "entry" && inputs.value !== null ? progressTravelTarget(row.entry.item, inputs.value) : null;
});
const primaryLabel = computed(() => {
  const row = activeRow.value;
  if (row === null) return "Done";
  if (row.kind === "suggestion") return `Show ${row.goal.name}`;
  const to = target.value;
  if (to === null) return "No unlocked outpost nearby";
  if (to.here) return `You are in ${to.name}`;
  return `Travel to ${to.name}${to.nearest ? " (nearest)" : ""}`;
});
const primaryDisabled = computed(() => {
  const row = activeRow.value;
  return row !== null && row.kind === "entry" && (target.value === null || target.value.here);
});
async function runActive(): Promise<void> {
  const row = activeRow.value;
  if (row === null) { emit("close"); return; }
  if (row.kind === "suggestion") {
    query.value = "";
    chooseGoal(row.goal.id);
    return;
  }
  const to = target.value;
  if (to === null || to.here) return;
  try {
    await props.travel(to.mapId);
    emit("travelled");
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Travel did not start.";
  }
}
watch([primaryLabel, primaryDisabled], () => {
  props.footer.primary({ label: primaryLabel.value, disabled: primaryDisabled.value, run: runActive });
}, { immediate: true });
const actionsItem = computed(() => activeRow.value?.kind === "entry" ? activeRow.value.entry.item : null);
watch(actionsItem, (item) => {
  props.footer.secondary(item === null ? null : {
    label: "Show in Travel",
    run: () => props.showInTravel(item.name),
  });
}, { immediate: true });

function statusMark(entry: ProgressEntry): string {
  return entry.status === "done" ? "ok" : entry.status === "needs-reward" ? "need" : entry.status === "locked" ? "lock" : "not";
}
function travelHint(row: Row): string {
  if (row.kind !== "entry" || inputs.value === null) return "";
  const to = progressTravelTarget(row.entry.item, inputs.value);
  if (to === null) return "";
  if (to.here) return "You are here";
  return to.nearest ? `Near ${to.name}` : "";
}
/** The campaign is chosen above, so a card drops "of Tyria". */
const shortName = (goal: ProgressGoal) => goal.name.replace(/ of (Tyria|Cantha|Elona)$/u, "");
const percent = (goal: ProgressGoal) => goal.percent ?? (goal.total === 0 ? 0 : Math.round(goal.done / goal.total * 100));
const goalCount = (goal: ProgressGoal) => goal.id === "cartographer"
  ? goal.percent === null ? "Unknown" : `${goal.percent.toFixed(1)}%`
  : `${goal.done} / ${goal.total}`;
const goalLeft = (goal: ProgressGoal) => goal.id === "cartographer" || goal.unit === null ? ""
  : goal.done === goal.total ? "Complete" : `${goal.total - goal.done} left`;
const cartographer = computed(() => PROGRESS_CAMPAIGNS.flatMap((each) => {
  if (each.cartographer === null || each.continent === null) return [];
  return [{ continent: each.continent, percent: ready.value?.cartographer?.[each.cartographer] ?? null }];
}));

const waitingText = computed(() => {
  const value = props.progress.value;
  if (value.status === "ready") return null;
  return value.reason === "loading"
    ? "Map loading. Progress returns when the map has loaded."
    : "Progress appears when your character is in an outpost or explorable area.";
});
const unknownText = computed(() => ready.value !== null && goals.value.length === 0
  ? "Guild Wars did not report this character's progress. Try again after the next map change." : null);

async function moveActive(step: number): Promise<void> {
  active.value = Math.max(0, listIndexAfter(active.value, rows.value.length, step));
  await nextTick();
  root.value?.querySelector(`[data-row="${active.value}"]`)?.scrollIntoView({ block: "nearest" });
}
function stepGoal(direction: number): void {
  const list = goals.value;
  const index = list.findIndex((candidate) => candidate.id === selectedGoal.value?.id);
  const next = list[Math.max(0, Math.min(list.length - 1, index + direction))];
  if (next) chooseGoal(next.id);
}
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  const step = event.target === input.value
    ? listKeyStep(event, listPage(root.value?.querySelector<HTMLElement>(".progress-list"), root.value?.querySelector<HTMLElement>("[data-row]")))
    : null;
  if (step !== null) { event.preventDefault(); void moveActive(step); return; }
  // ← → change the goal while the search is empty; with a query they move the caret.
  if (plain && !hasQuery.value && (event.key === "ArrowLeft" || event.key === "ArrowRight") && event.target === input.value) {
    event.preventDefault();
    stepGoal(event.key === "ArrowLeft" ? -1 : 1);
    return;
  }
  if (event.key === "Escape" || isHubBackKey(event)) {
    event.preventDefault();
    if (event.repeat) return;
    if (hasQuery.value) query.value = "";
    else emit("close");
    return;
  }
  if (plain && event.key === "Enter" && event.target === input.value) {
    event.preventDefault();
    if (!event.repeat && !primaryDisabled.value) void runActive();
  }
}

onBeforeUnmount(() => {
  emit("remember", { campaign: campaign.value, goal: selectedGoal.value?.id ?? null, query: query.value, showFinished: showFinished.value });
  props.footer.secondary(null);
});
void nextTick(() => input.value?.focus());
</script>

<template>
  <section ref="root" class="progress-view" @keydown="onKeydown">
    <div class="travel-search">
      <label for="progress-search-input" class="ui-hub-search"><svg class="travel-search-icon" viewBox="0 0 24 24" aria-hidden="true" v-html="HUB_SEARCH_GLYPH"></svg><input id="progress-search-input" ref="input" v-model="query" role="combobox" aria-label="Search missions, areas and outposts" aria-controls="progress-list" aria-autocomplete="list" aria-haspopup="listbox" :aria-expanded="rows.length > 0" :aria-activedescendant="activeRow ? `progress-row-${active}` : undefined" autocomplete="off" spellcheck="false" maxlength="60" placeholder="Search missions, areas and outposts…"></label>
    </div>

    <p v-if="waitingText" class="ui-empty progress-empty" role="status"><strong>Progress</strong><span>{{ waitingText }}</span></p>
    <p v-else-if="unknownText" class="ui-empty progress-empty" role="status"><strong>Progress</strong><span>{{ unknownText }}</span></p>
    <template v-else>
      <div v-if="!hasQuery" class="progress-campaigns ui-segment" role="group" aria-label="Campaign">
        <button v-for="each in PROGRESS_CAMPAIGNS" :key="each.id" type="button" :aria-pressed="each.id === campaign" @click="chooseCampaign(each.id)">
          {{ each.name }}<span v-if="each.id === here" class="progress-here" title="You are in this campaign" aria-label="(you are here)"></span>
        </button>
      </div>

      <div v-if="!hasQuery" class="progress-goals" role="tablist" aria-label="Goal">
        <button v-for="each in goals" :key="each.id" type="button" role="tab" class="progress-goal" :class="{ 'progress-goal-minor': each.minor }" :aria-selected="each.id === selectedGoal?.id" tabindex="-1" @mousedown.prevent @click="chooseGoal(each.id)">
          <span class="progress-goal-name" :title="each.name">{{ shortName(each) }}</span>
          <span class="progress-goal-count">{{ goalCount(each) }}</span>
          <small>{{ goalLeft(each) }}</small>
          <span class="ui-progress" aria-hidden="true"><span class="ui-progress-fill" :style="{ width: `${percent(each)}%` }"></span></span>
        </button>
      </div>

      <div v-if="!hasQuery && selectedGoal" class="progress-rule">
        <p>{{ selectedGoal.rule }}</p>
        <label v-if="selectedGoal.total > 0" class="ui-check"><input v-model="showFinished" type="checkbox"> Show finished</label>
      </div>

      <div v-if="!hasQuery && selectedGoal?.id === 'cartographer'" class="progress-cartographer">
        <div v-for="each in cartographer" :key="each.continent" class="progress-carto-row">
          <span>{{ each.continent }}</span>
          <span class="ui-progress" aria-hidden="true"><span class="ui-progress-fill" :style="{ width: `${each.percent ?? 0}%` }"></span></span>
          <strong>{{ each.percent === null ? "Unknown" : `${each.percent.toFixed(1)}%` }}</strong>
        </div>
      </div>
      <template v-else>
        <div v-if="rows.length" id="progress-list" class="progress-list ui-scroll" role="listbox" aria-label="Progress">
          <template v-for="(row, index) in rows" :key="row.key">
            <div v-if="headingBefore(index)" class="progress-region" role="presentation">{{ headingBefore(index) }}</div>
            <button :id="`progress-row-${index}`" :data-row="index" type="button" class="ui-row progress-row" role="option" tabindex="-1" :aria-selected="index === active" @mousedown.prevent @click="active = index" @dblclick="runActive">
              <template v-if="row.kind === 'suggestion'">
                <span class="progress-row-name"><strong>Show goal: {{ row.goal.name }}</strong><small>{{ goalLeft(row.goal) || row.goal.rule }}</small></span>
                <kbd class="ui-kbd" aria-hidden="true">↵</kbd>
              </template>
              <template v-else>
                <span class="progress-row-name"><strong>{{ row.entry.item.name }}</strong><small>{{ travelHint(row) }}</small></span>
                <span class="progress-status" :data-mark="statusMark(row.entry)">{{ row.entry.label }}</span>
              </template>
            </button>
          </template>
        </div>
        <p v-else-if="hasQuery" class="ui-empty progress-empty" role="status"><strong>No match</strong><span>No mission, area or outpost is called “{{ query }}”.</span></p>
        <p v-else class="ui-empty progress-empty" role="status"><strong>Nothing left here</strong><span>{{ selectedGoal?.name }} is complete for this character.</span></p>
      </template>
    </template>
    <span class="ui-sr-only" role="status" aria-live="polite">{{ feedback }}</span>
    <p v-if="feedback" class="ui-status-line" data-tone="warning">{{ feedback }}</p>
  </section>
</template>
