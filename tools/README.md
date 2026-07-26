# wasm tooling

Operates on `Gw.wasm` / `Gw.jspi.wasm` as bytes. Nothing here needs the client
running: wasm code is immutable after instantiation, so the module bytes *are*
the running code, and every question about them can be answered offline.

Outputs land in `build/` and are gitignored — they are derived game binaries.

## Two facts that bite

**Constants use non-canonical, zero-padded LEB128.** `i32.const 0x102820`
encodes as `41 a0 d0 c0 80 00`, not the canonical `41 a0 d0 c0 00`, because
LLVM emits fixed-width relocatable encodings. Anything looking for a constant
must **decode**, not byte-match an encoded needle — searching for the canonical
form finds nothing, silently, and looks exactly like "never referenced". Three
analyses returned clean, plausible, entirely wrong zeroes before this was
caught.

**Code is not in linear memory.** A running module cannot read its own code
section; there is no address that reaches it. Scanning therefore happens over
the module bytes, never in-process.

## Scripts

### `wasmscan.py` — decoder and scanner
Full instruction decode (build 38,771: 17,600/17,600 functions, no failures).
Resolves string and assertion anchors to function indices, and byte patterns to
code offsets.

    python3 tools/wasmscan.py dist/Gw.jspi.wasm "!s_context"

Source paths are stored as `../../../../Gw/Ui/UiRoot.cpp` — relative prefix,
forward slashes — so Win32-form paths need normalising and tail-matching.

### Production targeted transform

The application and developer CLI share the TypeScript transformer in
`src/main/core/toolbox-transform.ts`. It accepts only an exact supported hash,
clones one selected function, inserts one typed dispatcher, and uses the
verified null table slot without growing the table:

    pnpm toolbox:transform -- dist/Gw.jspi.wasm build/Gw.toolbox.wasm

The former table-growth and all-functions detour experiments were removed.
They rewrote far more of the client than the production hook requires.
`src/main/core/client-module.ts` owns the production transform chain,
derived-cache validation, and atomic publication. The CLI invokes the same
pure byte transform directly for an explicit input and output.

### `gensyms.py` — symbol recovery
The module is stripped, but naming information survives: 219 imports and 44
exports carry real names, and all 850 source paths in `.data` are referenced
from code, so most functions can be attributed to the `.cpp` they came from.
Writes that into a standard `name` custom section, which Ghidra, `wasm-dis`,
`wasm-objdump`, Binaryen and Chrome DevTools all read.

Also emits `string_xrefs.csv` plus a Ghidra importer. Ghidra cannot derive those
xrefs itself: `i32.const 1052749` is just an integer, and code and linear memory
are separate address spaces, so nothing marks a constant as a pointer.

### `gwca_anchor_probe.py` — GWCA source-anchor survival

Compares `Scanner::FindAssertion(file, message, ...)` calls in a GWCA source
tree with strings and decoded references in a Guild Wars WASM build. It reports
which old file/assertion pairs still identify exactly one WASM function:

    python3 tools/gwca_anchor_probe.py path/to/GWCA/Source dist/Gw.jspi.wasm

This does not claim that the old function signature or structure layout still
matches. It is a triage tool for choosing re-derivation targets.

## Pipeline

    python3 tools/wasmscan.py dist/Gw.jspi.wasm "!s_context"
    python3 tools/gensyms.py dist/Gw.jspi.wasm build/
    pnpm toolbox:transform -- dist/Gw.jspi.wasm build/Gw.toolbox.wasm

## Toolbox workspace

    pnpm toolbox:doctor
    pnpm toolbox:recertify -- path/to/Gw.jspi.wasm
    GW_LIVE_SMOKE=1 pnpm toolbox:live -- --scenario target

`toolbox:doctor` is local-only. `toolbox:recertify` reports semantic hook and
table candidates without publishing a transformed client. The live runner is
cached-only unless `--allow-update` is explicitly supplied and supports at
most 16 typed scalar observations through `--observe`.
Its coordinator, fixed gameplay scenarios, and paired performance capture are
kept in separate modules under `scripts/toolbox-live/`.
