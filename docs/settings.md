# Settings

This document owns how settings behave across the launcher and the in-game Hub:
where each setting lives, what it is called, when a change takes effect, and how
a player reaches a setting that the current surface does not show.

## The problem this solves

A player who plays and sees "Guild Wars is running low on memory" reads that an
experimental 4 GB limit exists. Hub › Settings does not offer it. The only
control is Launcher › Settings › Game settings, which the player must first find
through Window › Show Launcher. Before this change:

- Hub Settings and launcher Settings were two hand-built lists with different
  section names and seven different labels for the same stored value
  ("Relog after reload" and "Return to character after reload").
- Nothing in the Hub said that more settings exist in the launcher, or where.
- Hub Settings showed a snapshot and did not follow a change made elsewhere.
- Settings were not found by their own words in Hub search ("memory").

## Jobs

| Who | Job | Frequency | Situation | Must never go wrong | Target |
|---|---|---|---|---|---|
| Player | Turn a tool or map layer on or off | Weekly | In game, mid-session | The change applies now, in every window | ⌘R, type the name, ↵. 3 steps |
| Player | React to a memory warning | Rare, urgent | In game, warning on screen | The player learns what the change does and when it applies | 1 step from the warning to the setting |
| Player | Change a game-wide option (render quality, memory, controller symbols) | Rare | In game, or in the launcher before play | Honest timing: now, next game open, or app restart | Findable in both surfaces by its name |
| Player | Change a shortcut | Rare | In game | No conflict is saved silently | Hub › Settings › Shortcuts |
| Player | Edit custom colors or a map style | Rare, long | At a desk | Nothing lost | Launcher, one click from the Hub |
| Player | Updates, Home content, game files, texture packs, logs, reset | Rare | Launcher | Files and accounts stay safe | Launcher only |

Evidence: the reported case (memory setting unreachable in game), the audit
findings HUB-063/064 (settings not found by their words), and the code inventory.
Assumed, not measured: how often each setting changes.

## Rules

1. **One setting, one name, one place in the tree.** Both surfaces show the same
   section names and the same labels and descriptions, from one shared
   definition in `src/shared/settings-catalogue.ts`.
2. **In game shows every game setting.** Hub › Settings holds every setting that
   changes the game, its tools or its panels. The launcher adds only what
   concerns the launcher, accounts and files.
3. **Every setting says when it applies**, in the same words everywhere:
   no note when it applies now; "Applies when you next open a game window";
   "Applies after you restart gwonmac". A saved choice that is not active yet
   shows its state next to the control ("Restart required. This session uses 2 GB.").
4. **What the Hub does not show, it links to.** A section with launcher-only
   depth ends with one named link that opens the launcher at that section
   ("Edit custom colors in the launcher"). No dead ends.
5. **Hub Settings follows the stored value.** A change from the launcher or
   another game window repaints an open Hub Settings page.
6. **Settings are found by their words.** Typing a setting's label or keyword in
   Hub search offers "Open setting", which opens Settings at that section with
   the control focused.

## The tree

Both surfaces use these sections for game settings, in this order.

| Section | Settings | Hub | Launcher |
|---|---|---|---|
| Game | Render quality, Extended memory, Controller symbols, Return to character after reload, Diagnostics overlay | All | All |
| Appearance | Panel style, Panel font, Panel opacity, Reset Hub position (Hub only) | All; custom colors link to the launcher | All, with the custom theme editor |
| Tools | Enable Tools, every tool, and each tool's options (Character Switch details, chat filters, timer color, skill key labels, Alcohol Timer position) | Switches and options; skill key labels and timer color link to the launcher | All |
| Shortcuts | The ten app shortcuts | All | Shown beside their tools, as today |
| Maps | Grid, walkable terrain, compass ranges and their opacity | Layers, ranges, opacity; styles link to the launcher | All, with the style editor |

The Hub's former "Chat & characters" section moves into Tools, beside the tool
each option belongs to (Character Switch, Chat Filters).

Launcher only: Updates, Content, Texture packs, Game files, Advanced (logs,
reset all settings).

## Entry points

| From | Opens |
|---|---|
| Hub › Settings, macOS Settings… in a game window | Hub Settings, last section |
| Hub search: a setting's name | Hub Settings at that section, control focused |
| Memory warning › "Memory settings" | Hub Settings › Game, Extended memory focused |
| Hub link "… in the launcher" | Launcher Settings at that section |
| macOS Check for Updates… | Launcher Settings › Updates |
| Launcher gear, macOS Settings… in the launcher | Launcher Settings, last section |

## Acceptance

- In a running game: ⌘R, type `memory`, ↵ focuses Extended memory in Hub › Settings › Game. 3 steps.
- Turning Extended memory on in the Hub shows "Restart required. This session uses 2 GB." and the launcher shows the same value.
- The memory warning's "Memory settings" lands on the same control.
- Every label shared by both surfaces is byte-identical (unit test over the catalogue).
- A change made in the launcher repaints an open Hub Settings page.
- Check for Updates… opens the Updates section.
