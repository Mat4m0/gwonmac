# Guild Wars Reforged user guide

Guild Wars Reforged runs Guild Wars on supported macOS, Windows, and Linux
systems. It is an independent, unofficial community application. ArenaNet and
NCSOFT do not make, sponsor, endorse, or support it.

## Install and start

Use the package published for your operating system. The macOS package uses
Developer ID signing and Apple notarization. Windows uses the signed installer.
Linux uses the signed Flatpak repository.

1. Download the package for your system from a `Mat4m0/gwonmac` GitHub release.
2. [Verify the assets](release-verification.md#verify-downloaded-assets) if you
   want to check their origin.
3. Install it through the normal system installer or Flatpak repository.
4. Start it normally. Do not bypass the operating system's signature checks.

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

Closing the launcher hides it while games run. Closing one game affects only
that account. Closing the last game leaves the launcher available. Clicking the
Dock icon restores the most recent launcher or game window that you used. If
that window has closed, the next most recent game window is restored. On
Windows and Linux, activating the application from the taskbar or desktop does
the same job.

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

## Optional Tools

Tools are global. The same master switch, Tool switches, and shortcuts apply to
every account. The launcher exposes only:

- **Build Management** — save and organize builds and teams;
- **Quick Travel** — search reviewed Guild Wars destinations;
- **Xunlai Storage** — open storage in supported PvE outposts.

Open **Settings → Tools** to configure them. Each Tool row contains its switch,
shortcut, **Change shortcut**, and **Restore default**. There is no separate
Shortcuts page.

Shortcuts use the platform modifier, such as Command-T on macOS or Control-T on
Windows and Linux. Normal editing and application shortcuts remain reserved.
If a new shortcut conflicts with another Tool, the launcher asks before
replacing it.

Enabling the Tools runtime can require a restart. With no games open, the
launcher offers to restart. With games open, it saves the change for the next
normal restart and does not close them. Individual Tool switches and shortcuts
apply to all running profiles when the Tools runtime is already loaded.

## Maps and cartography

Open **Settings → Maps** for two independent features. **Grid** marks the game's
exploration cells and highlights the cell containing your character.
**Walkable terrain** shades terrain outside certified pathing geometry while it
keeps the native map artwork visible.

Choose Cartographer, Synthwave, or Monochrome. Custom styles can change colors,
line widths, patterns, unseen-cell markers, and inspection ranges. Hold Shift
over a Mission Map cell to inspect its normal 3×3 reveal area, or Option-Shift
for the Bird's Eye 7×7 area. One style applies to the Compass and Mission Map.
Both layers hide when the current map projection or data cannot be certified.

## Saved login

Guild Wars owns sign-in inside each game window. The launcher does not ask for
credentials. Saved credentials use Apple Data Protection Keychain on macOS,
Windows Credential Manager on Windows, and the Secret portal with encrypted
per-profile files inside the Flatpak on Linux. They are isolated by profile.
If the system secret service is unavailable, saved login is unavailable rather
than written as plaintext. A local source build has a temporary identity and
does not share saved-login access with the published application.

## Display, input, and memory

Mouse, trackpad, keyboard, and controller input go directly to Guild Wars. The
application does not broadcast input between profiles. Main letters, the number
row, and ANSI punctuation keep the same physical game binding when the input
source changes. Text fields still use the active input source.

Open **Settings → Advanced** to enable extended memory or local diagnostics and
to reveal logs. The in-game memory warning remains available during long
sessions and can reload only the affected profile.

## Updates

Automatic application updates are enabled by default. Stable is recommended;
Beta is optional. An available application update never blocks Play in this
version. Install it from the launcher when you are finished playing.

After an official Guild Wars update, the main process downloads, verifies, and
tests one client generation for every profile. The first opened game acts as a
canary. Later selected profiles open only after that first game proves the new
client is healthy. A failure in one profile does not close healthy profiles.

## Known issues and feedback

Use **Known issues** for maintained workarounds when a feed becomes available.
Until then, the launcher links to GitHub and Discord. Some issues belong to the
official Guild Wars client and must be reported to ArenaNet; the launcher should
say that without claiming it can fix them.

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
