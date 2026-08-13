# Multiple Accounts

This document owns the player-data boundary between Single Account mode and
Multiple Accounts mode.

## Product boundary

Single Account mode is the default. It starts Guild Wars directly and keeps
the existing saved login, Guild Wars files, builds, settings, and window state.

Multiple Accounts mode is an explicit opt-in workspace. It starts at the
Account Picker. The player can open one or more independently controlled Guild
Wars accounts. The app does not broadcast input or automate gameplay.

The active mode is fixed for the lifetime of the app process. A mode change
takes effect after a restart.

## Canonical data owners

| Data | Owner |
| --- | --- |
| Verified client, chunks, compatibility artifacts, and skill assets | Shared app infrastructure |
| Application updater and update preferences | Shared app infrastructure |
| Active account mode | Launcher-mode document |
| Single saved login | Existing fixed Keychain items |
| Single Guild Wars files and templates | Default Electron session |
| Single builds and teams | Existing root build library |
| Single window state | Existing root window state |
| Multiple Accounts profile registry | Multiple Accounts workspace |
| Profile saved login | Profile-scoped Keychain items |
| Profile Guild Wars files | Profile persistent Electron session |
| Profile window state | Profile window-state document |
| Shared Multiple Accounts templates | Multiple Accounts shared template library |
| Private Multiple Accounts templates | Profile template library |
| Shared Multiple Accounts builds | Multiple Accounts shared build library |
| Private Multiple Accounts builds | Profile build library |
| Ready, queued, opening, checking, running, and failed status | Main-process runtime store and live window registry |

Single Account mode is not a Multiple Accounts profile. No Multiple Accounts
game window uses the default Electron session or the fixed Single Account
Keychain items.

## Setup and mode transitions

Settings shows Multiple Accounts setup only in the Accounts pane until
the player enables the mode.

Setup creates a staged Multiple Accounts workspace and at least one profile.
The player signs in separately for every profile. Setup can copy templates,
builds, and teams from Single Account mode. This import reads a stable snapshot
and writes a new Multiple Accounts destination. It never moves, links, mirrors,
or later synchronizes the Single Account source.

The app publishes the workspace before it publishes the selected mode. A
cancelled or failed setup leaves Single Account mode selected. An import failure
does not change its source or the previous destination revision.

Returning to Single Account mode preserves the complete Multiple Accounts
workspace. Re-enabling it restores the profiles and libraries. Neither
transition copies data automatically.

## Multiple Accounts sharing

Sharing applies only among Multiple Accounts profiles. Each profile selects
**Shared** or **Private** independently for templates and for builds and teams.

Build libraries remain main-process documents. Main serializes writes per
library and refuses a save whose last-read baseline is stale, so one profile
cannot silently replace another profile's newer shared library.

Every profile keeps an isolated IDBFS mount. A profile that uses Shared
templates receives a working projection of the canonical Multiple Accounts
template library. The app reconciles that projection before launch and after a
clean close or reload. It does not mutate another running renderer's filesystem.

Template reconciliation preserves both contents when two different templates
use the same normalized path. A deletion cannot silently discard a concurrent
edit. The canonical library and each profile checkpoint use revisions, so a
projection can be rebuilt. Private template libraries use the same snapshot
format but never reconcile with another profile.

## Lifecycle and recovery

Every cold Multiple Accounts launch opens the Account Picker with no account
selected. One profile ID maps to at most one live game window. The Hub shows
only bounded runtime language: **Ready**, **Waiting**, **Starting**, **Checking
updated client**, **Open**, and **Needs Attention**. It never describes a loaded
renderer as game-ready.

The app starts selected accounts in a bounded queue and presents every new game
window inactive. It confirms a new client generation with one canary renderer
before it starts the remaining accounts. A canary failure stops the unopened
queue and returns those rows to Ready. An ordinary account failure does not
close or stop another account.

After complete success, the Hub hides and focuses the first selected account
once. Selecting an already-open account shows its existing window. If any
account fails, the Hub stays visible for recovery and successful accounts stay
open. Brand-new windows cascade by 32 pixels where display space permits;
saved window positions take precedence after the first launch.

A renderer gets one automatic recovery per deliberate launch. Recovery keeps
the same profile ownership and does not affect other accounts. A second crash
becomes a persistent Needs Attention row with Retry. The Hub remains
recoverable from Dock activation, and Settings is available with Command-,.

Closing a profile flushes its filesystem and closes only its sockets. Quitting
the app flushes all live profile filesystems in parallel. After an application
update or process crash, Multiple Accounts mode returns to the Account Picker.
It does not reopen profiles automatically.

If the selected mode or profile registry is missing, corrupt, or from an
unsupported future format, startup does not guess at its contents. It offers to
preserve the unreadable document and restart in Single Account mode. This
recovery quarantines the unreadable document and changes the launcher-mode
document only; it does not open, copy, or clear either mode's player data or
Keychain items.

Archive is the normal account-removal action. It preserves the profile session,
private libraries, and Keychain items. Permanent deletion is a separate,
confirmed action in Hub Settings. It never removes a shared library or Single
Account data.

## Hub interaction

The Hub is a focused chooser, not an account dashboard. Rows use native
checkbox semantics and the entire non-action area is clickable. The primary
action reflects the selection: Open, Open _Account_, Show _Account_, Retry
_Account_, or Open _n_ Accounts. Edit and Archive live in each row's More menu.

New and Edit Account are modal sheets. Player-facing sharing choices are
**Builds and teams** and **In-game templates**, each either **Shared between
Multiple Accounts** or **Separate for this account**. Shared is the default.
The sheet states that login, game settings, screenshots, chat logs, and Single
Account data are never shared.

Mode switching, archived-account restoration, and permanent deletion live in
Settings rather than the launch surface. Game Settings → Accounts carries the
same mode explanation and Return to Single Account action.

Reset actions name their scope. A Single Account saved-files reset clears only
the default session. A profile reset clears only the selected persistent
session. Clearing downloaded game data affects the shared app infrastructure
and does not clear player files or saved login.

## Security and privacy

The window registry derives profile authority from the trusted sender. A
renderer cannot choose a profile ID, native path, Electron partition, Keychain
item, or socket owner.

The Account Picker cannot access game sockets, saved login, player files, or
build writes. Diagnostics use ephemeral window identifiers. They do not record
profile names, stable profile IDs, account identifiers, credentials, template
contents, or game traffic.
