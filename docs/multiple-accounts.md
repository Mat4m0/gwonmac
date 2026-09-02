# Account profiles

This document owns the account-profile data and launch boundary.

## Product model

Every installation has at least one profile. There is no Single or Multiple
Accounts mode. The launcher always opens first, lists profiles, and lets the
player add another account without a restart.

One profile ID owns at most one live game window. **Play** opens a closed
profile. **Show** restores and focuses its existing window. Profiles open
sequentially and the first new window remains the client-generation canary.
Failure in one profile does not close another profile.

## Canonical owners

| State | Owner |
|---|---|
| Profile registry and deletion journal | `multi/workspace.json` |
| Launcher setup, content order, remembered selection, profile appearance | `launcher-state.json` |
| Live profile state | Main-process profile runtime |
| Queued launch intent and launcher snapshot | Main-process launcher orchestrator |
| Launcher and game-window identity | Main-process window registry |
| Window presentation | Main-process window coordinator |
| Application settings, client downloads, repair, updates, Tools install | Global main-process owners |
| Cartography visited-map knowledge | Global `cartography-map-knowledge.json` |
| Login, Steam session, game storage, private libraries, window state | Resolved profile storage |
| Shared templates and builds | Existing shared Multi libraries |

The renderer displays validated snapshots and sends narrow commands. It never
chooses storage, migrates data, owns update state, or identifies its profile.
Main resolves the immutable profile from the registered native sender.

`launcher-state.json` contains presentation state only. It is created
atomically before account bootstrap and is not another profile or settings
store. Corrupt JSON is copied to a durable diagnostic backup while the source
remains in place, then conservative defaults atomically replace it. A crash at
any point therefore retries corruption recovery instead of looking like a
fresh installation. Recovery skips forced setup and keeps **Launcher
preferences were reset** pending across restarts until the player dismisses
the recovery notices. Ordinary read failures remain fatal and are never
treated as corruption.

## Existing installation adoption

The first unified launch publishes the workspace atomically and idempotently:

- A fresh installation gets one isolated profile named **Main account**.
- Released Single Account data is adopted as **Main account** in place.
- An existing Multiple Accounts workspace keeps all profile IDs and data.
- Dormant Multiple Accounts profiles remain beside an adopted Main account.
- An interrupted publish reloads the durable candidate before deciding whether
  it committed. A retry cannot create duplicate profiles.
- A corrupt, future, or impossible workspace is never quarantined or replaced.
  Startup offers Retry or Quit and leaves source bytes untouched.

The adopted Main account is a virtual profile with one reserved public ID. It
does not consume the 16 isolated-profile limit and is not inserted into the
old `profiles` array. Its additive format-1 marker is ignored by supported
Stable builds. `launcher-mode.json` remains byte-for-byte untouched during the
rollback window and has no operational role in the candidate.

## Storage resolver

Only `profile-storage.ts` knows about adopted storage.

The adopted Main account resolves to the released default Electron session,
fixed Keychain items, root build library, native template filesystem, root
reset marker, and root window state. No file or credential is copied, moved,
linked, or deleted during cutover.

A normal profile resolves to `persist:gw-multi-<profileId>`, profile-scoped
Keychain items, profile game storage, private window state, and the selected
existing shared or private template/build library.

Deleting a normal archived profile is journaled before native cleanup. The
adopted Main account cannot be archived or deleted while it owns released
storage.

## Companion window policy

The launcher remains visible while profiles open. After complete success, it
hides and focuses the first selected game. **Show** also hides the launcher
after it restores the selected game. A failure keeps the launcher visible for
recovery. This keeps the launcher out of normal game-window switching.

**Window → Show Launcher** restores it without changing a game. **Settings…**
restores it at Settings. Closing the launcher hides it while a game is open.
Closing one game affects only that profile; closing the final game reveals the
launcher. A Dock activation restores the most recently used live window. If
that window has closed, it falls back through the previous game windows before
revealing the launcher.
A second app launch restores the launcher explicitly. An asynchronous Play
completion does not steal focus if the player has already moved to another app.

The policy uses normal `BrowserWindow` ordering. It does not use always-on-top,
panels, parent-child windows, all-workspaces behavior, or an AppKit bridge.
Physical Dock, Command-Tab, Spaces, Stage Manager, and multi-display ordering
remain packaged macOS qualification boundaries.

## Launch queue and first frame

The main process owns one queue of requested profile IDs. A healthy installed
client opens immediately. During first preparation, Play records the requested
profiles and preparation continues independently; Cancel waiting removes only
profiles that have not started. Once the client is playable, the queue drains
one profile at a time so the first candidate window can complete the existing
client canary before another profile starts. A global client failure moves the
launcher to one repair state without marking every profile as failed.

A game window is created only after a playable client exists. Electron keeps it
hidden after `ready-to-show`; the game renderer then submits the dedicated
`gameReadyToPresent` event with its owning profile. Main accepts that event once,
restores maximize or fullscreen state, and presents the window only if the
launch still owns focus. A crash or 90-second timeout destroys only that
profile window and returns a local retry state. Diagnostics are not used as
presentation control flow.

## Security boundary

The launcher uses the isolated `persist:gw-launcher` session and exact
`gw://app/launcher/index.html` main-frame URL. Its reduced preload can read the
revisioned launcher snapshot and request validated profile, setup, settings,
Tools, game-file, update, and external-link actions. It cannot access game
sockets, credentials, Steam tokens, player files, templates, snapshots, or game
diagnostics. Game windows cannot invoke launcher mutation channels.
