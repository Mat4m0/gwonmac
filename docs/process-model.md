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
  active Single or Multiple Accounts mode
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
          | validated IPC
          v
Sandboxed preload
          |
          | frozen window.gwNative capabilities
          v
Chromium renderer
  account picker, launcher, and settings
  Guild Wars Module host
  input and presentation
  required Core features
  optional Tools
```

The renderer has no Node.js integration. Context isolation, the Chromium
sandbox, web security, ASAR integrity, and app-only ASAR loading stay enabled.

The main process validates IPC senders and values. It also validates navigation,
permissions, external links, DNS names, socket destinations, ports, and proxy
routes.

The preload exposes one frozen `window.gwNative` object. It transports
capabilities. It does not own game rules or persistence rules.

## Account modes

The process captures one account mode at startup. It does not switch storage
owners while it runs.

Single Account mode uses the existing default Electron session, saved-login
items, build library, and window state. Multiple Accounts mode does not treat
Single Account mode as a profile. Each Multiple Accounts profile uses a
non-default persistent Electron session and profile-scoped native stores.

Both modes use the same verified client generation, chunk store, derived
client artifacts, and application updater. These stores contain rebuildable
client infrastructure. They do not contain player account state.

The main-process window registry owns the Single game window, the Multiple
Accounts Hub, and every profile game window. Native code resolves a renderer
only through this registry. It does not infer ownership from Electron's global
window list or from the current focus.

[Multiple Accounts](multiple-accounts.md) owns the complete data and transition
contract.

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
| `src/main/settings-actions.ts` | Confirmed settings actions and recovery requests |
| `src/main/app-updater.ts` | Updates for the `gwonmac` application |
| `src/main/diagnostics.ts` and `src/main/diagnostics/` | Diagnostics entry point and implementation |
| `src/preload/preload.body.cjs` | Sandboxed preload body |
| `src/renderer/` | Launcher, game host, input, presentation, and diagnostics UI |
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
became visible again. The Account Picker keeps normal background throttling.

The renderer owns one input policy in `src/renderer/input.ts`. Mouse and
trackpad actions go to Guild Wars without a selectable input mode. A real focus
or visibility loss releases all held input. Pointer-only interruptions release
only mouse buttons; they do not stop keyboard movement.

On macOS, AppKit consumes ordinary key-up events while Command remains down.
The app-local native monitor forwards that physical key position to the focused
game renderer. The renderer releases only the matching entry from its existing
held-key map and clears that physical code from renderer-owned suppression.
Bare Command transitions stay outside Guild Wars, which has no
Command modifier, so pressing or releasing Command cannot interrupt another
key that is still physically held. A real focus loss remains the final cleanup
for interrupted input.

Moving focus from the game canvas into a control in the same renderer does not
blur Guild Wars. Settings, Tools, Travel, warnings, and game text fields remain
part of the active game window, so they do not mute game audio. A real window
blur still reaches Guild Wars and releases held input.

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
- Single Account and profile-scoped saved-login items in Apple's Data
  Protection Keychain.

Each game renderer owns one Guild Wars IDBFS mount under its isolated
`gw://app` session. The mount contains game preferences, templates,
screenshots, and chat logs. Two renderers do not mount the same browser store.

Derived WASM modules and caches are rebuildable. They are never certification
authority.

## Saved login

The Release and signed Development identities use separate Keychain authority.
Historical signed Preview builds have their own retained identity too. Each
identity can read only its own provisioned items; no new signed Preview is
published.

Each account scope has one item for the ArenaNet user name and password and one
item for the Steam access token and expiry. The existing fixed items belong
only to Single Account mode. A read failure does not delete an item. The game
can continue to its login screen when an item is unavailable.

Unpackaged, ordinary local, and ad-hoc developer builds use volatile storage.
They do not claim a provisioned Keychain item. There is no file or
`safeStorage` fallback.

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
files. In Single Account mode, a second launch focuses the game. In Multiple
Accounts mode, it opens or focuses the Account Picker.

Closing the Single Account game window quits the application. Closing one
Multiple Accounts game window closes only that profile. Application quit saves
all live renderer filesystems in parallel, closes sockets, stops background
work, flushes diagnostics, and exits through one bounded cleanup path.

Main-to-renderer events stop after the window or its `webContents` is destroyed.
The app attempts renderer recovery only after unexpected renderer loss. It does
not recover a renderer while the app is quitting.

Startup cleanup can remove only files that the app owns and can rebuild. It must
not remove settings, Keychain items, the current verified client, or player
files as a general recovery action.
