import type { DailyActivityKind } from "../model";

export interface DailyActivity {
  kind: DailyActivityKind;
  label: string;
  name: string;
  wikiPath: string;
}

export interface DailyScheduleDay {
  dayOffset: number;
  activities: DailyActivity[];
}

export const dailyActivities: DailyActivity[] = [
  {
    kind: "mission",
    label: "Zaishen Mission",
    name: "Gate of Pain",
    wikiPath: "Gate_of_Pain_(Zaishen_quest)",
  },
  {
    kind: "bounty",
    label: "Zaishen Bounty",
    name: "Zoldark the Unholy",
    wikiPath: "Zoldark_the_Unholy_(Zaishen_quest)",
  },
  {
    kind: "combat",
    label: "Zaishen Combat",
    name: "Random Arena",
    wikiPath: "Random_Arena_(Zaishen_quest)",
  },
  {
    kind: "vanquish",
    label: "Zaishen Vanquish",
    name: "Skyward Reach",
    wikiPath: "Skyward_Reach_(Zaishen_vanquish)",
  },
  {
    kind: "shining-blade",
    label: "Shining Blade",
    name: "Justiciar Marron",
    wikiPath: "Wanted:_Justiciar_Marron",
  },
  {
    kind: "vanguard",
    label: "Vanguard Quest",
    name: "Footman Tate",
    wikiPath: "Vanguard_Rescue:_Footman_Tate",
  },
  {
    kind: "sandford",
    label: "Nicholas Sandford",
    name: "Baked Husks",
    wikiPath: "Baked_Husk",
  },
];

const weeklyRotations: Record<DailyActivityKind, Omit<DailyActivity, "kind" | "label">[]> = {
  mission: [
    { name: "Gate of Pain", wikiPath: "Gate_of_Pain_(Zaishen_quest)" },
    { name: "A Time for Heroes", wikiPath: "A_Time_for_Heroes_(Zaishen_quest)" },
    { name: "Vizunah Square", wikiPath: "Vizunah_Square_(Zaishen_quest)" },
    { name: "Abaddon's Gate", wikiPath: "Abaddon%27s_Gate_(Zaishen_quest)" },
    { name: "Aurora Glade", wikiPath: "Aurora_Glade_(Zaishen_quest)" },
    { name: "Gyala Hatchery", wikiPath: "Gyala_Hatchery_(Zaishen_quest)" },
    { name: "Ruins of Morah", wikiPath: "Ruins_of_Morah_(Zaishen_quest)" },
  ],
  bounty: [
    { name: "Zoldark the Unholy", wikiPath: "Zoldark_the_Unholy_(Zaishen_quest)" },
    { name: "Rotscale", wikiPath: "Rotscale_(Zaishen_quest)" },
    { name: "Duncan the Black", wikiPath: "Duncan_the_Black_(Zaishen_quest)" },
    { name: "Justiciar Thommis", wikiPath: "Justiciar_Thommis_(Zaishen_quest)" },
    { name: "Fendi Nin", wikiPath: "Fendi_Nin_(Zaishen_quest)" },
    { name: "Molotov Rocktail", wikiPath: "Molotov_Rocktail_(Zaishen_quest)" },
    { name: "The Darknesses", wikiPath: "The_Darknesses_(Zaishen_quest)" },
  ],
  combat: [
    { name: "Random Arena", wikiPath: "Random_Arena_(Zaishen_quest)" },
    { name: "Alliance Battles", wikiPath: "Alliance_Battles_(Zaishen_quest)" },
    { name: "The Jade Quarry", wikiPath: "The_Jade_Quarry_(Zaishen_quest)" },
    { name: "Fort Aspenwood", wikiPath: "Fort_Aspenwood_(Zaishen_quest)" },
    { name: "Codex Arena", wikiPath: "Codex_Arena_(Zaishen_quest)" },
    { name: "Heroes' Ascent", wikiPath: "Heroes%27_Ascent_(Zaishen_quest)" },
    { name: "Guild Battles", wikiPath: "Guild_Battles_(Zaishen_quest)" },
  ],
  vanquish: [
    { name: "Skyward Reach", wikiPath: "Skyward_Reach_(Zaishen_vanquish)" },
    { name: "Scoundrel's Rise", wikiPath: "Scoundrel%27s_Rise_(Zaishen_vanquish)" },
    { name: "Jaya Bluffs", wikiPath: "Jaya_Bluffs_(Zaishen_vanquish)" },
    { name: "Turai's Procession", wikiPath: "Turai%27s_Procession_(Zaishen_vanquish)" },
    { name: "Arbor Bay", wikiPath: "Arbor_Bay_(Zaishen_vanquish)" },
    { name: "The Alkali Pan", wikiPath: "The_Alkali_Pan_(Zaishen_vanquish)" },
    { name: "Mount Qinkai", wikiPath: "Mount_Qinkai_(Zaishen_vanquish)" },
  ],
  "shining-blade": [
    { name: "Justiciar Marron", wikiPath: "Wanted:_Justiciar_Marron" },
    { name: "Insatiable Vakar", wikiPath: "Wanted:_Insatiable_Vakar" },
    { name: "Destor the Truth Seeker", wikiPath: "Wanted:_Destor_the_Truth_Seeker" },
    { name: "Justiciar Kimii", wikiPath: "Wanted:_Justiciar_Kimii" },
    { name: "Justiciar Kasandra", wikiPath: "Wanted:_Justiciar_Kasandra" },
    { name: "Justiciar Sevaan", wikiPath: "Wanted:_Justiciar_Sevaan" },
    { name: "Justiciar Amilyn", wikiPath: "Wanted:_Justiciar_Amilyn" },
  ],
  vanguard: [
    { name: "Footman Tate", wikiPath: "Vanguard_Rescue:_Footman_Tate" },
    { name: "Farmer Hamnet", wikiPath: "Vanguard_Rescue:_Farmer_Hamnet" },
    { name: "Bandits", wikiPath: "Vanguard_Bounty:_Bandits" },
    { name: "Utini Wupwup", wikiPath: "Vanguard_Bounty:_Utini_Wupwup" },
    { name: "Charr", wikiPath: "Vanguard_Bounty:_Charr" },
    { name: "Countess Nadya", wikiPath: "Vanguard_Rescue:_Countess_Nadya" },
    { name: "Lieutenant Langmar", wikiPath: "Vanguard_Rescue:_Lieutenant_Langmar" },
  ],
  sandford: [
    { name: "Baked Husks", wikiPath: "Baked_Husk" },
    { name: "Charr Carvings", wikiPath: "Charr_Carving" },
    { name: "Gargoyle Skulls", wikiPath: "Gargoyle_Skull" },
    { name: "Grawl Necklaces", wikiPath: "Grawl_Necklace" },
    { name: "Icy Lodestones", wikiPath: "Icy_Lodestone" },
    { name: "Red Iris Flowers", wikiPath: "Red_Iris_Flower" },
    { name: "Unnatural Seeds", wikiPath: "Unnatural_Seed" },
  ],
};

export const dailySchedule: DailyScheduleDay[] = Array.from({ length: 7 }, (_, dayOffset) => ({
  dayOffset,
  activities: dailyActivities.map((activity) => ({
    kind: activity.kind,
    label: activity.label,
    ...weeklyRotations[activity.kind][dayOffset]!,
  })),
}));
