# Completed engineering programs

This directory keeps short records of expensive work that must not be repeated
without new evidence. These records are not current architecture or future
plans.

Use the current documents first:

- [Process model](../../docs/process-model.md)
- [Content pipeline](../../docs/content-pipeline.md)
- [WASM host](../../docs/wasm-host.md)
- [Diagnostics](../../docs/diagnostics.md)
- [Enhancement development](../../docs/enhancement-development.md)
- [Release verification](../../docs/release-verification.md)

Exact current behavior belongs to code and tests.

## TypeScript cutover

The repository completed its TypeScript cutover in July 2026. A small set of
JavaScript files remains because the runtime or build tool requires their exact
form.

Do not repeat these mistakes:

- Do not let a type-check command write build output.
- Do not let the main TypeScript project compile renderer files with Node.js
  libraries.
- Use `import type` for code that Node's type stripper executes.
- Keep the classic renderer host as a script. Generated Emscripten glue
  redeclares the global `var Module`.
- Keep every source and test file inside a checked TypeScript or lint project.

The current TypeScript configs and policy tests own these rules.

## Saved-login cutover

The app replaced encrypted credential files and Electron `safeStorage` with two
fixed Data Protection Keychain items. One item stores ArenaNet credentials. One
item stores the Steam session.

The hard cutover was intentional:

- Release, Preview, and signed Development use separate bundle identities and
  separate Keychain access groups.
- Unprovisioned builds keep secrets only in memory.
- The app has no file, mock-Keychain, or second persistent fallback.
- The old credential files are obsolete. Do not restore a migration reader.
- A signed package must prove its profile, entitlements, signature, and
  Keychain behavior before release.

See [Process model](../../docs/process-model.md) for the current boundary.

## Diagnostics and crash evidence

The project considered hosted crash services, raw dumps, console capture,
screenshots, and a second incident journal. It rejected them.

The retained design uses the existing bounded flight recorder and one local
diagnostics ZIP. A player decides whether to share it. An abnormal prior
session can be included without collecting raw memory.

Do not add a new crash pipeline until the closed local record cannot answer a
specific reproduced defect. Never weaken the privacy schema to make a report
more convenient.

## Client certification and patch day

The project tested a remotely delivered certificate-feed design. It deleted
that design because it created another runtime authority without a reliable
operational recovery benefit.

The durable result is:

- one `pnpm certification` command;
- one scheduled ArenaNet change detector;
- compiled exact-build Enhancement facts;
- one bounded isolated local proof for derivable template repairs; and
- the verified official client as the refusal path.

Detection can propose a change. It cannot authorize runtime behavior.

## Tools and client integration

The project studied broad GWToolbox++ parity, a generic plug-in host, shared
memory engines, map overlays, hero automation, and generic game commands. The
product rejected those broad surfaces.

The costly research produced these durable rules:

- Port player outcomes, not the Windows injection architecture.
- Prefer passive observation to invocation.
- Recover call neighborhoods and types before you recover values.
- Decode WebAssembly values. Do not byte-match one encoding.
- Add one bounded snapshot field or one named command at a time.
- Verify every command through fresh game-owned readback.
- Keep the companion pointer-free at its host boundary.
- Keep Build and Team data in the host.
- Refuse live integration on an unknown build or unsupported region.
- Do not expose raw memory, packets, pointers, generic calls, or generic writes.

Team Apply is the only approved multi-step game configuration workflow. It is
explicit, bounded, reversible where possible, and limited to supported PvE
outposts. This decision does not authorize general automation.

Detailed upstream facts that still matter are under
[`internal/upstream/`](../upstream/).

## Refactor program

The 2026 architecture program tested several larger designs and rejected the
ones without a demonstrated second consumer. The final system did not add a
generic GameHost, startup coordinator, feature registry, compatibility
framework, remote certificate authority, second updater, or renderer rewrite.

The retained ownership is direct:

- `ActiveClientSlot` owns the published client generation.
- `ClientRuntime` owns activation and recovery.
- `PatchClient` owns verified ArenaNet acquisition and staging.
- `AppUpdater` owns application update state.
- Settings actions own their multi-step workflows.
- IPC validates and forwards.

Do not reopen this program because a file is large. Reopen one boundary only
after a reproduced ownership defect or a second real consumer exists.

## Stable and Beta rollout

Stable and Beta use one Release identity. Beta is a preference, not another
application. A Stable enabler must own a durable key and accepted value before
a public candidate writes it.

The application never performs an automatic downgrade. A failed public
candidate is corrected with a higher version. Do not replace published assets.
The latest Stable must read, modify, and write candidate data before the
candidate can ship.

See [Release verification](../../docs/release-verification.md) for the current
procedure.

## Retired planning files

The local planning tree was removed in August 2026. It contained completed
implementation diaries, speculative roadmaps, duplicated evidence, and stale
build facts. The current documents, tests, source history, and this archive now
hold the durable results.

Create a new plan only for approved work with a concrete outcome. Delete it
when the work is complete and its lasting rules have moved to their owner.
