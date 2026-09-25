/**
 * Owns Elite Skills against the certified Maps lifetime and existing input boundary.
 * It reads scalar map projections, draws the planner's markers inside the native
 * maps, and claims only marker presses on a map the game routes the pointer to.
 * It never sends map or gameplay commands.
 */
import { isTravelCharacterKey } from "../shared/travel-history.js";
import type { ToolboxObservation } from "../shared/builds/live-party.js";
import type { EliteMapHandle } from "../shared/elite-map.js";
import type { CompanionPlayRegionState } from "./companion-play-region-snapshot.js";
import type { EmbeddedToolsBundle } from "../shared/tools-bundle-contracts.js";
import { createCartographyContextReader } from "./cartography-spike/context-observer.js";
import { createCompassFrameSpikeReader, createMissionMapFrameSpikeReader, createWorldMapFrameSpikeReader } from "./cartography-spike/frame-observer.js";
import { createWorldMapAnchorSpikeReader } from "./cartography-spike/world-map-anchor-observer.js";
import { eliteMapSurfaces } from "./elite-map-projection.js";
import { ensureToolsStylesheet } from "./tools-stylesheet.js";
import { requireToolsApi } from "./tools-native-api.js";
import { createNonActivatingSurface } from "./non-activating-surface.js";
import { createEliteMapGraphics } from "./elite-map-graphics.js";
import { EMPTY_ELITE_SCENE, type PlacedEliteMarker } from "../shared/elite-map-scene.js";
import { installEliteMapPointer, type EliteMapPointerSurface } from "../shared/ui/elite-map-pointer.js";
export function createEliteMapInstallation(options: {
  exports: WebAssembly.Exports;
  state(): Readonly<{ region: CompanionPlayRegionState; observation: ToolboxObservation; onWorldMap: boolean }>;
}) {
  let enabled = false;
  let disposed = false;
  let pending = false;
  let frame = 0;
  let app: EliteMapHandle | null = null;
  let cleanup: (() => void) | null = null;
  let requestedSkill: number | null = null;
  const context = createCartographyContextReader(options.exports);
  const compass = createCompassFrameSpikeReader(options.exports);
  const mission = createMissionMapFrameSpikeReader(options.exports);
  const anchor = createWorldMapAnchorSpikeReader(options.exports);
  const world = createWorldMapFrameSpikeReader(options.exports);
  async function mount() {
    if (pending || app || !enabled || disposed) return;
    pending = true;
    let remove: (() => void) | null = null;
    try {
      const canvas = document.getElementById("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return;
      const specifier = "./tools/tools-app.js";
      const bundle: EmbeddedToolsBundle<HTMLElement> = await import(specifier);
      if (disposed || !enabled) return;
      ensureToolsStylesheet(document);
      const root = document.createElement("div");
      root.id = "elite-skills-host";
      document.body.append(root);
      const surface = window.gwSurfaces.register({ root, priority: 4, dismiss: () => app?.close() });
      const input = createNonActivatingSurface(root, () => canvas);
      for (const name of ["keydown", "keyup", "pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "contextmenu"]) {
        root.addEventListener(name, (event) => event.stopPropagation());
      }
      root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
      root.addEventListener("pointerdown", () => surface.raise(), true);
      remove = () => { surface.dispose(); input.dispose(); root.remove(); };
      const releaseHost = remove;
      const graphics = createEliteMapGraphics(options.exports, document);
      remove = () => { try { graphics.dispose(); } finally { releaseHost(); } };
      const within = options.exports.gwonmac_map_pointer_within;
      const owns = (frameId: number) => typeof within === "function" && within(frameId) === 1;
      let scene = EMPTY_ELITE_SCENE;
      let targets: EliteMapPointerSurface[] = [];
      const pointer = installEliteMapPointer({ view: window, accepts: (target) => target === canvas,
        surfaces: () => targets, hover: (hit) => app?.pointer(hit), activate: (hit) => app?.activate(hit) });
      remove = () => { pointer.dispose(); try { graphics.dispose(); } finally { releaseHost(); } };
      app = bundle.mountEliteSkills(root, { nativeApi: requireToolsApi(), onOpenChange: (open) => {
        surface.setOpen(open);
        if (open && document.pointerLockElement) document.exitPointerLock();
        input.releaseKeyboard();
      }, present: (next) => { scene = next; },
      setMissionMarkers: async (mode) => { await window.gwNative.settings.set({ eliteMissionMapMarkers: mode }); } });
      cleanup = remove;
      let lastView = "";
      let lastParty = "";
      let lastCharacter = "";
      let observed: ToolboxObservation = { status: "waiting" };
      let nextPartyPoll = 0;
      const render = () => {
        if (!app || !enabled || disposed) return;
        const { region, observation, onWorldMap } = options.state();
        const ready = region.status === "ready" && region.playRegion === "pve";
        const mapId = ready ? region.mapId : null;
        const now = performance.now();
        const character = ready ? `${region.characterKey}:${region.mapId}` : "";
        if (character !== lastCharacter) {
          observed = { status: "waiting" }; lastParty = ""; nextPartyPoll = 0; lastCharacter = character;
        }
        if (!ready) { observed = { status: "waiting" }; lastParty = ""; }
        else if (now >= nextPartyPoll) {
          const identity = JSON.stringify([region.characterKey, region.mapId, observation.status,
            observation.partyObserved, observation.party?.characterSkills,
            observation.party?.slots?.[0]?.professions]);
          if (identity !== lastParty) { lastParty = identity; observed = observation; }
          nextPartyPoll = now + 200;
        }
        const before = context?.refresh() ? context.snapshot() : null;
        const missionFrame = ready ? mission?.snapshot() ?? null : null;
        const worldFrame = ready ? world?.snapshot() ?? null : null;
        const canvasBox = canvas.getBoundingClientRect();
        const surfaces = eliteMapSurfaces({ context: before, mapId, anchor: ready ? anchor?.snapshot() ?? null : null, onWorldMap, compass: ready ? compass?.snapshot() ?? null : null,
          mission: missionFrame, world: worldFrame, canvas: canvasBox });
        const after = context?.snapshot();
        const stable = before && after && before.sequence === after.sequence;
        const next = { ...(stable ? surfaces : { world: null, mission: null }), mapId,
          characterKey: ready && isTravelCharacterKey(region.characterKey) ? region.characterKey : null,
          observation: observed, missionMarkers: window.gwToolsSettings().eliteMissionMapMarkers };
        // Native pan and zoom move the drawn markers every frame. Vue changes only
        // when a map opens, closes, moves its box, or its planner input changes.
        const signature = JSON.stringify([next.world?.box, next.world?.continent, next.mission?.box, Boolean(next.mission?.transform),
          next.mapId, next.characterKey, lastParty, next.missionMarkers]);
        if (signature !== lastView) { lastView = signature; app.update(next); }
        const pixelRatio = canvas.width / Math.max(1, canvasBox.width);
        const placedWorld = graphics.update("world", next.world && worldFrame ? { area: worldFrame.generation, continent: worldFrame.continent,
          surface: next.world, markers: scene.world, pixelRatio, zoom: worldFrame.zoom } : null);
        const missionSurface = next.mission?.transform ? { box: next.mission.box, transform: next.mission.transform } : null;
        const placedMission = graphics.update("mission", missionSurface && missionFrame ? { area: missionFrame.generation, continent: 0,
          // The Mission Map zooms from 1 to 3.5; markers grow over that same range.
          surface: missionSurface, markers: scene.mission, pixelRatio, zoom: (missionFrame.zoom - 1) / 2.5 } : null);
        const target = (name: "world" | "mission", box: EliteMapPointerSurface["box"], placed: readonly PlacedEliteMarker[], frameId: number) =>
          placed.length ? [{ name, box, placed, ownsPointer: () => owns(frameId) }] : [];
        targets = [
          ...(missionSurface && missionFrame ? target("mission", missionSurface.box, placedMission, missionFrame.frameId) : []),
          ...(next.world && worldFrame ? target("world", next.world.box, placedWorld, worldFrame.frameId) : []),
        ];
        pointer.refresh();
        frame = requestAnimationFrame(render);
      };
      render();
      if (requestedSkill !== null) { app.find(requestedSkill); requestedSkill = null; }
    } catch (error) {
      app?.dispose(); app = null; remove?.(); cleanup = null;
      console.error("[maps] Elite Skills could not start", error);
    } finally { pending = false; }
  }
  const find = (event: Event) => {
    if (!enabled || !(event instanceof CustomEvent)) return;
    const value: unknown = event.detail;
    if (!value || typeof value !== "object" || !("skillId" in value)
      || typeof value.skillId !== "number" || !Number.isSafeInteger(value.skillId)) return;
    event.preventDefault();
    if (app) app.find(value.skillId);
    else { requestedSkill = value.skillId; void mount(); }
  };
  window.addEventListener("gw:elite-find", find);
  function stop() { cancelAnimationFrame(frame); app?.dispose(); app = null; cleanup?.(); cleanup = null; }
  return { update(next: boolean) { enabled = next && !disposed; if (enabled) void mount(); else stop(); },
    dispose() { disposed = true; enabled = false; stop(); window.removeEventListener("gw:elite-find", find); },
  };
}
