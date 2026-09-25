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
optional Tools. Tools are off unless you enable them. After setup, the launcher
opens directly without a guided tour.

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

The launcher remembers whether you last chose **Home** or **Accounts**, along
with its window size, position, and fullscreen or maximized state. Visiting
Settings does not change your starting page.

On **Accounts**, check accounts to open together with the large launch button.
Use **Play** beside any account to open only that account. This keeps your
selected group unchanged. The Home account picker offers the same individual
actions. **Show** brings an existing game forward; **Try again** retries a
failed account; **Cancel** removes a waiting launch. **Edit** lets you change
an account's name, icon, and color. The native **Accounts** menu also opens or
shows named accounts while you are playing.

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

- **Call target** — opt in to a shortcut for calling a target without attacking;
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

Quick Travel keeps a reviewed current outpost visible and disabled in its small
catalogue, even when a character was ferried there without unlocking map travel.

Open **Settings → Tools** to configure them. Features with shortcuts have
an editable shortcut value. Select **Change** to capture a shortcut. Open
the three-dot shortcut menu for **Clear** and **Restore default**.
Skill labels only change the displayed labels, not Guild Wars key bindings.
Character Switch has its own switch, shortcut, and display settings here.
It is a Core feature and does not require **Enable Tools**.
Inside Hub, Character Switch uses compact horizontal cards in character-selection
order. Its settings control search, profession, level and known-location display.
The search bar is shown by default and can be hidden for the current app session.

Build Library defaults to **Command-B**. **Control-Shift-Space** remains a
Guild Wars control for calling the selected target without attacking.

**Call target** is off by default. Enable it in **Settings → Tools** with
**Enable Tools** on. Its shortcut defaults to **Command-G** and can be changed
or cleared. It works while the game has keyboard focus. It sends Control-Shift-Space, so it requires the default Guild Wars
controls for targeting, suppressing an action, and attacking/interacting. It does
not run while typing or on login and character-selection screens. Existing
custom Command-G shortcuts keep their binding; choose another Call target
shortcut if Command-G was already assigned.

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

## Hub command palette

Press **Command-R** to search people, outposts, tools, and commands. Type a name, use Up and Down,
and press Enter for the action shown in the footer. The **Actions** button opens secondary actions. **Command-K** opens Trade. Escape goes back or
closes the palette. The game keeps running while Hub is open.

With Travel enabled, search an outpost or your custom Travel phrase. Travel,
favourites, recent places, and Guild Hall stay in the same window. Command-T
and `/tp` also open Travel inside Hub.

Search a friend's alias or character name and press Enter to choose an action.
With Whispers enabled, people search also finds your conversations, recent
people, and names seen in chat during this game session. `whisper Character Name`
always offers that exact name, spelled as you typed it, after any similar known
people.
**Travel to outpost** uses Any district; it does not join the friend's exact
instance. Offline or stale locations cannot start a trip. **Whisper** opens a
compact conversation. You can also type `whisper Character Name` to start one.
Press Enter or Send to submit a message; merely opening a result sends nothing.

A name copied from Discord or a web page can contain a trailing space or an
invisible character. Paste into a Guild Wars text field removes them, so the
name works like a typed name. The cleaned text also replaces the clipboard.
Password and email fields receive the clipboard unchanged.

Whispers uses one conversation interface for person search, the Whispers shortcut,
and the unread launcher. Messages, drafts, history, mute and unread state stay in
that view. Escape or Left at the start of a draft returns to people; closing Hub
keeps drafts for the game session. Character changes, leaving the game, or turning
off Whispers clear the session.

In an outpost, choose **Invite to party** on a person, or type
`invite Character Name`, to invite that character.
For a friend in another outpost, **Travel and invite** travels there (Any
district) and invites them once you arrive. If you land in a different district,
Guild Wars cannot find them; Hub then shows the game's answer in chat. Both
actions need Whispers enabled.

Build Library, Trade Chat, Characters, and Whispers open inside Hub. Detach a tool
when you want to keep it beside the game. Disabled tools are absent from search.
Storage opens quietly and does not show a failure popup.

Use `team gom afk` to review and apply that saved team, or `build smiter` to load
an exact saved build on your character. Prefixes open a review first; duplicate
names require selection. Builds can also target an existing hero without replacing
your team. `10 ecto in p` shows labelled NPC trader buy and sell estimates with
observation times. Fixed gold/platinum conversions work offline. Amounts accept attached or spaced
units: `1p`, `1 p`, `100k`, `.5e`, `2a`, and `10zkeys`. Use `in` or `to`.
Stacks, mixed sums and multiplication work too: `1 stack ecto in p`,
`100k + 10e in a`, `250 * 1.5e in p`, or `14a/stk in e each`.

Armbrace and Zaishen key conversions automatically use recent Kamadan advertisements
when enough consistent evidence exists. Results start with `~` and explain that
they are inferred from median advertised prices. Choose seller asking prices or
buyer offers; sample counts and observation dates remain visible. Missing evidence
shows **Not enough recent prices** quietly inside Hub.

For an optional override, search `rates`, choose **Your rates**, and enter your
values. These rates stay in this game window and are explicitly labelled.
NPC results offer a Buy/Sell
selector. Material names and common aliases such as iron, feathers, dust and
obby shards use Trade's catalogue and its quoted batch quantities. Fractional
item results are labelled Equivalent value.

Use Actions to pin a result or give it an exact search phrase. Search **Hub
preferences** to reorder pins, remove saved actions, or reset aliases. Search `resign` for its existing
confirmation, or `reload` for the account's Quit or Reload dialog.

A custom shortcut already using Command-R takes priority. Use **View → Hub**
in that case. Existing custom shortcuts and cleared bindings are preserved.

## Switch Character

Press **Command-E** to open **Switch Character** from a playable outpost or
the Guild Wars character-selection screen. You can also search for a character
in Hub and select it to switch directly. On the character-selection screen,
every character can be selected, and the switch enters it without a logout.
The search bar is shown for every account size. Initial focus remains on the
current character. Press Left or Up for the previous character. Press Right or
Down for the next character. Start typing a character name or primary profession
to move focus to search. Secondary professions are not searched. The number keys
1–9 and 0 switch to the first ten characters. Use **View → Reload Guild Wars**
to reload.

Enable **Resign** in **Settings → Tools**. It is off by default and requires
Tools. Its shortcut is unassigned by default and can be assigned or cleared
in the same row. Turning off Resign or Tools disables it immediately.

Press the shortcut for **Resign** in PvE. Press Enter to confirm sending
`/resign`, or click **Resign** in the in-game dialog. Escape, **Cancel**, the close
button, and clicking outside cancel. Close text fields first.
The action stops if chat contains text or you interrupt it.

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

The memory warning can be moved by dragging its heading. Focus the heading and
use arrow keys to move it with the keyboard; Shift moves one pixel at a time.
The app remembers its position for later warnings and keeps it inside the window
when the window size changes.

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

### Title calculations in Hub

Search `titles` for editable examples. Try `sweet tooth from 7350`, then press
Enter to compare the items needed. `250 cupcakes in sweet points` converts items
to base points; `250 sweet points for 3e` compares an offer by price per point.
`zaishen rank 3 from 500` calculates the keys still needed. These are offline
calculations from your entered numbers, not observed character progress.
See [title calculators](hub-title-calculators.md) for supported items and syntax.


Inside Hub, recent Travel destinations form a horizontal carousel and Favorites
stay in a compact grid. With an empty query, arrows choose and Enter travels.
Escape returns to Hub. While editing a query, Left/Right preserve caret movement;
Right at the end can activate a search result. Tab reaches Travel settings.
Hub keeps the same size and position across results and tools; content scrolls inside.

Type `char Toefte` in Hub and press Enter on **Switch to Toefte**. Switching from
an explorable area retains the existing leave-area confirmation. The current
character is labelled and cannot be switched to again.

Type `acc second` to choose **Close Main and open Second** or **Open Second**.
The first opens the target successfully before saving and closing the current
game; the second keeps both accounts open. Already-open accounts are shown instead
of launched twice. Search **Switch Account** to browse all saved accounts. Sign-in
stays in the normal Guild Wars window.
