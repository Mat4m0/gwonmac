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
  launcher and settings
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

The renderer owns one input policy in `src/renderer/input.ts`. Mouse and
trackpad actions go to Guild Wars without a selectable input mode. The host
releases held keys and buttons when focus changes or native UI consumes a
release.

Right-drag uses pointer lock and a virtual cursor. The host bounds drag
recycling so camera movement can continue. The host normalizes supported
physical keyboard positions before the official client receives them. Text
fields still use the active macOS input source.

Certified Core supplies native double-click and the Guild Wars cursor. Core is
required behavior. It is not a saved player preference. If an ArenaNet build
is not certified, the official client remains playable with the normal macOS
pointer and without the certified repair.

The input trace is a renderer-only troubleshooting view. It records bounded
counts and distances. It does not record coordinates. It does not cross IPC or
write to disk.

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
- two saved-login items in Apple's Data Protection Keychain.

The renderer owns the Guild Wars IDBFS mount under the `gw://app` origin. This
mount contains game preferences, templates, screenshots, and chat logs.

Derived WASM modules and caches are rebuildable. They are never certification
authority.

## Saved login

The Release, Preview, and signed Development identities use separate Keychain
authority. Each identity can read only its own provisioned items.

One item stores the ArenaNet user name and password. One item stores the Steam
access token and expiry. A read failure does not delete an item. The game can
continue to its login screen when an item is unavailable.

Unpackaged and ordinary local builds use volatile storage. They do not claim a
provisioned Keychain item. There is no file or `safeStorage` fallback.

The game proxy does not send or accept browser cookies. The Steam sign-in
window uses a separate in-memory session. It destroys that session after
success, failure, or cancellation.

## Distribution and application updates

Release, Preview, and Development are separate signed identities. Preview is a
tester application. It cannot use the public application updater.

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
files. A second launch focuses the existing window and exits.

Closing the game window quits the application. Quit follows one bounded cleanup
path. It saves the renderer filesystem, closes sockets, stops background work,
flushes diagnostics, and exits.

Main-to-renderer events stop after the window or its `webContents` is destroyed.
The app attempts renderer recovery only after unexpected renderer loss. It does
not recover a renderer while the app is quitting.

Startup cleanup can remove only files that the app owns and can rebuild. It must
not remove settings, Keychain items, the current verified client, or player
files as a general recovery action.
