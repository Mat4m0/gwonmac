# `gwonmac` user guide

`gwonmac` is Guild Wars Reforged for macOS on Apple Silicon.

It is an independent, unofficial application. ArenaNet and NCSOFT do not make,
sponsor, endorse, or support it. The app downloads the official client from
ArenaNet. It does not include ArenaNet game files.

## Install and start

Use a published DMG for normal play. Published releases use Developer ID
signing and Apple notarization.

1. Download the DMG from a `Mat4m0/gwonmac` GitHub release.
2. [Verify the assets](release-verification.md#verify-downloaded-assets) if you
   want to check their origin.
3. Open the DMG.
4. Drag **Guild Wars Reforged** to Applications.
5. Start it normally.

Do not disable Gatekeeper.

The first start needs an internet connection. The app checks ArenaNet, verifies
the client files, asks how to store game data, and starts Guild Wars. Later
starts use verified cached data when possible. Login and online play still need
ArenaNet.

## Single and Multiple Accounts

Single Account mode is the default. It starts Guild Wars directly and keeps
the login, templates, builds, settings, and window state that you already use.

Open **Settings → Accounts**, name the first account, choose its Shared or
Private libraries, and select **Enable and Restart…** to create a separate
Multiple Accounts workspace. Every later Multiple Accounts start opens the
Account Picker with nothing preselected. Select one or more accounts and choose
**Open**. If an account is already running, the action changes to **Show**.

Each account signs in separately and keeps separate Guild Wars preferences,
screenshots, chat logs, saved login, and window position. Profiles can use the
shared Multiple Accounts template and build libraries or private libraries.

Setup can copy templates, builds, and teams from Single Account mode. This is a
one-time copy. The originals remain in Single Account mode. Later changes do
not synchronize between the two modes.

Use Command-, in the Account Picker to open Settings, then choose **Return to
Single Account…** to change the next launch. Your accounts and saved logins stay
available if you restore Multiple Accounts from **Settings → Accounts** later. The modes
share verified game downloads, so creating an account does not download another
complete copy of Guild Wars.

Use **New Account…** in the Account Picker to add accounts. The row's More menu
contains **Edit Account…** and **Archive Account**; close its game window before
changing sharing. Archive keeps all account data and saved login. Hub Settings
can restore it or permanently delete it after a native confirmation.

Every account window is independently controlled. The app does not broadcast
keyboard, mouse, or controller input between windows.

A local source build has a temporary identity. It does not share saved-login
access with the published Release app.

## Game data

**Quick Start** is the recommended default. It downloads areas when the game
needs them and keeps verified data for later.

**Download Full Game** downloads all available chunks. It needs more time and
disk space. It does not make login or online play available offline.

During a full download, you can pause, resume, return to Quick Start, or choose
**Play While Downloading**. Verified chunks remain when you switch modes. The
Dock icon shows active progress.

To change the next launch, open **Guild Wars Reforged → Settings… → Game Data**.
This does not interrupt the current game.

Use **Clear Game Data…** only to remove downloaded area data. The app confirms
the action and restarts. It keeps the small official client files.

## Display and input

Open **Settings → Display** to select render scale, interface style, and
panel opacity.

**Retina — 2×** is the image-quality default. Use 1.5× or 1× to reduce GPU work
and memory. Settings shows the current backing resolution. The official web
client can offer only **None** for antialiasing, so use render scale for
supersampling.

Mouse and trackpad actions go directly to Guild Wars. There is no input mode.
Hold the right button to steer the camera. A macOS double-click reaches Guild
Wars with the system double-click timing.

Main letters, the number row, and ANSI punctuation keep the same physical game
binding when the macOS input source changes. Text fields still use the active
input source. An old custom binding can need one manual rebind.

The official client includes browser gamepad support. This project does not have
a dedicated controller release test.

## Core and optional Tools

Open **Settings → Tools**.

Required compatibility restores persistent game files and template saving when
its exact proof passes. Certified Core adds the Guild Wars cursor and native
double-click. These features stay on. The cursor has no player switch. The app
does not ship or download cursor artwork.

**Enable optional Tools Beta** is off by default. Its first enable asks for one
restart because the app selects the Tools-capable module before Guild Wars
starts.

After that restart, these choices update immediately:

- **Team management** (Beta) stores builds and teams. It can observe and capture
  a PvE party. It can apply a selected team after your explicit action in a PvE
  outpost.
- **Target distance and range** (Test) shows the selected target's distance and
  range band.

Optional Tools stop in PvP, guild halls, transitions, and unknown regions. Team
Apply checks policy before each step and stops when the state changes.

The saved library still works when live client integration is unavailable. You
can edit, import, and export. Live party data and Apply remain unavailable.

## Builds, teams, and templates

Tools stores authored builds and complete teams. **Export team** creates a
`gwonmac-team:` exchange code. This is not a Guild Wars or GWToolbox++ code.

**Export build** shows the standard Guild Wars template code. It can publish the
build to the game's Skills directory. Choose **Refresh List** in Guild Wars
after publication.

Open **Settings → Templates** after Guild Wars finishes starting and you sign
in. If you opened it earlier, reopen Templates after signing in so it can
connect to the game's storage. Use it to import a Templates folder, `.txt`
files, or clipboard codes. The app previews changes and writes nothing until
you confirm.

Use **Export…** to create a Windows-compatible `Guild Wars Build Templates`
folder. A later export uses a new folder name instead of overwriting the first.

Guild Wars does not list imported templates inside subfolders. Imports go to
the top level. A source path becomes part of the name. For example,
`Warrior\Shockaxe` becomes `Warrior - Shockaxe`.

If an older app left a template in a subfolder, use **Move to Top Level**. The
action does not overwrite a different template.

## Saved login

Guild Wars owns its **Remember Password** checkbox.

The published Release app stores the ArenaNet account name and password as one
device-only Data Protection Keychain item. It does not sync through iCloud. A
local source build keeps the value only until quit.

Use **Sign in with Steam** only when Steam is already linked to a Guild Wars
account. This flow cannot create the link.

Steam opens in a modal sheet without an address bar. The app limits top-level
navigation, blocks popups and downloads, uses no Node or preload access, and
destroys the separate browser session when sign-in ends. Close an empty or
unexpected sheet. Do not enter a password into an unexpected page.

The Release app stores the Steam token and expiry in a separate device-only
Keychain item. An expired or unavailable item returns you to login. Signing out
removes the local token but does not unlink the accounts.

The game proxy does not send or accept browser cookies.

## Copy and paste

Press **Command-V** in a Guild Wars text field to paste. **Command-C** copies
the selected text in the field, or the full field when nothing is selected.
Password fields are never copied.

The official web client cannot copy text that it only displays, such as chat
history or item names.

## Extended memory

**Advanced → Experimental 4 GB memory limit** requests the certified 4 GB module
for the next start. Restart `gwonmac` after changing it.

If the current ArenaNet build has no 4 GB certificate, the app uses the ordinary
2 GB module. The larger limit can delay a memory-related crash. It cannot stop
memory that continues to grow.

When the app warns about memory, choose **Reload Guild Wars**. Guild Wars
normally reconnects. Reload in an outpost when you want the lowest gameplay
risk.

## Updates

ArenaNet game updates and `gwonmac` application updates are independent.

At startup, the app verifies the official ArenaNet client. A changed client is a
candidate. The app keeps one verified previous generation until the candidate
renders and connects. It restores that generation when the candidate fails
early.

**Automatically check for and download app updates** is on by default. The app
checks at launch and can check again about every six hours. It does not run an
automatic check during a game connection.

Turn the setting off to stop automatic GitHub requests. Use **Check for
Updates** for a manual check.

A launch update installs before play. Choose **Play Without Updating** to start
while it downloads. An update found during play installs on **Restart to
Update** or the next normal restart. The app asks before it disconnects a game.

**Stable** is the default. **Beta** also receives beta and release-candidate
versions, never alpha. Both tracks use the same app identity, profile, saved
login, and updater. Changing the track does not start a request.

The updater never installs an older Stable automatically. To return from a
newer candidate, install the signed Stable DMG from GitHub Releases. Preview is
a separate tester app and is not the Beta track.

## Unknown ArenaNet build

ArenaNet can publish a client before the current `gwonmac` release knows its
Core and Tools layout.

The app runs an isolated local file check. It keeps only the features that it
can prove. The launcher explains the result and keeps **Play Guild Wars** as the
primary action.

The official client remains playable. The saved build and team library remains
safe. Live Target Distance, party observation, Apply, file repair, native
double-click, or the Guild Wars cursor can be unavailable according to the
failed proof. The normal macOS pointer remains available.

Reinstalling or clearing game data does not add a certificate. Use **Check for
Updates** to look for a newer `gwonmac` release.

## Recovery

- An ArenaNet connection failure restores the previous verified client when
  possible.
- A paused or interrupted full download keeps verified chunks.
- Insufficient disk space stops the download before more data is fetched.
- A corrupt chunk is removed and fetched again.
- The first unexpected renderer crash starts automatic recovery.

If Guild Wars stops, the launcher shows **Retry** and **Report a Bug…**. A
repeated crash makes reporting the primary action.

Use **Reset Saved Files…** only when the Guild Wars filesystem cannot open. It
removes game preferences, templates, screenshots, and chat logs. It keeps game
data, `gwonmac` settings, and saved login.

Use **Reset GWonMac settings…** for launcher defaults. Use **View → Reset Window
Size and Position** for an off-screen window. These actions do not clear saved
login.

## Bugs and feature requests

Choose **Help → Report a Bug…** or **Help → Request a Feature…**. Each action
opens its GitHub issue form immediately. GitHub issues are public.

- Diagnostics are optional. To include them with a bug, use
  **Help → Diagnostics → Export Recent Diagnostics…** and attach the ZIP.
- Use **Record Performance Problem** for stutter. Reproduce it, press
  **Command-Shift-M**, stop the capture, and export it when prompted.
- Use **Show Input Trace** for click problems. It records bounded counts and
  distances, not coordinates. Closing it discards the trace.

The diagnostics ZIP excludes saved login, account request bodies, game traffic,
chat, and crash dumps. Other text is scanned for known secret and path patterns.
Review the readable ZIP before attaching it to a bug issue.

See [Diagnostics and performance](diagnostics.md) for technical details.

## Local data

Settings, verified clients, chunks, and diagnostics are usually under:

```text
~/Library/Application Support/Guild Wars
```

Use **Settings → Game Data → Show in Finder** to open the game-data directory.
Guild Wars preferences and files use the app-owned `gw://app` browser origin.
ArenaNet and Steam login values are separate Keychain items.
