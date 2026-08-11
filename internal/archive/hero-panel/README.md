# Hero-panel observation archive

> **Status: retired and non-normative.** Current Tools behavior is defined by
> [WASM host](../../../docs/wasm-host.md). This archive prevents a deleted,
> no-value callback path from returning by accident.

The removed observer was last present after commit `f3ca846`. For exact client
build 38,797, live measurement identified UI message `0x100001a3` as Hide Hero
Panel and `0x100001a4` as Show Hero Panel. The kernel integration test covered
both messages. The preserved source is [observer.rs](observer.rs).

Panel visibility was not part of a saved or applied team. The observer added
state and callback work without a product consumer, so it was removed from
production source, package inputs, runtime exports, and coverage.

Do not restore it without a player-facing requirement. If that requirement
appears, re-certify both message IDs for the exact supported client and restore
the focused adversarial test before exposing the value.
