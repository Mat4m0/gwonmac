import {
  LIBRARY_VERSION,
  buildId,
  heroId,
  skillBarOf,
  skillId,
  teamId,
  teamSlotsOf,
  type Build,
  type BuildLibrary,
  type Profession,
} from "../../../src/shared/builds/library";
import { liveParty } from "../../../src/shared/builds/live-party";
import { createSkillCatalogue, type SkillPresentation } from "./skill-catalog";

const names = [
  "Protective Spirit", "Word of Healing", "Aegis", "Dismiss Condition",
  "Spirit Bond", "Patient Spirit", "Guardian", "Resurrection Chant",
  "Discord", "Animate Bone Minions", "Death Nova", "Putrid Bile",
  "Blood of the Master", "Foul Feast", "Signet of Lost Souls", "Flesh of My Flesh",
  "Cry of Frustration", "Power Drain", "Unnatural Signet", "Mistrust",
  "Shatter Hex", "Complicate", "Leech Signet", "Energy Surge",
  "Splinter Weapon", "Barrage", "Distracting Shot", "Savage Shot",
  "Read the Wind", "Lightning Reflexes", "Comfort Animal", "Never Rampage Alone",
  "Spirit Light", "Mend Body and Soul", "Protective Was Kaolai", "Life",
  "Recovery", "Weapon of Warding", "Spirit Transfer", "Flesh of My Flesh",
  "Invoke Lightning", "Chain Lightning", "Lightning Orb", "Blinding Flash",
  "Air Attunement", "Glyph of Lesser Energy", "Elemental Lord", "Resurrection Signet",
  "Infuse Health", "Heal Party", "Empathy", "Backfire",
] as const;

const professions: readonly Profession[] = ["Mo", "N", "Me", "R", "Rt", "E"];
const eliteSkills = new Set([
  "Word of Healing",
  "Discord",
  "Cry of Frustration",
  "Barrage",
  "Spirit Transfer",
  "Invoke Lightning",
]);
const playerOnlySkills = new Set(["Never Rampage Alone", "Elemental Lord"]);
const presentations: SkillPresentation[] = names.map((name, index) => ({
  id: skillId(200 + index),
  name,
  profession: index < 48
    ? professions[Math.floor(index / 8)] ?? null
    : (["Mo", "Mo", "Me", "Me"] as const)[index - 48] ?? null,
  attribute: null,
  elite: eliteSkills.has(name),
  availability: playerOnlySkills.has(name) ? "player-only-pve" : "pve",
  energyCost: index % 3 === 0 ? 10 : 5,
  adrenalineCost: 0,
  healthCost: 0,
  overcast: 0,
  activationSeconds: index % 2 === 0 ? 1 : 0.25,
  aftercastSeconds: 0.75,
  rechargeSeconds: 5 + index % 4,
  description: `${name} demonstrates the client-owned skill description in the standalone workbench.`,
  iconUrl: null,
}));

export const demoSkillCatalogue = createSkillCatalogue(presentations);

function bar(profession: Profession, variation: number): Build["skills"] {
  const block = professions.indexOf(profession) * 8;
  return skillBarOf((slot) => skillId(200 + block + ((variation + slot) % 8)));
}

function build(
  id: string,
  name: string,
  profession: Profession,
  offset: number,
  tags: readonly string[],
  parent: string | null = null,
): Build {
  return {
    id: buildId(id),
    name,
    professions: [
      profession,
      profession === "Mo" ? "Me" : profession === "Rt" ? "Mo" : "Rt",
    ],
    skills: bar(profession, offset),
    attributes: profession === "Mo"
      ? { HealingPrayers: 12, ProtectionPrayers: 10, DivineFavor: 8 }
      : profession === "N"
        ? { DeathMagic: 12, SoulReaping: 10 }
        : profession === "Me"
          ? { DominationMagic: 12, FastCasting: 10 }
          : {},
    tags,
    favourite: id === "b-woh" || id === "b-discord",
    parent: parent === null ? null : buildId(parent),
    notes: parent === null
      ? "Reliable general-purpose bar. Easy to adapt."
      : "A focused variant that keeps its relationship to the original.",
    lastUsed: null,
    origin: null,
  };
}

const builds: Build[] = [
  build("b-woh", "Word of Healing", "Mo", 0, ["support", "general"]),
  build("b-woh-aegis", "Word of Healing — Aegis", "Mo", 1, ["support", "vanquish"], "b-woh"),
  build("b-discord", "Discord Necro", "N", 8, ["damage", "general"]),
  build("b-discord-rot", "Discord Necro — rot", "N", 10, ["damage", "pressure"], "b-discord"),
  build("b-dom", "Domination shutdown", "Me", 16, ["interrupt", "HM"]),
  build("b-barrage", "Splinter Barrage", "R", 24, ["player", "damage"]),
  build("b-resto", "Ritualist restoration", "Rt", 5, ["support", "spirits"]),
  build("b-ele", "Air pressure", "E", 12, ["damage", "general"]),
];

const heroIds = [null, heroId(21), heroId(4), heroId(1), heroId(24), heroId(3), heroId(15), heroId(26)] as const;
function slots(ids: readonly (string | null)[]): BuildLibrary["teams"][number]["slots"] {
  return teamSlotsOf((position) => ({
    hero: heroIds[position] ?? null,
    build: ids[position] ? buildId(ids[position]!) : null,
    behaviour: position === 0 ? null : "guard",
  }));
}

/**
 * A party for the standalone view, built by putting a fake observation through
 * the same `liveParty` door the running game uses.
 *
 * Constructing the result by hand would let the fixture describe a party the
 * mapper cannot actually produce, which is how a section gets designed against
 * data that never arrives. Koss is `heroId(6)`; the count says three because
 * the companion counts what it cannot yet name.
 */
export const demoParty = liveParty({
  status: "ready",
  partyObserved: true,
  heroAvailable: true,
  heroCount: 3,
  firstHeroId: 6,
  firstHeroAgentId: 142,
});

export const demoLibrary: BuildLibrary = {
  version: LIBRARY_VERSION,
  tags: ["general", "support", "damage", "vanquish", "HM", "missions"],
  builds,
  teams: [
    {
      id: teamId("t-vanquish"), name: "Balanced vanquish", mode: "hard",
      tags: ["vanquish", "HM"], favourite: true, lastUsed: null, notes: "",
      slots: slots(["b-barrage", "b-discord", "b-discord-rot", "b-dom", "b-dom", "b-woh-aegis", "b-resto", "b-ele"]),
    },
    {
      id: teamId("t-discord"), name: "Classic Discordway", mode: "hard",
      tags: ["general", "HM"], favourite: false, lastUsed: null, notes: "",
      slots: slots(["b-barrage", "b-discord", "b-discord", "b-dom", "b-dom", "b-woh", "b-resto", "b-ele"]),
    },
    {
      id: teamId("t-story"), name: "Story and missions", mode: "normal",
      tags: ["general", "missions"], favourite: false, lastUsed: null, notes: "",
      slots: slots(["b-barrage", "b-discord", "b-discord", "b-dom", "b-ele", "b-woh", "b-resto", null]),
    },
  ],
};
