# Template host-bridge evidence

> **Status: implemented workaround; historical detail.** Current code and
> [WASM host](../../docs/wasm-host.md) define runtime behavior. This file keeps
> the contract details and failed-path lessons needed to inspect a refusal.

## Conclusion

The official client does not import the filesystem operations needed to repair
template management from JavaScript. gwonmac therefore derives a module for an
exact certified client hash and routes only the proven broken call sites to a
renderer-local filesystem bridge.

The official module remains canonical on disk. If any proof fails, gwonmac uses
the untouched official module. The game remains playable and the unproven
template capability becomes unavailable.

## Owners

| Owner | File | Responsibility |
| --- | --- | --- |
| Main process | [`template-save-compat.ts`](../../src/main/certification/template-save-compat.ts) | Verify the exact input and derive one module. |
| Renderer | [`template-save-compatibility.ts`](../../src/renderer/template-save-compatibility.ts) | Answer bridge calls against the mounted IDBFS. |
| Composition | [`client-module.ts`](../../src/main/certification/client-module.ts) and [`client-runtime.ts`](../../src/main/client-runtime.ts) | Select and cache the derived module. |
| Installation | [`harness.ts`](../../src/renderer/harness.ts) | Wrap imports before WebAssembly instantiation. |

## Why the module bytes change

Four client routines are stubs. The client never reaches a syscall for them and
imports no `mkdir`, `getdents`, or `unlink`. The fifth routine reaches `openat`,
but its broken flags are also valid for a real create. A JavaScript wrapper
cannot distinguish those calls.

## Transform

For a certified input hash, the transform:

1. Appends one forwarder for each bridge operation. Existing function indices
   keep their meaning.
2. Repoints only the call sites listed in
   [client-internals.md](client-internals.md#the-broken-routines-and-their-call-sites).
3. Leaves the original target bodies and all unapproved callers unchanged.

The selected calls use LLVM's five-byte padded index encoding. The replacement
has the same width, so no function body length changes.

Each forwarder calls `__syscall_newfstatat` import 207 with a directory
descriptor that no real call can produce. A normal call uses `AT_FDCWD` (-100)
or a real file descriptor. These markers are outside that space:

| Marker | Operation |
| --- | --- |
| `-70001` | Ensure a directory. |
| `-70002` | Find files. |
| `-70003` | Derive an entry name. |
| `-70004` | Delete a file. |
| `-70005` | Test whether a file exists. |

`WASM_BRIDGE_MARKERS` in `src/shared/contracts.ts` is the one source of truth.
The transform imports it. The generated preload supplies it to the sandboxed
renderer. Two copies previously risked turning a bridge call into a real
`stat`.

Renaming needs no separate operation. The client writes the new file and then
deletes the old file after an existence check.

### Refusal checks

`rewriteTemplateSaveWasm` refuses when:

- the input hash is unknown;
- a certified stub body changed;
- a call site does not target the expected function;
- the derived hash differs from the certified output hash; or
- `WebAssembly.validate` rejects the result.

For `File::Open`, the call-site target is the proof because the target is a real
implementation, not a stub. The rebuildable cache lives below
`game/compatibility/<input-hash>/<abi>/`.

## Renderer contract

### Ensure directory

Input: `(path)`. Output: an errno. Zero means success. The bridge uses
`FS.mkdirTree` on the normalized path.

### Find files

Input: `(pattern, out, flags)`. Output: zero.

The bridge splits the last path component, matches `*` and `?` within one
component without case sensitivity, applies the file/directory flag, and sorts
by name. It allocates `count * 544` bytes with the client's `malloc` because the
client frees the block. It creates heap views after allocation because memory
can grow.

Each entry has a zeroed 24-byte header and a UTF-16 name with extension at byte
24. The bridge writes the block pointer at `out+0` and the count at `out+8`. It
skips an entry that the mount cannot describe because the client has no partial
listing error.

### Derive entry name

Input: `(path, dst, chars)`. Output: the number of written characters.

The result uses a leading backslash and backslash separators. It has no file
extension. The bridge removes the extension because the examined client's
`Path::RemoveExtension` also removes the preceding character. Calling that
function with a name that has no extension is a safe no-op.

### Delete file

Input: `(path)`. Output: non-zero on success. The bridge calls `FS.unlink`.
The success polarity is part of the client contract.

### Test whether a file exists

The client uses `File::Open(path, 1)` as a no-overwrite probe. In the examined
build, mode 1 has `O_CREAT`, so it creates the destination and reports it as
taken.

The forwarder asks the host first. If the file exists, it calls the original
`File::Open` and returns the real handle. If the file does not exist, it returns
zero. An undecidable path is treated as existing so that rename refuses instead
of overwriting data. Only this probe is repointed. The write and load calls keep
the original function.

Returning the real handle matters because the caller releases it and asserts on
an invalid handle.

## Path normalization

Apply these steps in order:

1. Convert backslashes to forward slashes.
2. Collapse repeated separators.
3. Remove leading and trailing separators.
4. Remove an `app:/` prefix.
5. Reject an empty, `.` or `..` segment.

The client produces `Templates/Skills/\Test.txt`. After backslash conversion,
this contains a repeated separator. Collapse it before applying the traversal
guard. Rejecting it first breaks delete and rename even though the path does not
escape the mount.

## Invariants and lessons

- Transform only a derived copy for an exact certified hash.
- Keep unapproved callers on the original client functions.
- Keep the bridge in the renderer. Do not add IPC, `fetch`, or a native bridge.
- Allocate listing memory with the client allocator.
- Bump `TEMPLATE_SAVE_TRANSFORM_ABI` when derived bytes or the contract change.
- Test the exact path shapes produced by the client. Cleaner fixtures hid two
  real failures.
- A filtered trace cannot prove that no call occurred.

## Opt-in trace

`GW_TEMPLATE_FS_TRACE=1` enables console-only `[template-fs-trace]` and
`[template-fs-bridge]` records in an unpackaged build. They include counts and
outcomes only. They do not include names, paths, or contents. They do not cross
IPC or enter a diagnostics ZIP.

Interpret the trace as follows:

| Shape | Meaning |
| --- | --- |
| Only `installed` | The client failed before it called the bridge. |
| `listed:-1` | `FS.readdir` rejected the directory. |
| `listed:N` and `matched:0` | The directory was read, but the glob or kind filter was wrong. |
| `published:true` | The bridge supplied a list. Continue the investigation inside the client. |
