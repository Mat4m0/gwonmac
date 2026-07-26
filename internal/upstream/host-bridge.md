# The host bridge

What we ship to work around the defects in
[upstream-defects.md](upstream-defects.md).

## Shape

Two halves, one contract:

| Half | File | Job |
| --- | --- | --- |
| Main | [`src/main/core/template-save-compat.ts`](../../src/main/core/template-save-compat.ts) | derive one module from the certified official hash |
| Renderer | [`src/renderer/template-save-compatibility.js`](../../src/renderer/template-save-compatibility.js) | answer the derived module's calls against the mounted IDBFS |

Selection and caching live in
[`template-save-client.ts`](../../src/main/core/template-save-client.ts) and
[`client-runtime.ts`](../../src/main/client-runtime.ts). Installation is
[`harness.js`](../../src/renderer/harness.js) inside `Module.instantiateWasm`,
before instantiation, so the import object can be wrapped.

## Why a derived module at all

The client never reaches a syscall for four of the five operations, and imports
no `mkdir`, `getdents` or `unlink`. The fifth does reach a syscall, but with
flags we cannot distinguish from a legitimate create. There is no
JavaScript-only fix in either case: these are internal WebAssembly functions, so
the module bytes have to change.

## How the transform works

For the certified input hash only:

1. **Append** one forwarder per bridged routine to the type, function and code
   sections. Appending leaves every existing function index valid, so nothing
   else in the module changes meaning. Each forwarder reuses its target's own
   type index.
2. **Repoint** the specific call sites listed in
   [client-internals.md](client-internals.md#the-broken-routines-and-their-call-sites)
   at the forwarders. The `call` immediates use LLVM's 5-byte padded encoding,
   so the replacement is the same width and no body length changes.
3. **Leave the target bodies intact.** Callers we did not certify keep exactly
   today's behaviour — which matters for `MdlDecomp.cpp` and `MdlTex.cpp`, which
   also call 416 and currently take a working fallback branch, and for the load
   path and the write call that still use the real `File::Open`.

Each forwarder hands its arguments to `__syscall_newfstatat` (import 207) behind
a dirfd no real call can produce:

```wasm
;; ensureDirectory(path, recursive) -> errno
i32.const -70001
local.get 0        ;; path
i32.const 0
local.get 1        ;; recursive
call 207
```

`__syscall_newfstatat` was chosen because it already exists, takes four `i32`
arguments and returns one, and its first argument is a directory descriptor —
`AT_FDCWD` (-100) or a real fd, never our markers. Ordinary calls pass through
untouched.

### Markers

| Marker | Operation |
| --- | --- |
| `-70001` | ensure directory |
| `-70002` | find files |
| `-70003` | entry name |
| `-70004` | delete file |
| `-70005` | does this file exist |

Neither half holds them by hand any more. `WASM_BRIDGE_MARKERS` in
`src/shared/contracts.ts` is the one source: the transform imports it, and the
renderer — a sandboxed module that may not reach the main process — receives it
through the preload that `scripts/generate-preload.mjs` produces. They used to
be two copies, and drift would have silently turned every bridged call into a
real `stat`.

Renaming needs no marker of its own: the client implements it as
write-the-new-name followed by delete-the-old, gated by the existence probe.

### Failing closed

`rewriteTemplateSaveWasm` rejects, in order: an unexpected input hash, a stub
whose body is not byte-for-byte what we certified (where we certify one — the
`File::Open` bridge fronts a real implementation, and there the call site's own
target index is the certification), a call site that does not
contain the expected `call`, an output hash that differs from the pinned one,
and a module that fails `WebAssembly.validate`. Any failure falls back to the
untouched official module. A new client build therefore degrades to "templates
broken again", never to a corrupted client.

The derived module is cached under `game/compatibility/<input hash>/<abi>/` and
is rebuildable from the official artifact at any time.

## Bridge contract

### ensure directory

`(path) -> errno`, 0 on success. `FS.mkdirTree` on the normalised path.

### find files

`(pattern, out, flags) -> 0`

- split the pattern at its last `/` into directory and glob; `*` and `?` match
  within one component, case-insensitively
- include an entry when `FS.isDir(mode) ? (flags & 2) : (flags & 1)`
- sort by name, for a stable list
- allocate `count * 544` bytes with **the client's own `malloc`**, because the
  client frees the block; take every heap view *after* the allocation, since it
  can grow memory
- zero the 24-byte header, write the name (with extension) at +24
- publish `entries` at `out+0` and `count` at `out+8`

An entry the mount cannot describe is skipped rather than failing the listing —
the client has no way to report a partial read.

### entry name

`(path, dst, chars) -> written`

Returns the client's internal record form: a leading `\`, backslash separators,
**extension removed**.

Removing the extension here is not tidiness. The client calls
`Path::RemoveExtension` on this result and that function is off by one (defect
5), so anything with an extension loses its last character. Handing it a bare
name leaves it nothing to trim. If ArenaNet fixes defect 5, this stays correct —
stripping an absent extension is a no-op.

### delete file

`(path) -> deleted`, **non-zero on success** — that is what the caller reads.
`FS.unlink` on the normalised path.

### does this file exist

`(path) -> exists`

The one bridge that fronts a working function rather than replacing a stub.
`#9757`'s no-overwrite probe calls `File::Open(path, 1)` to ask whether a
rename's destination is taken, and mode 1 creates the file (defect 6). The
forwarder asks the host first and only calls the real `File::Open` when the file
is genuinely there:

```wasm
i32.const -70005
local.get 0
i32.const 0
i32.const 0
call 207           ;; newfstatat -> 1 exists, 0 absent
if (result i32)
  local.get 0
  local.get 1
  local.get 2
  call 771         ;; the real File::Open, so the caller gets a real handle
else
  i32.const 0
end
```

Returning a handle rather than a boolean matters: the caller passes the result
to `Handle::Release`, which asserts on null.

An undecidable path answers "exists", which refuses the rename rather than
silently overwriting a template.

Only the probe is repointed. The write call at `9538+226` and the load path in
`#9753` keep the real function untouched.

### Path normalisation

Applies to every operation:

1. backslashes to forward slashes
2. collapse runs of separators — the client produces `Templates/Skills/\Test.txt`
   on every file operation against a listed template
3. strip leading and trailing separators
4. drop an `app:/` prefix
5. reject the path if any remaining segment is empty, `.` or `..`

Step 5 keeps the client inside its own mount. Step 2 has to come first: without
it the doubled separator produces an empty segment and step 5 rejects a
perfectly ordinary path. That cost us a round on delete and rename.

## Invariants

- The official module stays canonical on disk; only the derived copy is
  transformed, and only for an exact hash.
- Function bodies are never modified, only call sites — so uncertified callers
  are untouched.
- The bridge stays inside the renderer: no IPC, no `fetch`, no native bridge.
  Asserted in `tests/policy/source-wasm-host.test.mjs`.
- The listing block comes from the client's allocator.
- Bump `TEMPLATE_SAVE_TRANSFORM_ABI` whenever the derived bytes or the bridge
  contract change; it is part of the cache key.

## Diagnostics

`GW_TEMPLATE_FS_TRACE=1` on an unpackaged build sets `templateFsTrace` in the
renderer init payload and enables two console-only traces:

- `[template-fs-trace]` — the syscall wrappers, from
  [`template-filesystem-trace.js`](../../src/renderer/template-filesystem-trace.js)
- `[template-fs-bridge]` — the bridge itself: which marker fired, how many
  entries were listed and matched, whether the block was published, and each
  outcome

Both record counts and outcomes only — no filename, path or content — and
neither crosses IPC or appears in `.gwdiag`. Normal launches are unaffected.

```bash
GW_TEMPLATE_FS_TRACE=1 ELECTRON_ENABLE_LOGGING=1 \
  "…/Guild Wars.app/Contents/MacOS/Guild Wars" 2>&1 \
  | rg --line-buffered 'template-fs'
```

Reading a trace:

| Shape | Meaning |
| --- | --- |
| only `installed` | the client never asked — the operation fails before the bridge |
| `"listed":-1,"failed":…` | `FS.readdir` rejected the directory |
| `"listed":N,"matched":0` | directory reads, the glob or the kind filter is wrong |
| `"published":true` | the host handed over a correct list; any remaining failure is past the bridge |

A trace that filters cannot prove absence. The first version of the syscall
trace only recorded paths it recognised as template paths, and its silence was
read as "no filesystem activity at all" — see
[investigation-log.md](investigation-log.md).
