# Multi-OS and profile-management specification

Status: implementation in progress; public support remains gated below
Research cut: 2026-07-29
Audience: a mid-level developer implementing with AI-agent assistance
Execution plan: [plan.md](plan.md)

## 1. Decision summary

The best foundation is one Electron application with one trusted main process,
one verified ArenaNet client/cache runtime, and OS-native distribution and
credential protection at the edges. It is not a lowest-common-denominator
desktop abstraction.

The work has three independently releasable outcomes:

1. A portable, single-profile WASM client that is built and tested natively on
   macOS, Windows, and Linux.
2. A profile manager that keeps credentials and browser storage separate and
   initially launches one profile at a time.
3. At most two simultaneous game windows, only after storage, performance, and
   Guild Wars policy gates pass.

Packaging the current code is medium difficulty. Making three release-quality
products is high difficulty because the repository currently assumes one
macOS window, one Electron session, one credential file, macOS packaging tools,
and one macOS CI runner. Concurrent profiles are harder again: the current
IDBFS contains an approximately 919 MB `Gw.dat`, and each renderer already has
a large WASM/WebGL memory footprint.

A realistic engineering range for one developer with AI assistance is:

| Outcome | Expected effort | What the estimate excludes |
| --- | ---: | --- |
| Portable single-profile previews | 6–10 engineer-weeks | Signing procurement and hardware queues |
| Sequential profile manager | 5–8 engineer-weeks | A full `Gw.dat` migration |
| Two simultaneous profiles | 6–10 engineer-weeks after the feasibility gate | A new native/lazy filesystem |
| Release signing and native qualification | 4–8 engineer-weeks | Apple/Microsoft identity approval time |

The complete release-quality programme is therefore closer to 21–36
engineer-weeks than to a packaging script. AI can accelerate mechanical
refactors and test generation. It cannot replace real OS users, signing
identities, hardware qualification, or a policy decision from ArenaNet.

## 2. Product position

### 2.1 Why use the WASM client?

On macOS and Linux, the WASM client offers the clear product benefit: the
official game client runs without a Windows installation, Wine, DLL injection,
or a browser tab.

On Windows, ArenaNet's DirectX 9 client remains the compatibility and
single-account performance baseline. The WASM client should not claim to be
faster or more compatible. Its potential Windows advantages are:

- the same sandboxed host and diagnostics used on the other operating systems;
- isolated named profiles without plaintext account files;
- one consistent launcher experience across a player's computers;
- no DLL injection or copied Windows installations for account separation;
- one application-wide, verified, content-addressed download cache.

Those advantages justify a Windows preview. Windows general availability is
conditional on measured startup, frame pacing, memory, and network behaviour.
If the WASM build does not provide a useful, reliable alternative to the native
client, it remains a preview rather than acquiring unsupported marketing
claims.

### 2.2 Product-document hard cutover

The current [PRODUCT.md](../../PRODUCT.md) explicitly says:

- no Windows or Linux build; and
- no account features or multiboxing help.

Implementation must not begin under contradictory product rules. Phase 0
changes those two decisions in one hard cutover and updates
[README.md](../../README.md), [AGENTS.md](../../AGENTS.md),
[docs/internals.md](../../docs/internals.md), and
[docs/user-guide.md](../../docs/user-guide.md). It must retain these existing
non-goals:

- no automation, macros, input broadcasting, bots, or unattended play;
- no DLL/plugin injection;
- no redistribution of ArenaNet client binaries;
- no telemetry;
- no automatically installed application update;
- no unrequested network request.

The application remains single-instance at the OS-process level. “Multiple
accounts” means multiple owned `BrowserWindow` instances inside that one
process, never multiple competing application processes.

### 2.3 Policy gate for simultaneous play

The current [Guild Wars Rules of Conduct][gw-rules] prohibit bots, cheats, and
automation, but the researched public Guild Wars document does not provide a
specific first-game multiboxing rule. ArenaNet's published
[Guild Wars 2 multiboxing policy][gw2-multibox] is useful design guidance but
is not evidence for Guild Wars 1.

Sequential profile switching may ship after the product decision. The
production build must not contain simultaneous-launch behaviour until the
project has current written ArenaNet clarification for Guild Wars 1.
Regardless of that answer, the product permanently enforces:

- one physical input event reaches one focused game window;
- no input hook, broadcast, mirror, follow, or synchronized action;
- no manager action that plays, moves, targets, or uses a skill;
- no global hotkey that sends game input;
- no packaged automation bridge.

This is a code and package invariant, not a preference or hidden setting.

## 3. Supported platforms and distribution

### 3.1 Support matrix

| Target | Initial supported baseline | Primary public artifact | Credential posture | Status |
| --- | --- | --- | --- | --- |
| macOS | macOS 15+, Apple Silicon | Existing ZIP containing `.app` | Current preview uses mock keychain; Developer ID build uses Keychain | Existing preview, production identity later |
| Windows | Windows 11 x64 | Per-user Squirrel installer | Electron safe storage backed by user-scoped DPAPI | Preview, then signed general availability |
| Linux | Ubuntu 24.04 x64, GNOME Wayland | `.deb` | Secret Service/KWallet only; fail closed without a secure backend | Preview, then supported release |

Qualification also covers KDE Wayland and an X11 fallback on Linux, plus
integrated and discrete GPUs on Windows. They broaden evidence; they do not
silently broaden the documented support baseline.

Deferred until demand and native verification capacity exist:

- Intel macOS;
- Windows arm64;
- Linux arm64;
- Windows 10;
- RPM, Snap, Flatpak, AppImage, MSI, MSIX, and Microsoft Store distribution;
- 32-bit Windows and Linux.

Windows arm64 is specifically deferred because Electron does not provide the
same WASM trap-handler support there as on the initial targets. AppImage is
deferred because it adds another packaging toolchain rather than using an
Electron Forge maker already needed by the project.

### 3.2 Native build rule

Release candidates are built and exercised on their target OS:

- macOS on an Apple Silicon macOS runner;
- Windows on a Windows x64 runner;
- `.deb` on an Ubuntu 24.04 x64 runner.

Cross-building may be used for an experiment, never as release evidence. The
exact final installer/archive that passed packaged smoke tests is hashed,
attested, and published. A publisher job must not rebuild or modify it.

### 3.3 Signing and trust

Current macOS previews remain transparently ad-hoc signed and not notarized.
They continue to use Chromium's `use-mock-keychain` switch. The UI and release
notes say that saved login has weaker same-user protection. They never instruct
the player to disable Gatekeeper.

The long-term macOS cutover is one operation:

1. use a stable Developer ID Application identity and bundle identifier;
2. enable Hardened Runtime with only required entitlements;
3. sign all nested code;
4. submit with `notarytool`, inspect the log, and staple the ticket;
5. remove `use-mock-keychain`;
6. require preview users to enter a saved login once under the real Keychain
   provider.

Signing supplies the stable identity needed by Keychain. Notarization supplies
the Gatekeeper distribution decision. Both are release gates.

Windows previews may be explicitly unsigned. A public Windows release is
Authenticode-signed and timestamped with one stable publisher identity.
Microsoft's current [SmartScreen guidance][smartscreen] says that even valid
OV, EV, or Artifact Signing identities can initially be unfamiliar while
reputation accumulates. The product must never promise “no SmartScreen
warning,” and it must never ask users to disable Defender.

Linux `.deb` releases carry checksums, an SBOM, and provenance attestations.
The project must not claim repository/package signing until it actually owns a
package repository and signing mechanism.

### 3.4 Antivirus posture

The supplied GW Launcher notice normalizes antivirus alerts because that
launcher injects DLL mods and accepts plaintext `Accounts.json` data. This
project must take the opposite path:

- no DLL injection, TexMod loading, or arbitrary plugin discovery;
- no account email or password in a manager-owned JSON document;
- no assertion that antivirus warnings are “expected” or harmless;
- signed publisher identity where available;
- SHA-256, SBOM, source commit, and provenance for every release artifact;
- a documented false-positive reporting path that does not ask for disabled
  security controls.

An unfamiliar unsigned preview can still trigger an OS reputation warning.
That warning is described accurately; it is not used as evidence that the
artifact is safe.

## 4. Architectural principles

### 4.1 Ownership graph

The target is a small explicit composition, not a generic service framework:

```text
AppRuntime (one Electron main process)
├── ClientRuntime (one active ArenaNet client generation)
│   └── ChunkStore (one shared content-addressed cache; eight requests max)
├── SocketManager (one manager; handles owned by webContents)
├── DiagnosticRecorder (one closed-schema flight recorder)
├── AppSettingsStore (one global settings document)
├── ProfileStore (directory-backed profile metadata)
└── WindowRegistry
    ├── optional control window (no game runtime)
    ├── game window: profile A → session A
    └── game window: profile B → session B
```

The composition root remains [src/main/main.ts](../../src/main/main.ts), but
mutable ownership moves out of module globals. `AppRuntime` is an explicit
record/class with concrete dependencies and lifecycle methods. It is not a
dependency-injection container.

### 4.2 Global versus profile-owned state

| Application-global, one source | Profile-owned, isolated |
| --- | --- |
| ArenaNet active client and generation | Display label |
| Native artifacts, manifests, chunks, and boot-chunk index | Encrypted credential envelope |
| `dataStrategy` and application settings | Electron session/browser storage |
| Update/release-check policy | IDBFS, including profile `Gw.dat` |
| Enhancement selection and derived WASM | Window state |
| Diagnostic recorder and export | Runtime status, derived from registry |
| Socket manager implementation | Socket handles, owned by renderer ID |

`AppSettings` stays application-global in the first implementation. The game
already stores its own durable preferences in the profile's IDBFS. Splitting
render scale, touch mode, or enhancements per profile without a demonstrated
user requirement would create another source of truth.

### 4.3 Platform decisions, not a platform framework

Main derives a closed platform value:

```ts
type DesktopPlatform = "macos" | "windows" | "linux";
```

It places that value in the existing trusted renderer-init payload passed
through `webPreferences.additionalArguments`. Preload validates and freezes
it. Renderer code uses it only where behaviour genuinely differs, such as
macOS Option-key repair or platform wording. Security and profile identity
remain main-owned.

Do not add `IPlatformService`, a generic adapter registry, or speculative OS
capabilities. Use small direct functions for:

- packaged layout resolution;
- credential-provider policy;
- atomic replacement durability;
- window-state behaviour on Wayland;
- installer/signing verification.

## 5. Paths and profile persistence

### 5.1 Target layout

Refactor [src/main/core/paths.ts](../../src/main/core/paths.ts) into disjoint
`AppPaths` and `ProfilePaths`:

```text
userData/
  settings.json
  diagnostics/
  game/
    artifacts/
    chunks/
    compatibility/
    enhancements/
    ...
  profiles/
    <opaque-id>/
      profile.json
      credentials.bin
      window-state.json
      browser/
```

The `game/` tree remains in its existing location to avoid a multi-gigabyte
redownload. No profile create, rename, reset, or delete operation can address
that tree.

### 5.2 Profile identity

`ProfileId` is generated by main from at least 128 random bits and encoded as a
fixed lowercase filesystem-safe token. It is never derived from a label,
account name, email address, or character. The parser rejects:

- the wrong length/alphabet;
- separators, `.`/`..`, absolute paths, and NUL;
- Windows device names and trailing dot/space forms;
- unnormalised variants.

The directory name is the canonical ID. `profile.json` does not duplicate it:

```ts
interface ProfileDocumentV1 {
  formatVersion: 1;
  label: string;
}
```

Labels are trimmed NFC text, 1–40 Unicode scalar values, with control and bidi
override characters rejected. The uniqueness key is exactly
`normalisedLabel.toLowerCase()`; no locale-dependent comparison or confusable
guessing is introduced. They are private display text and never appear in
diagnostics, paths, partition names, resource-owner keys, or game window
titles.

There is no profile database and no duplicated catalog. `ProfileStore` scans
the small `profiles/` directory, validates each document, and sorts by label.
Ordering and grouping are non-goals for v1.

### 5.3 Durable operations

- Create writes a complete profile into a same-parent staging directory and
  publishes it with one atomic rename.
- Rename atomically replaces only `profile.json`.
- “Forget saved login” clears only that profile's credential file.
- Delete is refused while the profile is running. It writes a closed
  owner-only `trash-on-start` marker and requests an application restart.
  Before creating any profile session on the next start, main passes that
  profile root to Electron `shell.trashItem`. If trashing fails, the marker and
  profile remain and the manager reports a closed failure; it never falls back
  to a recursive permanent delete. Deferral avoids relying on Chromium having
  released every profile-session file handle, especially on Windows.
- Boot cleanup removes only recognised incomplete profile stages. It does not
  recursively sweep unknown profile content.

Profile runtime status is derived from `WindowRegistry`; it is never persisted.

## 6. Sessions, windows, and lifecycle

### 6.1 Session isolation

Each game profile uses:

```ts
session.fromPath(profilePaths.browser, sessionOptions)
```

The absolute browser path makes ownership inspectable, testable, and
recoverable. The session receives the existing secure `gw` protocol handler,
navigation restrictions, permission handlers, CSP, user agent, and download
policy through one direct `installGameSession(session, sharedDependencies)`
function.

Electron custom protocols are session-specific; the
[protocol documentation][electron-protocol] explicitly requires registering
the handler for a custom session. `gw://app/` stays the canonical game origin
inside every isolated session, so the renderer trust root and official glue do
not learn profile IDs.

The control window uses a non-persistent owned session and loads only packaged
manager assets. It never imports game glue, WASM, WebGL, game audio, image
streaming, or native sockets.

Whether Chromium HTTP cache is enabled for profile sessions is decided by the
Phase 0 performance spike. The native chunk cache remains canonical either
way. The code must not assume that disabling Chromium cache is free.

### 6.2 Window registry

`WindowRegistry` is the sole window/role/profile authority:

```ts
type SenderContext =
  | { kind: "control"; window: BrowserWindow }
  | {
      kind: "game";
      window: BrowserWindow;
      profileId: ProfileId;
      slot: number;
    };
```

It maps an exact live `WebContents` object and its ID to a record. A lookup
also verifies object identity so a reused numeric ID cannot inherit stale
ownership. Destruction removes the record before resources can be reused.

Rules:

- at most one control window;
- at most one game window for a profile;
- sequential phase: at most one game window globally;
- simultaneous phase: at most two game windows globally;
- creating the same profile twice focuses its existing window;
- no code selects `BrowserWindow.getAllWindows()[0]` as behaviour;
- commands always target an explicit registry record.

`slot` is an ephemeral number allocated per application launch. It may appear
in diagnostics; `profileId` and `label` may not.

### 6.3 Lifecycle semantics

The current “red X quits the application” invariant is deliberately replaced
when profiles ship:

- closing a game window flushes that profile, closes only its sockets, and
  closes only that window;
- closing the control window while games remain leaves the visible games
  running;
- if the last visible window closes, the application quits;
- a Quit menu/command closes every game after confirmation and exits cleanly;
- the official client's clean-exit request means “close this game window,” not
  “quit all profiles”;
- a second OS invocation focuses or recreates the control window;
- the app never remains as a zero-window background process.

Power-save blocking remains one app-global handle. A direct reconcile function
derives whether it is needed from the canonical download state and registry
game-window count; it is stopped when neither source requires it. Do not keep
an independent reference counter.

On Linux Wayland, the compositor owns position and focus. Restore size,
maximised/fullscreen state, and last normal bounds where the platform permits;
do not force XWayland or fight the compositor for exact `x/y`.

## 7. IPC and preload security

The existing narrow preload and sender validation remain the model.

`assertSender` changes from “is the singleton main window” to:

1. sender is the registered `WebContents` object;
2. event originates from its main frame;
3. URL is the exact canonical manager or game URL;
4. registry role is allowed for this channel.

The game-facing credential, storage, socket, and diagnostic IPC methods never
accept a `profileId`. They derive it from the registered sender.

| Capability | Control | Game |
| --- | ---: | ---: |
| List/create/rename/delete profiles | Yes | No |
| Launch/focus/close profile | Yes | Close self only |
| Global cache/update actions | Yes | Read status; settings UI may request existing actions |
| Credentials | No plaintext access | Own profile only |
| DNS/image/socket host | No | Yes |
| Game storage reset | Selected stopped profile only | Own profile through existing confirmed flow |
| Diagnostics export | Yes | Existing UI may request |
| Targeted performance capture | Selects running slot | Own slot only |

The manager's “add profile” form asks only for a label. The official game login
screen remains the only credential-entry UI. This avoids a second credential
model and avoids the plaintext `Accounts.json` pattern in the supplied
launcher example.

Preload may use one generated file with role-specific frozen namespaces, but
main IPC authorization remains authoritative. It must not expose a generic
`invoke(channel, payload)` surface.

## 8. Client generation, cache, and sockets

### 8.1 One shared client runtime

[src/main/client-runtime.ts](../../src/main/client-runtime.ts) and
[src/main/core/chunk-store.ts](../../src/main/core/chunk-store.ts) remain
application-global.

For any number of profiles:

- exactly one active client generation exists;
- concurrent reads for a content hash share one promise;
- demand work outranks queued prefetch;
- ArenaNet download concurrency remains at most eight application-wide;
- a second profile launch does not perform a second update check or duplicate
  already-resident chunks;
- profile deletion never deletes shared client content.

Creating one `ClientRuntime` or request pool per profile is forbidden.

### 8.2 Generation safety with live games

Multiple live renderers cannot safely execute different client generations.
The first implementation uses this direct gate:

1. ArenaNet client update/generation activation runs only while no game window
   is live.
2. An unconfirmed candidate generation permits exactly one qualification game
   window.
3. Existing first-frame/socket health evidence promotes that candidate.
4. Only a stable confirmed generation permits the second game window.
5. Update/retry is deferred while any game window is running.
6. Full-data download may continue during play only for the stable active
   generation and under the existing global scheduler.

This avoids a per-window generation state machine and split-brain rollback.

### 8.3 Socket ownership

The current [SocketManager](../../src/main/core/sockets.ts) already owns handles
by `webContents.id`. Keep one manager. On reload, crash, or destruction,
`closeAll(ownerId)` runs before registry ownership is released.

Cross-owner send/close is refused. Existing per-owner limits remain until
measurements prove an application-wide limit is needed; do not add another
scheduler speculatively.

## 9. IDBFS and `Gw.dat` feasibility gate

This is the largest technical risk.

[src/renderer/filesystem.ts](../../src/renderer/filesystem.ts) mounts one
auto-persisting `app:` IDBFS. [docs/internals.md](../../docs/internals.md)
records an approximately 919 MB `app:/Gw.dat`, an approximately 369 MiB WASM
linear memory, and restore-time browser/main and renderer peaks above 1 GiB.

Unsafe choices are forbidden:

- two renderers using independent IDBFS instances over the same database;
- copying Chromium storage directories by hand;
- promising shared `Gw.dat` without a concurrency proof;
- patching official glue or replacing IDBFS speculatively.

The correctness-first profile design gives each profile its own Electron
session and IDBFS. This can duplicate `Gw.dat` and its restore cost. The
product therefore makes no “one copy of all game data” claim. It may claim only
that the native verified chunk cache is shared.

Before profile implementation, an offline feasibility programme must measure:

- which IDBFS files are account-specific, user-authored, or reconstructable;
- incremental disk use for the second and third clean profile;
- restore time and peak/steady RSS for one, two, and three sessions;
- concurrent auto-persist behaviour and clean-close duration;
- whether Chromium HTTP cache changes duplicate storage or startup time;
- how much of a clean profile's `Gw.dat` can be rebuilt from resident shared
  native chunks and how much, if any, follows the user's normal launcher
  request;
- corruption/crash behaviour when one renderer dies during persistence.

Exit decisions:

- Sequential profiles may proceed if separate-session isolation is correct and
  its measured disk/startup cost is disclosed.
- Two simultaneous profiles proceed only if they pass the performance budgets
  in section 13 on the minimum qualification machine.
- If they fail, simultaneous support is blocked. A lazy/native filesystem
  replacement becomes a separately specified project with its own evidence.
  It is not smuggled into this plan.

## 10. Credential protection

### 10.1 Store contract

`CredentialsStore` becomes promise-based on every OS and returns closed
outcomes:

```ts
type CredentialRead =
  | { state: "absent" }
  | { state: "available"; credentials: StoredCredentials }
  | { state: "temporarily-unavailable" };
```

Corrupt, unsupported-provider, and I/O outcomes remain typed `AppError`
failures. Temporary provider unavailability is not corruption. Reads never
delete or replace ciphertext on failure.

The on-disk file is a versioned envelope with only closed metadata and
base64-encoded ciphertext:

```ts
interface CredentialEnvelopeV1 {
  formatVersion: 1;
  protection:
    | "mac-preview-mock-v1"
    | "os-safe-storage-v1"
    | "linux-keyring-v1";
  ciphertext: string;
}
```

It contains no username, profile label, account ID, provider error text, or
filesystem path. Saving validates plaintext, encrypts, writes atomically, and
only then replaces the prior envelope. If key rotation is requested, the
returned plaintext is re-encrypted and atomically published; decrypting twice
is not the rotation operation.

Existing raw preview ciphertext may be read once through the current provider
and rewritten as the envelope after a successful load. An unreadable legacy
file is preserved.

### 10.2 Provider policy

| Platform/mode | Implementation | User-visible statement |
| --- | --- | --- |
| macOS ad-hoc preview | Existing safe storage with `use-mock-keychain` | Saved login is encrypted locally but has weaker same-user protection; not Keychain-backed |
| macOS Developer ID | Async Electron safe storage using Keychain | Protected by macOS Keychain for this signed application |
| Windows | Async Electron safe storage using user-scoped DPAPI | Protected by the signed-in Windows account; same-user software is outside the guarantee |
| Linux | Promise-wrapped synchronous safe storage after checking backend | Remember Login is available only with Secret Service/KWallet; `basic_text` is refused |

Electron currently recommends its
[asynchronous safe-storage API][electron-safe-storage] on macOS and Windows
because it is non-blocking and supports key rotation. The documented Linux
async fallback does not expose enough provider identity to prove that a secure
keyring won. The first Linux release therefore uses the inspectable synchronous
backend behind an asynchronous application contract and refuses `basic_text`.
This is a deliberate, testable exception.

If Linux has no supported unlocked keyring, the game may accept credentials
for that session but “Remember Login” is unavailable. The app never silently
persists with a hard-coded key and never builds a custom master-password vault.

POSIX credential files are mode `0600`. Windows does not pretend POSIX modes
are a security boundary; DPAPI plus the user's profile ACL is the proof.

### 10.3 macOS production cutover

A Developer ID release expects `os-safe-storage-v1` and has no
`use-mock-keychain` switch. A preview envelope is preserved but not decrypted
under a second provider. The user re-enters and re-saves the login, which
atomically replaces it. There is no permanent dual-provider compatibility
path.

## 11. Diagnostics and privacy

There remains one application-wide recorder and one `.gwdiag` report.
The existing three protection tiers remain unchanged:

- closed-schema events are certified;
- Chromium/OS-authored text is pattern-scanned;
- Level 2 traces diagnose but do not prove performance gains.

Multi-window changes:

- maintain renderer clock offsets by exact `WebContents`;
- target a capture at one explicit game-window slot;
- accept renderer frame metrics only from that target during the capture;
- stop with a closed reason if the target dies;
- include aggregate main/GPU/cache/socket/process evidence as app-wide context;
- require other game windows closed or idle for a certification run;
- never record profile IDs, labels, account identifiers, titles, credentials,
  cookies, paths, packet contents, or headers.

Game window titles remain generic. A Level 2 capture requires the control
window to be destroyed before Chromium tracing starts, because that renderer
is the only browser surface that receives profile labels. If it cannot close,
capture does not start; it may be recreated after capture. This reduces the
private text available to the trace but does not upgrade pattern-scanned data
to a proof.

Replace the macOS `ditto` calls in
[src/main/diagnostics.ts](../../src/main/diagnostics.ts) and
[src/tools/diagnostics/common.ts](../../src/tools/diagnostics/common.ts) with
one audited portable streaming ZIP codec. The direct application surface is
`writeDiagnosticZip`; the tool surface is `readDiagnosticZip`. The archive:

- accepts only a closed filename set;
- bounds entry count, per-entry size, and total size;
- rejects absolute paths, traversal, duplicate names, links, and unsupported
  compression;
- writes to a same-directory partial and atomically renames the completed file;
- retains the current `0600` POSIX behaviour;
- is checked by an independent native extractor on every OS.

Select a maintained, license-compatible codec with a small packaged surface
and no unnecessary transitive dependencies. A bespoke ZIP implementation is
allowed only if the dependency review proves no maintained streaming codec
meets these bounds.

## 12. OS-native experience

### 12.1 Shared experience

Every OS gets:

- the same loading phases, data strategy, settings, and compatibility notice;
- a lightweight profile manager with Add, Rename, Launch/Focus, Close, Forget
  Saved Login, and Move to Trash;
- accurate running status derived from the registry;
- the official login screen as the credential-entry surface;
- native window state, fullscreen, pointer lock, audio-device handling, and
  high-DPI rendering;
- a manual update check and manual application replacement;
- no telemetry and no unrequested GitHub call.

The profile list is alphabetic in v1. Reordering, tags, groups, automatic
launch, and per-profile command-line arguments are non-goals.

### 12.2 macOS strengths

- real Keychain protection after the Developer ID cutover;
- notarized/stapled Gatekeeper experience;
- standard application menu and `Command` accelerators;
- macOS-specific Option/Command input repair;
- Apple Silicon qualification and existing Metal/ANGLE performance evidence.

### 12.3 Windows strengths

- per-user installer/uninstaller and Start menu integration;
- DPAPI bound to the signed-in Windows user;
- D3D/ANGLE on the platform where the native client provides a useful baseline;
- standard taskbar, snapping, DPI, audio-device, and fullscreen behaviour.

The installer is manual replacement infrastructure, not an auto-updater.
Squirrel startup events are handled before normal app composition and exit
quickly.

### 12.4 Linux strengths and constraints

- standard `.deb` install, desktop entry, icon, and uninstall;
- Secret Service/KWallet integration where the desktop provides it;
- native Wayland rather than globally forcing XWayland;
- X11 fallback qualification.

Exact position/focus restoration is best effort under Wayland. The manager
must not depend on focus stealing or arranging multiple windows at fixed
coordinates.

### 12.5 Input

[src/renderer/input.ts](../../src/renderer/input.ts) gates macOS
Option/Command repair on the trusted platform value. Windows/Linux receive
Chromium's native key semantics. Native tests cover:

- macOS Option, Command, dead keys, and non-US layout;
- Windows Alt, AltGr, Windows key, dead keys, and non-US layout;
- Linux Wayland/X11 Alt/AltGr, compose/dead keys, and non-US layout;
- focus loss, pointer lock loss, fullscreen, and stuck-key reset.

No input path enumerates or sends to another window.

## 13. Performance and maintenance budgets

### 13.1 What remains shared

Only immutable/native infrastructure is shared: client generation, verified
chunks, updater, diagnostics recorder, and socket implementation. Each game
window necessarily owns its WASM memory, WebGL context, renderer image cache,
audio graph, and IDBFS restore. The design does not pretend renderer memory is
shared.

The control window must not load game modules. A warm second profile must cause
zero client-update requests and no duplicate native chunk acquisition.

Do not add workers, utility processes, dynamic cache controllers, disabled
background throttling, or a replacement filesystem until a Level 1 capture
identifies the bottleneck. Electron's [performance guidance][electron-perf]
likewise starts with measurement and avoiding blocked main/renderer processes.

### 13.2 Baseline scenarios

Before refactoring, collect five clean Level 1 runs on each release-blocking
hardware class for:

- cold single game;
- warm single game;
- manager idle;
- second profile cold and warm;
- two visible game windows with each window focused in turn;
- one foreground and one background/minimised window;
- clean close after active IDBFS writes.

Record ready/first-frame time, frame p50/p95/p99/max, main/renderer/GPU
RSS/CPU, event-loop p95/p99/max, disk size and I/O, socket bridge timing and
backing amplification, cache coalescing, scheduler active/queued counts, and
close duration.

### 13.3 Release budgets

- Existing single-window frame gate remains: fail when both p95 and p99 regress
  by more than 2%, or p95 rises by more than 1 ms on the same machine.
- Single-window main and renderer peak RSS stay within 10% of the platform
  baseline unless a reviewed capture explains and accepts the change.
- Socket sync p95 stays at or below 1 ms; settle p95 stays at or below 8 ms;
  payload/backing amplification remains exactly 1.0×.
- ArenaNet HTTP concurrency is at most eight and one concurrent hash
  acquisition produces one fetch/read.
- Creating an empty profile copies no native artifact or chunk.
- A second warm game causes no application update request.
- Two-window foreground p95 and p99 do not regress by more than both 10% and
  2 ms absolute versus that machine's warm single-window median.
- A two-window 60-minute warm soak has no crash, no unresolved socket/write at
  shutdown, and no more than 64 MiB host-owned RSS growth from minute 15 to
  minute 60.
- The exact second-profile IDBFS disk cost is displayed/documented; there is no
  “shared game data” claim beyond native chunks.

No absolute FPS promise crosses machines or operating systems. Level 2 traces
locate causes; five clean Level 1 candidate runs establish a gain.

### 13.4 Maintenance policy

- Stay within Electron's supported stable-major window; schedule a packaged
  smoke qualification for every Electron major upgrade.
- Review OS baseline support and CI runner availability at least twice yearly.
- Keep one lockfile and use native runners rather than OS-specific dependency
  forks.
- Remove a superseded migration path after its documented compatibility
  release; do not retain permanent legacy/default-profile branches.
- Add a platform or package format only with a named owner, native test
  environment, artifact gate, and public support acceptance criterion.

## 14. Portable filesystem and package mechanics

### 14.1 Atomic documents

[src/main/core/atomic-file.ts](../../src/main/core/atomic-file.ts) retains the
same-directory write/fsync/rename algorithm.

- POSIX: apply the requested owner-only mode, fsync the file, rename, and fsync
  the directory.
- Windows: rely on the user profile ACL and encrypted payload, perform the
  replace without deleting the old file first, and use bounded retries only
  for documented transient sharing/antivirus errors.
- Unsupported directory-fsync behaviour is an explicit platform branch with a
  native failure-path test; it is not silently swallowed everywhere.
- Any failed replacement leaves either the prior complete document or the new
  complete document, never an absent/partial canonical path.

### 14.2 Packaged layout

One test/build-only `packagedLayout(platform, arch, outputRoot)` resolves:

- executable;
- resources;
- `app.asar`;
- icon/metadata location;
- fuse target.

Shared package assertions are platform-neutral. Info.plist/codesign,
PE/Authenticode, and desktop-file/DEB assertions remain explicit OS suites.
Do not scatter package-path `if` branches across tests.

### 14.3 Fuses

Apply fuses before signing on every target with Electron Forge's fuse plugin or
an equivalently central Forge lifecycle hook. The packaged test reads actual
fuse bytes from the final executable.

Required where supported:

- disable Run as Node;
- disable `NODE_OPTIONS`;
- disable CLI inspect arguments;
- enable only-load-from-ASAR;
- enable embedded ASAR integrity on macOS and Windows;
- disable extra `file:` privileges;
- preserve WASM trap handlers.

Do not claim ASAR integrity on Linux, where Electron does not provide the same
enforcement.

## 15. Migration

Profiles are a hard storage-layout cutover; a permanent legacy-profile special
case is forbidden.

The beta migration is:

1. Finish current atomic writes and ensure no renderer/session is open.
2. Create one generated profile labelled `Default`.
3. Atomically move the root credential envelope and window-state document into
   that profile, preserving unreadable ciphertext.
4. Use a bounded, typed legacy renderer to export only the user-owned IDBFS
   paths established by the Phase 0 inventory (initial candidates are
   `Templates/Skills` and `Templates/Equipment`).
5. Import those files into the new profile session and round-trip verify names,
   sizes, and hashes.
6. Start the new profile without copying `Gw.dat`. Its normal launcher path
   reuses resident shared chunks and follows the user's existing
   `dataStrategy` for anything absent; migration adds no network path of its
   own.
7. Write the typed user-owned export to a clearly named recoverable backup
   outside active profile discovery, then clear only the legacy `gw://app`
   origin through Electron's session API. Do not move or copy Chromium's
   storage directories.
8. Publish one migration-complete marker only after every required step passes.

The export has closed roots, filename/count/per-file/total-size bounds, no
links, no traversal, and chunked transfer so a large file does not cross
`contextBridge` as one buffer. If the inventory finds additional
user-authored paths such as screenshots or chat logs, Phase 0 must either add
them to the closed migration contract or explicitly document/export them
before cutover.

Fault injection after each durable step must prove idempotent resume. The typed
backup is not mounted as a runtime path. After one stable release and an
explicit product decision, remove the migration code and offer a confirmed
Move to Trash action for the backup.

## 16. Release pipeline and website

Create one canonical release-target document consumed by Forge/build scripts,
website release selection, tests, and a CI matrix setup job. It owns:

- target ID;
- Electron platform and architecture;
- public artifact format;
- filename convention;
- current public/preview status.

It does not contain secrets or workflow state. One validator rejects unknown
platforms, duplicate targets, ambiguous filenames, and unsupported public
combinations.

Every artifact receives a machine-readable manifest:

```ts
interface ArtifactManifestV1 {
  formatVersion: 1;
  sourceCommit: string;
  appVersion: string;
  electronVersion: string;
  targetId: string;
  platform: "darwin" | "win32" | "linux";
  arch: "arm64" | "x64";
  format: "zip" | "squirrel" | "deb";
  filename: string;
  sha256: string;
  signing:
    | "adhoc"
    | "developer-id-notarized"
    | "unsigned-preview"
    | "authenticode"
    | "linux-attested";
  ciRunUrl: string;
}
```

The release assembler requires the exact public target set, verifies all
hashes, and requires one source commit/version across the set. It then attests
and publishes those exact bytes.

Signing order is fixed:

1. build and flip fuses;
2. sign;
3. notarize/staple where applicable;
4. create the final installer/archive;
5. install or unpack that artifact;
6. run packaged smoke;
7. hash, SBOM, manifest, and handoff;
8. publish without rebuilding.

The website presents an explicit OS/architecture selector. Client-side OS
detection may recommend a choice but never hides the others or silently picks
an unavailable asset. Install guides and issue templates use OS-specific
wording. The application still checks GitHub only when the user opts in or
presses the existing manual action.

## 17. Verification model

### 17.1 CI matrix

| Gate | Ubuntu 24.04 x64 | Windows native x64 CI | macOS 15 arm64 |
| --- | ---: | ---: | ---: |
| Shared typecheck/lint/links/policy | One matrix setup/shared job | — | — |
| Build and unit tests | Yes | Yes | Yes |
| Integration tests | Yes | Yes | Yes |
| Offline Electron tests | Xvfb/X11 with sandbox | Yes | Yes |
| Native package/make | `.deb` | Squirrel | `.app` ZIP |
| Shared packaged smoke | Yes | Yes | Yes |
| OS-specific package/signing smoke | Yes | Yes | Yes |

Keep Playwright workers at one initially. Linux CI must retain the Electron
sandbox; `--no-sandbox` is not an acceptable green build.

Linux credential testing has two jobs:

- D-Bus plus a supported keyring;
- no supported keyring/forced `basic_text`, where persistence is refused.

Only offline synthetic traces/screenshots may be uploaded from CI. Never upload
downloaded game binaries, live user data, credentials, or diagnostic exports.

### 17.2 Acceptance catalogue

| ID | Required result | Executable proof |
| --- | --- | --- |
| MOS-P01 | Product docs permit the target OSes/profiles and still prohibit automation | Policy tests inspect canonical product claims and packaged automation surface |
| MOS-A01 | One `ClientRuntime`, `ChunkStore`, `SocketManager`, and recorder serve all windows | Unit composition test plus two-owner integration test |
| MOS-A02 | Registry, not window order or renderer input, owns role/profile | Unit negative tests and Electron cross-window IPC probes |
| MOS-D01 | Shared native cache is unchanged by profile CRUD; global concurrency is eight | Path tests, scheduler tests, concurrent-range integration |
| MOS-D02 | One stable client generation serves all live games | Candidate/update gating Electron tests |
| MOS-R01 | Profile A cannot read/write B credentials, IDBFS, cookies, state, or sockets | Unit, integration, Electron, and packaged relaunch tests |
| MOS-R02 | One profile cannot launch twice; initial simultaneous maximum is two | Registry and real manager Electron tests |
| MOS-C01 | Credential provider posture matches the OS table | Native credential matrix and packaged relaunch |
| MOS-C02 | Unavailable/corrupt/key-rotation outcomes preserve prior ciphertext | Fault-injected unit/integration tests |
| MOS-S01 | Every renderer stays sandboxed and every final executable has required fuses | Existing sandbox suite plus per-target packaged fuse read |
| MOS-S02 | One physical input is never broadcast | Structural package test plus real-hardware focus test |
| MOS-G01 | Startup reaches GitHub zero times when opt-in is off, regardless of window count | Extended offline Electron network fixture |
| MOS-X01 | Diagnostics contain no persistent profile/account data and target one explicit slot | Closed-schema tests, control-before-trace lifecycle, and two-window capture tests |
| MOS-X02 | `.gwdiag` is portable, bounded, atomic, and independently extractable | Adversarial unit tests plus native extractor on every OS |
| MOS-U01 | Closing one game preserves another; closing the last visible window quits | Electron and packaged process-lifecycle tests |
| MOS-M01 | Migration resumes after every injected failure and preserves user-owned files | Migration integration matrix with hashed fixtures |
| MOS-F01 | Single-window regression budgets pass | Five clean Level 1 baseline/candidate runs |
| MOS-F02 | Two-window budgets and 60-minute soak pass | Release-blocking real-hardware qualification |
| MOS-B01 | Final native artifact is the tested artifact with matching version/hash/manifest | Packaged smoke and release-assembler verification |
| MOS-B02 | OS signature/trust statement is exact, never stronger than evidence | macOS, Windows, and Linux OS-specific release tests |

### 17.3 Real-hardware release qualification

Minimum release-blocking machines:

- oldest and current supported macOS on Apple Silicon, including M1-class
  hardware;
- Windows 11 x64 on one integrated GPU and one discrete AMD/NVIDIA GPU;
- Ubuntu 24.04 GNOME Wayland with supported Secret Service;
- KDE Wayland and X11 Linux compatibility runs.

For each final artifact test clean install, upgrade, launch to first frame,
profile persistence, credentials, focus/input isolation, pointer lock,
wheel/mouse/trackpad where applicable, fullscreen, scaling, audio-device
change, sleep/resume, multi-monitor recovery, renderer crash, shared-cache
integrity, diagnostics export, clean close, and uninstall/data-retention
wording.

One deliberate live ArenaNet confirmation per OS is enough. Automated and load
tests remain offline.

## 18. Explicit non-goals

- Matching or replacing the DirectX 9 client on Windows.
- More than two simultaneous game windows in the first supported release.
- Input broadcasting, macros, launch-time actions, or unattended play.
- A credential editor or plaintext account catalog.
- Plugin, DLL, TexMod, or arbitrary command-line injection.
- A database, profile index, generic platform service layer, or per-profile
  `ClientRuntime`.
- Per-profile application settings in v1.
- Sharing mutable IDBFS between live renderers.
- A native/lazy Emscripten filesystem without a separate measured project.
- Automatic application installation/update.
- Flatpak/AppImage/RPM/MSI/Store packages in this programme.
- A promise that signing immediately removes SmartScreen reputation prompts.
- A promise that all game data exists only once.

## 19. Research sources

Primary references used for this specification:

- [Electron safe storage][electron-safe-storage]
- [Electron sessions][electron-session]
- [Electron custom protocols][electron-protocol]
- [Electron security checklist][electron-security]
- [Electron performance guidance][electron-perf]
- [Electron application distribution][electron-distribution]
- [Electron code signing][electron-signing]
- [Electron Forge makers][forge-makers]
- [Forge Squirrel.Windows maker][forge-squirrel]
- [Forge Debian maker][forge-deb]
- [Forge fuses plugin][forge-fuses]
- [Apple notarization][apple-notarization]
- [Apple Hardened Runtime][apple-hardened-runtime]
- [Apple code-signing requirements][apple-code-requirements]
- [Microsoft SmartScreen reputation][smartscreen]
- [Microsoft DPAPI `CryptProtectData`][windows-dpapi]
- [XDG Desktop Portal Secret][portal-secret]
- [Secret Service API][secret-service]
- [Node filesystem API][node-fs]
- [Guild Wars Rules of Conduct][gw-rules]
- [Guild Wars 2 multiboxing policy—context only][gw2-multibox]

[apple-code-requirements]: https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
[apple-hardened-runtime]: https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime
[apple-notarization]: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
[electron-distribution]: https://www.electronjs.org/docs/latest/tutorial/application-distribution
[electron-perf]: https://www.electronjs.org/docs/latest/tutorial/performance
[electron-protocol]: https://www.electronjs.org/docs/latest/api/protocol
[electron-safe-storage]: https://www.electronjs.org/docs/latest/api/safe-storage
[electron-security]: https://www.electronjs.org/docs/latest/tutorial/security
[electron-session]: https://www.electronjs.org/docs/latest/api/session
[electron-signing]: https://www.electronjs.org/docs/latest/tutorial/code-signing
[forge-deb]: https://www.electronforge.io/config/makers/deb
[forge-fuses]: https://js.electronforge.io/modules/_electron_forge_plugin_fuses.html
[forge-makers]: https://www.electronforge.io/config/makers
[forge-squirrel]: https://www.electronforge.io/config/makers/squirrel.windows
[gw-rules]: https://legal.guildwars.com/en/gw-rules-of-conduct-en.pdf
[gw2-multibox]: https://help.guildwars2.com/hc/en-us/articles/360013658134-Policy-Dual-or-Multi-Boxing
[node-fs]: https://nodejs.org/api/fs.html
[portal-secret]: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Secret.html
[secret-service]: https://specifications.freedesktop.org/secret-service/latest/
[smartscreen]: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
[windows-dpapi]: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
