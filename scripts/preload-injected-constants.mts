// What generate-preload.ts splices above the preload body.
//
// `PRELOAD_CONSTANTS` names four canonical exports and the generator emits one
// `const` per name at the top of build/preload/preload.cjs, so the body reads
// them as ordinary file-scope bindings it must never declare — a second
// declaration would be a redeclaration SyntaxError in the generated file.
// Declaring them here is what lets src/preload/preload.body.cjs be type-checked
// against the real contracts instead of not at all, and typing them as the
// contracts' own exports keeps src/shared/contracts.ts the single source: a
// channel that changes shape there fails at the preload's use site.
//
// This lives beside the generator rather than beside the body because
// tsconfig.json includes all of `src`, and a global `IPC` visible to the main
// process would let a file there use the name without importing it.
//
// It is a `.mts` and not a `.d.mts` because tsconfig.tests.json sets
// `skipLibCheck` — third-party declarations do not compile under this
// project's strictness — and that flag skips this repository's own
// declaration files too. As a `.d.mts` a stale reference here resolved to
// `any` in silence, which turned every checked use of `IPC` in
// src/preload/preload.body.cjs into no check at all. Nothing imports this
// file and nothing emits it; `declare global` works the same in either.
declare global {
  const IPC: typeof import("../src/shared/contracts.js").IPC;
  const RENDERER_INIT_ARGUMENT:
    typeof import("../src/shared/contracts.js").RENDERER_INIT_ARGUMENT;
  const TOOLBOX_TOOLS: typeof import("../src/shared/contracts.js").TOOLBOX_TOOLS;
  const WASM_BRIDGE_MARKERS:
    typeof import("../src/shared/contracts.js").WASM_BRIDGE_MARKERS;
}

export {};
