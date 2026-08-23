import type { NewsArticle } from "../model";

export const newsArticles: NewsArticle[] = [
  {
    id: "event",
    source: "Guild Wars",
    date: "Starts Aug 25",
    title: "Wayfarer’s Reverie starts Tuesday",
    summary: "The event includes quests across Tyria, Cantha, and Elona.",
    image: "/images/desert.webp",
    paragraphs: [
      "Wayfarer’s Reverie returns next week. The event sends you across all three campaigns.",
    ],
    bullets: ["Complete the event quests during the week.", "All weekly bonuses will be active."],
  },
  {
    id: "client-update",
    source: "Official Guild Wars",
    date: "Aug 19, 2026",
    title: "Client stability update",
    summary: "This update fixes problems with cinematics and the map.",
    image: "/images/ascalon.webp",
    paragraphs: ["ArenaNet released a small client update."],
    bullets: [
      "Fixed a crash in some cinematics.",
      "Fixed areas near mission boundaries that could not be revealed on the map.",
    ],
  },
  {
    id: "multiple-accounts",
    source: "Reforged for macOS",
    date: "Aug 17, 2026",
    title: "Start every account from one launcher",
    summary: "Open separate game windows without opening another launcher.",
    image: "/images/bg-reforged.jpg",
    paragraphs: [
      "Accounts now stay in the main launcher. Choose an account and start it directly from the Accounts screen or the Play menu.",
    ],
    bullets: [
      "Each account keeps its own login and settings.",
      "Multiple game windows can be enabled or disabled immediately.",
      "The launcher never copies keyboard or mouse input between accounts.",
    ],
  },
];
