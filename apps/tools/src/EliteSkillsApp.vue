<!-- Elite skill discovery and one capture plan shared by both native maps. The host draws the chosen markers natively. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { installResizeGrip } from "../../../src/shared/ui/resize";
import type { EliteMapView } from "../../../src/shared/elite-map";
import type { EliteMapHit, EliteMarkerScene, EliteSceneMarker } from "../../../src/shared/elite-map-scene";
import { ELITE_MISSION_MAP_MARKERS, ELITE_MISSION_MAP_MARKER_LABELS, isEliteMissionMapMarkers, type EliteMissionMapMarkers } from "../../../src/shared/elite-map-settings";
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { eliteContinent, eliteLearned, type EliteLocation, type EliteViewPreferences } from "../../../src/shared/elite-skills";
import { guildWarsMapName } from "../../../src/shared/guild-wars-map-names";
import { liveParty, unavailableParty } from "../../../src/shared/builds/live-party";
import { PROFESSIONS } from "../../../src/shared/builds/heroes";
import { skillId, type Profession } from "../../../src/shared/builds/library";
import type { SkillCatalogue, SkillPresentation } from "./skill-catalog";
import { useEliteTracking, type EliteTrackingHost } from "./use-elite-tracking";
import SkillDetails from "./components/SkillDetails.vue";
import EliteFilters from "./components/EliteFilters.vue";
import EliteCaptureLocation from "./components/EliteCaptureLocation.vue";
import "./styles/elite-skills.css";
const props = defineProps<{
  view: EliteMapView; catalogue: SkillCatalogue; catalogueVersion: number;
  catalogueProblem: string; trackingHost: EliteTrackingHost;
  openWiki: (location: EliteLocation, page: "boss" | "skill") => void | Promise<void>;
  reloadSkills: () => void;
  present?: (scene: EliteMarkerScene) => void;
  setMissionMarkers?: (mode: EliteMissionMapMarkers) => void | Promise<void>;
}>();
const emit = defineEmits<{ openChange: [open: boolean] }>();
const open = ref(false);
const wikiProblem = ref("");
const selectedId = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);
const mapTrigger = ref<HTMLButtonElement | null>(null);
const filters = ref<InstanceType<typeof EliteFilters> | null>(null);
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
const active = computed(() => ELITE_LOCATIONS.find((entry) => entry.id === tracking.value.activeLocation) ?? null);
const blocked = computed(() => !loaded.value || problem.value !== "");
const preview = ref<{ location: EliteLocation; x: number; y: number; keyboard: boolean; nearby: readonly EliteLocation[]; pinned?: boolean } | null>(null);
const nearbySkills = computed(() => [...new Map(preview.value?.nearby.map(location => [location.skillId, location])).values()]);
const previewBosses = computed(() => {
  if (!preview.value) return [];
  const locations = [preview.value.location, ...preview.value.nearby.filter(location => location.skillId === preview.value?.location.skillId)];
  return [...new Map(locations.map(location => [`${location.mapId}:${location.boss}`, location])).values()];
});
const previewElement = ref<HTMLElement | null>(null);
let previewClose: ReturnType<typeof setTimeout> | undefined;
function keepPreview() { clearTimeout(previewClose); }
function hidePreview() {
  keepPreview();
  if (preview.value?.pinned) return;
  previewClose = setTimeout(() => { preview.value = null; }, 100);
}
// The pointer reaches a preview through host UI, not the game; the host then reports no marker.
let previewHovered = false;
function enterPreview() { previewHovered = true; keepPreview(); }
// A removed card fires no pointerleave; every path that removes it releases the hover.
watch(() => preview.value === null, (gone) => { if (gone) previewHovered = false; });
function leavePreview() { previewHovered = false; hidePreview(); }
function dismissPreview(event: KeyboardEvent) {
  if (!preview.value) return;
  if (previewElement.value?.contains(document.activeElement)) {
    root.value?.querySelector<HTMLButtonElement>('.elite-marker[aria-describedby="elite-skill-preview"]')?.focus({ preventScroll: true });
  }
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
    pref.mode === "tracked" ? "Saved skills" : "",
    selectedProfessions.value === null ? "All professions" : selectedProfessions.value.length
      ? selectedProfessions.value.map(name => PROFESSIONS[name].name).join(" + ") : pref.professions.kind === "mine" ? "Current professions unavailable" : "No professions selected",
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
watch(() => matching.value.map(location => location.id).join("|"), () => { preview.value = null; });
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
const unique = (locations: readonly EliteLocation[]) => [...new Map(locations.map(location => [location.id, location])).values()];
const ready = computed(() => !character.value || loaded.value);
// The World Map is the planning surface: it shows the planner's matches and the target.
const worldLocations = computed(() => {
  const world = props.view.world;
  if (!world || !preferences.value.worldMap || !ready.value) return [];
  return unique([...(active.value ? [active.value] : []), ...matching.value]).filter((entry) => eliteContinent(entry.region) === world.continent);
});
// The Mission Map is for play: it shows only what the chosen mode asks for.
const missionLocations = computed(() => {
  const mode = props.view.missionMarkers;
  if (!props.view.mission?.transform || !ready.value || mode === "off") return [];
  const here = (entry: EliteLocation) => entry.mapId === props.view.mapId;
  const target = active.value && here(active.value) ? [active.value] : [];
  if (mode === "target") return target;
  return unique([...target, ...(mode === "saved" ? ELITE_LOCATIONS.filter(entry => here(entry) && tracked(entry.skillId)) : matching.value.filter(here))]);
});
function sceneMarkers(locations: readonly EliteLocation[]): readonly EliteSceneMarker[] {
  return locations.flatMap(location => location.points.map(([mapX, mapY], index) => ({
    key: `${location.id}:${index}`, locationId: location.id, skillId: location.skillId, mapId: location.mapId, mapX, mapY,
    iconUrl: skill(location.skillId).iconUrl, hovered: preview.value?.location.id === location.id,
    emphasis: location.id === tracking.value.activeLocation ? "target" as const : tracked(location.skillId) ? "saved" as const : "match" as const,
  })));
}
const scene = computed<EliteMarkerScene>(() => ({ world: sceneMarkers(worldLocations.value), mission: sceneMarkers(missionLocations.value) }));
watch(scene, (value) => props.present?.(value), { immediate: true });
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });
const resizeGrip = ref<HTMLButtonElement | null>(null);
const resizing = ref(false);
const draggedHeight = ref<number | null>(null);
function measureViewport() { viewport.value = { width: window.innerWidth, height: window.innerHeight }; }
onMounted(() => window.addEventListener("resize", measureViewport));
onBeforeUnmount(() => window.removeEventListener("resize", measureViewport));
const panelPosition = computed(() => {
  const box = props.view.world?.box;
  return box ? { top: `${Math.max(12, box.top + 12)}px`, right: `${Math.max(12, viewport.value.width - box.left - box.width + 12)}px` } : {};
});
const panelMaxHeight = computed(() => {
  const box = props.view.world?.box;
  const top = box ? Math.max(12, box.top + 12) : 16;
  return Math.max(0, Math.min(box ? box.height - 24 : Infinity, viewport.value.height - top - 16));
});
const panelHeight = computed(() => Math.min(panelMaxHeight.value,
  Math.max(440, draggedHeight.value ?? viewport.value.height * preferences.value.panelHeightRatio)));
const panelStyle = computed(() => ({ ...panelPosition.value, height: `${panelHeight.value}px` }));
watch(resizeGrip, (handle, _, onCleanup) => {
  if (!handle) return;
  const saveHeight = () => {
    if (draggedHeight.value === null) return;
    updatePreferences({ panelHeightRatio: Math.max(0.2, Math.min(1, draggedHeight.value / viewport.value.height)) });
    draggedHeight.value = null;
  };
  const dispose = installResizeGrip(handle, {
    size: () => ({ width: 356, height: panelHeight.value }),
    limits: () => ({ minWidth: 356, maxWidth: 356, minHeight: 440, maxHeight: panelMaxHeight.value }),
    resize: (_, height) => { draggedHeight.value = height; if (!resizing.value) saveHeight(); },
    setActive: (active) => { resizing.value = active; if (!active) saveHeight(); },
  });
  onCleanup(() => { draggedHeight.value = null; dispose(); });
}, { flush: "post" });
const missionMessage = computed(() => {
  if (props.view.missionMarkers === "off") return "Mission Map markers are off.";
  if (props.view.mission && !props.view.mission.transform) return "Boss markers are unavailable in this area. Use the capture notes.";
  if (!active.value) return `${new Set(missionLocations.value.map(entry => entry.skillId)).size} skills shown in this area.`;
  if (active.value.points.length === 0) return "Boss position unavailable. Use the encounter notes.";
  if (active.value.mapId !== props.view.mapId) return `Target is in ${guildWarsMapName(active.value.mapId)}.`;
  if (!props.view.mission) return "Open the Mission Map to see the capture location.";
  return "Known spawn location; this is not a live boss position.";
});
async function showWiki(location: EliteLocation, page: "boss" | "skill") {
  wikiProblem.value = "";
  try { await props.openWiki(location, page); }
  catch { wikiProblem.value = "The wiki could not open. Try the link again."; }
}
function setOpen(value: boolean, keyboard = false, remember = true) {
  if (remember) updatePreferences({ panelOpen: value });
  keepPreview(); open.value = value; preview.value = null; previewHovered = false;
  emit("openChange", value);
  if (keyboard) void nextTick(() => {
    const target = value ? filters.value?.searchInput : mapTrigger.value;
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
  revealSelected();
}
function revealSelected(keyboard = false) {
  void nextTick(() => {
    const row = root.value?.querySelector<HTMLButtonElement>(`[data-skill-id="${selectedId.value}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
    if (keyboard) row?.focus({ preventScroll: true });
  });
}
function selectLocation(location: EliteLocation, keyboard = false) {
  selectedId.value = location.skillId;
  setOpen(true);
  revealSelected(keyboard);
}
function inspect(location: EliteLocation | null, x: number, y: number, keyboard = false, nearby: readonly EliteLocation[] = [], pinned = false) {
  if (!location) { hidePreview(); return; }
  keepPreview();
  // Place beside the marker instead of clamping the card over nearby pointer targets.
  const left = x + 340 <= window.innerWidth - 8 ? x + 20 : x - 340;
  const next = { location, x: Math.max(8, Math.min(window.innerWidth - 328, left)),
    y: Math.max(8, Math.min(window.innerHeight - 488, y + 16)), keyboard, nearby, pinned };
  preview.value = next;
  const shown = preview.value;
  void nextTick(() => {
    if (preview.value !== shown || !previewElement.value) return;
    next.y = Math.max(8, Math.min(next.y, window.innerHeight - previewElement.value.offsetHeight - 8));
    preview.value = { ...next };
  });
}
function previewNearby(location: EliteLocation) {
  if (!preview.value) return;
  keepPreview();
  preview.value = { ...preview.value, location };
}
function leavePreviewFocus(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !previewElement.value?.contains(event.relatedTarget)) hidePreview();
}
function inspectRow(location: EliteLocation, event: PointerEvent | FocusEvent) {
  if (selectedId.value === location.skillId || !(event.currentTarget instanceof HTMLElement)) return;
  const box = event.currentTarget.getBoundingClientRect();
  inspect(location, box.left - 352, box.top - 16, event.type === "focus");
}
const locationsOf = (ids: readonly string[]) => ids.flatMap(id => ELITE_LOCATIONS.find(entry => entry.id === id) ?? []);
/** The host reports the drawn marker under the pointer while the game routes it to that map. */
function pointer(hit: EliteMapHit | null) {
  if (preview.value?.pinned) return;
  const location = hit ? locationsOf(hit.locationIds)[0] : undefined;
  if (!hit || !location) { if (!previewHovered) hidePreview(); return; }
  if (preview.value?.location.id === location.id) { keepPreview(); return; }
  inspect(location, hit.x, hit.y, false, locationsOf(hit.nearbyIds));
}
/** A marker click opens its details in an open planner, or pins a small action card. */
function activate(hit: EliteMapHit) {
  const location = locationsOf(hit.locationIds)[0];
  if (!location) return;
  if (open.value) { selectLocation(location); return; }
  inspect(location, hit.x, hit.y, false, locationsOf(hit.nearbyIds), true);
}
function unpin() { keepPreview(); preview.value = null; previewHovered = false; }
function dismissPinned(event: PointerEvent) {
  if (preview.value?.pinned && !(event.target instanceof Node && previewElement.value?.contains(event.target))) unpin();
}
onMounted(() => window.addEventListener("pointerdown", dismissPinned, true));
onBeforeUnmount(() => window.removeEventListener("pointerdown", dismissPinned, true));
function chooseMissionMarkers(value: string) {
  if (isEliteMissionMapMarkers(value)) void props.setMissionMarkers?.(value);
}
function showDetails(id: number) {
  selectedId.value = selectedId.value === id ? null : id;
  keepPreview(); preview.value = null;
}
function focusSkill(id: number) {
  updatePreferences({ search: "", focusedSkill: id, professions: { kind: "all" }, region: "", mode: "browse", hideLearned: false, worldMap: true });
}
function close(event?: MouseEvent) {
  const keyboard = event ? event.detail === 0 : root.value?.contains(document.activeElement) === true;
  setOpen(false, keyboard);
}
function toggleTrack(id: number) { void plan.change({ kind: tracked(id) ? "remove" : "track", skillId: id }); }
watch(character, () => { selectedId.value = null; preview.value = null; setOpen(false, false, false); });
watch([() => Boolean(props.view.world), loaded], ([world, ready], [previous]) => {
  if (!world && previous) setOpen(false, false, false);
  else if (world && ready) setOpen(preferences.value.panelOpen, false, false);
});
watch(() => props.view.mission, (value, previous) => {
  if (!value && previous) { preview.value = null; previewHovered = false; if (!props.view.world) setOpen(false, false, false); }
});
onBeforeUnmount(() => { keepPreview(); plan.dispose(); });
defineExpose({ find, close, pointer, activate });
</script>
<template>
  <div ref="root" class="elite-skills-root" @keydown.esc="dismissPreview">
    <div v-if="view.world && !open" class="ui-frame elite-map-summary" :style="panelPosition">
      <button ref="mapTrigger" class="ui-button elite-map-trigger" aria-label="Open Elite Skills" :aria-expanded="false"
        :title="[filterSummary, active ? `Target: ${active.boss}` : ''].filter(Boolean).join(' — ')" @click="browse">
        <svg class="elite-map-trigger-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9Z"/></svg>Elite skills<span v-if="tracking.skills.length" class="elite-map-trigger-count" :title="`${tracking.skills.length} saved`">{{ tracking.skills.length }}</span>
      </button>
      <span v-if="problem" class="elite-summary-problem" role="alert" :title="loaded ? 'Changes are not saved. Open Elite Skills to retry.' : 'Your setup could not load. Open Elite Skills to retry.'"
        :aria-label="loaded ? 'Changes are not saved. Open Elite Skills to retry.' : 'Your setup could not load. Open Elite Skills to retry.'">!</span>
    </div>
    <section v-if="open" class="ui-frame elite-panel" :data-resizing="resizing || undefined" :style="panelStyle" aria-label="Elite skills">
      <header class="ui-panel-head">
        <h2>Elite skills</h2>
        <button class="ui-button" aria-label="Collapse Elite Skills" @click="close">Hide panel</button>
      </header>
      <div v-if="problem" class="elite-message" role="alert">
        <p>{{ problem }}</p><button class="ui-button" :disabled="busy" @click="plan.retry">Retry</button>
        <button v-if="loaded" class="ui-link" @click="plan.dismissError">Restore saved setup</button>
      </div>
      <p v-if="wikiProblem" class="elite-message" role="alert">{{ wikiProblem }}</p>
      <div v-if="catalogueProblem" class="elite-message" role="status"><p>{{ catalogueProblem }}</p><button class="ui-link" @click="reloadSkills">Reload skills</button></div>
      <p v-if="catalogueVersion === 0 && !catalogueProblem" class="elite-save-state" role="status">Loading skill details…</p>
      <p v-if="!view.characterKey" class="elite-message">Select a PvE character to save skills. You can still browse.</p>
      <div class="elite-filter-panel"><EliteFilters ref="filters" :preferences="preferences" :tracked-count="tracking.skills.length" :disabled="!!character && !loaded"
        :my-professions="party.player?.professions ?? null" :learned-available="!!party.characterSkills"
        @change="updatePreferences" @reset="resetFilters" /></div>
      <div class="elite-results-heading"><span>{{ results.length }} {{ results.length === 1 ? 'skill' : 'skills' }}</span><span v-if="busy" role="status">{{ loaded ? 'Saving…' : 'Loading setup…' }}</span></div>
      <div class="ui-scroll elite-panel-content">
        <div class="elite-results">
          <div v-if="!results.length" class="ui-empty"><strong>{{ selectedProfessions?.length === 0 ? 'Choose a profession' : preferences.mode === 'tracked' && !tracking.skills.length ? 'No saved skills yet' : 'No matching skills' }}</strong><p>{{ selectedProfessions?.length === 0 ? 'Select a class above to see its elite skills.' : preferences.mode === 'tracked' && !tracking.skills.length ? 'Use the star beside a skill to save it for this character.' : 'Try another name or clear the filters.' }}</p><button class="ui-button" @click="resetFilters">Show all skills</button></div>
          <div v-for="result in results" :key="result.skill.id" class="elite-result" :data-expanded="selectedId === result.skill.id">
            <div class="elite-result-heading">
              <button class="elite-result-main" :data-skill-id="result.skill.id" :aria-expanded="selectedId === result.skill.id" :aria-controls="`elite-detail-${result.skill.id}`"
                :aria-describedby="preview?.location.skillId === result.skill.id ? 'elite-skill-preview' : undefined" @click="showDetails(result.skill.id)" @pointerenter="inspectRow(result.locations[0]!, $event)" @pointerleave="hidePreview" @focus="inspectRow(result.locations[0]!, $event)" @blur="hidePreview">
                <span class="ui-slot elite-skill-icon" :data-profession="result.skill.profession" data-elite><img v-if="result.skill.iconUrl" :src="result.skill.iconUrl" alt="" draggable="false"><span v-else>{{ result.skill.profession?.slice(0, 1) ?? '?' }}</span></span>
                <span class="elite-result-label"><strong>{{ result.skill.name }}</strong><small>{{ result.skill.attribute?.replace(/([a-z])([A-Z])/gu, '$1 $2') ?? (result.skill.profession ? PROFESSIONS[result.skill.profession].name : 'Profession unavailable') }}<span v-if="learned(result.skill.id) === 'learned'" class="elite-learned-badge"> · ✓ Learned</span></small></span>
                <span class="elite-result-chevron" aria-hidden="true">{{ selectedId === result.skill.id ? '−' : '+' }}</span>
              </button>
              <button class="ui-button elite-track-button" :aria-label="`${tracked(result.skill.id) ? 'Unsave' : 'Save'} ${result.skill.name}`" :title="tracked(result.skill.id) ? 'Remove from saved skills' : 'Save skill for this character'" :aria-pressed="tracked(result.skill.id)" :disabled="blocked" @click="toggleTrack(result.skill.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg></button>
            </div>
            <div v-if="selectedId === result.skill.id" :id="`elite-detail-${result.skill.id}`" class="elite-inline-detail">
              <SkillDetails :skill="result.skill" />
              <p v-if="learned(result.skill.id) === 'unknown'" class="elite-support">Learned status unavailable</p>
              <h3>Capture from</h3>
              <EliteCaptureLocation v-if="selectedLocations[0]" :location="selectedLocations[0]" :active="active?.id === selectedLocations[0].id" :here="selectedLocations[0].mapId === view.mapId" :disabled="blocked"
                @target="plan.change({ kind: 'target', locationId: selectedLocations[0]!.id })" @wiki="showWiki(selectedLocations[0]!, 'boss')" />
              <details v-if="selectedLocations.length > 1" class="elite-other-locations">
                <summary>{{ selectedLocations.length - 1 }} other capture {{ selectedLocations.length === 2 ? 'location' : 'locations' }}</summary>
                <EliteCaptureLocation v-for="location in selectedLocations.slice(1)" :key="location.id" :location="location" :active="active?.id === location.id" :here="location.mapId === view.mapId" :disabled="blocked"
                  @target="plan.change({ kind: 'target', locationId: location.id })" @wiki="showWiki(location, 'boss')" />
              </details>
              <div class="elite-detail-links"><button class="ui-link" :disabled="!!character && !loaded" @click="focusSkill(result.skill.id)">Show only this skill</button><button v-if="selectedLocations[0]" class="ui-link" @click="showWiki(selectedLocations[0], 'skill')">Skill wiki</button></div>
            </div>
          </div>
        </div>
      </div>
      <footer class="elite-panel-footer">
        <p v-if="active" class="elite-current-target" :title="missionMessage"><strong>Target: {{ active.boss }}</strong></p>
        <details class="elite-map-display"><summary>Map display</summary>
          <p v-if="active">{{ missionMessage }}</p>
          <label class="elite-check"><input type="checkbox" :checked="preferences.worldMap" :disabled="!!character && !loaded" @change="updatePreferences({ worldMap: !preferences.worldMap })"> Show World Map markers</label>
          <label class="elite-mission-markers"><span>Mission Map markers</span><select class="ui-select" :value="view.missionMarkers" :disabled="!setMissionMarkers" @change="chooseMissionMarkers(($event.currentTarget as HTMLSelectElement).value)"><option v-for="mode in ELITE_MISSION_MAP_MARKERS" :key="mode" :value="mode">{{ ELITE_MISSION_MAP_MARKER_LABELS[mode] }}</option></select></label>
        </details>
      </footer>
      <button ref="resizeGrip" class="elite-panel-resize" aria-label="Resize Elite Skills height" title="Drag to resize · Arrow keys adjust height" :disabled="!!character && !loaded"><span aria-hidden="true"></span></button>
    </section>
    <aside v-if="preview" id="elite-skill-preview" ref="previewElement" class="ui-frame elite-preview" :data-keyboard="preview.keyboard ? '' : undefined" @pointerenter="enterPreview" @pointerleave="leavePreview" @focusin="keepPreview" @focusout="leavePreviewFocus" :style="{ left: `${preview.x}px`, top: `${preview.y}px`, maxHeight: `min(480px, calc(100dvh - ${preview.y + 8}px))` }" :role="preview.pinned || preview.nearby.length > 1 ? 'region' : 'tooltip'" :aria-label="preview.pinned ? `${skill(preview.location.skillId).name} capture location` : preview.nearby.length > 1 ? 'Nearby elite skills' : undefined">
      <div v-if="preview.pinned" class="elite-preview-actions">
        <button class="ui-button" :disabled="blocked || tracking.activeLocation === preview.location.id" @click="plan.change({ kind: 'target', locationId: preview.location.id })">{{ tracking.activeLocation === preview.location.id ? 'Current target' : 'Set as target' }}</button>
        <button class="ui-button" :aria-pressed="tracked(preview.location.skillId)" :disabled="blocked" @click="toggleTrack(preview.location.skillId)">{{ tracked(preview.location.skillId) ? 'Saved' : 'Save' }}</button>
        <button class="ui-link" @click="selectLocation(preview.location)">Open planner</button>
        <button class="ui-button elite-preview-close" aria-label="Close capture details" @click="unpin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="ui-scroll elite-preview-content">
        <div v-if="nearbySkills.length > 1" class="elite-nearby">
          <span class="elite-field-label">Nearby skills · Click to open</span>
          <div class="elite-nearby-choices" role="group" aria-label="Nearby capture locations">
            <button v-for="location in nearbySkills" :key="location.skillId" class="elite-nearby-choice"
              :data-previewed="preview.location.skillId === location.skillId ? '' : undefined"
              :aria-label="`${skill(location.skillId).name} — ${location.boss} · ${guildWarsMapName(location.mapId)}`"
              @pointerenter="previewNearby(location)" @focus="previewNearby(location)" @click="selectLocation(location, $event.detail === 0)">
              <img v-if="skill(location.skillId).iconUrl" :src="skill(location.skillId).iconUrl!" alt="" draggable="false">
              <span v-else aria-hidden="true">{{ skill(location.skillId).name.split(' ').map(part => part[0]).join('').slice(0, 3) }}</span>
            </button>
          </div>
        </div>
        <SkillDetails :skill="skill(preview.location.skillId)">
          <template #context><div class="elite-preview-bosses">
          <p v-if="previewBosses.length > 1" class="elite-field-label">Possible bosses · {{ previewBosses.length }}</p>
          <ul><li v-for="boss in previewBosses" :key="boss.id">{{ boss.boss }} <span>· {{ guildWarsMapName(boss.mapId) }}</span></li></ul>
          </div></template>
        </SkillDetails>
      </div>
    </aside>
  </div>
</template>
