# Progress

Progress is a page of the Hub's Travel app. It shows what one title goal still
needs for the current character, and each missing place is one trip away.

Open it with `progress` in the Hub, or type a goal word: `vq`, `guardian`,
`protector`, `carto`, `hm`, `outposts`. A goal word opens that goal of the
campaign you are in.

## Goals

| Campaign | Goals |
|---|---|
| Prophecies | Protector and Guardian of Tyria (bonus), Vanquisher of Tyria, Cartographer, Outposts |
| Factions | Protector and Guardian of Cantha (Master's), Vanquisher of Cantha, Cartographer, Outposts |
| Nightfall | Protector and Guardian of Elona (Master's), Vanquisher of Elona, Cartographer, Outposts |
| Eye of the North | Missions, Hard mode missions, Vanquishes, Outposts (no title is tied to these) |

- **Counts come from the list.** A goal's `9 / 17` counts exactly the entries
  the list shows as done.
- **Cartographer is a percentage only.** The game reports the title points, not
  which areas are missing, so the page shows the percent per continent.
- **Unknown is not zero.** When the game's record cannot be read, that goal is
  left out instead of showing 0%.
- **Enter travels.** A mission goes to its own outpost (Vizunah Square and
  Unwaking Waters to an unlocked quarter). An area, or a locked mission, goes to
  the nearest unlocked outpost on the same world map, and the button says
  "(nearest)". The trip uses Travel's rules and its "Leave this area?" question.

## Rules

- **PvE only, with a character.** Loading screens, PvP and character select
  show a waiting line, never an empty record.
- **It follows the Travel switch.** Progress has no switch of its own.
- **Nothing is stored.** The goal you last chose per campaign is kept only
  while the game runs.

## How it reads the game

The companion kernel copies, each tick, the character's mission, bonus,
hard-mode and vanquish bitsets and the three Cartographer title records from
WorldContext. Once per session it copies the static AreaInfo rows (campaign,
region, type, flags, name and world-map position). An explorable area has no
map point in AreaInfo, only an icon rectangle; the kernel publishes the
rectangle's centre instead.

Every field is certified per client build through its own accessor function;
see `src/main/certification/enhancement-progress-proof.ts`. The catalogue rules
(which rows are title missions and vanquish areas) live in
`src/shared/game-progress.ts`.
