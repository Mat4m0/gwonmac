import type { DailyActivityKind } from "../model";

export interface DailyActivity {
  kind: DailyActivityKind;
  label: string;
  name: string;
  wikiPath: string;
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
