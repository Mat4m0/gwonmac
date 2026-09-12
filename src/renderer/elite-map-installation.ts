/**
 * Owns Elite Skills against the certified Maps lifetime and existing input boundary.
 * It reads scalar map projections only and never sends map or gameplay commands.
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
      app = bundle.mountEliteSkills(root, { nativeApi: requireToolsApi(), onOpenChange: (open) => {
        surface.setOpen(open);
        if (open && document.pointerLockElement) document.exitPointerLock();
        input.releaseKeyboard();
      } });
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
        const surfaces = eliteMapSurfaces({ context: before, mapId, anchor: ready ? anchor?.snapshot() ?? null : null, onWorldMap, compass: ready ? compass?.snapshot() ?? null : null,
          mission: ready ? mission?.snapshot() ?? null : null, world: ready ? world?.snapshot() ?? null : null,
          canvas: canvas.getBoundingClientRect() });
        const after = context?.snapshot();
        const stable = before && after && before.sequence === after.sequence;
        const next = { ...(stable ? surfaces : { world: null, mission: null }), mapId,
          characterKey: ready && isTravelCharacterKey(region.characterKey) ? region.characterKey : null,
          observation: observed };
        // Vue receives changes only. Native pan/zoom still follows animation frames.
        const signature = JSON.stringify([next.world, next.mission, next.mapId, next.characterKey, lastParty]);
        if (signature !== lastView) { lastView = signature; app.update(next); }
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
