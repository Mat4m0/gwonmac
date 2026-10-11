# Settings

This document owns how settings behave: where each setting lives, what it is
called, when a change takes effect, and how a player reaches a setting from the
launcher or from a game window.

## The decision

gwonmac has one Settings page. The launcher draws it. Inside a game window, the
same page opens as a Hub page, with the same labels and controls.

The Hub page shows four in-game sections: **Tools**, **Maps**, **Appearance**
and **Game**. You change them there, and the game updates at once. Five other
sections need the launcher: **Texture packs**, **Game files**, **Updates**,
**Home screen** and **Advanced**. In the Hub they show ↗. Choosing one opens the
launcher at that section.

Hub search (⌘R) finds sections and single settings by their words. Choosing a
result opens the Hub Settings page at that control. The control takes focus and
is briefly highlighted. Hub search does not change a setting in place.

## Rules

1. **One setting, one name, one control.** `src/shared/settings-catalogue.ts`
   lists the sections and the settings that search can open, with their stable
   IDs, labels and keywords. Each control carries `data-setting="<id>"`.
2. **Every setting says when it applies**, in the same words everywhere:
   no note when it applies now; "Applies when you next open or reload a game
   window."; "Applies after you restart GWonMac." A saved choice that is not
   active yet shows its state next to the control ("Restart required. This
   session still uses 2 GB.").
3. **Changes save right away.** A change applies in every open game window. The
   status line names the saved setting and when it applies. A failed save keeps
   the change on screen and offers **Retry** and **Revert**.
4. **Settings are found by their words.** Launcher Settings search (⌘F) and Hub
   search both use the catalogue.
5. **A game window cannot reach launcher-only actions.** Updates, game files,
   texture packs, reset and logs run only from the launcher. The Hub page never
   offers them.
6. **Tools on or off needs a restart of the launcher.** The Tools section says
   "Restart the launcher". Only the launcher offers the restart button.
   Restarting only a game window does not load or unload Tools.

## Build and trust

- `apps/launcher/src/components/SettingsView.vue` draws the page for both the
  launcher and the Hub.
- The launcher builds the page a second time as a module for the game window:
  `vite build --mode hub` writes `build/renderer/settings/settings-app.js` and
  `.css` from `apps/launcher/src/hub-entry.ts`. `src/renderer/hub-settings-page.ts`
  loads it when Settings first opens. It is not part of the optional Tools
  bundle: Settings must work in a Core launch, because that is where Tools are
  turned on.
- A game window gets a bounded `hubSettings` API: `get`, `update`, `capture` and
  `cancelCapture`. The main process checks each change with
  `parseHubSettingsChange` against `HUB_SETTINGS_FIELDS` in
  `src/shared/hub-settings.ts`. It refuses unknown or launcher-only controls, a
  value of the wrong kind, and extra fields. The Hub sections come from
  `HUB_SECTIONS` in `src/shared/settings-catalogue.ts`.

## The tree

Settings has two groups. The launcher shows both. The Hub shows only the
in-game group.

| Group | Section | In the Hub |
|---|---|---|
| In game | Tools | Yes |
| In game | Maps | Yes |
| In game | Appearance | Yes |
| In game | Game | Yes |
| In game | Texture packs, Game files | ↗ (launcher) |
| GWonMac | Updates, Home screen, Advanced | ↗ (launcher) |

## Entry points

| From | Opens |
|---|---|
| **Settings…** in a focused game window | Hub Settings page |
| **Settings…** with no game window focused | Launcher Settings |
| **Check for Updates…** (macOS app menu) | Launcher, Updates |
| Hub search: a setting | Hub Settings page, that control focused and highlighted |
| Hub search: a ↗ section | Launcher Settings, that section |
| Memory warning › "Memory settings" | Hub Settings page, Game, Extended memory focused |

## Acceptance

- In a running game: ⌘R, type `memory`, ↵. The Hub Settings page opens at Game with Extended memory focused. It says the change applies after you restart GWonMac.
- The memory warning's "Memory settings" opens the same control.
- Every catalogue entry has exactly one control with the same label.
- **Check for Updates…** opens the launcher at Updates.

## Calculator estimates

Hub › Conversion rates saves the selected source and optional currency estimates
through the existing settings file. Rates apply in every game window. They do
not change the game or replace observed prices. Automatic keeps the saved
estimates for a later switch to Your rates.

Older builds ignore `calculatorRates` and can discard that field on their next
settings write. Release planning must account for this existing reader behavior
before a public Beta writes the new field. Developer Builds can verify the editor
and persistence without publishing a new release.
