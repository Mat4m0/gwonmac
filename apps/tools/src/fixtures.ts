import {
  LIBRARY_VERSION,
  buildId,
  heroId,
  skillId,
  teamId,
  type Build,
  type BuildLibrary,
  type Profession,
  type TeamSlot,
} from "../../../src/shared/builds/library";
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
] as const;

const professions: readonly Profession[] = ["Mo", "N", "Me", "R", "Rt", "E"];
const presentations: SkillPresentation[] = names.map((name, index) => ({
  id: skillId(200 + index),
  name,
  profession: professions[Math.floor(index / 8) % professions.length] ?? null,
  elite: index % 8 === 0,
  iconUrl: null,
}));

export const demoSkillCatalogue = createSkillCatalogue(presentations);

function bar(offset: number): Build["skills"] {
  return Array.from({ length: 8 }, (_, index) =>
    skillId(200 + ((offset + index) % names.length)),
  ) as unknown as Build["skills"];
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
    professions: [profession, profession === "Mo" ? "Me" : "Rt"],
    skills: bar(offset),
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
  return heroIds.map((hero, index): TeamSlot => ({
    hero,
    build: ids[index] ? buildId(ids[index]!) : null,
    behaviour: index === 0 ? null : "guard",
    panel: index > 0,
    disabled: [],
  })) as unknown as BuildLibrary["teams"][number]["slots"];
}

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
