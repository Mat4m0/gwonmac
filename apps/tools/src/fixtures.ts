import type {
  Build,
  BuildLibrary,
  Profession,
  Skill,
  TeamSlot,
} from "./model";

const professions: Profession[] = [
  "Warrior",
  "Ranger",
  "Monk",
  "Necromancer",
  "Mesmer",
  "Elementalist",
  "Assassin",
  "Ritualist",
  "Paragon",
  "Dervish",
];

const skillNames = [
  "Protective Spirit",
  "Word of Healing",
  "Aegis",
  "Dismiss Condition",
  "Spirit Bond",
  "Patient Spirit",
  "Guardian",
  "Resurrection Chant",
  "Discord",
  "Animate Bone Minions",
  "Death Nova",
  "Putrid Bile",
  "Blood of the Master",
  "Foul Feast",
  "Signet of Lost Souls",
  "Flesh of My Flesh",
  "Cry of Frustration",
  "Power Drain",
  "Unnatural Signet",
  "Mistrust",
  "Shatter Hex",
  "Complicate",
  "Leech Signet",
  "Energy Surge",
  "Splinter Weapon",
  "Barrage",
  "Distracting Shot",
  "Savage Shot",
  "Read the Wind",
  "Lightning Reflexes",
  "Comfort Animal",
  "Never Rampage Alone",
] as const;

function skills(offset: number, profession: Profession): Skill[] {
  return Array.from({ length: 8 }, (_, index) => {
    const name = skillNames[(offset + index) % skillNames.length]!;
    return {
      id: 200 + offset + index,
      name,
      short: name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2),
      profession,
      ...(index === 0 ? { elite: true } : {}),
    };
  });
}

function build(
  id: string,
  name: string,
  profession: Profession,
  offset: number,
  tags: string[],
  parentId: string | null = null,
): Build {
  return {
    id,
    name,
    professions: [profession, profession === "Monk" ? "Mesmer" : "Ritualist"],
    skills: skills(offset, profession),
    attributes: {
      [profession === "Monk" ? "Healing Prayers" : `${profession} Mastery`]: 12,
      "Inspiration Magic": 8,
      "Protection Prayers": 10,
    },
    tags,
    favourite: id === "b-woh" || id === "b-discord",
    parentId,
    notes:
      parentId === null
        ? "Reliable general-purpose bar. Kept intentionally readable and easy to adapt."
        : "A focused variant that keeps its relationship to the original.",
  };
}

const builds: Build[] = [
  build("b-woh", "Word of Healing", "Monk", 0, ["support", "general"]),
  build(
    "b-woh-aegis",
    "Word of Healing — Aegis",
    "Monk",
    1,
    ["support", "vanquish"],
    "b-woh",
  ),
  build("b-discord", "Discord Necro", "Necromancer", 8, ["damage", "general"]),
  build(
    "b-discord-rot",
    "Discord Necro — rot",
    "Necromancer",
    10,
    ["damage", "pressure"],
    "b-discord",
  ),
  build("b-dom", "Domination shutdown", "Mesmer", 16, ["interrupt", "HM"]),
  build("b-barrage", "Splinter Barrage", "Ranger", 24, ["player", "damage"]),
  build("b-resto", "Ritualist restoration", "Ritualist", 5, ["support", "spirits"]),
  build("b-ele", "Air pressure", "Elementalist", 12, ["damage", "general"]),
];

const heroes = [
  ["You", "Ranger"],
  ["Livia", "Necromancer"],
  ["Master of Whispers", "Necromancer"],
  ["Norgu", "Mesmer"],
  ["Gwen", "Mesmer"],
  ["Tahlkora", "Monk"],
  ["Razah", "Ritualist"],
  ["Vekk", "Elementalist"],
] as const satisfies readonly (readonly [string, Profession])[];

function slots(ids: readonly (string | null)[]): TeamSlot[] {
  return heroes.map(([hero, profession], index) => ({
    hero,
    profession,
    buildId: ids[index] ?? null,
    behavior: index === 0 ? "Fight" : "Guard",
  }));
}

export const demoLibrary: BuildLibrary = {
  version: 1,
  builds,
  teams: [
    {
      id: "t-vanquish",
      name: "Balanced vanquish",
      mode: "Hard",
      tags: ["vanquish", "HM"],
      favourite: true,
      slots: slots([
        "b-barrage",
        "b-discord",
        "b-discord-rot",
        "b-dom",
        "b-dom",
        "b-woh-aegis",
        "b-resto",
        "b-ele",
      ]),
    },
    {
      id: "t-discord",
      name: "Classic Discordway",
      mode: "Hard",
      tags: ["general", "HM"],
      favourite: false,
      slots: slots([
        "b-barrage",
        "b-discord",
        "b-discord",
        "b-dom",
        "b-dom",
        "b-woh",
        "b-resto",
        "b-ele",
      ]),
    },
    {
      id: "t-story",
      name: "Story and missions",
      mode: "Normal",
      tags: ["general", "missions"],
      favourite: false,
      slots: slots([
        "b-barrage",
        "b-discord",
        "b-discord",
        "b-dom",
        "b-ele",
        "b-woh",
        "b-resto",
        null,
      ]),
    },
  ],
};

export { professions };
