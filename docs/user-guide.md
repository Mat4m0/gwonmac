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

Open **Settings → Accounts** and select **Enable and Restart…**. Settings only
switches the mode; it does not create or manage accounts. GWonMac restarts into
the Account Picker, where **Create First Account** sets up the first account and
its Shared or Separate libraries. Every later Multiple Accounts start opens the
Account Picker with nothing preselected. Select one or more accounts and choose
**Open**. If an account is already running, the action changes to **Show**.

Each account signs in separately and keeps separate Guild Wars preferences,
screenshots, chat logs, saved login, and window position. Profiles can use the
shared Multiple Accounts template and build libraries or private libraries.

Creating the first account can copy templates, builds, and teams from Single
Account mode. This is a one-time copy. The originals remain in Single Account
mode. Later changes do not synchronize between the two modes. All later account
creation and management also stays in the Account Picker.

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

Press Command-Q in a game window to choose **Reload Guild Wars**, **Quit Game**,
or **Cancel**. Both actions affect only that account. Select **Return to my
character automatically** to keep the preference for every account and future
app launches. The same option is available under **Settings → Advanced** and on the
memory warning.
The app submits the restored saved login, then selects the current character as
soon as the certified Play control is ready. It accepts Guild Wars' default
reconnect choice only when the certified reconnect dialog is present. Without
one, it observes that Guild Wars started loading the selected character and
sends no extra input. A status line shows each step. If it cannot advance
within 30 seconds, the line says where it stopped.

A local source build has a temporary identity. It does not share saved-login
access with the published Release app.

## Game data

Guild Wars starts as soon as the required data is ready. The remaining game
data downloads automatically in the background while you play. It needs disk
space and does not make login or online play available offline.

Open **Guild Wars Reforged → Settings… → Game Data** to see progress or pause
and resume the download. Verified data remains when you pause or close the app,
and the next launch continues automatically. The Dock icon shows active
progress.

Use **Clear Game Data…** only to remove downloaded area data. The app confirms
the action and restarts. It keeps the small official client files.

## Display and input

Open **Settings → Display** to select render scale, interface style, interface
font, panel opacity, and controller button symbols. **Guild Wars Original** is
converted locally from your installed game. **Inter** uses the modern font when
it is installed and the closest system sans-serif otherwise.

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

**Controller button symbols** can keep Guild Wars' built-in symbols or show
PlayStation-style symbols throughout the game. The setting changes only the
prompt artwork: it does not remap buttons or change controller input. Restart
GWonMac after changing it. If a Guild Wars update changes the exact prompt
texture, GWonMac leaves the game's texture untouched instead of guessing.

## Maps and cartography

Open **Settings → Maps** for two independent features. **Grid** marks the game's
exploration cells and highlights the cell containing your character. **Walkable
terrain** keeps Guild Wars' map artwork and shades terrain outside the certified
walkable geometry. Choose Cartographer, Synthwave, or Monochrome. Select
**Customize style…** to create an editable version of the active style and
change its terrain colors, grid lines, unseen-cell marker, or inspection ranges.
The normal unseen marker means the loaded map has ground within reveal range.
Grey hatching means the unseen cell is creditable somewhere, but not from known
ground in this map; another map or special route may be required. Explored and
out-of-map cells stay unmarked. Guidance never changes the game's explored state.
Use **Manage styles** to copy and import styles for sharing, rename or duplicate
them, or delete custom styles. Hold Shift over a Mission Map cell to inspect its
normal 3×3 reveal area, or Option+Shift for the Bird's Eye 7×7 area. One style applies to the
Compass and Mission Map, while each layer keeps its own opacity. Both preserve
the native map artwork and hide when their current map projection or data
cannot be certified.

## Game integration and optional Tools

Press **Command-R** to open **Switch Character** from a playable outpost. For
accounts with up to ten characters, choose with the arrow keys, Return, or
1–9 and 0 for the tenth row. Larger accounts show a search field; an empty
search lists the ten most-used characters, while typing searches the complete
live account list. Number shortcuts pause while search text is present. Escape
clears search first, then closes the palette. Its display settings control
profession, level, and known location independently. A location appears only
when it matches Travel's reviewed catalogue. **Command-Shift-R** reloads Guild
Wars.

Character names and search text are not saved. Successful switches update a
small ranking document containing only opaque character keys, counts, and
recency. Failed or cancelled attempts do not change the ranking.

Open **Settings → Tools**.

GWonMac checks each certified game-integration feature after a Guild Wars
update. File saving, the Guild Wars cursor, local actions, and Apply team can
remain available or turn off independently.
Native double-click is unavailable when its native callback proof refuses. The
app never substitutes touch events.
The cursor has no player switch. The app does not ship or download cursor
artwork.

**Enable Tools Beta** is off by default. Its first enable asks for one
restart because the app selects the Tools-capable mode before Guild Wars
starts. Every tool has its own switch. Turning Tools Beta off disables all tool
surfaces, shortcuts, and chat commands without deleting saved tool data. It does
not close Guild Wars or force a restart. Settings shows **Tools are disabled.
Restart GWonMac to unload Tools code completely** until you restart or turn the
master back on. **Restart now…** is optional and warns before closing Guild Wars.

With Tools Beta off at launch, GWonMac loads only its required Core integration.
It does not load the Build Library, Trade, Travel, Xunlai, Target, Apply Team,
skill-label, or cooldown implementation. Enabling Tools from that Core launch
therefore saves only after confirmation and restarts immediately.

After that restart, these choices update immediately:

- **Build Library** (Beta) opens with Command-B. It saves, organizes, and
  applies builds and teams. Apply Team is available automatically in supported
  PvE outposts.
- **Trade Chat** (Beta) opens with Command-K or `/trade`.
- **Xunlai Storage** (Beta) allows the Storage button, Command-Shift-C
  shortcut, and the `/chest` and `/xunlai` chat commands in a supported PvE
  outpost, after the current character's storage access is confirmed.
- **Travel** (Beta) opens with Command-T or the `/tp` chat
  command. It shows a customizable 3×3 Quick Travel grid. Press 1–9 to use a
  saved destination, use the cog button to replace or remove one, or press
  Command-1 through Command-9 while a search
  result is selected. Type any of the 199 reviewed direct-travel destinations,
  an official alias such as `la`, `kama`, or `eotn`, or your own custom synonym,
  then press Return. Once Guild Wars publishes the active character's unlock
  data, locked destinations are hidden; the command checks the unlock again
  immediately before travel. Travel keeps the current
  Guild Wars region and language and uses district Any.

  **Recent** comes from locations Guild Wars actually reports, including world
  map travel and other in-game paths. It keeps up to ten unique reviewed places
  per character across game and app restarts, hides the current map, and shows
  the six newest destinations that character can still travel to. When the
  character has 10 or fewer unlocked destinations, such as early in any
  campaign, Travel shows the complete alphabetical list before the player
  types. The list marks the current location, recent visits, and assigned number
  shortcuts without repeating destinations in separate sections.

Open **Trade Chat** from the View menu, with Command-K, or by typing the
exact lowercase `/trade` command on a certified client. The Trade window is
independent from Build Library, so both can stay open. `/trade` passes
through to Guild Wars when Tools is disabled or the current parser is not
certified.

Trade Chat shows the public Kamadan and Pre-Searing Ascalon feeds. Choose one
source, search for an item or character, and use **Selling** or **Buying** to
filter whole-word `WTS` and `WTB` messages. Select a row to read the complete
message and exact time. Select a character name to see that character's recent
listings, then use **Back to results** or **Back to offers** to return to the
same ledger position. Copy the character name or message when you find a useful
listing. The feature is read-only: publish listings and contact players through
normal Guild Wars chat.

Choose **Trader prices** to inspect observed Kamadan NPC trader prices. Browse
Common, Rare, Runes, or Dyes, or search the complete item catalogue. Select an
item to compare its current buy and sell quotes and view its history over 24
hours, 7 days, 30 days, 90 days, or 1 year. Use the chart controls to zoom or
reset the view. **Back to listings** returns to the same Trade Chat ledger.

Feed history, searches, and copied character names are not saved automatically.
Use **Save offer** to keep an exact local copy of a useful listing. Use
**Follow player** to highlight that character's current and future listings.
Open **Saved** to review Offers and Players in a right-side drawer. These saved
items stay on this Mac; GWonMac does not send them to either public feed.

Tools and Travel stay open when you click Guild Wars behind them. Press Tab to
move the keyboard into the topmost GWonMac window. Press Escape to close that
window and return the keyboard to Guild Wars. If a confirmation dialog is open,
Escape closes the confirmation first.
- **Target distance and range** (Test) shows the selected target's distance and
range band.
- **Skill Key Labels** must be enabled before you configure the eight labels.
  They mirror custom Guild Wars keyboard or mouse bindings over
  the eight skill slots. Choose **Change**, then press a key, mouse button, or
  move the wheel. Control, Option, Shift, and Command become part of the label.
  **Clear** restores the native number for that slot. Labels do not change the
  Guild Wars controls.
- **Skill Cooldowns** must be enabled before you configure their colour. They
  show the remaining recharge time over each unavailable skill. In
  **Settings → Tools**, choose Guild
  Wars red, native cream, warm gold, icy blue, or a custom color. This display
  reads the game's existing recharge state; it does not activate skills.

An enabled tool shows its shortcut beside its other settings. Choose
**Change**, then press a Command shortcut to replace the default. Letter and
number shortcuts use their
physical keyboard positions, so they stay stable when Option or the active
keyboard layout changes. Control remains available to Guild Wars. Delete clears a shortcut, Escape
cancels recording. **Build Library** uses Command-B by default, **Trade Chat**
uses Command-K, and **Travel** uses Command-T. Press the same interface
shortcut again to close it.
**Restore default shortcuts** also restores Command-Shift-C for Xunlai storage.
Shortcuts work only while the Guild Wars window is active. GWonMac keeps normal
editing and application shortcuts such as Command-C and Command-Q, plus
Travel's Command-1 through Command-9 assignments, reserved.

In a supported outpost, turn on **Open Xunlai storage** in
**Settings → Tools**, then choose **Storage** in the Tools title bar or press
Command-Shift-C. You can also type `/chest` or `/xunlai` in chat. GWonMac opens
the normal Xunlai window locally. It does not
interact with an NPC, unlock storage, or change an
item. Deposits, withdrawals, and gold changes still use the normal game and
server rules.

GWonMac waits for a fresh access result after loading, switching characters,
or switching accounts. If the current character cannot access storage, the
button and shortcut explain that storage is unavailable. The slash commands
remain with Guild Wars while access is unconfirmed or refused. Party roster
observation does not control storage, and `/tp` remains independent.

The complete Tools surface works in PvE outposts, PvP outposts, and guild
halls. During active PvP play, Tools and Xunlai storage close, their shortcuts
report that they are unavailable, and `/chest` and `/xunlai` remain with Guild
Wars. Apply checks policy before each step and stops when the state changes.

At login, during loading, or when the region cannot be identified, enabled
Build Library and Trade Chat remain available. Live observation, storage
opening, Travel, and Apply stay unavailable until their stronger live
requirements pass.

Skill key labels and cooldown numbers also stop outside a confirmed PvE region.
Their saved display settings remain in Settings.

The saved library still works when live client integration is unavailable. You
can edit, import, and export. Live party data, storage opening, Travel, and Apply remain
unavailable.

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

## Chat editing

Guild Wars text fields use the standard macOS shortcuts: **Command-A** selects
all, **Command-C** copies, **Command-X** cuts, and **Command-V** pastes.
Command-C copies the selected text, or the full field when nothing is selected.
Password fields can be selected and pasted into, but are never copied or cut.

The official web client cannot copy text that it only displays, such as chat
history or item names.

## Extended memory

**Advanced → Experimental 4 GB memory limit** requests the verified 4 GB mode
for the next start. Restart `gwonmac` after changing it.

If the current Guild Wars version does not support 4 GB mode, the app uses the
ordinary 2 GB mode. The larger limit can delay a memory-related crash. It
cannot stop memory that continues to grow.

When the app warns about memory, choose whether to return to the selected
character automatically, then choose **Reload Guild Wars**. This uses the same
saved preference as Command-Q and **View → Reload Guild Wars**. Reload in an
outpost when you want the lowest gameplay risk. The warning does not take
keyboard focus from Guild Wars. Click a warning control when you want to use it.

## Updates

ArenaNet game updates and `gwonmac` application updates are independent.

At startup, the app verifies the official ArenaNet client. A changed client is a
candidate. The app keeps one verified previous generation until the candidate
renders and connects. It restores that generation when the candidate fails
early.

**Automatically check for and download app updates** is on by default. The app
checks when due after launch, at most once every six hours even across restarts.
It does not run an automatic check during a game connection.

Turn the setting off to stop automatic update requests. Use **Check for
Updates** for a manual check. Release discovery reads a small static Stable or
Beta channel file; application downloads remain immutable, signed GitHub
Release assets.

A launch update installs before play. Choose **Play Without Updating** to start
while it downloads. An update found during play installs on **Restart to
Update** or the next normal restart. The app asks before it disconnects a game.

**Stable** is the default. **Beta** also receives beta and release-candidate
versions, never alpha. Both tracks use the same app identity, profile, saved
login, and updater. Changing the track does not start a request.

The updater never installs an older Stable automatically. To return from a
newer candidate, install the signed Stable DMG from GitHub Releases. Preview is
a separate tester app and is not the Beta track.

## After a Guild Wars update

ArenaNet can publish a client before the current GWonMac release supports every
optional feature.

The app runs an isolated local file check. It keeps only the features that it
can prove. The launcher explains the result and keeps **Play Guild Wars** as the
primary action.

The official client remains playable. Saved builds and teams remain available.
File saving, the Guild Wars cursor, storage opening, and Apply team have scoped
support checks. One unavailable command does not turn off the other command,
the official client, saved builds, or host-owned templates. The macOS pointer
remains available; the app does not synthesize a double-click.

Use **Check for updates** to look for a newer GWonMac release.

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

Use **Reset GWonMac settings…** for launcher defaults. It also clears Travel
shortcuts and search phrases. If Travel preferences cannot be
reset after the other settings, the app keeps the completed settings reset and
asks you to run the same reset again. Use **View → Reset Window Size and
Position** for an off-screen window. These actions do not clear saved login.

## Bugs and feature requests

Choose **Help → Report a Bug…** or **Help → Request a Feature…**. Each action
opens its GitHub issue form immediately. GitHub issues are public.

- Diagnostics are optional. To include them with a bug, use
  **Help → Diagnostics → Export Recent Diagnostics…** and attach the ZIP.
- For missing, corrupted, or black textures, leave the problem visible and use
  **Help → Capture Visual Corruption…**. Choose whether to include synchronized
  images and save the ZIP. Inspect it because the images can show your
  character, account name, and visible chat. Upload the ZIP manually to
  SwissTransfer and send the download link with the bug report. The app never
  uploads it automatically. Diagnostics Only records graphics and effective
  runtime state without image pixels.
- Use **Record Performance Problem** for stutter. Reproduce it, press
  **Command-Shift-M**, stop the capture, and export it when prompted.
- Use **Show Input Trace** for keyboard, text, pointer, shortcut, or gamepad
  problems. Drag its header to move it away from the Guild Wars control you
  need to test. Reproduce the problem, pause the bounded timeline, then copy
  it into the issue. Pausing records which physical game-canvas keys remain
  held. A normalized release says whether the renderer released its matching
  key or found no held key. The trace omits text, secrets, field lengths,
  coordinates, account identifiers, and controller identifiers. Pointer rows
  say only whether the click belonged to the game canvas, a GWonMac surface, a
  text or secret field, or another element. Closing it discards the trace.
- Use **Copy Reload Trace** after a reload or failed automatic return. It joins
  Command-Q, the quit/reload dialog, reload, login, character selection, and
  reconnect timing for this game window without copying account or UI text.
- Holding a character, Backspace, Delete, Left Arrow, or Right Arrow in Guild
  Wars text fields follows the repeat delay and speed configured in macOS
  Keyboard settings. gwonmac stores an app-specific press-and-hold preference;
  it does not change the global macOS preference. A packaged physical check is
  the final proof for each Guild Wars client update.

The diagnostics ZIP excludes saved login, account request bodies, game traffic,
chat, and crash dumps. Other text is scanned for known secret and path patterns.
Explicitly approved visual-corruption images are the only exception: they are
not text-scanned because scanning would damage them. Review the readable ZIP
before sharing it.

See [Diagnostics and performance](diagnostics.md) for technical details.

## Local data

Settings, verified clients, chunks, and diagnostics are usually under:

```text
~/Library/Application Support/Guild Wars
```

Use **Settings → Game Data → Show in Finder** to open the game-data directory.
Guild Wars preferences and files use the app-owned `gw://app` browser origin.
ArenaNet and Steam login values are separate Keychain items.
