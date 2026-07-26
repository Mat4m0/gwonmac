// What generate-preload.mjs splices above the preload body.
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
declare global {
  const IPC: typeof import("../src/shared/contracts.js").IPC;
  const RENDERER_INIT_ARGUMENT:
    typeof import("../src/shared/contracts.js").RENDERER_INIT_ARGUMENT;
  const ENHANCEMENTS: typeof import("../src/shared/contracts.js").ENHANCEMENTS;
  const WASM_BRIDGE_MARKERS:
    typeof import("../src/shared/contracts.js").WASM_BRIDGE_MARKERS;
}

export {};
