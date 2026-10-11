# Settings

This document owns how settings behave: where each setting lives, what it is
called, when a change takes effect, and how a player reaches a setting from the
launcher, the game and the Hub.

## The decision

gwonmac has one Settings window. The launcher, every game window, the Hub and
the memory warning open the same window. Before this change the Hub and the
launcher had two hand-built Settings lists with different section names, seven
different labels for the same stored value, and settings the Hub could not
reach (Extended memory).

## Jobs

| Who | Job | Frequency | Situation | Must never go wrong | Target |
|---|---|---|---|---|---|
| Player | Turn a tool or map layer on or off | Weekly | In game, mid-session | The change applies now, in every window | ⌘R, type the name, ↵. 3 steps |
| Player | React to a memory warning | Rare, urgent | In game, warning on screen | The player learns what the change does and when it applies | 1 step from the warning to the setting |
| Player | Change a game-wide option | Rare | In game, or in the launcher before play | Honest timing: now, next game open, or app restart | Found by its name in Settings search and Hub search |
| Player | Change a shortcut | Rare | In game | No conflict is saved silently | Beside its tool in Settings › Tools |
| Player | Updates, Home screen, game files, texture packs, logs, reset | Rare | Launcher | Files and accounts stay safe | Same window, GWonMac group |

Evidence: the reported case (memory setting unreachable in game), the audit
findings HUB-063/064 (settings not found by their words), and the code inventory.
Assumed, not measured: how often each setting changes.

## Rules

1. **One setting, one name, one control.** `src/shared/settings-catalogue.ts`
   lists every section and every setting that search can open, with its stable
   ID, label and keywords. Each control carries `data-setting="<id>"`. A test
   renders every section and fails when a catalogue entry has no control, more
   than one control, or a different label.
2. **Every setting says when it applies**, in the same words everywhere:
   no note when it applies now; "Applies when you next open a game window";
   "Applies after you restart GWonMac." A saved choice that is not active yet
   shows its state next to the control ("Restart required. This session still
   uses 2 GB.").
3. **Changes save right away.** The status line at the bottom names the saved
   setting and when it applies. A failed save keeps the change on screen, locks
   other edits, and offers **Retry** and **Revert**.
4. **Settings are found by their words.** Settings search (⌘F) and Hub search
   both use the catalogue. Choosing a result opens its section, opens a closed
   **Options** group if needed, and focuses the control.
5. **The window stays above the game.** Settings is a child of the window that
   opened it, so it appears over a full-screen game on the same Space.

## The tree

The sidebar shows two groups. Settings opens at Tools unless the caller names
a section.

| Group | Section | Settings |
|---|---|---|
| In game | Tools | Hub (built in, ⌘R), Enable Tools, every tool with its shortcut and switch on one row, and each tool's options in a closed **Options** group |
| In game | Maps | Grid, walkable terrain, compass ranges, Elite skills, map style and opacities |
| In game | Appearance | Panel style (including custom colors), font, text size, panel opacity |
| In game | Game | Render quality, Extended memory, Return to character after reload, Controller symbols, Diagnostics overlay |
| In game | Texture packs | Import, choose and remove `.tpf` packs |
| In game | Game files | Download state, cache size, pause and resume |
| GWonMac | Updates | Check automatically, update channel |
| GWonMac | Home screen | News, Dailies, news sources |
| GWonMac | Advanced | Reveal logs, reset all settings |

## Entry points

| From | Opens |
|---|---|
| Launcher gear, **Settings…** (⌘,) in the launcher or a game window | Settings, at Tools or the section already shown |
| Hub: the **Settings** command | Settings |
| Hub search: a section or a setting's name | That section, control focused |
| Hub › Keys & shortcuts: a tool's row | Tools, that tool's row focused |
| Memory warning › "Memory settings" | Game, Extended memory focused |
| Launcher Home › **Customize** | Home screen |
| **Check for Updates…** in a game window | Updates |

The target travels over IPC, not in the URL: the trusted Settings URL has no
query and no fragment. The window pulls the first target once on load and
receives later targets as events.

## Trust

The Settings window has its own role (`settings`) and its own preload
(`settingsNative`). Settings writes, tools, texture packs and game files accept
only that role. Snapshot state, Home preferences, external links and update
installation accept the launcher and Settings. The launcher keeps accounts and
profiles; Settings cannot reach them. `src/main/ipc-sender.ts` holds the rule,
and `tests/unit/renderer-trust.test.ts` lists the refused senders.

## Acceptance

- In a running game: ⌘R, type `memory`, ↵ opens Settings at Game with Extended memory focused. 3 steps.
- Turning Extended memory on shows "Restart required. This session still uses 2 GB."
- The memory warning's "Memory settings" lands on the same control.
- Every catalogue entry has exactly one control with the same label (launcher test).
- Settings opened from a full-screen game appears above it. (Live check by a person.)
- Check for Updates… opens the Updates section.

## Calculator estimates

Hub › Conversion rates saves the selected source and optional currency estimates
through the existing settings file. Rates apply in every game window. They do
not change the game or replace observed prices. Automatic keeps the saved
estimates for a later switch to Your rates.

Older builds ignore `calculatorRates` and can discard that field on their next
settings write. Release planning must account for this existing reader behavior
before a public Beta writes the new field. Developer Builds can verify the editor
and persistence without publishing a new release.
