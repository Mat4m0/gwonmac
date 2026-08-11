# Process model and boundaries

Guild Wars is an Emscripten/JSPI WebAssembly client whose platform
services are read from a JavaScript `Module` object. This repository supplies
those services in a macOS Electron application.

This document owns which process owns what and what each one is allowed to do:
the sandbox and `gw://app`, the renderer's presentation and input policy,
native sockets and DNS, the two persistent secrets, the signed distribution
channels, and application lifecycle.

## Process model

```text
Electron main process
  ArenaNet client updater + atomic artifact publication
  native content-addressed chunk store
  gw://app protocol
  DNS + raw TCP ownership
  explicit HTTPS proxy routes
  encrypted owner-only saved-login handling
  settings + lifecycle + diagnostics
          │ narrow validated IPC
Sandboxed preload
          │ frozen window.gwNative capability object
Chromium renderer
  loading/settings UI
  Emscripten Module host
  JSPI WASM + WebGL/ANGLE
  always-on certified Core plus opt-in GWonMac Tools Beta
```

The renderer has no Node integration. Context isolation, Chromium sandboxing,
web security, ASAR integrity, and app-only ASAR loading are enabled. Navigation,
redirects, permissions, external links, DNS names, socket destinations, ports,
proxy routes, IPC senders, and IPC payloads are validated in the main process.

`gw://app` is registered as a standard secure scheme before Electron becomes
ready. It serves packaged renderer assets, current JSPI artifacts, virtual
snapshot ranges, and an explicit set of proxy routes. It does not expose an
arbitrary filesystem or URL fetch capability.

## Source layout

| Path                      | Ownership                                                         |
| ------------------------- | ----------------------------------------------------------------- |
| `src/main/main.ts`        | composition root and application lifecycle                        |
| `src/main/client-runtime.ts` | atomic generation, update, rollback, cache, selected WASM       |
| `src/main/core/`          | updater, cache, DNS, sockets, credentials, settings, window state |
| `src/main/core/wasm-binary.ts` | WASM section codec shared by both transforms and the re-certifier |
| `src/main/certification/` | certified build tables, both transforms, the isolated local proof |
| `src/main/protocol.ts`    | `gw://app` routing and range responses                            |
| `src/main/ipc.ts`         | validated native capability handlers                              |
| `src/main/diagnostics.ts` | the diagnostics subsystem's one entry point                       |
| `src/main/diagnostics/`   | flight recorder, capture, samplers, schema, detector, export      |
| `src/preload/preload.body.cjs` | sandbox-compatible bridge; `scripts/generate-preload.ts` splices the canonical constants above it |
| `src/renderer/`           | launcher, `Module` host, input, graphics, diagnostics             |
| `src/companion-kernel/`     | freestanding read-only game-state companion WASM                  |
| `src/shared/`             | contracts, validation types, progress, errors                     |
| `src/tools/certification.ts` | the one certification command line over that chain              |
| `src/tools/diagnostics/`  | diagnostics ZIP validator, summary, comparison                    |
| `tools/`, `gwkey.py`      | developer-only binary analysis                                    |

The preload is deliberately self-contained CommonJS. Electron’s sandboxed
preload loader does not execute a local ESM dependency graph. Release tests
therefore assert that every canonical channel is present in both the preload
and the main-process wiring. The bridge and each nested namespace are frozen.

## Rendering and input

The client creates a WebGL context on an `OffscreenCanvas`. The EGL import
patch presents each successful swap through `transferToImageBitmap()` and the
visible canvas’s `bitmaprenderer`. The client remains the only canvas-size
owner; the host supplies the selected render scale through Emscripten’s device
pixel ratio import and mirrors client-requested sizes to the offscreen buffer.

A second import patch memoizes asynchronous shader-compile completion. The
client uses `KHR_parallel_shader_compile` and polls
`glGetProgramiv(program, COMPLETION_STATUS_KHR)` in a loop; Chromium cannot
answer that from its client-side cache, so every poll flushes the command
buffer and waits on the GPU process. A recon session measured 36,713 polls
against roughly 250 programs in seven minutes.

Only completion is cached, and only once it reads true. False is the answer the
client is polling for a change in, so freezing it would leave the client
polling a program that never finishes; true is terminal until the next
`glLinkProgram`, which clears the entry, as does losing the WebGL context. The
cache tracks a program only while the host has seen it created and not deleted,
so a recycled name starts cold and a name from before install is never
recorded. Every other query passes through untouched, including
`GL_VALIDATE_STATUS` — evaluated against current GL state rather than the
program — and the link-derived pnames, which the client was measured asking
exactly once per program. A missing import disables the whole patch rather than
half of it, and the `gl.programQuery*` counters prove it is engaged against the
downloaded client.

The renderer also supplies focus, OSK fields, trusted-interaction audio resume,
fullscreen, trackpad-wheel normalization, and right-drag pointer lock.
`input.ts` owns the one canvas input policy. Mouse, trackpad, and Magic Mouse
clicks and drags pass through unchanged, and the host dispatches no input event
of its own except the releases below; there is no device mode and no input
setting. One held-input registry releases keys and buttons when focus or native
UI consumes an input release. Pointer lock uses a virtual cursor and recycles a
held drag so camera rotation does not stall.

Double-click is the client's own. Its mouse path carries a per-press
double-click flag from the input record through `FrMouse` to the widget under
the cursor, and ArenaNet's glue never writes it, because `MouseEvent.detail` is
not marshalled — `internal/upstream/mouse-double-click.md` holds the evidence.
The certified chain's last stage appends one exported mutable global and one
store to the mousedown callback, and `native-double-click.ts` writes Chromium's
click count into that global before each trusted press: every even click of a
run sets the flag, exactly as Windows raises `WM_LBUTTONDBLCLK`, and every
other press clears it. The widget goes on deciding what a double-click means,
which is the behaviour the Windows client has.

The host used to reach the same action by synthesising a pair of touch taps.
That path is gone rather than kept beside this one. A tap is not a hint: the
client warps the cursor to it, force-releases every captured button, switches
its pointer mode to touch, enters the drag machinery, and delivers a click of
its own — so a double-click cost four clicks instead of two, arrived 360 ms
late, and moved inventory items it was meant to use. An unrecognised client
build is served untransformed and simply has no double-click until it is
certified again; `tests/electron/input-pointer.spec.ts` refuses any touch event
so the mechanism cannot return as a fallback.

`input-trace.ts` is the instrument for the reports that path produces. Help →
Diagnostics → Show Input Trace draws a bounded live list of what the input host
saw — press with its click-run count and modifiers, release with the distance
it travelled, each modifier key transition, and each press the double-click
flag rode on, including the ones an uncertified client could not be told
about. It observes and never decides: every call site is on
a path whose behaviour is identical with the trace absent, and switching it off
discards what it held. It is not the diagnostics recorder — nothing crosses
IPC, nothing is written to disk, and the text the Copy button produces carries
distances and counts but no coordinate, so it can be pasted into a public issue
unread. `docs/user-guide.md` owns what a player is told about it.

That recycle is rare by construction. The client keeps integrating mouse moves
whose coordinates fall outside the canvas, so a held right-drag is free to roam
sixteen canvases before the host releases the button, re-anchors at center, and
presses again — several camera revolutions apart at any window size. Stopping at
the canvas edge instead, as the host first did, made the recycle rate inversely
proportional to the window: a 941px canvas recycled on about every third mouse
move against every twenty-fifth on an 1866px one. Both halves of that cost the
smaller window: the released button interrupts the client's drag, and until the
leftover delta was spent in the same task rather than the next animation frame,
each recycle also froze the camera for a frame.

That roam runs outward only. The client integrates a move whose coordinates sit
past the far edge of the canvas, but ignores one whose client coordinates are
negative, and resumes only once they come back — so the near side of the budget
is bounded by the window edge rather than by the sixteen canvases. Without that
bound a canvas flush against the window, which is how the game canvas is laid
out, spent half a canvas of leftward travel inside the window and the remaining
sixteen in a range the client discards: rotating right ran indefinitely while
rotating left froze after one flick and stayed frozen, because the re-anchor
that would have restored it sits sixteen canvases beyond where a hand ever
drags. Bounded at the window edge, the near side recycles about every half
canvas of travel — far more often than the far side, and the cost of keeping
every coordinate in the range the client accepts.

The client identifies a binding by layout-dependent `KeyboardEvent.key` rather
than physical `KeyboardEvent.code`. The input host converts every main-block
letter, top-row digit, and ANSI punctuation position to its unique fixed
unshifted US-layout character before the client sees it. A physical `KeyW` is
therefore `w` to the client under QWERTY, AZERTY, and macOS's Option layer alike;
bindings survive an input-source change, and a release cannot disagree with its
press. ISO/JIS-only and numpad positions retain the official client's behavior:
its key-only vocabulary has no proven collision-free physical identity for
them. Their release still reuses the character recorded at press time, so a
layout or modifier change during one hold cannot strand the key. The client's
Controls screen receives the canonical character and does not relabel it when
the input source changes.

The host stops each replaced event and dispatches exactly one normalized key
event in its place. Text fields are restated too, because the client relays
their key events to the canvas; stopping propagation without preventing the
default action lets the field type the layout-aware composed character while
game input sees the physical identity. Command is different — macOS withholds
the release entirely — and remains handled by releasing every non-modifier key
when Command comes up.

## Native sockets and DNS

The native socket manager owns all TCP handles. It permits only public-unicast
destinations and ports `6112`, `80`, and `443`, and closes an owner’s sockets on
reload, renderer loss, or quit. DNS accepts only approved ArenaNet/Guild Wars
suffixes and retains the raw DNS fallback needed for the `0.0.1.2` datacenter
sentinel.

Three ceilings bound one renderer: 64 sockets, 4 MiB queued on any single
socket, and 16 MiB queued across all of them together. The aggregate one is the
ceiling that matters — a per-socket limit alone leaves 64 × 4 MiB = 256 MiB of
main-process buffering reachable from one renderer. A send that would cross
either byte ceiling is refused before anything is queued, and the socket stays
open, so a refusal costs one packet rather than the connection. Owners are
accounted separately: a saturated renderer cannot spend, or free, another’s
budget.

Each write reserves its bytes before the write and releases them exactly once —
when the write callback runs, or at teardown for whatever the socket still
holds. Both halves are needed. A destroyed socket may never fire the callbacks
it owes, so teardown without reclamation leaks an owner’s budget until the
process exits; and a callback that arrives after teardown must not release the
same bytes twice, or the reclaimed budget is taken from sockets that are still
alive. After close, failure, renderer reload and quit, no owner holds any
reserved bytes.

Game socket payloads are views into WebAssembly memory. The renderer copies
each outbound view into a compact `Uint8Array` before crossing
`contextBridge`; otherwise Electron can serialize the view’s entire backing
memory for a packet only a few bytes long. Electron's compact IPC value is
written directly to the native socket without another `Buffer` copy. Main
still owns validation, backpressure, ordering, and the TCP write. Diagnostics reconcile logical,
source-backing, compact, IPC-backing, and written byte counts without recording
packet contents.

## Saved login

The generated glue requires all three credential methods. They cross a narrow
IPC boundary to one native `CredentialsStore`. A provisioned Release, Preview,
or Development package persists its validated `{ username, password }` JSON
in the fixed `arenaNetCredentials` slot of its private Data Protection Keychain
access group. The Objective-C++ boundary accepts only the three exact host
bundle IDs. Release preserves the existing service name; Preview and
Development use distinct service names and labels. The boundary uses
`kSecUseDataProtectionKeychain`, `WhenUnlockedThisDeviceOnly`, and a fresh
noninteractive `LAContext` for every operation. A read failure never deletes or
replaces an item; the failure is recorded without credential content and the
game prompts again. The native module classifies a refusal, and
`KeychainJsonStore` keeps that classification on the error it raises:
`keychain_locked` for an item the Keychain would only release with user
interaction, `keychain_unentitled` for a process with no application identifier
for the access group, and the secret's own `*_unavailable` code otherwise. The
underlying rejection is logged by classification and error name only and never
becomes an exported field.

Unpackaged development, ordinary local packages, and explicit packaged smokes
use `VolatileNativeKeychain`, so no unstable identity can claim a provisioned
item. `pnpm dev:signed` is the intentional persistent developer path. There is
no file, `safeStorage`, or mock-Keychain fallback. The first Release
hard-cutover startup attempts to delete exactly `credentials.bin` and
`steam-session.bin`; Preview, Development, volatile, and unmarked builds
preserve them. Settings,
window state, diagnostics, cached clients and chunks, and the `gw://app` IDBFS
origin are outside that operation. The cleanup is one-way because the retired
ciphertexts cannot be safely migrated without recreating the prompt it removes.

The cookie-encryption fuse is disabled so Chromium never initializes a separate
Safe Storage Keychain item. The game proxy drops `Cookie` and `Set-Cookie` in
both directions, and browser cookies are also cleared at startup and quit.

## Distribution identities and signing

The three identities use Team `9NN976MFZ4` and bundle IDs
`io.github.mat4m0.gwonmac`, `io.github.mat4m0.gwonmac.preview`, and
`io.github.mat4m0.gwonmac.dev`. Release and Preview use Developer ID profiles;
Development uses a device-authorized development profile. Every top-level
signature claims only its application identifier, team identifier, and JIT
entitlement; none adds Keychain Sharing, App Groups, App Sandbox, or
`get-task-allow`. Developer ID signing pins the G2 certificate fingerprint
rather than its non-unique display name.

Stable and Beta application updates both live inside the `release` identity.
`updateTrack` changes release eligibility only; it never changes the bundle ID,
profile root, Keychain authority, or updater. Preview remains a separately
signed tester identity with no AppUpdater access. Returning to an older Stable
is a manual app replacement through the fixed Releases page, never a second
updater or an automatic downgrade.

Forge accepts one closed packaging intent: local ad-hoc, Preview handoff,
signed Release, or signed Development. It generates `distribution-channel.json`
only for a signed package and runs a preflight before signing. The trusted
Preview signer adds the same canonical marker only after it has verified the
unsigned artifact. Forge rejects an unknown intent, ambiguous identity
name, unavailable certificate, certificate/profile mismatch, wrong Team ID or
application identifier, expired profile or certificate, and any top-level
entitlement outside the three-key allowlist. The marker selects behavior but
cannot grant Keychain access without Apple's matching signature and profile.

Snapshot verification builds an ad-hoc Preview package with no signing secrets.
A separate `snapshot-signing` environment job checks its commit and checksums,
checks out the immutable trusted signer commit recorded by the calling workflow,
imports signing material only after dependency installation and all target
build code have finished, signs and notarizes the app plus an upgrade fixture,
then removes the temporary keychain before executing continuity tests. Only
that signed and tested Preview ZIP reaches the snapshot publisher. Pull-request
artifacts remain ad-hoc and volatile. Manual branch snapshots can reach the
protected signer only when the workflow itself was dispatched from `main` for
an explicit commit and its `snapshot-signing-approval` deployment was approved.
The secret-bearing `snapshot-signing` environment itself is restricted to the
`main` deployment branch, which keeps automatic main snapshots noninteractive.
The published handoff records and checksums both the selected source commit and
the trusted signer commit.

## Steam login

The Steam credential is a **Steam OAuth2 access token**. There is no ArenaNet
token-issuance endpoint: the official client (Guild Wars Reforged, a Capacitor
app using Ionic Auth Connect) runs a standard OAuth2 implicit flow against
Steam, and the token Steam returns is handed straight to the game client, which
base64-encodes it into `<PasswordToken>` for `webgate/users/login.xml`. The
account service validates it there and maps it to the linked Guild Wars account.
`<LoginName>` on that request is the client's local profile index — `1` — not
the SteamID, which the account service derives itself and returns as
`<steamid>@steam`. The token is long-lived (the flow grants a year), portable
across devices, and replayed on every login until it expires.

So `login.getAuthToken` has two paths and no others. A silent launch-time probe
may replay a stored token. An explicit request discards a readable stored token
that already failed to get the player past the login screen and runs fresh
acquisition. `src/main/core/steam-oauth.ts` holds the flow as
configuration plus pure functions (authorize-URL construction, a fail-closed
origin allowlist, redirect matching, `state` verification, token extraction), so
all of it is unit-testable and the whole flow can be pointed at a local fixture
server offline.

Acquisition opens a `BrowserWindow` the main process owns and tears down. It has
its own in-memory session partition shared with nothing, no preload and no Node,
deny-by-default permission and download handlers, no popups and no webviews, and
top-level navigation confined to the derived allowlist. Subframes and resources
are not described by that navigation guarantee: Steam may embed third-party
content, and Chromium governs it with the sandbox, origin isolation, disabled
Node/preload, denied permissions, and popup/download denial. A subframe cannot
complete the top-level redirect event. That redirect is intercepted *before it
is fetched* — so the return URL is never requested and needs no proxy allowlist
entry — and its exact HTTPS host, port, and path plus its `state` nonce are
validated in one parser. The partition is cleared and the window destroyed
however sign-in ends: success, refusal, or cancellation. Cleanup has a fixed
deadline, after which destroying the unique in-memory partition remains the
final bound. The window is hidden the moment an attempt settles so cleanup
cannot present a blank page as a black application window.

**The window is a modal child, and the origin is not visible in it.** `modal` is
load-bearing: `src/main/window.ts` restores the game window to fullscreen, and a
plain parented child is promoted into that fullscreen space and sized to the whole
display, so sign-in fills the screen instead of appearing as a contained sheet.
`tests/electron/steam-acquire.spec.ts` pins the modal, parented, requested-width
presentation for that reason.

The cost is that a macOS sheet draws no title bar, so the live origin
`showOrigin()` writes — and the `page-title-updated` `preventDefault` that stops
the page renaming it — are **not visible in the configuration that ships**. Both
are kept because a parentless window (no game window yet) is an ordinary titled
window where they do apply, but the player cannot verify the origin by eye during
a normal sign-in. This is accepted rather than solved: what constrains the window
is the top-level allowlist plus the sandbox controls, not the player's
inspection.
`docs/user-guide.md` says so plainly instead of asking them to check a title bar
that is not there.

The token persists as `{ token, expiry }` in the fixed `steamSession` Data
Protection Keychain slot, under the same `KeychainJsonStore` mechanism but with
its own validator, so the credential store's shape rule is untouched. It is the
token's only persistent home; **no environment variable seeds it in any
build**. Silent resolution returns a stored unexpired token or nothing;
explicit resolution reacquires. An expired token is discarded; an unreadable
one is treated as absent but deliberately kept, because Keychain access can be
momentarily unavailable and deleting on that would throw away a credential
that still works. Neither failure fails the launch — both return the player to
the client's own login screen. The client's `storeAccountData`
storeback refreshes the stored expiry only when the value matches the token
already held, since which value it actually passes back has never been isolated
and persisting a session-resume token in place of the link token would overwrite
a working credential. Sign-out clears the local copy only; the account link is
managed on ArenaNet's surfaces.

Diagnostics for all of this are outcomes: token requested (`vended` / `absent` /
`acquired`), sign-in opened, sign-in blocked (`navigation` / `popup` /
`download` / `webview`), sign-in result (`success` / `cancelled` / `failed` /
`state-mismatch` / `no-token`), and the storeback outcome. The closed schema has
no field that could carry a Steam identifier, a token, or an expiry.

## Application lifecycle

Closing the single game window is an application quit. The close event is
converted to `app.quit()` before the renderer is destroyed, cleanup closes
sockets and background work, diagnostics flush their final lifecycle events,
and the process exits with status zero. Main-to-renderer events are dropped
once either the window or its `webContents` is destroyed. Renderer recovery is
reserved for unexpected loss while the application is not quitting.

The process acquires Electron's single-instance lock before it reads or sweeps
profile-owned files. A second launch exits and asks the primary process to
restore, show, and focus its existing window. That lock is what makes startup
cleanup of atomic-write temporary files safe: another live app process cannot
still own a foreign-PID temporary file in the same profile.
