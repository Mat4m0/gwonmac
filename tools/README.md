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
Full instruction decode (17,596/17,596 functions, no failures). Resolves string
and assertion anchors to function indices, and byte patterns to code offsets.

    python3 tools/wasmscan.py dist/Gw.jspi.wasm "!s_context"

Source paths are stored as `../../../../Gw/Ui/UiRoot.cpp` — relative prefix,
forward slashes — so Win32-form paths need normalising and tail-matching.

### `wasmpatch.py` — table growth
Appends every function to the indirect table, so all 17,596 are callable and
hookable rather than the 4,681 that are address-taken. Also leaves growth
headroom, which a side module needs for its own function pointers; stock has
`min == max == 4682`, so `table.grow` fails outright.

Safe as a byte rewrite because it appends only. Adding an *import* would
renumber every defined function and would need a real rewriter.

### `wasmdetour.py` — static detours
Moves each function's body to an appended `gwca_orig_<f>` and replaces it with a
dispatcher reading a hook table in linear memory. Gives MinHook's
create/enable/disable/trampoline semantics, and unlike table redirection it
intercepts **direct** calls.

    python3 tools/wasmdetour.py in.wasm out.wasm --all

`--all` is deliberately target-agnostic: it dispatches every function uniformly
and encodes nothing about which ones matter.

Exports two globals so consumers read the layout off the binary rather than
compiling against generated constants: `gwca_hook_base` (mutable, the hook
table) and `gwca_orig_slot_base` (immutable, where the originals were parked).
Everything else — first function index, function count, table size, build_id —
is already readable from the module, so nothing needs baking in and a repatched
client needs no rebuild.

Measured: +1.05 MB (12.8%), boots the real client with zero page errors.

### `gensyms.py` — symbol recovery
The module is stripped, but naming information survives: 219 imports and 44
exports carry real names, and all 850 source paths in `.data` are referenced
from code, so most functions can be attributed to the `.cpp` they came from.
Writes that into a standard `name` custom section, which Ghidra, `wasm-dis`,
`wasm-objdump`, Binaryen and Chrome DevTools all read.

Also emits `string_xrefs.csv` plus a Ghidra importer. Ghidra cannot derive those
xrefs itself: `i32.const 1052749` is just an integer, and code and linear memory
are separate address spaces, so nothing marks a constant as a pointer.

## Pipeline

    python3 tools/wasmpatch.py  dist/Gw.jspi.wasm build/patched.wasm
    python3 tools/wasmdetour.py build/patched.wasm build/shared.wasm --all
    python3 tools/gensyms.py    dist/Gw.jspi.wasm build/
