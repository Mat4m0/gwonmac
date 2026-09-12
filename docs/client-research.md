# Client feature research

This page routes feature questions to existing examples and evidence. The
[feature development contract](enhancement-development.md#internal-feature-extension-contract)
owns implementation policy. [Compatibility](arenanet-compatibility.md) owns
runtime authority. Do not create another reader for an already accepted fact.

## Find the closest owner

| Need | Start here | Executable example |
| --- | --- | --- |
| Format or position an existing effect observation | [Effect timers](effect-timers.md) | [Snapshot and presentation tests](../tests/unit/companion-effect-snapshot.test.ts) |
| Position a persistent overlay without following changing icons | [Effect timers](effect-timers.md) | [Alcohol positioning in offline Electron](../tests/electron/alcohol-timer.spec.ts), using [corner positioning](../src/shared/corner-position.ts) |
| Extend map presentation | [Cartography](cartography.md) | [Compass ranges](../tests/unit/compass-range-indicators.test.ts) |
| Read a new native collection | [Friend-reader evidence](../internal/research/friend-reader-proof.md) | [Structural candidate tests](../tests/client-artifact/friend-table-evidence.test.ts) |
| Change a named command | [Feature development](enhancement-development.md) | Search `tests/` for `quick-item-move`, `travel`, or `character-switch` |
| Investigate a host/client defect | [Upstream evidence index](../internal/upstream/README.md) | Use the specific investigation's linked test |
| Draw inside the game frame | [Rendering evidence](../internal/research/world-rendering.md) | The retained probe is experimental, not a production rendering API |

Research documents can describe a stopped or superseded experiment. Follow the
current domain document and code for what ships; retain history as evidence.
The [workflow pilot outcome](../internal/research/agent-workflow-pilot.md)
records what this guidance and tooling have actually demonstrated.

## Inspect without building or starting the game

Run from the intended checkout after normal dependency setup:

```sh
pnpm certification doctor
pnpm certification inspect
pnpm certification inspect /path/to/Gw.jspi.wasm
pnpm enhancements:live --list
pnpm enhancements:live --describe effect-observer
```

`doctor` reads the local profile. `inspect` validates and inventories module
imports, exports, memory, and tables without instantiating game code. It reports
the selected bytes' hash, unverified provenance, and no runtime authority. It
accepts local files up to 64 MiB; missing, changed-size, malformed, or unsupported
input refuses explicitly. A cached path does not prove official origin.

Scenario discovery projects the actual scenario definitions: name, tier,
program, and readiness. It neither builds nor imports Playwright or acquires a
live capability. An actual live run retains the documented opt-in, preflight,
and build. Follow [startup and session ownership](development-workflow.md#start-and-hand-off-a-development-app)
before running it. Do not use a live run just to discover what scenarios exist.

Inspection is a module inventory, not a semantic function map. For string,
assertion, and message-builder candidates, use [WASM tools](../tools/README.md).
Decode LEB128 constants; do not assume a canonical byte encoding. Code is in
module bytes, not in the client's linear memory.

The certification CLI executes current TypeScript through the existing loader.
Its transforms do not require compiling the app first. Building the app and
freestanding kernels remains necessary before launching changed application
code; the normal build and live commands own that preparation.

## Reference sources

Locate clones explicitly; do not recursively search every sibling worktree.
These are the local reference locations inspected on 12 September 2026,
relative to this checkout's parent. Locations are suggestions, not dependencies.
Check their current revision and availability before relying on them.

| Location | Inspected revision | What it supplies / limits |
| --- | --- | --- |
| `../GWToolboxpp` | `baaaf0de5` (30 August 2026) | C++ feature implementations, newer GWCA declarations, and a WASM experiment. Native rendering APIs do not transfer to WebGL. |
| `../GWToolboxpp/Dependencies/GWCA` | Same Toolbox revision | Headers, libraries, and `wasm/gwca.wasm`. The inspected `source` has only two WASM support headers, not the full private implementation. |
| `../GWCA` | `e1bc303` (14 November 2023) | Historical native implementation. Use algorithms, assertions, and call relationships as leads; re-derive WASM layouts and signatures. |

Useful Toolbox search targets include `AlcoholWidget`, `PconsWindow`,
`RangeRenderer`, `GameWorldCompositor`, and `Wasm/main_wasm.cpp`. Record the
actual source revision with a finding rather than treating this table as a
promise that the source has not changed.

WASM functions have typed signatures and table relationships. Native addresses,
function indices, shader/program IDs, and offsets are not cross-build identity.
Use relationships to locate candidates and the current verifier to establish
capabilities. Generated `func_N` and source-file names are search aids, not proof
of recovered semantics. Do not transfer a whole Toolbox/GWCA runtime to avoid
proving the one required behavior.

## Retain a useful finding

For expensive discoveries the existing [investigation format](../internal/upstream/investigation-template.md)
provides useful fields; adapt it to the question rather than filling a template
for every edit.
Record meaning, source revision, input hash, evidence, tested boundary, rejected
hypothesis, and the next unanswered question. Update the domain document when
behavior becomes current; link its research evidence rather than copying it.

Keep generated analysis and private traces outside tracked source. Rebuild
analysis from the exact input. Refresh only when the relevant code changes;
use the existing official-client acquisition path, not a second updater.

When resuming a long investigation, check the current checkout, artifact identity,
and last unresolved question before repeating a scan. Retain working commands
and evidence paths in the existing investigation record, not another handoff file.

Ghidra/ReVa is optional when existing tools cannot answer a named question.
Verify support on the exact WASM and tool versions before investing in analysis.
A decompilation or matching assertion is candidate evidence; neither proves
live behavior. Keep durable annotations tied to their input hash.
