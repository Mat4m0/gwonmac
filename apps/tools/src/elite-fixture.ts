/**
 * Offline visual fixture for the real planner; all game state is illustrative.
 * A plain canvas stands in for the native map texture and uses the same painter
 * and pointer rules; it cannot prove native alignment or game panel coverage.
 */
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { EMPTY_ELITE_TRACKING, changeEliteTracking, parseEliteTracking } from "../../../src/shared/elite-skills";
import { travelCharacterKey } from "../../../src/shared/travel-history";
import { skillId } from "../../../src/shared/builds/library";
import type { EliteMapSurface, EliteMapView } from "../../../src/shared/elite-map";
import { EMPTY_ELITE_SCENE, placeEliteMarkers, type EliteMapSurfaceName, type PlacedEliteMarker } from "../../../src/shared/elite-map-scene";
import { ELITE_MISSION_MAP_MARKERS, type EliteMissionMapMarkers } from "../../../src/shared/elite-map-settings";
import { createEliteArtwork, paintEliteMarker } from "../../../src/shared/ui/elite-marker-paint";
import { installEliteMapPointer, type EliteMapPointer, type EliteMapPointerSurface } from "../../../src/shared/ui/elite-map-pointer";
import type { SkillPresentation } from "./skill-catalog";
import { mountEliteSkills } from "./elite-mount";
const fixtureSkills = [
  { boss: "Lissah the Packleader", name: "Eviscerate", profession: "W", attribute: "AxeMastery", type: "Axe Attack" },
  { boss: "Fenrir", name: "Crippling Slash", profession: "W", attribute: "Swordsmanship", type: "Sword Attack" },
  { boss: "Jormungand", name: "Earth Shaker", profession: "W", attribute: "HammerMastery", type: "Hammer Attack" },
  { boss: "Warrior's Construct", name: "Hundred Blades", profession: "W", attribute: "Swordsmanship", type: "Skill" },
  { boss: "Markis", name: "Barrage", profession: "R", attribute: "Marksmanship", type: "Bow Attack" },
  { boss: "Dwayna's Cursed", name: "Restore Condition", profession: "Mo", attribute: "ProtectionPrayers", type: "Spell" },
] as const;
export const ELITE_FIXTURE_SKILLS: readonly SkillPresentation[] = fixtureSkills.map(({ boss, name, profession, attribute, type }) => {
  const location = ELITE_LOCATIONS.find((entry) => entry.boss === boss)!;
  const color = profession === "W" ? "#ad7431" : profession === "R" ? "#37774b" : "#416caa";
  const initials = name.split(" ").map(part => part[0]).join("").slice(0, 2);
  // Reproduce the client texture's baked-in 4px rim so marker polish is visible offline.
  const iconUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#000"/><rect x="4" y="4" width="56" height="56" fill="${color}"/><path d="M4 60 60 4v56Z" fill="#000" opacity=".25"/><text x="32" y="40" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="24">${initials}</text></svg>`)}`;
  return { id: skillId(location.skillId), name, profession, attribute, type,
    elite: true, availability: "pve", energyCost: profession === "W" ? 0 : 5, adrenalineCost: profession === "W" ? 8 : 0, healthCost: 0, overcast: 0,
    activationSeconds: profession === "Mo" ? 0.75 : 0, aftercastSeconds: 0.75, rechargeSeconds: profession === "Mo" ? 2 : 0,
    description: "Illustrative details for the offline fixture: this value grows 10...45 with the attribute. In game, the description and costs come from the installed client.", iconUrl };
});
const characterA = travelCharacterKey("0123456789abcdef");
const characterB = travelCharacterKey("fedcba9876543210");
const location = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;
export function eliteFixtureView(mission = false, otherCharacter = false, learned = false, secondary = 2,
  missionMarkers: EliteMissionMapMarkers = "saved"): EliteMapView {
  return { characterKey: otherCharacter ? characterB : characterA, mapId: location.mapId, missionMarkers,
    observation: { status: "ready", partyObserved: true, party: { status: "ready", playRegion: "pve", rosterObserved: true, slotCount: 1,
      slots: [{ index: 0, occupied: true, hero: null, agentId: 10, level: 20, professions: [1, secondary], behaviour: null, skills: null, disabled: null, attributes: null }],
      characterSkills: { knownThrough: 5000, unlocked: learned ? [338] : [] } } },
    world: mission ? null : { continent: 0,
      box: { left: 24, top: 88, width: window.innerWidth - 48, height: window.innerHeight - 160 },
      transform: { a: 0.12, b: 0, c: 0, d: 0.12, e: -100, f: -60 } },
    mission: mission ? { box: { left: 24, top: 88, width: Math.min(540, window.innerWidth - 48), height: window.innerHeight - 160 },
      transform: { a: 0.9, b: 0, c: 0, d: 0.9, e: -5550, f: -1150 } } : null,
  };
}
export function mountEliteFixture(target: HTMLElement): void {
  const controls = document.createElement("div");
  controls.className = "elite-fixture-controls";
  controls.style.cssText = "position:fixed;left:24px;top:16px;display:flex;gap:8px;flex-wrap:wrap;z-index:5;right:24px";
  const label = document.createElement("strong"); label.textContent = "Elite Skills · offline map fixture"; controls.append(label);
  let mission = false, otherCharacter = false, learned = false, failSave = false, mapOpen = true, secondary = 2, crowded = false;
  let missionMarkers: EliteMissionMapMarkers = "saved";
  let view: EliteMapView | null = eliteFixtureView(); let scene = EMPTY_ELITE_SCENE;
  let targets: EliteMapPointerSurface[] = [];
  let pointer: EliteMapPointer | null = null;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none";
  const artwork = createEliteArtwork(document, () => paint());
  function paint() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio); canvas.height = Math.round(window.innerHeight * ratio);
    const context = canvas.getContext("2d"); if (!context) return;
    const surfaces: [EliteMapSurfaceName, EliteMapSurface | null][] = [["world", view?.world ?? null],
      ["mission", view?.mission?.transform ? { box: view.mission.box, transform: view.mission.transform } : null]];
    targets = [];
    for (const [name, surface] of surfaces) {
      if (!surface) continue;
      const placed: readonly PlacedEliteMarker[] = placeEliteMarkers(scene[name], surface);
      const { a, d, e, f } = surface.transform;
      for (const item of placed) paintEliteMarker(context, { x: (surface.box.left + item.x) * ratio, y: (surface.box.top + item.y) * ratio,
        size: item.size * ratio, marker: item.marker,
        direction: item.outside ? Math.atan2(d * item.marker.mapY + f - item.y, a * item.marker.mapX + e - item.x) : null }, ratio, artwork);
      targets.push({ name, box: surface.box, placed, ownsPointer: () => true });
    }
    pointer?.refresh();
  }
  const fullCatalogue = new URLSearchParams(window.location.search).has("fullCatalogue");
  const skills = fullCatalogue ? [...new Set(ELITE_LOCATIONS.map(entry => entry.skillId))].map(id =>
    ELITE_FIXTURE_SKILLS.find(skill => skill.id === id) ?? { ...ELITE_FIXTURE_SKILLS[0]!, id: skillId(id), name: `Fixture elite ${id}` }) : ELITE_FIXTURE_SKILLS;
  const app = mountEliteSkills(target, {
    initialView: eliteFixtureView(), loadSkills: async () => skills,
    onOpenChange: () => {},
    present: (next) => { scene = next; paint(); },
    setMissionMarkers: (mode) => { missionMarkers = mode; update(); },
    openWiki: (entry, page) => { label.textContent = `Wiki action: ${page === "boss" ? entry.boss : entry.skillId}`; },
    tracking: {
      get: async ({ characterKey }) => {
        const stored = localStorage.getItem(`elite-fixture:${characterKey}`);
        return stored ? parseEliteTracking(JSON.parse(stored), ELITE_LOCATIONS) : EMPTY_ELITE_TRACKING;
      },
      update: async ({ characterKey, change }) => {
        if (failSave) throw new Error("Fixture save failure");
        const stored = localStorage.getItem(`elite-fixture:${characterKey}`);
        const current = stored ? parseEliteTracking(JSON.parse(stored), ELITE_LOCATIONS) : EMPTY_ELITE_TRACKING;
        const next = changeEliteTracking(current, change, ELITE_LOCATIONS);
        localStorage.setItem(`elite-fixture:${characterKey}`, JSON.stringify(next));
        return next;
      },
    },
  });
  const map = document.createElement("div");
  map.style.cssText = "position:fixed;left:24px;top:88px;right:24px;bottom:72px;border:1px solid var(--ui-line);background:var(--ui-well-fill);padding:24px;color:var(--ui-text-muted);pointer-events:none";
  map.textContent = "Native map artwork appears here in game. This fixture verifies overlay placement and interaction.";
  document.body.prepend(map);
  map.after(canvas);
  // Fixture panels and controls stand in for game UI above the map.
  pointer = installEliteMapPointer({ view: window, surfaces: () => targets,
    accepts: (node) => !(node instanceof Node && (target.contains(node) || controls.contains(node))),
    hover: (hit) => app.pointer(hit), activate: (hit) => app.activate(hit) });
  function update() {
    const original = eliteFixtureView(mission, otherCharacter, learned, secondary, missionMarkers);
    const next = crowded && original.world ? { ...original, world: { ...original.world, transform: { a: 0.003, b: 0, c: 0, d: 0.003, e: 180, f: 180 } } } : original;
    view = mapOpen ? next : { ...next, world: null, mission: null };
    app.update(view); paint();
  }
  for (const [name, run] of [
    ["World / mission map", () => { mission = !mission; update(); }],
    ["Spread / overlap markers", () => { crowded = !crowded; update(); }],
    ["Close / open map", () => { mapOpen = !mapOpen; update(); }],
    ["Next Mission Map marker mode", () => {
      missionMarkers = ELITE_MISSION_MAP_MARKERS[(ELITE_MISSION_MAP_MARKERS.indexOf(missionMarkers) + 1) % ELITE_MISSION_MAP_MARKERS.length]!;
      label.textContent = `Mission Map markers: ${missionMarkers}`; update(); }],
    ["Change secondary profession", () => { secondary = secondary === 2 ? 3 : 2; update(); }],
    ["Switch character", () => { otherCharacter = !otherCharacter; update(); }],
    ["Learn / unlearn Eviscerate", () => { learned = !learned; update(); }],
    ["Fail / restore saves", () => { failSave = !failSave; label.textContent = failSave ? "Fixture: saves will fail" : "Elite Skills · offline map fixture"; }],
    ["Find Eviscerate", () => app.find(338)],
    ["Modern style", () => window.gwApplyFixtureAppearance?.({ uiStyle: "obsidian", uiPanelOpacity: 96 })],
    ["Guild Wars style", () => window.gwApplyFixtureAppearance?.({ uiStyle: "guild-wars", uiPanelOpacity: 96 })],
  ] as const) {
    const button = document.createElement("button"); button.className = "ui-button"; button.textContent = name; button.onclick = run; controls.append(button);
  }
  window.addEventListener("resize", update);
  target.addEventListener("keydown", (event) => { if (event.key === "Escape") app.close(); });
  document.body.append(controls);
  target.dataset.ready = "true";
}
