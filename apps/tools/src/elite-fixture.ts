/** Offline visual fixture for the real planner; all game state is illustrative. */
import { ELITE_LOCATIONS } from "../../../src/shared/elite-locations";
import { EMPTY_ELITE_TRACKING, changeEliteTracking, parseEliteTracking } from "../../../src/shared/elite-skills";
import { travelCharacterKey } from "../../../src/shared/travel-history";
import { skillId } from "../../../src/shared/builds/library";
import type { EliteMapView } from "../../../src/shared/elite-map";
import type { SkillPresentation } from "./skill-catalog";
import { mountEliteSkills } from "./elite-mount";
const fixtureBosses = ["Lissah the Packleader", "Fenrir", "Jormungand", "Warrior's Construct"];
export const ELITE_FIXTURE_SKILLS: readonly SkillPresentation[] = fixtureBosses.map((boss, index) => {
  const location = ELITE_LOCATIONS.find((entry) => entry.boss === boss)!;
  return { id: skillId(location.skillId), name: ["Eviscerate", "Crippling Slash", "Earth Shaker", "Hundred Blades"][index]!,
    profession: "W", attribute: ["AxeMastery", "Swordsmanship", "HammerMastery", "Swordsmanship"][index] as "AxeMastery" | "Swordsmanship" | "HammerMastery",
    elite: true, availability: "pve", energyCost: 0, adrenalineCost: 8, healthCost: 0, overcast: 0,
    activationSeconds: 0, aftercastSeconds: 0, rechargeSeconds: 0,
    description: "Illustrative skill details for the offline fixture. In game, the exact description and costs come from the installed client.", iconUrl: null };
});
const characterA = travelCharacterKey("0123456789abcdef");
const characterB = travelCharacterKey("fedcba9876543210");
const location = ELITE_LOCATIONS.find((entry) => entry.boss === "Lissah the Packleader")!;
export function eliteFixtureView(mission = false, otherCharacter = false, learned = false): EliteMapView {
  return { characterKey: otherCharacter ? characterB : characterA, mapId: location.mapId,
    observation: { status: "ready", partyObserved: true, party: { status: "ready", playRegion: "pve", rosterObserved: false,
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
  let mission = false, otherCharacter = false, learned = false, failSave = false;
  const app = mountEliteSkills(target, {
    initialView: eliteFixtureView(), loadSkills: async () => ELITE_FIXTURE_SKILLS,
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
  function update() { app.update(eliteFixtureView(mission, otherCharacter, learned)); }
  for (const [name, run] of [
    ["World / mission map", () => { mission = !mission; update(); }],
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
