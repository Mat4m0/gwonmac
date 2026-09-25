<!-- Elite skill discovery and one Hunt list per character, shared by both native maps. The host draws the chosen markers natively. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { installResizeGrip } from "../../../src/shared/ui/resize";
import type { EliteMapView } from "../../../src/shared/elite-map";
import type { EliteMapHit, EliteMarkerScene, EliteSceneMarker } from "../../../src/shared/elite-map-scene";
import { ELITE_MISSION_MAP_MARKERS, ELITE_MISSION_MAP_MARKER_LABELS, type EliteMissionMapMarkers } from "../../../src/shared/elite-map-settings";
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
/** Clearing returns to the defaults: every class, not yet learned, every region. */
function clearFilters() {
  updatePreferences({ search: "", professions: { kind: "all" }, region: "", learned: "missing", focusedSkill: null });
}
const party = shallowRef(unavailableParty());
watch(() => props.view.observation, (observation) => { party.value = liveParty(observation); }, { immediate: true });
const blocked = computed(() => !loaded.value || problem.value !== "");
const ready = computed(() => !character.value || loaded.value);
function skill(id: number): SkillPresentation {
  void props.catalogueVersion;
  return props.catalogue.get(skillId(id));
}
const learned = (id: number) => eliteLearned(id, party.value.characterSkills);
const captured = (id: number) => learned(id) === "learned";
const tracked = (id: number) => tracking.value.skills.includes(id);
/** Exact values in the preview follow this character's current attribute rank. */
const rankOf = (value: SkillPresentation) => value.attribute ? party.value.player?.attributes?.[value.attribute] ?? null : null;
const unique = (locations: readonly EliteLocation[]) => [...new Map(locations.map(location => [location.id, location])).values()];

// ---------- Discovery (All matches) ----------
const selectedProfessions = computed(() => {
  const filter = preferences.value.professions;
  if (filter.kind === "all") return null;
  if (filter.kind === "custom") return filter.values;
  return party.value.player?.professions?.filter((value): value is Profession => value !== null) ?? [];
});
const filtered = computed(() => {
  const pref = preferences.value;
  return pref.professions.kind !== "all" || pref.learned !== "missing" || !!pref.region || !!pref.search || pref.focusedSkill !== null;
});
const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
const matching = computed(() => {
  const pref = preferences.value;
  const needle = normalized(pref.search.trim());
  const status = party.value.characterSkills ? pref.learned : "any";
  return ELITE_LOCATIONS.filter((entry) => {
    const info = skill(entry.skillId);
    if (!props.catalogue.has(skillId(entry.skillId)) || !info.elite) return false;
    if (selectedProfessions.value && (!info.profession || !selectedProfessions.value.includes(info.profession))) return false;
    if (pref.focusedSkill !== null && entry.skillId !== pref.focusedSkill) return false;
    if (pref.region && entry.region !== pref.region) return false;
    if (status === "missing" && captured(entry.skillId)) return false;
    if (status === "learned" && !captured(entry.skillId)) return false;
    return !needle || normalized(`${info.name} ${info.attribute ?? ""} ${entry.boss} ${guildWarsMapName(entry.mapId)}`).includes(needle);
  });
});
const grouped = (locations: readonly EliteLocation[]) => {
  const bySkill = new Map<number, EliteLocation[]>();
  for (const entry of locations) bySkill.set(entry.skillId, [...bySkill.get(entry.skillId) ?? [], entry]);
  return [...bySkill].map(([id, entries]) => ({ skill: skill(id), locations: entries }));
};
const matchingSkills = computed(() => grouped(matching.value).sort((a, b) => a.skill.name.localeCompare(b.skill.name)));

// ---------- Hunt list and target ----------
const huntLocations = computed(() => ELITE_LOCATIONS.filter(entry => tracked(entry.skillId)));
const hunt = computed(() => grouped(huntLocations.value)
  .sort((a, b) => tracking.value.skills.indexOf(a.skill.id) - tracking.value.skills.indexOf(b.skill.id)));
const huntOpen = computed(() => hunt.value.filter(entry => !captured(entry.skill.id)));
const huntDone = computed(() => hunt.value.filter(entry => captured(entry.skill.id)));
const hereRegion = computed(() => ELITE_LOCATIONS.find(entry => entry.mapId === props.view.mapId)?.region ?? null);
const chosen = computed(() => ELITE_LOCATIONS.find((entry) => entry.id === tracking.value.activeLocation) ?? null);
/**
 * The target is the boss to go for now. A chosen target stays until its skill
 * is captured; otherwise the next Hunt list boss is chosen for the player:
 * this area first, then this region, then list order.
 */
const target = computed(() => {
  if (chosen.value && !captured(chosen.value.skillId)) return { location: chosen.value, automatic: false };
  const candidates = huntLocations.value.filter(entry => !captured(entry.skillId) && entry.points.length > 0);
  const score = (entry: EliteLocation) => entry.mapId === props.view.mapId ? 0 : entry.region === hereRegion.value ? 1 : 2;
  const next = [...candidates].sort((a, b) => score(a) - score(b)
    || tracking.value.skills.indexOf(a.skillId) - tracking.value.skills.indexOf(b.skillId))[0];
  return next ? { location: next, automatic: true } : null;
});
const isTarget = (location: EliteLocation) => target.value?.location.id === location.id;

// ---------- Map markers ----------
const worldLocations = computed(() => {
  const world = props.view.world;
  if (!world || !preferences.value.worldMap || !ready.value) return [];
  const shown = preferences.value.mode === "tracked" ? huntLocations.value : matching.value;
  return unique([...(target.value ? [target.value.location] : []), ...shown]).filter((entry) => eliteContinent(entry.region) === world.continent);
});
const missionLocations = computed(() => {
  const mode = props.view.missionMarkers;
  if (!props.view.mission?.transform || !ready.value || mode === "off") return [];
  const here = (entry: EliteLocation) => entry.mapId === props.view.mapId;
  const first = target.value && here(target.value.location) ? [target.value.location] : [];
  return unique([...first, ...(mode === "saved" ? huntLocations.value : matching.value).filter(here)]);
});
function sceneMarkers(locations: readonly EliteLocation[], positions: boolean): readonly EliteSceneMarker[] {
  return locations.flatMap(location => location.points.map(([mapX, mapY], index) => ({
    key: `${location.id}:${index}`, locationId: location.id, skillId: location.skillId, mapId: location.mapId, mapX, mapY,
    iconUrl: skill(location.skillId).iconUrl, hovered: preview.value?.location.id === location.id,
    emphasis: isTarget(location) ? "target" as const : tracked(location.skillId) ? "saved" as const : "match" as const,
    captured: captured(location.skillId),
    position: positions && location.points.length > 1 ? `${index + 1}/${location.points.length}` : null,
  })));
}
const scene = computed<EliteMarkerScene>(() => ({ world: sceneMarkers(worldLocations.value, false), mission: sceneMarkers(missionLocations.value, true) }));
watch(scene, (value) => props.present?.(value), { immediate: true });

// ---------- Capture notice ----------
const notice = ref<{ name: string; done: number; total: number; next: EliteLocation | null } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const capturedHunt = computed(() => party.value.characterSkills
  ? `${character.value}|${hunt.value.filter(entry => captured(entry.skill.id)).map(entry => entry.skill.id).join(",")}` : null);
watch(capturedHunt, (next, previous) => {
  if (!next || !previous || next.split("|")[0] !== previous.split("|")[0]) return;
  const before = new Set(previous.split("|")[1]!.split(",").filter(Boolean));
  const gained = next.split("|")[1]!.split(",").filter(id => id && !before.has(id));
  if (!gained.length) return;
  notice.value = { name: skill(Number(gained.at(-1))).name, done: huntDone.value.length, total: hunt.value.length,
    next: target.value?.location ?? null };
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = null; }, 8000);
});

// ---------- Panel geometry ----------
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
    size: () => ({ width: 372, height: panelHeight.value }),
    limits: () => ({ minWidth: 372, maxWidth: 372, minHeight: 440, maxHeight: panelMaxHeight.value }),
    resize: (_, height) => { draggedHeight.value = height; if (!resizing.value) saveHeight(); },
    setActive: (active) => { resizing.value = active; if (!active) saveHeight(); },
  });
  onCleanup(() => { draggedHeight.value = null; dispose(); });
}, { flush: "post" });
const targetMessage = computed(() => {
  const location = target.value?.location;
  if (!location) return tracking.value.skills.length ? "Everything on your Hunt list is captured." : "Add skills to your Hunt list to get a target.";
  if (location.mapId !== props.view.mapId) return `In ${guildWarsMapName(location.mapId)}.`;
  if (props.view.missionMarkers === "off") return "Here. Mission Map markers are off.";
  if (props.view.mission && !props.view.mission.transform) return "Here. Boss markers are unavailable in this area; use the notes.";
  return "In this area.";
});

// ---------- Preview ----------
const preview = ref<{ location: EliteLocation; x: number; y: number; keyboard: boolean; nearby: readonly EliteLocation[]; pinned?: boolean } | null>(null);
const nearbySkills = computed(() => [...new Map(preview.value?.nearby.map(location => [location.skillId, location])).values()]);
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
  keepPreview(); preview.value = null;
  event.preventDefault(); event.stopPropagation();
}
watch(() => matching.value.map(location => location.id).join("|"), () => { if (!preview.value?.pinned) preview.value = null; });
const otherBosses = (location: EliteLocation) => ELITE_LOCATIONS.filter(entry => entry.skillId === location.skillId && entry.id !== location.id).length;
function inspect(location: EliteLocation | null, x: number, y: number, keyboard = false, nearby: readonly EliteLocation[] = [], pinned = false) {
  if (!location) { hidePreview(); return; }
  keepPreview();
  // Place beside the marker instead of clamping the card over nearby pointer targets.
  const left = x + 360 <= window.innerWidth - 8 ? x + 20 : x - 360;
  const next = { location, x: Math.max(8, Math.min(window.innerWidth - 348, left)),
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
  inspect(location, box.left - 372, box.top - 16, event.type === "focus");
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
function unpin() { keepPreview(); preview.value = null; }
function dismissPinned(event: PointerEvent) {
  if (preview.value?.pinned && !(event.target instanceof Node && previewElement.value?.contains(event.target))) unpin();
}
onMounted(() => window.addEventListener("pointerdown", dismissPinned, true));
onBeforeUnmount(() => window.removeEventListener("pointerdown", dismissPinned, true));

// ---------- Actions ----------
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
    const focus = value ? filters.value?.searchInput ?? root.value?.querySelector<HTMLButtonElement>(".elite-view-switch button") : mapTrigger.value;
    focus?.focus({ preventScroll: true });
  });
}
function browse(event?: MouseEvent) { setOpen(true, event?.detail === 0); }
function showView(mode: EliteViewPreferences["mode"]) { if (preferences.value.mode !== mode) updatePreferences({ mode, focusedSkill: null }); }
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
  if (!tracked(location.skillId) && preferences.value.mode === "tracked") showView("browse");
  setOpen(true);
  revealSelected(keyboard);
}
function showDetails(id: number) {
  selectedId.value = selectedId.value === id ? null : id;
  keepPreview(); preview.value = null;
}
function focusSkill(id: number) {
  updatePreferences({ search: "", focusedSkill: id, professions: { kind: "all" }, region: "", mode: "browse", learned: "any", worldMap: true });
}
function close(event?: MouseEvent) {
  const keyboard = event ? event.detail === 0 : root.value?.contains(document.activeElement) === true;
  setOpen(false, keyboard);
}
function toggleTrack(id: number) { void plan.change({ kind: tracked(id) ? "remove" : "track", skillId: id }); }
function setTarget(location: EliteLocation) { void plan.change({ kind: "target", locationId: location.id }); }
async function removeCaptured() { for (const entry of huntDone.value) await plan.change({ kind: "remove", skillId: entry.skill.id }); }
function chooseMissionMarkers(mode: EliteMissionMapMarkers) { void props.setMissionMarkers?.(mode); }
const detailLocations = (id: number) => ELITE_LOCATIONS.filter((entry) => entry.skillId === id)
  .sort((a, b) => Number(isTarget(b)) - Number(isTarget(a)) || Number(b.mapId === props.view.mapId) - Number(a.mapId === props.view.mapId) || a.boss.localeCompare(b.boss));
/** Profession · attribute · area (or boss count), as the skill reads in the game's skills window. */
const rowMeta = (value: SkillPresentation, locations: readonly EliteLocation[]) => [
  value.profession ? PROFESSIONS[value.profession].name : null, value.attribute?.replace(/([a-z])([A-Z])/gu, "$1 $2") ?? null,
  locations.length === 1 ? guildWarsMapName(locations[0]!.mapId) : `${locations.length} bosses`,
].filter(Boolean).join(" · ");
const myClasses = computed(() => party.value.player?.professions?.filter((value): value is Profession => value !== null).join("/") ?? "");
watch(character, () => { selectedId.value = null; preview.value = null; notice.value = null; setOpen(false, false, false); });
watch([() => Boolean(props.view.world), loaded], ([world, isReady], [previous]) => {
  if (!world && previous) setOpen(false, false, false);
  else if (world && isReady) setOpen(preferences.value.panelOpen, false, false);
});
watch(() => props.view.mission, (value, previous) => {
  if (!value && previous) { preview.value = null; if (!props.view.world) setOpen(false, false, false); }
});
onBeforeUnmount(() => { keepPreview(); clearTimeout(noticeTimer); plan.dispose(); });
defineExpose({ find, close, pointer, activate });
</script>
<template>
  <div ref="root" class="elite-skills-root" @keydown.esc="dismissPreview">
    <div v-if="view.world && !open" class="ui-frame elite-map-summary" :style="panelPosition">
      <button ref="mapTrigger" class="ui-button elite-map-trigger" aria-label="Open Elite skills planner" title="Open Elite skills planner" :aria-expanded="false" @click="browse">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 9-8 9-8-9Z"/></svg>
      </button>
      <div class="ui-segment elite-view-switch" role="group" aria-label="Elite markers on this map">
        <button :aria-pressed="preferences.mode === 'tracked'" :disabled="!ready" title="Your Hunt list" @click="showView('tracked')">Hunt <small>{{ huntDone.length }}/{{ hunt.length }}</small></button>
        <button :aria-pressed="preferences.mode === 'browse'" :disabled="!ready" title="Everything the planner filters match" @click="showView('browse')">All <small>{{ matchingSkills.length }}</small></button>
      </div>
      <span v-if="problem" class="elite-summary-problem" role="alert" :title="loaded ? 'Changes are not saved. Open the planner to retry.' : 'Your setup could not load. Open the planner to retry.'"
        :aria-label="loaded ? 'Changes are not saved. Open the planner to retry.' : 'Your setup could not load. Open the planner to retry.'">!</span>
    </div>
    <section v-if="open" class="ui-frame elite-panel" :data-resizing="resizing || undefined" :style="panelStyle" aria-label="Elite skills">
      <header class="ui-panel-head">
        <h2>Elite skills</h2>
        <span v-if="myClasses" class="elite-classes" :title="`This character's professions`">{{ myClasses }}</span>
        <button class="ui-button" aria-label="Collapse Elite Skills" @click="close">Hide</button>
      </header>
      <div class="elite-view-bar">
        <div class="ui-segment elite-view-switch" data-fill role="group" aria-label="Show">
          <button :aria-pressed="preferences.mode === 'browse'" @click="showView('browse')">All matches <small>{{ matchingSkills.length }}</small></button>
          <button :aria-pressed="preferences.mode === 'tracked'" @click="showView('tracked')">Hunt list <small>{{ huntDone.length }}/{{ hunt.length }}</small></button>
        </div>
      </div>
      <div v-if="problem" class="elite-message" role="alert">
        <p>{{ problem }}</p><button class="ui-button" :disabled="busy" @click="plan.retry">Retry</button>
        <button v-if="loaded" class="ui-link" @click="plan.dismissError">Restore saved setup</button>
      </div>
      <p v-if="wikiProblem" class="elite-message" role="alert">{{ wikiProblem }}</p>
      <div v-if="catalogueProblem" class="elite-message" role="status"><p>{{ catalogueProblem }}</p><button class="ui-link" @click="reloadSkills">Reload skills</button></div>
      <p v-if="catalogueVersion === 0 && !catalogueProblem" class="elite-save-state" role="status">Loading skill details…</p>
      <p v-if="!view.characterKey" class="elite-message">Select a PvE character to build a Hunt list. You can still browse.</p>
      <div v-if="preferences.mode === 'browse'" class="elite-filter-panel"><EliteFilters ref="filters" :preferences="preferences" :disabled="!!character && !loaded"
        :my-professions="party.player?.professions ?? null" :learned-available="!!party.characterSkills" @change="updatePreferences" /></div>
      <div class="elite-results-heading">
        <span v-if="preferences.mode === 'browse'">{{ matchingSkills.length }} {{ matchingSkills.length === 1 ? 'skill' : 'skills' }}<template v-if="filtered"> · <button class="ui-link" @click="clearFilters">Clear {{ preferences.focusedSkill !== null ? 'skill focus' : 'filters' }}</button></template></span>
        <span v-else>{{ huntOpen.length }} to capture</span>
        <span v-if="busy" role="status">{{ loaded ? 'Saving…' : 'Loading setup…' }}</span>
      </div>
      <div class="ui-scroll elite-panel-content">
        <div class="elite-results">
          <template v-for="section in (preferences.mode === 'browse' ? [{ key: 'all', title: '', entries: matchingSkills }] : [{ key: 'open', title: '', entries: huntOpen }, { key: 'done', title: `Captured · ${huntDone.length}`, entries: huntDone }])" :key="section.key">
            <h3 v-if="section.title && section.entries.length" class="elite-section-title">{{ section.title }}</h3>
            <div v-for="result in section.entries" :key="result.skill.id" class="elite-result" :data-expanded="selectedId === result.skill.id" :data-captured="captured(result.skill.id) || undefined">
              <div class="elite-result-heading">
                <button class="elite-result-main" :data-skill-id="result.skill.id" :aria-expanded="selectedId === result.skill.id" :aria-controls="`elite-detail-${result.skill.id}`"
                  :aria-describedby="preview?.location.skillId === result.skill.id ? 'elite-skill-preview' : undefined" @click="showDetails(result.skill.id)" @pointerenter="inspectRow(detailLocations(result.skill.id)[0]!, $event)" @pointerleave="hidePreview" @focus="inspectRow(detailLocations(result.skill.id)[0]!, $event)" @blur="hidePreview">
                  <span class="ui-slot elite-skill-icon" :data-profession="result.skill.profession" data-elite><img v-if="result.skill.iconUrl" :src="result.skill.iconUrl" alt="" draggable="false"><span v-else>{{ result.skill.profession?.slice(0, 1) ?? '?' }}</span></span>
                  <span class="elite-result-label"><strong>{{ result.skill.name }}</strong>
                    <span class="elite-tags">
                      <span v-if="result.locations.some(isTarget)" class="elite-tag" data-kind="target">Target</span>
                      <span v-if="captured(result.skill.id)" class="elite-tag" data-kind="captured">✓ Captured</span>
                      <span v-else-if="result.locations.some(entry => entry.mapId === view.mapId)" class="elite-tag" data-kind="here">In this area</span>
                    </span>
                    <small>{{ rowMeta(result.skill, result.locations) }}</small></span>
                </button>
                <button class="ui-button elite-track-button" :aria-label="`${tracked(result.skill.id) ? 'Remove' : 'Add'} ${result.skill.name} ${tracked(result.skill.id) ? 'from' : 'to'} Hunt list`" :title="tracked(result.skill.id) ? 'Remove from Hunt list' : 'Add to Hunt list'" :aria-pressed="tracked(result.skill.id)" :disabled="blocked" @click="toggleTrack(result.skill.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg></button>
              </div>
              <div v-if="selectedId === result.skill.id" :id="`elite-detail-${result.skill.id}`" class="elite-inline-detail">
                <SkillDetails :skill="result.skill" :rank="rankOf(result.skill)" />
                <h3>Capture from</h3>
                <EliteCaptureLocation v-for="location in detailLocations(result.skill.id)" :key="location.id" :location="location" :active="isTarget(location)" :here="location.mapId === view.mapId" :disabled="blocked"
                  @target="setTarget(location)" @wiki="showWiki(location, 'boss')" />
                <div class="elite-detail-links"><button v-if="preferences.mode === 'browse'" class="ui-link" :disabled="!!character && !loaded" @click="focusSkill(result.skill.id)">Show only this skill</button>
                  <button class="ui-link" @click="showWiki(result.locations[0]!, 'skill')">Skill wiki</button></div>
              </div>
            </div>
          </template>
          <div v-if="preferences.mode === 'browse' && !matchingSkills.length" class="ui-empty"><strong>No elite skills match</strong><p>Try another name or fewer filters.</p><button class="ui-button" @click="clearFilters">Clear filters</button></div>
          <div v-if="preferences.mode === 'tracked' && !hunt.length" class="ui-empty"><strong>Your Hunt list is empty</strong><p>Use the star beside a skill in All matches to hunt it with this character.</p><button class="ui-button" @click="showView('browse')">Find elite skills</button></div>
          <p v-if="preferences.mode === 'tracked' && huntDone.length" class="elite-clear-captured"><button class="ui-link" :disabled="blocked" @click="removeCaptured">Remove captured from Hunt list</button></p>
        </div>
      </div>
      <footer class="elite-panel-footer">
        <div v-if="target" class="elite-current-target">
          <span><strong>Target: {{ target.location.boss }}</strong> · {{ skill(target.location.skillId).name }}</span>
          <small>{{ target.automatic ? 'Chosen for you · ' : '' }}{{ targetMessage }}</small>
        </div>
        <p v-else class="elite-support">{{ targetMessage }}</p>
        <div class="elite-mission-markers"><span>Mission Map</span>
          <div class="ui-segment" role="group" aria-label="Mission Map markers">
            <button v-for="mode in ELITE_MISSION_MAP_MARKERS" :key="mode" :aria-pressed="view.missionMarkers === mode" :disabled="!setMissionMarkers" @click="chooseMissionMarkers(mode)">{{ ELITE_MISSION_MAP_MARKER_LABELS[mode] === 'All planner matches' ? 'All' : ELITE_MISSION_MAP_MARKER_LABELS[mode] }}</button>
          </div>
        </div>
        <label class="elite-check"><input type="checkbox" :checked="preferences.worldMap" :disabled="!!character && !loaded" @change="updatePreferences({ worldMap: !preferences.worldMap })"> World Map markers</label>
      </footer>
      <button ref="resizeGrip" class="elite-panel-resize" aria-label="Resize Elite Skills height" title="Drag to resize · Arrow keys adjust height" :disabled="!!character && !loaded"><span aria-hidden="true"></span></button>
    </section>
    <aside v-if="preview" id="elite-skill-preview" ref="previewElement" class="ui-frame elite-preview" :data-keyboard="preview.keyboard ? '' : undefined" @pointerenter="enterPreview" @pointerleave="leavePreview" @focusin="keepPreview" @focusout="leavePreviewFocus" :style="{ left: `${preview.x}px`, top: `${preview.y}px`, maxHeight: `min(520px, calc(100dvh - ${preview.y + 8}px))` }" :role="preview.pinned || preview.nearby.length > 1 ? 'region' : 'tooltip'" :aria-label="preview.pinned ? `${skill(preview.location.skillId).name} capture location` : preview.nearby.length > 1 ? 'Nearby elite skills' : undefined">
      <div v-if="preview.pinned" class="elite-preview-actions">
        <button class="ui-button" :disabled="blocked || captured(preview.location.skillId) || (isTarget(preview.location) && !target?.automatic)" @click="setTarget(preview.location)">{{ isTarget(preview.location) ? '✓ Target' : 'Set as target' }}</button>
        <button class="ui-button" :aria-pressed="tracked(preview.location.skillId)" :disabled="blocked" @click="toggleTrack(preview.location.skillId)">{{ tracked(preview.location.skillId) ? '★ Hunting' : '☆ Hunt' }}</button>
        <button class="ui-link" @click="selectLocation(preview.location)">Planner</button>
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
        <SkillDetails :skill="skill(preview.location.skillId)" :rank="rankOf(skill(preview.location.skillId))">
          <template #context><div class="elite-preview-where">
            <p><strong>{{ preview.location.boss }}</strong> · {{ guildWarsMapName(preview.location.mapId) }}<template v-if="preview.location.mapId === view.mapId"> · you are here</template></p>
            <p v-if="preview.location.points.length > 1" class="elite-support" title="Known spawn references, not live boss positions">{{ preview.location.points.length }} possible positions · spawns at one of them</p>
            <p v-else-if="!preview.location.points.length" class="elite-support">Position unknown · use the notes</p>
            <p v-if="preview.location.note" class="elite-location-note">{{ preview.location.note }}</p>
            <p class="elite-preview-status">
              <span v-if="captured(preview.location.skillId)" data-kind="captured">✓ Captured by this character</span>
              <span v-else-if="isTarget(preview.location)" data-kind="target">◆ Target{{ target?.automatic ? ' · chosen for you' : '' }}</span>
              <span v-else-if="tracked(preview.location.skillId)" data-kind="target">★ On your Hunt list</span>
              <span v-else-if="learned(preview.location.skillId) === 'not-learned'">Not learned yet</span>
              <span v-if="otherBosses(preview.location)"> · {{ otherBosses(preview.location) }} other {{ otherBosses(preview.location) === 1 ? 'boss has' : 'bosses have' }} it</span>
            </p>
          </div></template>
        </SkillDetails>
        <p v-if="!preview.pinned" class="elite-preview-hint">Click for actions</p>
      </div>
    </aside>
    <div v-if="notice" class="ui-frame elite-notice" role="status">
      <strong>✓ {{ notice.name }} captured</strong><span>{{ notice.done }} of {{ notice.total }} on your Hunt list</span>
      <span v-if="notice.next">Next: {{ notice.next.boss }} · {{ guildWarsMapName(notice.next.mapId) }}</span>
      <button class="ui-button elite-preview-close" aria-label="Dismiss" @click="notice = null"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>
  </div>
</template>
