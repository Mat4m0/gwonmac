/** Offline visual fixture for the real planner; all game state is illustrative. */
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { EMPTY_ELITE_TRACKING, changeEliteTracking, parseEliteTracking } from "../../../src/shared/elite-skills";
import { travelCharacterKey } from "../../../src/shared/travel-history";
import { skillId } from "../../../src/shared/builds/library";
import type { EliteMapView } from "../../../src/shared/elite-map";
import type { SkillPresentation } from "./skill-catalog";
import { mountEliteSkills } from "./elite-mount";
const fixtureSkills = [
  { boss: "Lissah the Packleader", name: "Eviscerate", profession: "W", attribute: "AxeMastery" },
  { boss: "Fenrir", name: "Crippling Slash", profession: "W", attribute: "Swordsmanship" },
  { boss: "Jormungand", name: "Earth Shaker", profession: "W", attribute: "HammerMastery" },
  { boss: "Warrior's Construct", name: "Hundred Blades", profession: "W", attribute: "Swordsmanship" },
  { boss: "Markis", name: "Barrage", profession: "R", attribute: "Marksmanship" },
  { boss: "Dwayna's Cursed", name: "Restore Condition", profession: "Mo", attribute: "ProtectionPrayers" },
] as const;
export const ELITE_FIXTURE_SKILLS: readonly SkillPresentation[] = fixtureSkills.map(({ boss, name, profession, attribute }) => {
  const location = ELITE_LOCATIONS.find((entry) => entry.boss === boss)!;
  const color = profession === "W" ? "#ad7431" : profession === "R" ? "#37774b" : "#416caa";
  const initials = name.split(" ").map(part => part[0]).join("").slice(0, 2);
  // Reproduce the client texture's baked-in 4px rim so marker polish is visible offline.
  const iconUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#000"/><rect x="4" y="4" width="56" height="56" fill="${color}"/><path d="M4 60 60 4v56Z" fill="#000" opacity=".25"/><text x="32" y="40" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="24">${initials}</text></svg>`)}`;
  return { id: skillId(location.skillId), name, profession, attribute,
    elite: true, availability: "pve", energyCost: profession === "W" ? 0 : 5, adrenalineCost: profession === "W" ? 8 : 0, healthCost: 0, overcast: 0,
    activationSeconds: profession === "Mo" ? 0.75 : 0, aftercastSeconds: 0.75, rechargeSeconds: profession === "Mo" ? 2 : 0,
    description: "Illustrative skill details for the offline fixture. In game, the exact description and costs come from the installed client.", iconUrl };
});
const characterA = travelCharacterKey("0123456789abcdef");
const characterB = travelCharacterKey("fedcba9876543210");
const location = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;
export function eliteFixtureView(mission = false, otherCharacter = false, learned = false, secondary = 2): EliteMapView {
  return { characterKey: otherCharacter ? characterB : characterA, mapId: location.mapId,
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
  const fullCatalogue = new URLSearchParams(window.location.search).has("fullCatalogue");
  const skills = fullCatalogue ? [...new Set(ELITE_LOCATIONS.map(entry => entry.skillId))].map(id =>
    ELITE_FIXTURE_SKILLS.find(skill => skill.id === id) ?? { ...ELITE_FIXTURE_SKILLS[0]!, id: skillId(id), name: `Fixture elite ${id}` }) : ELITE_FIXTURE_SKILLS;
  const app = mountEliteSkills(target, {
    initialView: eliteFixtureView(), loadSkills: async () => skills,
    onOpenChange: () => {},
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
  function update() {
    const original = eliteFixtureView(mission, otherCharacter, learned, secondary);
    const view = crowded && original.world ? { ...original, world: { ...original.world, transform: { a: 0.003, b: 0, c: 0, d: 0.003, e: 180, f: 180 } } } : original;
    app.update(mapOpen ? view : { ...view, world: null, mission: null });
  }
  for (const [name, run] of [
    ["World / mission map", () => { mission = !mission; update(); }],
    ["Spread / overlap markers", () => { crowded = !crowded; update(); }],
    ["Close / open map", () => { mapOpen = !mapOpen; update(); }],
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
