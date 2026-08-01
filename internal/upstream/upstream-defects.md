# Guild Wars WebAssembly client: template file management is unimplemented

A report for ArenaNet. Nothing in it depends on our project.

## Summary

In the published WebAssembly client, saving, listing, renaming and deleting
skill and equipment templates cannot work. Six defects are involved: four
`Base/Os/Emscripten` routines that ship unimplemented, and two logic errors —
one in path handling and one in the file open modes. The first two routines
also disable screenshots and chat logs.

Client examined:

| | |
| --- | --- |
| Artifact | `Gw.jspi.wasm` |
| SHA-256 | `b0319704f3072d6948a66026a35af5eb0af12b48d70986783c293e7c77e98483` |
| Size | 8,194,484 bytes |

The module is stripped, so functions are identified below by index, signature,
call sites and observed behaviour. Source attribution comes from the assertion
strings embedded in each translation unit.

Every claim here was verified by executing the function in question, not by
reading the disassembly. The method: append export entries for the target
function to the module, instantiate it in Node with stub imports, call it. The
path helpers are pure and need no game state.

## User-visible symptoms

| Action | Result |
| --- | --- |
| Save a skill template | *"The attempt to save the Skills Template named "…" failed because the file could not be created/written to"* |
| Load from Skills Template | List is always empty, including after a successful save |
| Rename a template | *"The attempt to rename the Skills Template named "…" failed"* |
| Delete a template | Client aborts |
| Screenshot (`Screens/`) | Never written |
| Chat log | Never written |

## Defect 1 — directory creation always fails

**Function 404**, `(wchar_t* path, int recursive) -> int`, in
`Base/Os/Emscripten/EmscriptenPath.cpp`.

Entire body:

```wasm
i32.const 2
end
```

It returns `2` (`ERROR_FILE_NOT_FOUND`) unconditionally, without touching the
Emscripten filesystem.

Callers, all of which treat a non-zero result as fatal to the operation:

| Caller | Purpose |
| --- | --- |
| 9757, from `Gw/Account/Cli/AcctCliTemplate.cpp` | create `Templates/Skills` / `Templates/Equipment` before writing a template |
| 12433, `Gw/Ui/UiScreen.cpp` | create `Screens` before a screenshot |
| 11744, `CtChatLog.cpp` | create the chat-log directory |
| 11460, `ActDlgLogin.cpp` | result discarded |

**Consequence.** The template save path checks this before opening the file, so
`AcctCliTemplate.cpp:1020` stores error 2 and the client reports that the file
could not be created. No filesystem syscall is ever attempted. Verified: the
save failure occurs with zero `openat` activity.

```
func_404(L"Templates/Skills/", 1) = 2
```

**Expected.** Create the directory (with parents when `recursive`) and return 0
on success. The module imports no `mkdir`, so this needs an implementation
against the Emscripten FS API — `FS.mkdirTree` is the direct equivalent.

## Defect 2 — directory enumeration does nothing

**Function 405**, `(FileList* out, const wchar_t* pattern, int flags) -> void`,
same translation unit.

Entire body is empty. It returns without writing to `out`, which the caller
zeroed beforehand — so every directory reads as empty.

The `out` structure, from the call sites:

```c
struct FileList {          // 16 bytes, caller-zeroed
    Entry*   entries;      // +0   caller frees this with free()
    uint32_t _pad;         // +4
    uint32_t count;        // +8
    uint32_t _pad2;        // +12
};

struct Entry {             // 544 bytes, stride confirmed at every call site
    uint8_t  header[24];   // +0   no caller reads this
    wchar_t  name[260];    // +24  file name, with extension
};
```

`flags` selects the entry kind. Observed values:

| Caller | Pattern | flags |
| --- | --- | --- |
| 9747, `AcctCliTemplate.cpp` | `Templates/Skills/*.txt` | 17 — files |
| 9746, `AcctCliTemplate.cpp` | `Templates/Skills/*` | 18 — directories |
| 11744, `CtChatLog.cpp` | `<dir>/gw???.txt` | 1 |
| 12433, `UiScreen.cpp` | `Screens/gw???.???` | 1 |

Bit 0 selects files and bit 1 selects directories; bit 4 is set by the template
scans only and we did not determine its meaning.

**Consequence.** "Load from Skills Template" is permanently empty, and the
screenshot and chat-log paths cannot find the next free `gw000.*` index.

**Expected.** Populate `out` with the matching entries. The module imports no
`getdents`; `FS.readdir` plus `FS.stat` is the equivalent. Note the allocation
contract: the caller frees `entries`, so it must come from the client's own
allocator.

## Defect 3 — entry-name derivation writes nothing

**Function 416**,
`(wchar_t* dst, int, const wchar_t* baseDir, int, const wchar_t* path, int dstChars) -> int`,
same translation unit.

Entire body:

```wasm
i32.const 0
end
```

It returns 0 and writes nothing to `dst`.

Callers: 9746 and 9747 (`AcctCliTemplate.cpp`, both template scans), 4463
(`MdlDecomp.cpp`) and 4532 (`MdlTex.cpp`).

**Consequence.** In the template scans the result is dropped and `dst` is read
immediately afterwards, so the client sanitises and registers uninitialised
stack memory as the template name. In the two model paths the result is tested,
so those take their fallback branch instead.

**Expected.** From the call sites, the intended result is `path` expressed
relative to `baseDir`. In the template scans, `baseDir` is `Templates/Skills/`
and `path` is an entry name from defect 2.

## Defect 4 — file deletion aborts the client

**Function 552**, `(const wchar_t* path) -> int`, in
`Base/Os/Emscripten/Exe/EmscriptenExeFile.cpp`, line 840.

Entire body:

```wasm
i32.const "not implemented"
i32.const "../../../../Base/Os/Emscripten/Exe/EmscriptenExeFile.cpp"
i32.const 840
call <assert>
unreachable
```

Reached from `File::Delete` → 730 → 678 → 552. Its caller reads a non-zero
result as success and otherwise reports error 4.

**Consequence.** Deleting a template aborts the client outright. Renaming is
implemented as write-the-new-name followed by delete-the-old, so renaming aborts
too — or, if the write half fails first, reports a rename failure.

**Expected.** Delete the file and return non-zero on success. The module imports
no `unlink`; `FS.unlink` is the equivalent.

### Related: ten further `assert("not implemented")` bodies

The same translation unit contains eight more (functions 526, 527, 532, 533,
534, 535, 538, 539, at lines 490, 601, 608 and 634), plus two in
`Net/DiagLib/Emscripten/EmscriptenDiagLib.cpp` at lines 23 and 28. None is
currently reachable — the eight are vtable slots with no live caller, and the
DiagLib pair sits behind a disabled flag — but they are latent aborts on those
paths.

## Defect 5 — `Path::RemoveExtension` drops the last character of the name

`Base/Rtl/Path.cpp`'s remove-extension helper (function 457) splits with
`_wsplitpath` (function 411) and rebuilds with `_wmakepath` (function 412),
passing a null extension. The filename length passed to the split is one short,
so the last character of the name is removed along with the extension.

Measured by calling the shipped function directly:

```
Path::RemoveExtension("\ASDAs.txt")      = "\ASDA"        ← expected "\ASDAs"
Path::RemoveExtension("\LOLOL.txt")      = "\LOLO"        ← expected "\LOLOL"
Path::RemoveExtension("\Sub\Nested.txt") = "\Sub\Neste"   ← expected "\Sub\Nested"
Path::RemoveExtension("ASDAs.txt")       = "ASDA"         ← expected "ASDAs"
Path::RemoveExtension("\ASDAs")          = "\ASDAs"       ← correct, nothing to strip
```

The bug appears only when there is an extension to remove.

**Consequence.** Function 9747 calls this on every enumerated template, so once
defects 2 and 3 are fixed, every listed name is short by one character — and the
subsequent load builds a path from that truncated name and cannot find the file.
It also affects `MdlTex.cpp`, which calls the same helper.

**Expected.** `dir + filename` without the extension, filename intact.

## Defect 6 — `File::Open` mode 1 creates the file it is asked to open

`File::Open(path, mode, err)` (function 771). Mode 1 is the client's
open-an-existing-file mode: function 9753 uses it to read a template, and
function 9757 uses it to ask whether a rename's destination name is already
taken:

```c
if (!allowOverwrite) {
    handle = File::Open(path, 1, NULL);
    if (handle) return false;          // name already in use
}
handle = File::Open(path, 2, NULL);    // create and write
```

Both modes reach `openat` with identical flags. Captured live, from a save
followed by a rename:

```
save    openat flags:32834 access:2 create:true errno:0 → fd_pwrite 24/24 → fd_close
rename  openat flags:32834 access:2 create:true errno:0 → fd_close
```

`32834` is `O_RDWR | O_CREAT | O_LARGEFILE`. Mode 1 carries `O_CREAT`, so the
probe **creates the file it is testing for**, observes that it now exists, and
reports the name as taken.

**Consequence.** Every rename fails, for every destination name, with "The
attempt to rename the Skills Template named "…" failed" — and leaves a
zero-length file behind at the destination. Loading is also affected: opening a
missing template creates an empty file rather than failing.

**Expected.** Mode 1 should open an existing file and fail when it is absent —
no `O_CREAT`.

## Defect 7 — the cursor is not re-evaluated after a server-acknowledged mode change

**Observed.** Using an item that starts a targeting mode (salvage or
identification kit) hides the cursor immediately, but the targeting cursor
only appears on the next pointer input or on the client's idle hover cadence.
With the pointer held still, the measured gap between the hide and the new
cursor was 183 ms, 1,266 ms and 1,795 ms for the same action on build 38797 —
consistent with the server round-trip completing and the cursor decision then
waiting for the idle cycle.

**Probe.** A synthetic zero-distance `mousemove` pair dispatched after the gap
resolves the cursor instantly, which is how the host works around it. A pair
dispatched one frame after the click is answered with the hidden cursor: the
client re-evaluates on request, but the mode is not resolved until the server
acknowledges.

**Expected.** After the acknowledgement that completes a mode change, the
client should re-run pointer hit-testing once on its own, without waiting for
input or the idle cycle.

## How to reproduce

Reproduces on a stock client; no host modification required.

1. Log in and open the skills panel.
2. Save a build under any name → defect 1, save fails.
3. Open "Load from Skills Template" → defects 2 and 3, list is empty.

For defects 4 and 5 the earlier ones must be worked around first. With a build
where directory creation and enumeration succeed:

4. Delete a listed template → defect 4, client aborts.
5. Compare a listed name against the file on disk → defect 5, one character
   short.
6. Rename a template to any unused name → defect 6, always fails, and a
   zero-length file appears at the destination.

Defect 5 alone can be confirmed without any of that, by calling function 457
with `"\Test.txt"`.

## Contact

Filed from https://github.com/Mat4m0/gwonmac — a sandboxed macOS Electron host
for the official client. We would rather these were fixed at source than carry a
host-side workaround.
