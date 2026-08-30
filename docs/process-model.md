# Process model and ownership

This document explains the runtime boundaries in `gwonmac`.

Audience: contributors who change the Electron host, client lifecycle, IPC,
networking, input, persistence, or application updates.

This document owns process and module responsibilities. It does not own exact
client hashes, build numbers, wire schemas, or release steps. Code and tests own
those facts.

## Runtime model

```text
Electron main process
  application lifecycle
  revisioned launcher projection and launch queue
  launcher presentation preferences
  account-profile workspace
  game-window registry
  ArenaNet client and content updates
  verified client generations and rollback
  native chunk storage
  gw://app protocol
  DNS and TCP sockets
  saved login and settings
  application updates
  diagnostics
          |
          | validated, window-specific IPC
          +-----------------------------+
          v                             v
Launcher preload                  Game preload
  frozen launcherNative             frozen gwNative
  profiles and global actions       profile runtime only
          |                             |
          v                             v
Vue launcher renderer             Game renderer
  setup and profiles                canvas and input
  updates and game files            saved session
  global Tools settings             health proof
  support surfaces                  in-game Tools
```

The renderer has no Node.js integration. Context isolation, the Chromium
sandbox, web security, ASAR integrity, and app-only ASAR loading stay enabled.

The main process validates IPC senders and values. It also validates navigation,
permissions, external links, DNS names, socket destinations, ports, and proxy
routes.

The two preloads expose different frozen capability objects. The launcher gets
`window.launcherNative`, which can read one revisioned projection and send
narrow profile or global commands. It cannot access credentials, Steam tokens,
sockets, templates, game snapshots, or game health channels. A game window gets
`window.gwNative`, which contains only its profile-owned runtime capabilities.
Neither preload owns domain or persistence rules.

The Vue renderer reads one `LauncherSnapshot` on mount and subscribes to newer
revisions. The snapshot is a rebuildable projection, not writable state. The
main process remains the canonical owner of profiles, downloads, updates,
Tools, windows, and launch sequencing.

## Account profiles

Every game window has one `ProfileId`. The process bootstraps one account
workspace before creating a window. Existing installations adopt their released
storage as **Main account** in place. Added profiles use isolated persistent
sessions and profile-scoped native stores.

One storage resolver maps a profile to its Electron session, saved-login slots,
build and template libraries, reset marker, and window state. Other main-process
modules do not branch on legacy storage.

All profiles use the same verified client generation, chunk store, derived
client artifacts, application updater, general settings, and Tools installation.
These shared stores contain infrastructure, not profile login state.

The main-process window registry owns the launcher and every profile game
window. The window coordinator owns show, hide, restore, focus, and Dock
activation. Native code resolves a renderer only through the registry; it does
not infer ownership from Electron's global window list or current focus.

[Account profiles](multiple-accounts.md) owns the complete bootstrap, storage,
and rollback contract.

## Client generation ownership

Three types have different jobs:

| Owner | Responsibility |
| --- | --- |
| `PatchClient` | Fetch and verify ArenaNet manifests, artifacts, and chunks. Stage a candidate generation. Report download progress. |
| `ClientRuntime` | Serialize generation changes. Activate one verified generation. Select the derived WASM module. Confirm or roll back a candidate. Own full-game download work. |
| `ActiveClient` | Describe one immutable active generation. Bind its artifact paths, chunk store, selected WASM module, and compatibility result. |

Only `ClientRuntime` can declare a client ready. `PatchClient` cannot emit a
ready state. This rule prevents the renderer from requesting snapshot metadata
before an active client exists.

`ClientRuntime` uses one generation lock for operations that move generation
directories. Update, candidate confirmation, and crash recovery must not move
the same directories at the same time.

The active generation's compatibility result is immutable and shared. A
renderer installation failure is a document-local overlay keyed by its window,
document routing ID, and client generation. Reload or a new generation removes
that overlay without changing another renderer's session.

The `gw://app` protocol reads one `ActiveClient` for each request. A response
must not combine artifacts, chunks, or compatibility facts from different
generations.

[Game content and updates](content-pipeline.md) explains download and rollback
behavior. [The WASM host and client certification](wasm-host.md) explains module
selection.

## Source ownership

| Path | Responsibility |
| --- | --- |
| `src/main/main.ts` | Composition root and application lifecycle |
| `src/main/active-client.ts` | Immutable active-generation slot |
| `src/main/client-runtime.ts` | Client activation, health proof, rollback, and content downloads |
| `src/main/core/patch-client.ts` | ArenaNet manifest and artifact preparation |
| `src/main/core/` | Native storage, sockets, DNS, credentials, settings, and window state |
| `src/main/certification/` | Client certification and deterministic WASM transforms |
| `src/main/protocol.ts` | `gw://app` routing and range responses |
| `src/main/ipc.ts` | Validated IPC registration |
| `src/main/launcher-ipc.ts` | Launcher-only IPC registration and sender validation |
| `src/main/launcher-orchestrator.ts` | Revisioned launcher projection and queued profile launch commands |
| `src/main/core/launcher-state.ts` | Atomic presentation-only launcher preferences |
| `src/main/settings-actions.ts` | Confirmed settings actions and recovery requests |
| `src/main/app-updater.ts` | Updates for the `gwonmac` application |
| `src/main/diagnostics.ts` and `src/main/diagnostics/` | Diagnostics entry point and implementation |
| `src/preload/preload.launcher.cjs` | Reduced sandboxed Vue-launcher preload body |
| `src/preload/preload.body.cjs` | Sandboxed game preload body |
| `apps/launcher/` | Vue launcher shell and deterministic development fixtures |
| `src/renderer/` | Game host, input, presentation, in-game Tools, and diagnostics UI |
| `src/companion-kernel/` | Read-only companion WASM for certified Core and Tools features |
| `src/shared/` | Contracts and validation used by more than one process |
| `src/tools/` and `tools/` | Maintainer commands and binary research tools |

The preload remains self-contained CommonJS. Electron's sandboxed preload
loader does not load a local ESM dependency graph. The build generates the
canonical channel constants that the preload uses.

## Protocol boundary

The app registers `gw://app` as a secure standard scheme before Electron is
ready. The protocol serves these resources:

- packaged renderer assets;
- verified JSPI client artifacts;
- virtual ranges from the ArenaNet snapshot;
- a fixed set of HTTPS proxy routes.

The protocol is not a general file server. It is not a general URL fetcher.
The renderer cannot select a native path or an arbitrary remote address.

## Rendering and input

The official client creates WebGL on an `OffscreenCanvas`. The host presents a
successful swap on the visible canvas. The client owns canvas size. The host
supplies the selected render scale and mirrors the requested backing size.

Every game window remains scheduled when it is fully covered or minimized.
Guild Wars uses animation frames for its main loop, so background throttling
would delay network updates and enabled background audio until the window
became visible again. The launcher keeps normal background throttling.

The renderer owns one input policy in `src/renderer/input.ts`. Mouse and
trackpad actions go to Guild Wars without a selectable input mode. A real focus
or visibility loss releases all held input. Pointer-only interruptions release
only mouse buttons; they do not stop keyboard movement.

On macOS, AppKit consumes ordinary key-up events while Command remains down.
The app-local native monitor forwards that physical key position to the focused
game renderer. The renderer releases only the matching entry from its existing
held-key map and clears that physical code from renderer-owned suppression.
The monitor remembers each physical key that crosses a Command transition.
It forwards that key's release even when the release no longer reports Command,
without consuming the native event. If Chromium delivers the release too, the
renderer lets it reach the client because key-up is idempotent.
Bare Command transitions stay outside Guild Wars, which has no
Command modifier, so pressing or releasing Command cannot interrupt another
key that is still physically held. A real focus loss remains the final cleanup
for interrupted input.

When Guild Wars moves focus from the canvas into one of its hidden text proxies,
the renderer releases canvas-owned W, A, S, and D at that boundary. This keeps
movement state out of chat without changing later text input or releasing any
other game key.

Moving focus from the game canvas into a control in the same renderer does not
blur Guild Wars. Settings, Tools, Travel, warnings, and game text fields remain
part of the active game window, so they do not mute game audio. A real window
blur still reaches Guild Wars and releases held input.

Main owns one account-local reload workflow. Memory warnings, Command-R, crash
retry, and Command-Q use it. The workflow closes only the owning renderer's
sockets, gives its filesystem sync up to 1.5 seconds, and navigates only that
window. An automatic-relog intent is bound to that `BrowserWindow` and consumed
once by its replacement document. The replacement renderer uses the active
client session as its launch gate; complete-game data may keep downloading in
the background without making reload wait for that download to finish.

Automatic relog follows certified observed boundaries. Returning saved
credentials permits one Return to submit the login screen. A successful
account-token request waits for the exact native Play and Selector controls
before selecting the current character. It sends another Return only while the
exact native reconnect controls are visible. Loading is transition evidence,
not success: completion requires a fresh bounded play-region publication with
a valid map, instance type, and player. Existing session progress or a physical
Return cancels the related synthetic one. Losing focus pauses input. The
renderer records each boundary and shows the current step; after 30 seconds it
names where progress stopped.

Right-drag uses pointer lock and a virtual cursor. The host bounds drag
recycling so camera movement can continue. The host normalizes supported
physical keyboard positions before the official client receives them. Text
fields still use the active macOS input source.

Main claims physical Command-A/C/X/V before the renderer can hold their base
keys and runs the edit immediately. The claim contains physical repeats and
releases while allowing the translated Control chord through. Edit menu clicks
use the same semantic command and focused-window route. A hidden Guild Wars
text proxy claims the command. An ordinary gwonmac input declines it so
Chromium edits normally. Copy and Cut send only non-password proxy text to
main. Main writes Cut text to the pasteboard before it sends Guild Wars
Control-X. Paste validates the clipboard in main and sends Guild Wars a
Control-V chord, which also produces Chromium's trusted native Paste edit
(`insertFromPaste`). Select All mirrors the full selection onto the proxy and
sends Guild Wars Control-A, so a following Cut can export the same selection.
Password text never crosses the renderer bridge. Physical Control stays
available to Guild Wars unchanged.

Before the first window exists, Electron writes the bundle-specific persistent
`ApplePressAndHoldEnabled = false` preference. This makes macOS send physical
repeat keydowns to hidden text proxies for printable characters, Backspace,
Delete, and navigation keys. It does not change the global macOS preference,
create a timer, or synthesize repeat cadence. macOS remains the sole repeat
clock. Guild Wars treats arrows as transitions, so the renderer puts a release
before each native repeated arrow press. This lets chat history and cursor
movement follow the native cadence. Automated tests prove how Chromium handles
supplied repeat events. A packaged physical test proves that AppKit supplies
them to the current client.

Certified Core supplies native double-click and the Guild Wars cursor. Core is
required behavior. It is not a saved player preference. If an ArenaNet build
is not certified, the official client remains playable with the normal macOS
pointer and without the certified repair.

The input harness is a player-visible troubleshooting view with one bounded,
receipt-ordered renderer-memory timeline. AppKit and main-process decisions
cross one redacted main-to-renderer event; renderer keyboard, hidden text proxy,
pointer, wheel, pointer-lock, cleanup, and thresholded gamepad transitions join
the same timeline. It records no text, clipboard contents, secret-field lengths,
exact printable keys while a text proxy is active, coordinates, account
identifiers, or controller identifiers. Pausing changes only recording. Closing
clears the memory. The trace is not persisted, exported with diagnostics, or
sent over the network. Copy keeps the newest complete rows that fit the same
bounded clipboard contract used elsewhere and states how many older rows were
omitted.

Reload diagnostics are a separate, account-owned projection of the main flight
recorder. **Copy Reload Trace** survives renderer replacement and joins
Command-Q, the native sheet, reload, automatic-input outcomes, and the
certified pre-game state probe. It never changes an input decision and
does not make the renderer-memory input trace persistent.

### Packaged input qualification

CDP and `webContents.sendInputEvent()` start after AppKit. They cannot prove a
physical Command accelerator or native repeat generation. Qualify each release
candidate in the packaged app on macOS:

1. Open **Help → Diagnostics → Show Input Trace** and drag its header away from
   the text field under test.
2. Hold a printable character, Backspace, Delete, Left Arrow, and Right Arrow
   in a Guild Wars text field.
3. Confirm native repeated keydowns, trusted proxy edits, and visible Guild Wars
   changes at the macOS repeat cadence.
4. Use physical Command-A/C/X/V and each matching Edit menu item.
5. Confirm Copy and Cut update the pasteboard, Paste preserves Unicode and
   multiline text, and Select All changes the visible Guild Wars editor.
6. Release Command before the editing key. Repeat with the editing key released
   first.
7. Confirm no bare game key, unmatched key-up, or held-key state remains.

Stop qualification if Paste does not produce trusted `insert-paste` proxy
events. Record the events. Do not restore character-by-character Paste as a
fallback.

## Native network boundary

The main process owns all game TCP sockets. The renderer never receives a
native socket handle.

The socket manager permits only approved public destinations and the required
ports. It closes all sockets owned by a renderer after reload, renderer loss,
or quit. Per-socket and per-renderer queue limits bound backpressure.

The renderer copies each outbound WASM view into a compact byte array before it
crosses the preload boundary. Cost must scale with the packet length, not with
the size of WASM memory that backs the original view.

DNS accepts only approved ArenaNet and Guild Wars names. The main process owns
the official client's required datacenter fallback.

Diagnostics can record sizes, durations, and closed outcomes. It never records
packet contents.

## Persistent state

The main process owns these native stores:

- application settings and window state;
- verified ArenaNet client generations;
- the content-addressed chunk store;
- bounded diagnostics files;
- adopted and profile-scoped saved-login items in Apple's Data
  Protection Keychain.

Each game window stores its normal bounds, mode, and display work area in its
window-state document. Restore keeps the window's relative size and position
when display resolution, scaling, or usable space changes. A missing display
falls back to the primary display. Restore never opens a window off-screen.

Each game renderer owns one Guild Wars IDBFS mount under its isolated
`gw://app` session. The mount contains game preferences, templates,
screenshots, and chat logs. Two renderers do not mount the same browser store.

Derived WASM modules and caches are rebuildable. They are never certification
authority.

### Native package inputs

The Guild Wars archive decoder is an isolated executable built for the package
host. Windows x64 uses MSVC and an `.exe` suffix; Linux x86_64 uses the system
C++ compiler; macOS keeps its released Xcode recipe. The decoder never owns a
credential or an Electron process.

`host.node` remains Darwin-only. It contains the existing AppKit key-release
monitor and Apple Data Protection Keychain implementation. Windows packages a
separate `windows-host.node`: it obtains LocalAppData from the Windows known-
folder API and stores only the closed saved-login slots in Windows Credential
Manager. Linux does not load either addon. Until Linux has a qualified secure
provider, persistent saved login fails closed and ordinary development uses
only the in-memory provider.

Forge applies the complete cross-platform fuse set to every packaged Electron
executable. Embedded ASAR integrity is enabled on macOS and Windows. Electron
does not provide that feature on Linux, where repository signatures, the
Flatpak sandbox, and ASAR-only loading must form the installed package proof.

## Saved login

The Release and signed Development identities use separate secret namespaces.
Historical signed Preview builds have their own retained namespace too; no new
signed Preview is published. On macOS, code-signing entitlements enforce the
Keychain identity. On Windows, the native host binds the closed application
identity into each Credential Manager target. This prevents accidental
cross-channel reads but is not a boundary against another process running as
the same Windows user.

Each account scope has one item for the ArenaNet user name and password and one
item for the Steam access token and expiry. The existing fixed items belong
only to the adopted Main account. A read failure does not delete an item. The game
can continue to its login screen when an item is unavailable.

Unpackaged, ordinary local, and ad-hoc developer builds use volatile storage.
They do not claim a provisioned Keychain or Credential Manager item. There is
no file or `safeStorage` fallback.

The game proxy does not send or accept browser cookies. The Steam sign-in
window uses a separate in-memory session. It destroys that session after
success, failure, or cancellation.

## Distribution and application updates

Release and Development are separate signed identities. Manual developer builds
use the Preview application identity only to install beside Release; they are
ad-hoc signed, carry no distribution marker, and cannot use saved login or the
public application updater.

Every application identity still uses the canonical `Guild Wars` user-data
directory. A developer build can therefore change settings, game files, builds,
templates, diagnostics, and caches even though Keychain access stays isolated.
Run only a trusted commit and back up important player data before testing.

Stable and Beta are update tracks inside the same Release identity. They share
the same bundle identity, profile, Keychain authority, settings, and updater.
The track changes release eligibility only.

`AppUpdater` is the only runtime owner of `gwonmac` application updates. ArenaNet
game updates cannot authorize an application update. Application releases
cannot certify an ArenaNet client build.

A return from a newer Beta or release candidate to an older Stable is a manual
application install. The updater never performs an automatic downgrade.

[Verify a release](release-verification.md) owns signing, publication, and
rollback procedures.

## Application lifecycle

The app acquires a single-instance lock before it reads or cleans profile-owned
files. A second launch reveals the launcher. A Dock activation restores the
most recently used live window. If that window has closed, the coordinator
falls back through its recent-window order. Neither action creates another
game window.

Closing the launcher hides it while games run. Closing one game window closes
only that profile. Closing the final game leaves the launcher available.
Application quit saves
all live renderer filesystems in parallel, closes sockets, stops background
work, flushes diagnostics, and exits through one bounded cleanup path.

Command-Q opens an account-owned native dialog while a game window is active.
Reload and Quit Game affect that account only. The launcher keeps the
ordinary application Quit command because it has no game account to reload.
The physical Q claim lasts only until that dialog settles; Cancel re-arms the
shortcut even when AppKit consumed the original key-up.

Main-to-renderer events stop after the window or its `webContents` is destroyed.
The app attempts renderer recovery only after unexpected renderer loss. It does
not recover a renderer while the app is quitting.

Startup cleanup can remove only files that the app owns and can rebuild. It must
not remove settings, Keychain items, the current verified client, or player
files as a general recovery action.
