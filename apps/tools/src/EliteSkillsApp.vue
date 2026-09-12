<!-- Elite skill discovery and one capture plan shared by both native maps. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { EliteMapView } from "../../../src/shared/elite-map";
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { ELITE_REGIONS, eliteContinent, eliteLearned, type EliteLocation } from "../../../src/shared/elite-skills";
import { guildWarsMapName } from "../../../src/shared/guild-wars-map-names";
import { liveParty, unavailableParty } from "../../../src/shared/builds/live-party";
import { PROFESSIONS } from "../../../src/shared/builds/heroes";
import { skillId } from "../../../src/shared/builds/library";
import type { SkillCatalogue, SkillPresentation } from "./skill-catalog";
import { useEliteTracking, type EliteTrackingHost } from "./use-elite-tracking";
import SkillDetails from "./components/SkillDetails.vue";
import EliteMarkers from "./components/EliteMarkers.vue";
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
const markersEnabled = ref(true);
const search = ref("");
const profession = ref("");
const region = ref("");
const hideLearned = ref(true);
const mode = ref<"browse" | "tracked">("browse");
const selectedId = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);
const mapTrigger = ref<HTMLButtonElement | null>(null);
const detailBack = ref<HTMLButtonElement | null>(null);
const manageTracked = ref<HTMLButtonElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const character = computed(() => props.view.characterKey);
const plan = useEliteTracking(character, props.trackingHost);
const { tracking, busy, loaded, problem } = plan;
const party = shallowRef(unavailableParty());
watch(() => props.view.observation, (observation) => { party.value = liveParty(observation); }, { immediate: true });
const detailsSkill = computed(() => selectedId.value === null ? null : skill(selectedId.value));
const active = computed(() => ELITE_LOCATIONS.find((entry) => entry.id === tracking.value.activeLocation) ?? null);
const blocked = computed(() => busy.value || !loaded.value || problem.value !== "");
const preview = ref<{ location: EliteLocation; x: number; y: number } | null>(null);
function skill(id: number): SkillPresentation {
  void props.catalogueVersion;
  return props.catalogue.get(skillId(id));
}
const learned = (id: number) => eliteLearned(id, party.value.characterSkills);
const tracked = (id: number) => tracking.value.skills.includes(id);
const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const matching = computed(() => {
  const needle = normalized(search.value.trim());
  return ELITE_LOCATIONS.filter((entry) => {
    const info = skill(entry.skillId);
    if (!props.catalogue.has(skillId(entry.skillId)) || !info.elite) return false;
    if (profession.value && info.profession !== profession.value) return false;
    if (region.value && entry.region !== region.value) return false;
    if (mode.value === "tracked" && !tracked(entry.skillId)) return false;
    // A tracked skill stays visible long enough to inspect its new learned state.
    if (mode.value === "browse" && hideLearned.value && learned(entry.skillId) === "learned" && !tracked(entry.skillId)) return false;
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
const mapLocations = computed(() => selectedId.value !== null
  ? selectedLocations.value : matching.value);
const worldLocations = computed(() => mapLocations.value.filter((entry) => eliteContinent(entry.region) === props.view.world?.continent));
const missionLocations = computed(() => ELITE_LOCATIONS.filter((entry) => entry.mapId === props.view.mapId && tracked(entry.skillId)
  && (active.value?.skillId !== entry.skillId || active.value.id === entry.id)));
const missionSurface = computed(() => {
  const mission = props.view.mission;
  return mission?.transform ? { box: mission.box, transform: mission.transform } : null;
});
const showWorldMarkers = computed(() => markersEnabled.value);
const panelStyle = computed(() => {
  const box = props.view.world?.box;
  return box ? { top: `${box.top + 12}px`, right: `${Math.max(12, window.innerWidth - box.left - box.width + 12)}px`,
    maxHeight: `${Math.max(140, Math.min(box.height - 24, window.innerHeight - box.top - 24))}px` } : {};
});
const trackerStyle = computed(() => {
  const box = props.view.mission?.box;
  return box ? { left: `${box.left + 8}px`, top: `${box.top + 8}px`, width: `${Math.max(140, Math.min(292, box.width - 16))}px` } : {};
});
const missionMessage = computed(() => {
  if (!tracking.value.missionMap) return "Mission map markers are off.";
  if (!active.value) return "Choose a boss to focus your hunt.";
  if (active.value.points.length === 0) return "Boss position unavailable. Use the encounter notes.";
  if (active.value.mapId !== props.view.mapId) return `Target is in ${guildWarsMapName(active.value.mapId)}.`;
  if (!props.view.mission) return "Open the mission map to see tracked bosses.";
  if (!props.view.mission.transform) return "Boss markers are unavailable in this area. Use the capture notes.";
  return "Known spawn location; this is not a live boss position.";
});
async function showWiki(location: EliteLocation, page: "boss" | "skill") {
  wikiProblem.value = "";
  try { await props.openWiki(location, page); }
  catch { wikiProblem.value = "The wiki could not open. Try the link again."; }
}
function setOpen(value: boolean, keyboard = false) {
  open.value = value; preview.value = null;
  emit("openChange", value);
  if (keyboard) void nextTick(() => {
    const target = value ? selectedId.value === null ? searchInput.value : detailBack.value
      : mapTrigger.value ?? manageTracked.value;
    target?.focus({ preventScroll: true });
  });
}
function browse(event?: MouseEvent) {
  setOpen(true, event?.detail === 0);
}
function find(id: number) {
  if (!ELITE_LOCATIONS.some((entry) => entry.skillId === id)) return;
  selectedId.value = id; search.value = "";
  browse();
}
function selectLocation(location: EliteLocation, keyboard = false) {
  selectedId.value = location.skillId;
  setOpen(true, keyboard);
}
function inspect(location: EliteLocation | null, x: number, y: number) {
  preview.value = location ? { location, x: Math.max(8, Math.min(window.innerWidth - 312, x + 20)),
    y: Math.max(8, Math.min(window.innerHeight - 350, y + 16)) } : null;
}
function inspectRow(location: EliteLocation, event: PointerEvent | FocusEvent) {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const box = event.currentTarget.getBoundingClientRect();
  inspect(location, box.left - 332, box.top - 16);
}
function showDetails(id: number, event: MouseEvent) {
  selectedId.value = id; preview.value = null;
  if (event.detail === 0) void nextTick(() => detailBack.value?.focus({ preventScroll: true }));
}
function back(event?: MouseEvent) {
  const id = selectedId.value;
  selectedId.value = null;
  if (event?.detail === 0) void nextTick(() => {
    const row = root.value?.querySelector<HTMLButtonElement>(`[data-skill-id="${id}"]`);
    (row ?? searchInput.value)?.focus({ preventScroll: true });
  });
}
function close(event?: MouseEvent) {
  const keyboard = event ? event.detail === 0 : root.value?.contains(document.activeElement) === true;
  setOpen(false, keyboard);
}
function cannotCapture(location: EliteLocation) { return /impossible to capture/i.test(location.note ?? ""); }
function toggleTrack(id: number) { void plan.change({ kind: tracked(id) ? "remove" : "track", skillId: id }); }
watch(character, () => { selectedId.value = null; preview.value = null; });
watch(() => props.view.world, (value, previous) => { if (!value && previous) setOpen(false); });
let choseDefaultProfession = false;
watch(() => party.value.player?.professions, (pair) => {
  if (!choseDefaultProfession && pair) { profession.value = pair[0]; choseDefaultProfession = true; }
}, { immediate: true });
onBeforeUnmount(plan.dispose);
defineExpose({ find, close });
</script>
<template>
  <div ref="root" class="elite-skills-root">
    <EliteMarkers v-if="view.world && showWorldMarkers" :surface="view.world" :locations="open ? worldLocations : ELITE_LOCATIONS.filter(entry => tracked(entry.skillId) && eliteContinent(entry.region) === view.world?.continent)"
      :active-location="tracking.activeLocation" :catalogue="catalogue" label="Elite capture locations on world map" @select="selectLocation" @inspect="inspect" />
    <EliteMarkers v-if="missionSurface && tracking.missionMap" :surface="missionSurface" :locations="missionLocations"
      :active-location="tracking.activeLocation" :catalogue="catalogue" label="Tracked capture locations on mission map" @select="selectLocation" @inspect="inspect" />
    <button v-if="view.world && !open" ref="mapTrigger" class="ui-button elite-map-trigger" :style="panelStyle" aria-label="Open Elite Skills" @click="browse">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9Z"/><path d="M12 8v8M8 12h8"/></svg>
      Elite skills <span v-if="tracking.skills.length">{{ tracking.skills.length }}</span>
    </button>
    <section v-if="open" class="ui-frame elite-panel" :style="panelStyle" aria-label="Elite skills">
      <header class="ui-panel-head">
        <button v-if="detailsSkill" ref="detailBack" class="ui-button elite-back" @click="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>Back to skills</button>
        <h2 v-else>Elite skills</h2>
        <button class="ui-button" aria-label="Close Elite Skills" @click="close">Close</button>
      </header>
      <div v-if="problem" class="elite-message" role="alert">
        <p>{{ problem }}</p><button class="ui-button" :disabled="busy" @click="plan.retry">Retry</button>
        <button v-if="loaded" class="ui-link" @click="plan.dismissError">Keep saved plan</button>
      </div>
      <p v-if="wikiProblem" class="elite-message" role="alert">{{ wikiProblem }}</p>
      <div v-if="catalogueProblem" class="elite-message" role="status"><p>{{ catalogueProblem }}</p><button class="ui-link" @click="reloadSkills">Reload skills</button></div>
      <p v-if="catalogueVersion === 0 && !catalogueProblem" class="elite-save-state" role="status">Loading skill details…</p>
      <p v-if="!view.characterKey" class="elite-message">Select a PvE character to save a capture plan. You can still browse.</p>
      <p v-else-if="busy" class="elite-save-state" role="status">{{ loaded ? 'Saving plan…' : 'Loading your plan…' }}</p>
      <template v-if="detailsSkill">
        <div class="elite-detail-toolbar"><button class="ui-button" :aria-pressed="tracked(detailsSkill.id)" :disabled="blocked" @click="toggleTrack(detailsSkill.id)">{{ tracked(detailsSkill.id) ? 'Stop tracking skill' : 'Track skill' }}</button></div>
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
        <div class="elite-search-controls">
          <label class="elite-search"><span class="elite-field-label">Search skill, boss or area</span><input ref="searchInput" v-model="search" type="search" class="ui-input" placeholder="Try Eviscerate or a boss name" /></label>
          <div class="elite-filters"><label><span class="elite-field-label">Profession</span><select v-model="profession" class="ui-select"><option value="">All professions</option><option v-for="(facts, name) in PROFESSIONS" :key="name" :value="name">{{ facts.name }}</option></select></label>
            <label><span class="elite-field-label">Capture region</span><select v-model="region" class="ui-select"><option value="">All regions</option><option v-for="name in ELITE_REGIONS" :key="name">{{ name }}</option></select></label></div>
          <label class="elite-check"><input v-model="hideLearned" type="checkbox" /> Hide learned skills</label>
          <p v-if="!party.characterSkills" class="elite-support">Learned status unavailable. All matching skills stay visible.</p>
          <div class="elite-modes" role="group" aria-label="Skills to show"><button class="ui-button" :aria-pressed="mode === 'browse'" @click="mode = 'browse'">Browse</button><button class="ui-button" :aria-pressed="mode === 'tracked'" @click="mode = 'tracked'">Tracked <span>{{ tracking.skills.length }}</span></button></div>
        </div>
        <div class="elite-results-heading"><span>{{ results.length }} {{ results.length === 1 ? 'skill' : 'skills' }}</span></div>
        <div class="ui-scroll elite-results">
          <div v-if="!results.length" class="ui-empty"><strong>{{ mode === 'tracked' && !tracking.skills.length ? 'Plan your first capture' : 'No matching skills' }}</strong><p>{{ mode === 'tracked' && !tracking.skills.length ? 'Browse skills and track one you want to learn.' : 'Try another name or clear the filters.' }}</p><button class="ui-button" @click="search = ''; profession = ''; region = ''; mode = 'browse'; hideLearned = false">Show all skills</button></div>
          <div v-for="result in results" :key="result.skill.id" class="elite-result">
            <button class="elite-result-main" :data-skill-id="result.skill.id" @click="showDetails(result.skill.id, $event)" @pointerenter="inspectRow(result.locations[0]!, $event)" @pointerleave="preview = null" @focus="inspectRow(result.locations[0]!, $event)" @blur="preview = null">
              <span class="ui-slot elite-skill-icon" :data-profession="result.skill.profession" data-elite><img v-if="result.skill.iconUrl" :src="result.skill.iconUrl" alt="" draggable="false"><span v-else>{{ result.skill.profession?.slice(0, 1) ?? '?' }}</span></span>
              <span><strong>{{ result.skill.name }}</strong><small>{{ result.skill.profession ? PROFESSIONS[result.skill.profession].name : 'Profession unavailable' }} · {{ result.locations.length }} {{ result.locations.length === 1 ? 'location' : 'locations' }}</small><small v-if="learned(result.skill.id) === 'learned'">Learned</small></span>
            </button>
            <button class="ui-button elite-track-button" :aria-label="`${tracked(result.skill.id) ? 'Stop tracking' : 'Track'} ${result.skill.name}`" :aria-pressed="tracked(result.skill.id)" :disabled="blocked" @click="toggleTrack(result.skill.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg></button>
          </div>
        </div>
      </template>
      <footer class="elite-panel-footer">
        <label class="elite-check"><input type="checkbox" :checked="tracking.missionMap" :disabled="blocked" @change="plan.change({ kind: 'mission-map', show: !tracking.missionMap })"> Show tracked on mission map</label>
        <p v-if="active">{{ missionMessage }}</p>
        <p v-else-if="!view.world">Open the world map to view capture locations.</p>
        <label class="elite-check"><input v-model="markersEnabled" type="checkbox"> Show world map markers</label>
      </footer>
    </section>
    <aside v-if="view.mission && tracking.skills.length && !view.world && !open" class="ui-frame elite-mission-tracker" :style="trackerStyle" aria-label="Elite skill tracker">
      <strong>{{ active ? skill(active.skillId).name : `${tracking.skills.length} tracked skills` }}</strong>
      <span v-if="active">{{ active.boss }}</span><p>{{ missionMessage }}</p><button ref="manageTracked" class="ui-link" @click="mode = 'tracked'; browse($event)">Manage tracked skills</button>
    </aside>
    <aside v-if="preview" class="ui-frame elite-preview" :style="{ left: `${preview.x}px`, top: `${preview.y}px` }" role="tooltip">
      <SkillDetails :skill="skill(preview.location.skillId)" />
      <p>{{ preview.location.boss }} · {{ guildWarsMapName(preview.location.mapId) }}</p>
    </aside>
  </div>
</template>
