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
| Running, queued, failed, and crashed status | Live window registry |

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

Every cold Multiple Accounts launch opens the Account Picker with no profile
selected. One profile ID maps to at most one live game window. A duplicate
launch request focuses that window.

The app starts selected profiles in a bounded queue. It confirms a new client
generation with one canary renderer before it starts the remaining profiles.
One profile failure does not close another profile.

Closing a profile flushes its filesystem and closes only its sockets. Quitting
the app flushes all live profile filesystems in parallel. After an application
update or process crash, Multiple Accounts mode returns to the Account Picker.
It does not reopen profiles automatically.

Archive is the normal profile-removal action. It preserves the profile session,
private libraries, and Keychain items. Permanent deletion is a separate,
confirmed action. It never removes a shared library or Single Account data.

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
