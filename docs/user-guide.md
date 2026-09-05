# Guild Wars Reforged user guide

Guild Wars Reforged runs Guild Wars on Apple Silicon Macs. It is an independent,
unofficial community application. ArenaNet and NCSOFT do not make, sponsor,
endorse, or support it.

## Install and start

Use a published DMG for normal play. Published releases use Developer ID signing
and Apple notarization.

1. Download the DMG from a `Mat4m0/gwonmac` GitHub release.
2. [Verify the assets](release-verification.md#verify-downloaded-assets) if you
   want to check their origin.
3. Open the DMG and drag **Guild Wars Reforged** to Applications.
4. Start it normally. Do not disable Gatekeeper.

The launcher prepares and verifies the official Guild Wars client. It does not
ship ArenaNet game files. A fresh installation has one profile named **Main
account**. The first start explains the application and asks whether to enable
optional Tools. Tools are off unless you enable them.

An update from an older version does not show first-run setup. The launcher
keeps the existing account data and shows a short confirmation instead.

## Account profiles

There is no Single or Multiple Accounts mode. Every game window belongs to one
profile. **Main account** always exists. Choose **Add account** to add another
game window without changing a mode or restarting the application.

The account picker remembers the selected set. Choose **Play** for one account
or **Open N accounts** for several. An account that is already open has a
**Show** action and is never opened twice.

Each added profile has separate Guild Wars browser storage, saved login, Steam
session, private builds and templates, screenshots, chat logs, and window
position. Profiles share the verified game client, downloads, application
updates, general settings, and Tools.

When updating from the old Single Account experience, **Main account** continues
to use the existing saved login, builds, templates, game files, and window
position in place. The cutover does not copy, move, or delete that data.

The launcher hides after every selected account opens successfully. It stays
visible if an account needs attention. Use **Window → Show Launcher** to open
another account. You can also right-click the Dock icon and choose **Show
Launcher**. **Settings…** opens launcher Settings directly. Closing one game
affects only that account. Closing the last game shows the launcher. Clicking
the Dock icon restores the most recent launcher or game window that you used.
If that window has closed, the next most recent game window is restored.

## Home content

Home can show News and Dailies. Open **Settings → Content** to enable either
section and choose which one appears first. If only one is enabled, Home removes
the tab switcher. If both are disabled, the artwork uses the full Home area.

News, Dailies, maintained Known Issues, and direct feedback submission are not
connected in the first production cutover. The launcher says this plainly and
links to the project website, GitHub, Discord, or Guild Wars Wiki. Development
fixtures are sample data and are never presented as current production content.

## Game files

The launcher owns game preparation, downloads, repair, and reset. There is no
second update or Play screen inside a game window.

Guild Wars can start as soon as a healthy client is ready. The remaining game
data downloads automatically in the background and does not block Play. Open
**Settings → Game files** to see the current state or pause and resume the
background download.

Use **Repair game files** to verify the client and reacquire missing or invalid
artifacts. Use **Advanced → Reset and redownload game files** only for a full
client/cache reset. Reset keeps profiles, saved logins, application settings,
Tools and shortcuts, builds, templates, screenshots, chat logs, and profile
window positions.

## Texture packs

Open **Settings → Game → Texture packs** to import a classic TexMod `.tpf` UI
design. Import keeps the pack inactive. Select it after import, then open a new
game window to use it. The selection is global across account profiles; game
windows that are already open keep the appearance they started with.

Select **Official textures** to disable packs for future game windows. Removing
a pack deletes gwonmac's managed copy and selects Official textures when that
pack was active. Resetting settings also selects Official textures, but keeps
installed packs. See [Texture packs](texture-packs.md) for supported formats,
safety limits, storage, and troubleshooting.

## Optional Tools

Tools are global. The same master switch, Tool switches, and shortcuts apply to
every account. The launcher exposes:

- **Build Library** — save and organize builds and teams;
- **Quick Travel** — search reviewed destinations, online friends, and your Guild Hall;
- **Xunlai Storage** — open storage in supported PvE outposts;
- **Quick Item Move** — Control-click whole stacks between inventory and an
  open Xunlai chest or player trade. Hold Shift too to choose the quantity;
- **Trade Chat** — browse the trade feed;
- **Maps** — enable exploration and walkability guidance;
- **Target Distance** — show distance to the selected target in PvE;
- **Skill Key Labels** — label the eight skill slots with your controls;
- **Skill Cooldowns** — show numeric recharge timers with a preset or custom color;
- **Effect Timers** — show exact remaining time on your own native Effects icons in PvE.

Open **Settings → Tools** to configure them. Features with shortcuts have
an editable shortcut value. Select **Change** to capture a shortcut. Open
the three-dot shortcut menu for **Clear** and **Restore default**.
Skill labels only change the displayed labels, not Guild Wars key bindings.
Character Switch has its own switch, shortcut, and display settings here.
It is a Core feature and does not require **Enable Tools**.
The in-game Character Switch settings also select a horizontal or vertical
layout. Horizontal is the default and follows the character-selection order.
The search bar is shown by default and can be hidden there. The layout and search
choices last for the current app session.

Shortcuts use macOS Command combinations such as Command-T. Normal editing and
application shortcuts such as Command-C, Command-V, Command-Q, and Command-W
remain reserved. If a new or restored shortcut conflicts with any feature,
the launcher asks before replacing it. This includes disabled features.

Enabling Tools for the first time requires restarting the entire app, including
the launcher. Turning Tools off removes its features from every game window
immediately. Restart the launcher to finish unloading the Tools runtime.
Re-enabling Tools before that restart restores its features immediately.
Reopening only a game window does not load or unload the runtime. Close all
game windows, then select **Restart launcher** in **Settings → Tools**. You can
also quit the app with Command-Q and reopen it. Individual Tool switches and
shortcuts apply to all running profiles when the Tools runtime is already loaded.

## Maps and cartography

**Settings → Maps** is always available. Enable **Tools** and **Maps** in
**Settings → Tools** to show the overlays. The Maps page explains when Tools
are off or an application restart is needed. Disabling Maps keeps your preferences.
The **Exploration grid** and **Walkable terrain** shortcuts are unassigned by
default. Assign them in Maps settings to toggle each layer independently.
**Grid** marks the game's
exploration cells and highlights the cell containing your character.
**Walkable terrain** shades areas you cannot walk on while it
keeps the native map artwork visible.
**Compass ranges** shows thin rings for Shout, Cast, Spirit, and Ext. Spirit range.
Click its circular control beside the Compass to show or hide all rings. Hover
the control to choose Color or Monochrome, select individual rings, or adjust
their opacity. The center icon stays white; the outer border shows whether
ranges are on. Hover a visible ring to see its short name. Settings → Maps
provides the same saved controls. The ranges work without opening the Mission Map.

Choose Cartographer, Synthwave, or Monochrome. Custom styles can change colors,
line widths, patterns, unseen-cell markers, and inspection ranges. A normal
unseen marker means the loaded map has ground within reveal range. Grey hatching
means the cell may need another map or special route. Guidance never changes
the game's explored state. Hold Shift over a Mission Map cell to inspect its
normal 3×3 reveal area, or Option-Shift for the Bird's Eye 7×7 area. One style
applies to the Compass and Mission Map. Pre-Searing supports both layers
alongside Tyria, Cantha, and Elona. In dungeons, underground maps, the Battle
Isles, and the Realm of Torment, the Grid and global progress hide while local
Walkable terrain remains available. The Cartography control stays beside the
Compass and explains the limitation when opened. Your settings remain intact
and all layers return automatically after travel to a fully supported area.

The style preview shows representative terrain, colors, borders, and grid lines.
It does not reproduce the current game map. Common appearance controls are
always visible. **Advanced grid lines** contains the individual line settings.
**Use Cartographer defaults** selects that built-in without deleting custom
styles. Deleting a custom style requires confirmation.

## Switch Character

Press **Command-R** to open **Switch Character** from a playable outpost.
The search bar is shown for every account size. Initial focus remains on the
current character. Press Left or Up for the previous character. Press Right or
Down for the next character. Start typing a character name or primary profession
to move focus to search. Secondary professions are not searched. The number keys
1–9 and 0 switch to the first ten characters. Press **Command-Shift-R** to reload
Guild Wars.

Character names and search text are not saved.

Start the switch while Guild Wars is focused. Once accepted, it continues if
you switch to another app or minimize the game. Guild Wars does not take focus
back. Closing or reloading that game window stops the switch.

## Saved login

Guild Wars owns sign-in inside each game window. The launcher does not ask for
credentials. Saved credentials use the macOS Data Protection Keychain and are
isolated by profile. A local source build has a temporary identity and does not
share saved-login access with the published application.

## Display, input, and memory

Mouse, trackpad, keyboard, and controller input go directly to Guild Wars. The
application does not broadcast input between profiles. Main letters, the number
row, and ANSI punctuation keep the same physical game binding when the macOS
input source changes. Text fields still use the active input source.

Open **Settings → Game** to change render quality, extended memory, or automatic
character return after reload. Render quality updates open windows immediately.
Extended memory takes effect after an application restart. Controller symbols
apply when you next open or reload a game window.

The **In-game panels** section restores control of panel style, font, opacity,
and custom colors. Each color accepts a picker or six-digit hex value. These
changes apply to gwonmac panels in every open game window. Custom themes can be
shared as text; switching to a built-in style keeps the saved custom palette.
An illustrative panel preview shows the selected palette. Low-contrast text
colors produce an explanation of the game's readability correction.

Settings save automatically. If a save fails, the settings feedback identifies
the unsaved change. Choose **Retry save** to repeat it or **Revert change** to
restore the confirmed values. Further edits wait until that change is resolved.
Switching sections starts at the new heading. Reopening Settings returns to the
last section.

Open **Settings → Advanced** to show the diagnostics overlay or reveal logs.
The in-game memory warning remains available during long sessions and can reload
only the affected profile.
**Reset all app settings** also resets game preferences, Tools, shortcuts,
custom map styles, and panel colors. The confirmation lists affected and kept
data. It is separate from resetting downloaded game files.

## Updates

Automatic application updates are enabled by default. Stable is recommended;
Beta is optional. An available application update never blocks Play in this
version. Install it from the launcher when you are finished playing.

After an official Guild Wars update, the main process downloads, verifies, and
tests one client generation for every profile. The first opened game acts as a
canary. Later selected profiles open only after that first game proves the new
client is healthy. A failure in one profile does not close healthy profiles.

## Known issues and feedback

Use **Known issues** to see problems that ship with the current launcher
version. Each open issue describes the symptom and its current workaround. The
page also explains how to check the same action in ArenaNet's official client.
Report an issue to ArenaNet when it also happens there. Report a macOS-only
issue to gwonmac on GitHub or Discord.

Use **Feedback** to prepare a short problem report or idea. Direct submission
and file upload are intentionally not connected in this cutover. Continue on
GitHub or Discord; the launcher never claims an unsubmitted form succeeded.

## Recovery

If game preparation fails, the launcher shows one global repair state rather
than marking every account failed. Existing game windows remain separate. If a
single profile fails to start, retry that profile from Accounts.

If launcher presentation preferences cannot be read, the application keeps a
diagnostic copy, restores safe defaults, and skips first-run setup rather than
guessing that an existing installation is new. The launcher reports that its
preferences were reset; profiles, saved login, game files, builds, and
templates are not changed.

Use **Open logs** before reporting a reproducible launcher or game-start issue.
Do not include passwords, Steam tokens, or other credentials in a report.

## Local data

Settings, launcher presentation preferences, profile metadata, builds,
templates, diagnostics, and downloaded client data remain local unless you
explicitly share a report. The launcher renderer cannot read credentials,
sockets, snapshots, templates, or profile browser storage.
