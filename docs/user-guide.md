# Guild Wars Reforged user guide

Guild Wars Reforged is an independent macOS host for ArenaNet’s official Guild
Wars Reforged client. It is not affiliated with ArenaNet or NCSOFT and does
not bundle game binaries.

## Install and start

Published builds are signed with Developer ID and notarized by Apple.

To build from source:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm package
```

Local source builds remain ad-hoc signed. Published releases use a `.dmg`:
open it, drag Guild Wars Reforged into Applications, then launch it normally.
Do not disable Gatekeeper globally.

Published releases include SHA-256 checksums, an SPDX SBOM, and GitHub
build/SBOM attestations. Follow [Verify a release](release-verification.md)
before opening a downloaded build.

Published tester snapshots are a separately signed and notarized Preview app.
Release and Preview share game data and settings, but each remembers its own
login. An ad-hoc pull-request artifact remembers login only until it quits.

The first release using the Data Protection Keychain asks an existing preview
installation to sign in once again. It removes only the two retired encrypted
secret files. Launcher settings, window state, downloaded game data,
diagnostics, screenshots, chat logs, and build templates remain where they
were.

The app then:

1. checks the official game client;
2. prepares the files needed to start;
3. starts Guild Wars;
4. downloads additional areas only when the game asks for them.

The first start needs an internet connection and takes longer than later
starts. The ArenaNet client updater and game-data cache always use at most eight
concurrent ArenaNet requests.

## Quick Start and the full game

Quick Start is the default. It keeps the loading screen tied to data the game
actually needs and caches downloaded areas for later.

On the first online start, the loading screen asks one question: **Quick
Start (Recommended)** or **Download Full Game**. A single pre-checked line
beneath it covers the automatic update check — see [Updates](#updates) — and
everything else keeps its default; the game tools live under
**Settings → Controls**. Guild Wars, its audio, networking, and graphics do
not start before this decision.

Quick Start starts Guild Wars and downloads areas when needed. Download Full
Game remains in the launcher, shows verified bytes, speed, and ETA, and does
not start Guild Wars automatically. When complete, choose **Play Guild Wars**.
While downloading you may pause, return to Quick Start, or explicitly choose
**Play While Downloading**; only that last action starts the game early and
lets the full download continue in the background.

The displayed transfer rate is a short moving average, so chunk-completion
bursts do not make the number jump between unrealistic highs and lows. While a
full download is active, progress also appears on the application’s Dock icon.
macOS may turn the display off, but the app prevents download suspension until
the task finishes or is paused.

To schedule the complete game from a running session:

1. Open **Guild Wars Reforged → Settings…**.
2. Select **Full Game** under **Game data mode**.

The current session is not interrupted. The next launch opens the resumable
full-download launcher when data is still missing. Choose **Start Downloading
Now** only when you want the same task to run in the background during the
current session. Switching back to Quick Start stops speculative full download
work but keeps every verified chunk.

The full download is optional. It requires enough free disk space for all
missing chunks plus a safety margin. It improves offline area availability,
but login and online play still require ArenaNet’s services.

Use **Clear Game Data…** only when you want to remove downloaded game data.
The app confirms the action and restarts. Small client files stay installed.

## Settings

Settings save immediately. **Game Data** owns the canonical Quick Start/Full
Game strategy, optional current-session download, and cache controls.
**Graphics quality** changes rendering resolution. **Retina — 2×** is the
visual-quality default; choose 1.5× or 1× when higher frame rate or lower GPU
memory use matters more than sharpness.
Settings shows the backing resolution for the current window beside every
scale. Compared with 1×, 1.5× renders 2.25 times as many pixels and 2× renders
four times as many pixels.
Right-drag always locks the pointer while steering the camera and restores it
on release. Mouse, trackpad, and Magic Mouse clicks and drags pass through to
Guild Wars unchanged. A macOS double-click reaches Guild Wars as a
double-click, using your own system double-click speed and distance settings;
there is no input mode to configure. On a client build this host has not
certified, double-click is unavailable until it is — the same builds that lose
build templates and the game's own cursor. Main-block letter, number-row, and punctuation bindings stay on the
same physical keys when the macOS input source changes, while chat and other
text fields continue to type the active layout. Extra ISO/JIS keys and the
numeric keypad retain the official web client's layout behavior. The in-game
Controls list shows the binding's stable reference character rather than
relabeling it after an input-source change. A custom binding first saved by an
older app build under a non-US input source may need to be rebound once; its
stored character does not retain the physical position needed for migration.
**Controls** keeps the game's own cursor on as a required Core feature; no
cursor artwork ships with this app. **GWonMac Tools Beta** is off by default.
The first enable asks for one restart so the launch can select the certified
Tools module. Once enabled, **Team Management** and **Target Distance (Test)**
switch on or off immediately. Team Management stores builds and full teams,
captures the player and their heroes, exchanges team codes, and applies a
chosen team after an explicit click in a PvE outpost. An explicit Normal or
Hard Mode and the player's own build are included.
Tools is the home for authored builds and teams. **Settings → Templates** keeps
the separate file-migration jobs: importing an old Windows folder, bulk
clipboard/file import, export, and rescuing templates stranded in subfolders.
Tools can publish one authored build into Guild Wars; neither surface treats
the other's files as a second library.
**Reload Game** reuses the module the launch already chose.
When the cursor is off — and whenever it cannot be read, or
your client build is not one this host has certified — you get the normal macOS
pointer. That is a cosmetic difference only: nothing about how the game plays
changes with the box either way. The rest of the window always keeps the macOS
pointer.
The local performance overlay stays under **Advanced**, outside the normal
setup path. Settings reopens to the pane most recently used during the current
session.

The official WebAssembly client currently requests a WebGL context without
multisampling, so its in-game antialiasing list may contain only **None**. The
host does not display options the client cannot provide; the 1.5× and 2×
render scales are the available supersampling choices.

The official client contains browser Gamepad support and community reports
confirm that controllers work. Physical controller behavior is not part of
the automated release gate because the project has no dedicated test
controller yet.

Settings are always available with **Command-,**, **Guild Wars Reforged → Settings…**,
or the **Settings** link on the loading screen. **Reset Launcher Settings…**
under **Advanced** restores launcher defaults, resets the window to a centered
1280×800 normal window, and makes the download choice appear on the next
launch. It does not remove downloaded game data, the remembered account name,
or the saved password.

The application remembers its last normal size and position plus maximized or
fullscreen mode. If a saved monitor is disconnected, the window is clamped and
centered on the primary display instead of opening off-screen. Choose **View →
Reset Window Size and Position** for an immediate window-only reset.

Guild Wars' **Remember Password** checkbox controls saved login. The password
and account name are kept together as one opaque, device-only item in Apple's
Data Protection Keychain by the provisioned Release or Preview app. Each app's
signed identity authorizes only its own item without the repeated legacy
Keychain access questions.
It does not sync through iCloud or move to another Mac. A source or ad-hoc
build keeps the value only in memory and forgets it when the process quits.
The game proxy does not accept or return cookies. Browser cookies are also
cleared at startup and quit.

## Signing in with Steam

If you bought Guild Wars on Steam you have no ArenaNet email or password, so the
login screen also offers **Sign in with Steam** beside the email and password
fields. Use whichever matches how you bought the game; adding Steam takes
nothing away from the email and password route.

Choosing Steam opens a separate Steam sign-in window that this application owns.
macOS presents it as a sheet attached to the game window, and a sheet draws no
title bar, so **there is no address bar or origin label for you to check** — you
cannot verify by eye that the page is Steam's.

What protects you instead is that the sheet's top-level page may only navigate
to Steam- and Valve-owned addresses; a top-level navigation anywhere else is
blocked outright. Like an ordinary browser, Steam may embed resources or frames
from other providers. They remain inside Chromium's sandbox with no Node,
preload, application permissions, popups, or downloads, and cannot complete the
top-level sign-in redirect. The window runs in a throwaway browser session of
its own with no access to the game or to this application, and the sign-in
result is read by the application itself rather than by loading whatever page
the redirect points at. If the sheet ever renders empty or broken, close it and
use the email and password fields instead of typing your Steam password into it.

Once you finish signing in, the window closes by itself and the game continues to
character select. Everything that window stored while it was open, cookies
included, is destroyed with it.

You normally do this once per machine and distribution channel. A provisioned
Release or Preview app remembers the token as a second opaque, device-only Data
Protection Keychain item and replays it on
later launches, so no Steam window appears again until it expires or you sign
out. A source or ad-hoc build keeps it only for that process. If the item cannot
be read, or the sign-in has expired or been revoked, you are simply returned to
the login screen — the application does not fail to start.

If an explicit sign-in fails for a reason other than you closing the window, a
brief status line appears over the login screen saying the sign-in did not
complete; it disappears on its own. Closing the Steam window yourself shows
nothing — you already know what happened.

Signing out in the game forgets the local copy. It does not unlink your accounts.

**This signs you in to a Steam account that is already linked to a Guild Wars
account — it cannot create that link.** If Steam authenticates you but the
account service reports that no Guild Wars account matches, the login is
refused and you are returned to the login screen. Linking is managed by
ArenaNet, not here: see the Guild Wars support site at
<https://help.guildwars.com/> for how Steam and Guild Wars accounts are
connected.

## Copy and paste

Pasting into the game works everywhere text can be typed: press **⌘V** in any
game text field.

Copying out of the game works for the text field you are editing — chat
entry, a search box, the guild announcement editor. **⌘C** copies the field's
selected text, or the whole field when nothing is selected, and password
fields are never copied.

Text the game merely displays — chat history, item names, a guild's status
line — cannot be copied, even where the game lets you highlight it. The web
build of ArenaNet's client ships without the clipboard support the Windows
client has, so the highlight never reaches macOS. Until that is fixed
upstream, retype or screenshot what you need.

## Templates

Guild Wars saves each build as a short template code. On Windows those are
`.txt` files under `Documents\Guild Wars\Templates`; here they live inside the
game's own storage, so **Settings → Templates** is how they get in and
out. The pane works once the game has started, because that is when the game's
storage exists.

**Export…** asks for a folder and writes a `Guild Wars Build
Templates` folder into it: one `.txt` per build, under `Skills` and
`Equipment`, with the subfolders you made in game. It is the same layout
Windows uses, so the result is a backup, a way to move builds to another Mac,
and a folder a Windows install can read. An export never writes into an earlier
one — a second export becomes `Guild Wars Build Templates 2`.

Import reads that layout back:

- **Import Folder…** takes a folder — one exported here, or the `Templates`
  folder from a Windows install. Subfolders are kept.
- **Import Files…** takes individual `.txt` files, including one file holding
  many codes.
- **Import from Clipboard** reads codes you copied from a guild page or a forum post.

Codes are recognised on their own, as `Name: code`, as `Name<tab>code`, and in
the `[Name;code]` form builds are usually shared in. Skill and equipment codes
are filed correctly on their own.

A bare code carries no name, so when one is pasted the preview offers a **Name**
field. Type one and it is used as-is; paste several bare codes and they are
numbered from it. Leave it empty and they are called `Template 1`, `Template 2`,
and so on. Codes that arrived with a name of their own keep it, and a file
import never asks — those are named after the file.

Nothing is written until you confirm. After picking a source the pane shows
what would be imported, what it would skip and why, and whether a name already
in use should be kept or replaced. Characters Guild Wars refuses in a name are
adjusted, and the preview says how many.

**Imports always land in the top level of Skills or Equipment.** Guild Wars
lists only the templates directly in those folders: it shows a subfolder, but
never reads what is inside one it did not write during the session, so a
template imported into a subfolder would be saved, would appear in an export,
and would never be visible in game. A build from a Windows subfolder therefore
keeps that folder in its name — `Warrior\Shockaxe` arrives as
`Warrior - Shockaxe`. That also means the game's limit of 550 templates per
kind applies to everything you import; subfolders cannot be used to get past
it here. This is a client defect, recorded in `internal/upstream/`.

Guild Wars reads its template list once per session, so **imported builds
appear after you choose Refresh List** in the game's template manager — or
after a restart.

Export keeps whatever folders exist in the game's storage, so an export of
templates the game itself filed into subfolders preserves them; re-importing
that export folds those folders into names, for the reason above.

If a template is already sitting in a folder Guild Wars cannot read — put
there by an earlier version of this app, or by the game itself — the pane says
so and offers **Move to Top Level**. That is the only way out: the game cannot
list such a template, so it cannot rename or delete it either. Moving keeps the
folder name as part of the template name and empties the folder away. A
template whose new name is already taken by a different build is left where it
is and reported, rather than overwriting either one. The offer appears only
when there is something to move.

## Report a problem

Open the project’s bug form on GitHub, or choose **Help → Report a Problem…**
in the app to export diagnostics and open it. Diagnostics are optional.

- For a crash, startup, download, graphics, input, audio, or login problem,
  choose **Export Recent Diagnostics…**.
- For stutter, choose **Record Performance Problem**, reproduce it, press
  **Cmd+Shift+M** when it is visible, then use
  **Help → Diagnostics → Stop Capture**.
- For a mouse problem — a click that arrives twice, a double-click that does
  nothing — choose
  **Help → Diagnostics → Show Input Trace**, reproduce it, then press **Copy**
  on the panel and paste the text straight into the report. It is a live list
  of every button press and release and what the app decided to do with it.
  Nothing is written to disk and nothing is sent anywhere; the text holds
  counts and distances, never where your pointer was or where your window is,
  and closing the trace discards it.
- When investigating a repeatable long loading stall with a Chromium trace,
  start the trace and wait five seconds before entering the portal or changing
  maps. Stop the capture after the destination has rendered. The initial wait
  keeps CPU-profiler startup outside the transition being investigated.

An always-visible capture indicator shows the recording type and elapsed time.
After **Cmd+Shift+M**, it confirms that the problem marker was registered.

The app creates one `.zip` file and can reveal it in Finder. Attach it to the
GitHub bug report as it is. (Earlier releases named the same archive `.gwdiag`;
the developer tools still read either.)

Your password, saved login, account name, game traffic, and crash dumps are
never recorded, so they are not in the export to begin with. The event log the
report is built from is a closed list: each event carries numbers, flags, and
short codes, so a failure is recorded as a code rather than as its text, and
an export that cannot account for one of its own events fails instead of being
written. Everything else in the file — Chromium's trace, the graphics and
environment report, your launcher settings — is scanned for passwords, tokens,
email addresses, and file paths, and those are replaced. That scan recognizes
known patterns, so treat it as strong rather than absolute. The export is an
ordinary ZIP you can open and read before attaching it. GitHub issues are
public, so review the bug form’s privacy notice as well.

## If the game crashes

When the running game client stops unexpectedly, the launcher screen returns
with **Retry** and **Report a Problem…**. Retry starts the client again; a
single crash is usually transient.

If the client crashes again in the same app run, the message changes to say
so and leads with reporting: **Report a Problem…** on the launcher is the
same flow as **Help → Report a Problem…** — it exports the diagnostics
archive (which includes the crashed session and the reason class of the
crash) and offers to open the GitHub bug form. What the archive does and does
not contain is described under [Report a problem](#report-a-problem).

The crash count resets when you quit and reopen the app.

## Recovery behavior

- If startup cannot reach ArenaNet, the previous verified client is restored
  when available. Otherwise the launcher presents **Retry** as the primary
  recovery action.
- Pausing, closing, losing the network, or sleeping during a full download does
  not discard verified chunks. Choose **Resume Download** to continue.
- When there is not enough disk space, the download stops before fetching more
  data. Free space, then resume.
- Corrupt cached chunks are discarded and fetched again automatically.
- If Guild Wars saved files cannot be opened, choose **Reset Saved Files…**.
  After confirmation, this removes local game preferences, build templates,
  screenshots, and chat logs, then restarts. Downloaded game data and the
  saved login stay untouched. This recovery is offered only when the game's
  storage cannot be opened at all, which is also why it cannot export first:
  keep a copy from **Settings → Templates** while the game runs.
- The first unexpected renderer crash is recovered automatically. If it
  repeats, use **View → Reload Game**, then **Help → Report a Problem…**.

## Updates

The first Developer ID release must be installed manually from its notarized
DMG. Later official releases can update themselves.

The app checks on a declared schedule. **Automatically check for and download
app updates** is on by default — it checks once at launch and then about every
six hours while the app stays open, never while a game connection is open, and
the first-run screen says so before the first check happens. Turn it off and
the app contacts GitHub only when you choose **Check for Updates** — on the
loading screen, in the application menu, on a client-compatibility notice, or
under **Settings → Updates**. Turning it back on immediately checks once.

A check asks GitHub for two things: whether a newer version of the app exists,
and whether the project has published a newer compatibility record for Guild
Wars client builds. The second is how an ArenaNet update that would otherwise
switch template saving off can be repaired without you installing anything. It
is a signed list of hashes and nothing else — no program and no instruction —
and the app still re-derives every claim against the client on your machine
before anything switches back on. Neither request sends anything about you or
your installation.

**At launch, an update lands before the game starts.** While the launch check
or its download is running, the loading screen holds at that step instead of
starting an outdated version; when the update is ready, the app restarts
itself into the new version and then starts the game. **Play Without
Updating** on the loading screen skips the wait — the download continues in
the background and installs on the next restart. A failed or offline check
never delays play, and with automatic checks off the launch is not held at
all.

An update found while you are already playing downloads in the background.
When it is ready, choose **Restart to Update** or choose Later and let it
install on the next ordinary restart. Restarting while Guild Wars is
connected asks before disconnecting. The app saves its persistent game
filesystem before either kind of restart.

Stable installations receive stable releases only. Preview installations may
receive a newer preview or advance to stable. A failed check is never reported
as “up to date,” and **Last checked** records the last completed catalog check.
ArenaNet client updates remain separate and automatic.

## When the client build is not certified

Each ArenaNet client build is checked separately for Core compatibility and the
exact Tools transform. When ArenaNet
ships a new build, the launcher checks a local copy in an isolated process.
When the structures it uses are unchanged or have only moved in the one
supported way, everything continues normally without an app update or an
extra choice.

If that check cannot prove compatibility — or proves saving files but not the
GWonMac Tools you selected — the loading screen says so once for that build,
names exactly what is affected, and offers **Play Guild Wars** as the primary
action. The notice explains; it does not block you.

Gameplay is never blocked. If the local check refuses a changed structure, Core
continues wherever safely certified and optional Tools stay off; support
may need a new app release; retrying, reinstalling, or clearing downloaded game
data will not change that decision. The same status is always visible under
**Settings → Controls**. An uncertified client build does not mean the app is
out of date — whether a newer release exists is the separate question above,
which the notice's own **Check for Updates** button answers.

Optional tools control their observations independently. Target Distance reads
only the state needed for its Test readout; Team Management reads party/build
state and exposes only its fixed certified Apply commands. A disabled optional
tool stops its observer. A small map-policy read remains so the app can enforce
the boundary and safely restore tools when the player returns to PvE.

In PvP, guild halls, and any region the client cannot positively classify,
every optional surface, observer, and command is disabled. Core remains active.
Apply additionally requires a positively observed PvE outpost and stops if that
condition changes while confirmation is in progress.
The native-cursor tool has one bounded exception: after your own trusted click,
if Guild Wars emitted no cursor event, it replays an out-and-back pointer
hit-test so an interaction-mode cursor appears without waiting for physical
movement. It cannot originate a click and ends at the same coordinates. On a
certified build the app derives one narrowly patched module that connects the
client's missing file operations to its
sandboxed persistent filesystem, which
is what makes build templates, screenshots, and chat logs work; the downloaded
official artifact is unchanged whichever way the box is set.

## Local data

Settings, cached chunks, client files, and bounded diagnostics live under the
normal macOS application-support directory, usually
`~/Library/Application Support/Guild Wars`. **Settings → Game Data → Show in
Finder** opens the game-data folder directly.

Saved ArenaNet and Steam login are not profile files. Release and Preview each
keep them in two isolated Data Protection Keychain items. On the first Release
hard-cutover launch, only the retired `credentials.bin` and
`steam-session.bin` files are removed from the application-support directory;
all other local data remains. Preview never performs that legacy cleanup.
