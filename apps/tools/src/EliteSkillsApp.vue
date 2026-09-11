<!-- Elite skill discovery and one capture plan shared by both native maps. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { EliteMapView } from "../../../src/shared/elite-map";
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { eliteContinent, eliteLearned, type EliteLocation, type EliteViewPreferences } from "../../../src/shared/elite-skills";
import { guildWarsMapName } from "../../../src/shared/guild-wars-map-names";
import { liveParty, unavailableParty } from "../../../src/shared/builds/live-party";
import { PROFESSIONS } from "../../../src/shared/builds/heroes";
import { skillId, type Profession } from "../../../src/shared/builds/library";
import type { SkillCatalogue, SkillPresentation } from "./skill-catalog";
import { useEliteTracking, type EliteTrackingHost } from "./use-elite-tracking";
import SkillDetails from "./components/SkillDetails.vue";
import EliteMarkers from "./components/EliteMarkers.vue";
import EliteFilters from "./components/EliteFilters.vue";
import "./styles/elite-skills.css";
const props = defineProps<{
  view: EliteMapView; catalogue: SkillCatalogue; catalogueVersion: number;
  catalogueProblem: string; trackingHost: EliteTrackingHost;
  openWiki: (location: EliteLocation, page: "boss" | "skill") => void | Promise<void>;
  reloadSkills: () => void;
}>();
const emit = defineEmits<{ openChange: [open: boolean] }>();
const open = ref(false);
const wikiProblem = ref("");
const selectedId = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);
const mapTrigger = ref<HTMLButtonElement | null>(null);
const detailBack = ref<HTMLButtonElement | null>(null);
const filters = ref<InstanceType<typeof EliteFilters> | null>(null);
const panel = ref<HTMLElement | null>(null);
let resultsScroll = 0;
const character = computed(() => props.view.characterKey);
const plan = useEliteTracking(character, props.trackingHost);
const { tracking, busy, loaded, problem } = plan;
const preferences = computed(() => tracking.value.view);
function updatePreferences(value: Partial<EliteViewPreferences>) {
  plan.change({ kind: "view", view: { ...preferences.value, ...value } });
}
function resetFilters() {
  updatePreferences({ search: "", professions: { kind: "all" }, region: "", mode: "browse", hideLearned: false, focusedSkill: null });
}
const party = shallowRef(unavailableParty());
watch(() => props.view.observation, (observation) => { party.value = liveParty(observation); }, { immediate: true });
const detailsSkill = computed(() => selectedId.value === null ? null : skill(selectedId.value));
const active = computed(() => ELITE_LOCATIONS.find((entry) => entry.id === tracking.value.activeLocation) ?? null);
const blocked = computed(() => !loaded.value || problem.value !== "");
const preview = ref<{ location: EliteLocation; x: number; y: number; keyboard: boolean } | null>(null);
const previewElement = ref<HTMLElement | null>(null);
let previewClose: ReturnType<typeof setTimeout> | undefined;
function keepPreview() { clearTimeout(previewClose); }
function hidePreview() {
  keepPreview();
  previewClose = setTimeout(() => { preview.value = null; }, 100);
}
function dismissPreview(event: KeyboardEvent) {
  if (!preview.value) return;
  keepPreview(); preview.value = null;
  event.preventDefault(); event.stopPropagation();
}
function skill(id: number): SkillPresentation {
  void props.catalogueVersion;
  return props.catalogue.get(skillId(id));
}
const learned = (id: number) => eliteLearned(id, party.value.characterSkills);
const tracked = (id: number) => tracking.value.skills.includes(id);
const selectedProfessions = computed(() => {
  const filter = preferences.value.professions;
  if (filter.kind === "all") return null;
  if (filter.kind === "custom") return filter.values;
  return party.value.player?.professions?.filter((value): value is Profession => value !== null) ?? [];
});
const filterSummary = computed(() => {
  const pref = preferences.value;
  return [pref.focusedSkill !== null ? skill(pref.focusedSkill).name : pref.search ? `“${pref.search}”` : "",
    pref.mode === "tracked" ? "Tracked" : "",
    selectedProfessions.value === null ? "All professions" : selectedProfessions.value.length
      ? selectedProfessions.value.map(name => PROFESSIONS[name].name).join(" + ") : "My professions unavailable",
    pref.hideLearned ? "Hide learned" : "", pref.region].filter(Boolean).join(" · ");
});
const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const matching = computed(() => {
  const needle = normalized(preferences.value.search.trim());
  return ELITE_LOCATIONS.filter((entry) => {
    const info = skill(entry.skillId);
    if (!props.catalogue.has(skillId(entry.skillId)) || !info.elite) return false;
    if (selectedProfessions.value && (!info.profession || !selectedProfessions.value.includes(info.profession))) return false;
    if (preferences.value.focusedSkill !== null && entry.skillId !== preferences.value.focusedSkill) return false;
    if (preferences.value.region && entry.region !== preferences.value.region) return false;
    if (preferences.value.mode === "tracked" && !tracked(entry.skillId)) return false;
    if (preferences.value.hideLearned && learned(entry.skillId) === "learned") return false;
    return !needle || normalized(`${info.name} ${info.attribute ?? ""} ${entry.boss} ${guildWarsMapName(entry.mapId)}`).includes(needle);
  });
});
const results = computed(() => {
  const bySkill = new Map<number, EliteLocation[]>();
  for (const entry of matching.value) {
    const entries = bySkill.get(entry.skillId) ?? [];
    entries.push(entry); bySkill.set(entry.skillId, entries);
  }
  return [...bySkill].map(([id, locations]) => ({ skill: skill(id), locations }))
    .sort((a, b) => a.skill.name.localeCompare(b.skill.name));
});
const selectedLocations = computed(() => ELITE_LOCATIONS.filter((entry) => entry.skillId === selectedId.value)
  .sort((a, b) => Number(b.mapId === props.view.mapId) - Number(a.mapId === props.view.mapId) || a.boss.localeCompare(b.boss)));
const worldLocations = computed(() => matching.value.filter((entry) => eliteContinent(entry.region) === props.view.world?.continent));
const missionLocations = computed(() => matching.value.filter((entry) => entry.mapId === props.view.mapId));
const missionSurface = computed(() => {
  const mission = props.view.mission;
  return mission?.transform ? { box: mission.box, transform: mission.transform } : null;
});
const panelStyle = computed(() => {
  const box = props.view.world?.box;
  return box ? { top: `${box.top + 12}px`, right: `${Math.max(12, window.innerWidth - box.left - box.width + 12)}px`,
    maxHeight: `${Math.max(140, Math.min(box.height - 24, window.innerHeight - box.top - 24))}px` } : {};
});
const trackerStyle = computed(() => {
  const box = props.view.mission?.box;
  return box ? { left: `${box.left + 8}px`, top: `${box.top + 8}px`, right: "auto", maxWidth: `${Math.max(140, box.width - 16)}px` } : {};
});
const missionMessage = computed(() => {
  if (!tracking.value.missionMap) return "Mission map markers are off.";
  if (props.view.mission && !props.view.mission.transform) return "Boss markers are unavailable in this area. Use the capture notes.";
  if (!active.value) return `${new Set(missionLocations.value.map(entry => entry.skillId)).size} matching skills in this area.`;
  if (active.value.points.length === 0) return "Boss position unavailable. Use the encounter notes.";
  if (active.value.mapId !== props.view.mapId) return `Target is in ${guildWarsMapName(active.value.mapId)}.`;
  if (!props.view.mission) return "Open the mission map to see capture locations.";
  return "Known spawn location; this is not a live boss position.";
});
async function showWiki(location: EliteLocation, page: "boss" | "skill") {
  wikiProblem.value = "";
  try { await props.openWiki(location, page); }
  catch { wikiProblem.value = "The wiki could not open. Try the link again."; }
}
function setOpen(value: boolean, keyboard = false, remember = true) {
  if (remember) updatePreferences({ panelOpen: value });
  keepPreview(); open.value = value; preview.value = null;
  emit("openChange", value);
  if (keyboard) void nextTick(() => {
    const target = value ? selectedId.value === null ? filters.value?.searchInput : detailBack.value
      : mapTrigger.value;
    target?.focus({ preventScroll: true });
  });
}
function browse(event?: MouseEvent) {
  setOpen(true, event?.detail === 0);
}
function find(id: number) {
  if (!ELITE_LOCATIONS.some((entry) => entry.skillId === id)) return;
  selectedId.value = id;
  focusSkill(id);
  browse();
}
function selectLocation(location: EliteLocation, keyboard = false) {
  resultsScroll = panel.value?.scrollTop ?? resultsScroll;
  selectedId.value = location.skillId;
  void nextTick(() => { if (panel.value) panel.value.scrollTop = 0; });
  setOpen(true, keyboard);
}
function inspect(location: EliteLocation | null, x: number, y: number, keyboard = false) {
  if (!location) { hidePreview(); return; }
  keepPreview();
  const next = { location, x: Math.max(8, Math.min(window.innerWidth - 328, x + 20)),
    y: Math.max(8, Math.min(window.innerHeight - 200, y + 16)), keyboard };
  preview.value = next;
  const shown = preview.value;
  void nextTick(() => {
    if (preview.value !== shown || !previewElement.value) return;
    next.y = Math.max(8, Math.min(next.y, window.innerHeight - previewElement.value.offsetHeight - 8));
    preview.value = { ...next };
  });
}
function inspectRow(location: EliteLocation, event: PointerEvent | FocusEvent) {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const box = event.currentTarget.getBoundingClientRect();
  inspect(location, box.left - 352, box.top - 16, event.type === "focus");
}
function showDetails(id: number, event: MouseEvent) {
  resultsScroll = panel.value?.scrollTop ?? 0;
  selectedId.value = id; preview.value = null;
  void nextTick(() => {
    if (panel.value) panel.value.scrollTop = 0;
    if (event.detail === 0) detailBack.value?.focus({ preventScroll: true });
  });
}
function focusSkill(id: number) {
  updatePreferences({ search: "", focusedSkill: id, professions: { kind: "all" }, region: "", mode: "browse", hideLearned: false, worldMap: true });
}
function back(event?: MouseEvent) {
  const id = selectedId.value;
  selectedId.value = null;
  void nextTick(() => {
    if (panel.value) panel.value.scrollTop = resultsScroll;
    if (event?.detail !== 0) return;
    const row = root.value?.querySelector<HTMLButtonElement>(`[data-skill-id="${id}"]`);
    (row ?? filters.value?.searchInput)?.focus({ preventScroll: true });
  });
}
function close(event?: MouseEvent) {
  const keyboard = event ? event.detail === 0 : root.value?.contains(document.activeElement) === true;
  setOpen(false, keyboard);
}
function cannotCapture(location: EliteLocation) { return /impossible to capture/i.test(location.note ?? ""); }
function toggleTrack(id: number) { void plan.change({ kind: tracked(id) ? "remove" : "track", skillId: id }); }
watch(character, () => { selectedId.value = null; preview.value = null; resultsScroll = 0; setOpen(false, false, false); });
watch(() => [Boolean(props.view.world), loaded.value] as const, ([world, ready], [previous]) => {
  if (!world && previous) setOpen(false, false, false);
  else if (world && ready) setOpen(preferences.value.panelOpen, false, false);
});
watch(() => props.view.mission, (value, previous) => {
  if (!value && previous) { preview.value = null; if (!props.view.world) setOpen(false, false, false); }
});
onBeforeUnmount(() => { keepPreview(); plan.dispose(); });
defineExpose({ find, close });
</script>
<template>
  <div ref="root" class="elite-skills-root" @keydown.esc="dismissPreview">
    <EliteMarkers v-if="view.world && preferences.worldMap && (!character || loaded)" :surface="view.world" :locations="worldLocations"
      :active-location="tracking.activeLocation" :preview-location-id="preview?.location.id ?? null" :catalogue="catalogue" label="Elite capture locations on world map" @select="selectLocation" @inspect="inspect" />
    <EliteMarkers v-if="missionSurface && tracking.missionMap && (!character || loaded)" :surface="missionSurface" :locations="missionLocations"
      :active-location="tracking.activeLocation" :preview-location-id="preview?.location.id ?? null" :catalogue="catalogue" label="Elite capture locations on mission map" @select="selectLocation" @inspect="inspect" />
    <div v-if="(view.world || view.mission) && !open" class="ui-frame elite-map-summary" :style="view.world ? panelStyle : trackerStyle">
      <label class="elite-visibility" title="Show elites on this map"><input type="checkbox" aria-label="Show elites" :checked="view.world ? preferences.worldMap : tracking.missionMap" :disabled="!!character && !loaded"
        @change="view.world ? updatePreferences({ worldMap: !preferences.worldMap }) : plan.change({ kind: 'mission-map', show: !tracking.missionMap })"></label>
      <button ref="mapTrigger" class="ui-button elite-map-trigger" aria-label="Open Elite Skills" :aria-expanded="false"
        :title="[filterSummary, view.mission && !view.world ? [active?.boss, missionMessage].filter(Boolean).join(' · ') : ''].filter(Boolean).join(' — ')" @click="browse">
        Elite skills<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>
      <span v-if="problem" class="elite-summary-problem" role="alert" :title="loaded ? 'Changes are not saved. Open Elite Skills to retry.' : 'Your setup could not load. Open Elite Skills to retry.'"
        :aria-label="loaded ? 'Changes are not saved. Open Elite Skills to retry.' : 'Your setup could not load. Open Elite Skills to retry.'">!</span>
    </div>
    <section v-if="open" class="ui-frame elite-panel" :style="panelStyle" aria-label="Elite skills">
      <header class="ui-panel-head">
        <button v-if="detailsSkill" ref="detailBack" class="ui-button elite-back" @click="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>Back to results</button>
        <h2 v-else>Elite skills</h2>
        <button class="ui-button" aria-label="Collapse Elite Skills" @click="close">Collapse</button>
      </header>
      <div ref="panel" class="ui-scroll elite-panel-content">
      <div v-if="problem" class="elite-message" role="alert">
        <p>{{ problem }}</p><button class="ui-button" :disabled="busy" @click="plan.retry">Retry</button>
        <button v-if="loaded" class="ui-link" @click="plan.dismissError">Restore saved setup</button>
      </div>
      <p v-if="wikiProblem" class="elite-message" role="alert">{{ wikiProblem }}</p>
      <div v-if="catalogueProblem" class="elite-message" role="status"><p>{{ catalogueProblem }}</p><button class="ui-link" @click="reloadSkills">Reload skills</button></div>
      <p v-if="catalogueVersion === 0 && !catalogueProblem" class="elite-save-state" role="status">Loading skill details…</p>
      <p v-if="!view.characterKey" class="elite-message">Select a PvE character to save a capture plan. You can still browse.</p>
      <p v-else class="elite-save-state" role="status">{{ busy ? loaded ? 'Saving setup…' : 'Loading your setup…' : problem ? 'Changes not saved' : 'Saved for this character' }}</p>
      <template v-if="detailsSkill">
        <div class="elite-detail-toolbar"><button class="ui-button" :aria-pressed="tracked(detailsSkill.id)" :disabled="blocked" @click="toggleTrack(detailsSkill.id)">{{ tracked(detailsSkill.id) ? 'Stop tracking skill' : 'Track skill' }}</button><button class="ui-button" :disabled="!!character && !loaded" @click="focusSkill(detailsSkill.id)">Show only this skill</button></div>
        <div class="ui-scroll elite-detail-scroll">
          <SkillDetails :skill="detailsSkill" />
          <p class="elite-learned" :data-learned="learned(detailsSkill.id)">{{ learned(detailsSkill.id) === 'learned' ? 'Learned by this character' : learned(detailsSkill.id) === 'not-learned' ? 'Not learned by this character' : 'Learned status unavailable' }}</p>
          <h3>Capture locations</h3>
          <div v-for="location in selectedLocations" :key="location.id" class="elite-location" :data-active="active?.id === location.id">
            <div class="elite-location-heading"><strong>{{ location.boss }}</strong><span v-if="active?.id === location.id">Active</span></div>
            <p>{{ guildWarsMapName(location.mapId) }}<span v-if="location.mapId === view.mapId"> · Here now</span></p>
            <p class="elite-location-note" v-if="location.note">{{ location.note }}</p>
            <p class="elite-support">{{ location.points.length === 0 ? 'Boss position unavailable' : location.points.length > 1 ? `${location.points.length} possible positions` : 'Known spawn location' }}</p>
            <div class="elite-actions"><button class="ui-button" :disabled="blocked || cannotCapture(location)" :aria-pressed="active?.id === location.id" @click="plan.change({kind: 'target', locationId: location.id})">{{ cannotCapture(location) ? 'Cannot capture here' : active?.id === location.id ? 'Tracking this boss' : 'Track this boss' }}</button>
              <button class="ui-link" @click="showWiki(location, 'boss')">Boss wiki</button></div>
          </div>
          <button v-if="selectedLocations[0]" class="ui-link" @click="showWiki(selectedLocations[0], 'skill')">Skill wiki</button>
        </div>
      </template>
      <template v-else>
        <EliteFilters ref="filters" :preferences="preferences" :tracked-count="tracking.skills.length" :disabled="!!character && !loaded"
          :my-professions="party.player?.professions ?? null" :learned-available="!!party.characterSkills" :summary="filterSummary"
          @change="updatePreferences" @reset="resetFilters" />
        <div class="elite-results-heading"><span>{{ results.length }} {{ results.length === 1 ? 'skill' : 'skills' }}</span></div>
        <div class="elite-results">
          <div v-if="!results.length" class="ui-empty"><strong>{{ preferences.mode === 'tracked' && !tracking.skills.length ? 'Plan your first capture' : 'No matching skills' }}</strong><p>{{ preferences.mode === 'tracked' && !tracking.skills.length ? 'Browse skills and track one you want to learn.' : 'Try another name or clear the filters.' }}</p><button class="ui-button" @click="resetFilters">Show all skills</button></div>
          <div v-for="result in results" :key="result.skill.id" class="elite-result">
            <button class="elite-result-main" :data-skill-id="result.skill.id" :aria-describedby="preview?.location.skillId === result.skill.id ? 'elite-skill-preview' : undefined" @click="showDetails(result.skill.id, $event)" @pointerenter="inspectRow(result.locations[0]!, $event)" @pointerleave="hidePreview" @focus="inspectRow(result.locations[0]!, $event)" @blur="hidePreview">
              <span class="ui-slot elite-skill-icon" :data-profession="result.skill.profession" data-elite><img v-if="result.skill.iconUrl" :src="result.skill.iconUrl" alt="" draggable="false"><span v-else>{{ result.skill.profession?.slice(0, 1) ?? '?' }}</span></span>
              <span><strong>{{ result.skill.name }}</strong><small>{{ result.skill.profession ? PROFESSIONS[result.skill.profession].name : 'Profession unavailable' }} · {{ result.locations.length }} {{ result.locations.length === 1 ? 'location' : 'locations' }}</small><small v-if="learned(result.skill.id) === 'learned'">Learned</small></span>
            </button>
            <button class="ui-button elite-track-button" :aria-label="`${tracked(result.skill.id) ? 'Stop tracking' : 'Track'} ${result.skill.name}`" :aria-pressed="tracked(result.skill.id)" :disabled="blocked" @click="toggleTrack(result.skill.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg></button>
          </div>
        </div>
      </template>
      </div>
      <footer class="elite-panel-footer">
        <label class="elite-check"><input type="checkbox" :checked="tracking.missionMap" :disabled="blocked" @change="plan.change({ kind: 'mission-map', show: !tracking.missionMap })"> Show elites on mission map</label>
        <p v-if="active">{{ missionMessage }}</p>
        <p v-else-if="!view.world">Open the world map to view capture locations.</p>
        <label class="elite-check"><input type="checkbox" :checked="preferences.worldMap" :disabled="!!character && !loaded" @change="updatePreferences({ worldMap: !preferences.worldMap })"> Show world map markers</label>
      </footer>
    </section>
    <aside v-if="preview" id="elite-skill-preview" ref="previewElement" class="ui-frame elite-preview" :data-keyboard="preview.keyboard ? '' : undefined" @pointerenter="keepPreview" @pointerleave="hidePreview" :style="{ left: `${preview.x}px`, top: `${preview.y}px` }" role="tooltip">
      <div class="ui-scroll elite-preview-content">
        <SkillDetails :skill="skill(preview.location.skillId)" />
        <p>{{ preview.location.boss }} · {{ guildWarsMapName(preview.location.mapId) }}</p>
      </div>
    </aside>
  </div>
</template>
