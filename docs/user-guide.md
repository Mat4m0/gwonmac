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

## Game integration and optional Tools

Open **Settings → Tools**.

GWonMac checks each certified game-integration feature after a Guild Wars
update. File saving, the Guild Wars cursor, local actions, and Apply team can
remain available or turn off independently.
Native double-click is unavailable when its native callback proof refuses. The
app never substitutes touch events.
The cursor has no player switch. The app does not ship or download cursor
artwork.

**Enable optional Tools Beta** is off by default. Its first enable asks for one
restart because the app selects the Tools-capable mode before Guild Wars
starts.

After that restart, these choices update immediately:

- **Apply teams in Guild Wars** (Beta) allows an explicit Apply action in a PvE
  outpost. The saved Build and Team library does not depend on this switch.
- **Open Xunlai storage** (Beta) allows the Storage button, Command-Shift-C
  shortcut, and the `/chest` and `/xunlai` chat commands in a supported PvE
  outpost, after the current character's storage access is confirmed.
- **Quick Travel palette** (Beta) opens with Command-T or the `/tp` chat
  command. It shows a customizable 3×3 Quick Travel grid. Press 1–9 to use a
  saved destination, choose **Edit** to
  replace or remove one, or press Command-1 through Command-9 while a search
  result is selected. Type any of the 199 reviewed direct-travel destinations,
  an official alias such as `la`, `kama`, or `eotn`, or your own custom synonym,
  then press Return. Locked destinations remain visible; Guild Wars decides
  whether the current character can travel there. Travel keeps the current
  Guild Wars region and language and uses district Any.

Open **Trade Chat** from the View menu, with Command-Shift-B, or by typing the
exact lowercase `/trade` command on a certified client. The Trade window is
independent from Builds and teams, so both can stay open. `/trade` passes
through to Guild Wars when Tools is disabled or the current parser is not
certified; the menu and shortcut do not depend on client certification.

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
- **Skill key labels** mirror custom Guild Wars keyboard or mouse bindings over
  the eight skill slots. Choose **Change**, then press a key, mouse button, or
  move the wheel. Control, Option, Shift, and Command become part of the label.
  **Clear** restores the native number for that slot. Labels do not change the
  Guild Wars controls.
- **Skill cooldowns** show the remaining recharge time over each unavailable
  skill. In **Settings → Tools**, you can turn the numbers off and choose Guild
  Wars red, native cream, warm gold, icy blue, or a custom color. This display
  reads the game's existing recharge state; it does not activate skills.

The same pane lists **Keyboard shortcuts**. Choose **Change**, then press a
Command shortcut to replace the default. Letter and number shortcuts use their
physical keyboard positions, so they stay stable when Option or the active
keyboard layout changes. Control remains available to Guild Wars. Delete clears a shortcut, Escape
cancels recording. **Show or hide GWonMac Tools** uses Command-B by default,
and **Show or hide Trade Chat** uses Command-Shift-B. **Restore default
shortcuts** also restores Command-Shift-C for Xunlai storage, Command-T for
Travel, and Command-Shift-B for Trade Chat. Shortcuts work only while the
Guild Wars window is active. GWonMac keeps normal editing and application
shortcuts such as Command-C and Command-Q, plus Travel's Command-1 through
Command-9 assignments, reserved.

In a supported PvE outpost, turn on **Open Xunlai storage** in
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

The complete Tools surface, including Builds and Teams and Trade Chat, closes
in positively identified PvP maps and guild halls. Xunlai storage also stops,
its shortcut reports that it is unavailable, and `/chest` and `/xunlai` remain
with Guild Wars. Apply checks policy before each step and stops when the state
changes.

At login, during loading, or when the region cannot be identified, the saved
Build and Team library and Trade Chat remain available. Live observation,
storage opening, Travel, and Apply stay unavailable until their stronger live
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
  **Help → Report Visual Problem…**. Choose whether to include a screenshot,
  save the ZIP, and attach it to the report. The screenshot can show your
  character, account name, and visible chat; inspect it before sharing. The
  diagnostics-only choice records graphics state without image pixels.
- Use **Record Performance Problem** for stutter. Reproduce it, press
  **Command-Shift-M**, stop the capture, and export it when prompted.
- Use **Show Input Trace** for keyboard, text, pointer, shortcut, or gamepad
  problems. Drag its header to move it away from the Guild Wars control you
  need to test. Reproduce the problem, pause the bounded timeline, then copy
  it into the issue. It omits text, secrets, field lengths, coordinates, account
  identifiers, and controller identifiers. Pointer rows say only whether the
  click belonged to the game canvas, a GWonMac surface, a text or secret field,
  or another element. Closing it discards the trace.
- Holding a character, Backspace, Delete, Left Arrow, or Right Arrow in Guild
  Wars text fields follows the repeat delay and speed configured in macOS
  Keyboard settings. gwonmac stores an app-specific press-and-hold preference;
  it does not change the global macOS preference. A packaged physical check is
  the final proof for each Guild Wars client update.

The diagnostics ZIP excludes saved login, account request bodies, game traffic,
chat, and crash dumps. Other text is scanned for known secret and path patterns.
An explicitly approved visual-problem screenshot is the only exception: it is
not text-scanned because scanning would damage the image. Review the readable
ZIP before attaching it to a bug issue.

See [Diagnostics and performance](diagnostics.md) for technical details.

## Local data

Settings, verified clients, chunks, and diagnostics are usually under:

```text
~/Library/Application Support/Guild Wars
```

Use **Settings → Game Data → Show in Finder** to open the game-data directory.
Guild Wars preferences and files use the app-owned `gw://app` browser origin.
ArenaNet and Steam login values are separate Keychain items.
