# Hero-panel observation archive

This archive preserves the difficult, live-measured hero-panel observer removed
from the production companion kernel during the `team-builds` finish pass.

- Original paths: `src/companion-kernel/toolbox.rs`,
  `src/companion-kernel/abi.rs`, and `src/renderer/companion-snapshot.ts`.
- Last production source: the working tree immediately after commit `f3ca846`.
- Proof level: the exact build 38,797 UI messages `0x100001a3` (hide) and
  `0x100001a4` (show) were observed and covered by the kernel integration test.
- Why retired: panel visibility is not part of a saved or applied team. Keeping
  it in the runtime created state and callback work with no product consumer.
- Build status: deliberately excluded from production TypeScript/Rust modules,
  package inputs, runtime exports, and coverage.

To restore it, first define a player-facing requirement that needs panel
visibility. Reintroduce the state as a new companion/toolbox ABI, restore the
focused adversarial test from `observer.rs`, and re-certify both UI messages
against the exact supported client before exposing the value.

