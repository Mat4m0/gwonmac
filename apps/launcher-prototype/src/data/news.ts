import type { NewsArticle } from "../model";

export const newsArticles: NewsArticle[] = [
  {
    id: "event",
    sourceKey: "guild-wars",
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
    sourceKey: "guild-wars",
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
    sourceKey: "macos",
    source: "Reforged for macOS",
    date: "Aug 17, 2026",
    title: "Accounts and Quick start are now in one launcher",
    summary: "Open one game window or your usual group from the same launcher.",
    image: "/images/bg-reforged.jpg",
    paragraphs: [
      "Add accounts only when you need them. Quick start opens your selected accounts together, each in its own game window.",
    ],
    bullets: [
      "Each account keeps its own login and settings.",
      "Every saved account can open in its own game window.",
      "The launcher never copies keyboard or mouse input between accounts.",
    ],
  },
];
