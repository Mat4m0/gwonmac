# Client internals: the template subsystem

The reference we had to reconstruct. Everything here is for build
`b0319704…`; indices and offsets are build-specific.

Function index = local code-section index + 219 (the function import count).

## Call graph

```
UI                          Account client                  Base/Os
──────────────────────────  ──────────────────────────────  ─────────────────────

TemplatesSave.cpp
  17012/17016 ─────────────► 9756  save skills ─────┐
                             9755  save equipment ──┤
                                                    ├─► 9757 write one file
                                                    │     404  create directory  ← stub
                                                    │     771  File::Open mode 1 ← probe, creates
                                                    │     771  File::Open mode 2
                                                    │     779  File::Write
TemplatesList.cpp
  16982 refresh ───────────► 9832 clear ─► 9734
                             9819 rescan ─► 9745 ──┬─► 9746 scan directories
                                                   │     405  find files        ← stub
                                                   │     416  entry name        ← stub
                                                   └─► 9747 scan files
                                                         405, 416              ← stubs
                                                         457  remove extension ← off by one
  16979 build rows ────────► 9811 ─► 9738 iterate + filter
                                       9736 next id
  16976 add row

TemplatesLoad.cpp
  16988/16989 ─────────────► 9753 open one template
                                     771, 769, 780

TemplatesManage.cpp
  16997 rename ────────────► 9821 ─► 9754 ─┬─► 9755/9756 write new name
                                           └─► 9735 delete old
  17000 delete ────────────► 9810 ─────────────► 9735 delete
                                                 760  File::Delete
                                                   730 ─► 678 ─► 552          ← abort
```

## The broken routines and their call sites

| Function | Local | Signature | Problem |
| --- | --- | --- | --- |
| 404 create directory | 185 | `(path, recursive) -> errno` | `i32.const 2`, always fails |
| 405 find files | 186 | `(out, pattern, flags) -> void` | empty body |
| 416 entry name | 197 | `(dst, _, baseDir, _, path, chars) -> written` | `i32.const 0`, writes nothing |
| 552 delete file | 333 | `(path) -> deleted` | `assert("not implemented"); unreachable` |
| 771 `File::Open` | 552 | `(path, mode, err) -> handle` | implemented, but mode 1 carries `O_CREAT` |

Call sites we repoint, as `(caller local, byte offset in body)`:

| Stub | Sites |
| --- | --- |
| 404 | 9538+171 (#9757 template save), 11525+142 (#11744 chat log), 12214+127 (#12433 screenshot) |
| 405 | 9527+157 (#9746 directories), 9528+157 (#9747 files), 11525+210, 12214+419 |
| 416 | 9527+276, 9528+278 |
| 552 | 459+201 (#678 `ExeFileDelete`) |
| 771 | 9538+201 — the existence probe in #9757 only. The write call at 9538+226 and the load path keep the real function. |

Not repointed, deliberately: 404 in #11460 (`ActDlgLogin`, result discarded),
405 in #6656 (`FrApi`), 416 in #4463 and #4532 (the model paths — they test the
result and currently take a working fallback branch, so changing it would be a
regression risk in code we have not analysed).

Every one of these `call` instructions uses LLVM's 5-byte padded index encoding,
so a repoint fits in place without changing any body length.

## Path helpers

| Function | Meaning |
| --- | --- |
| 411 | `_wsplitpath(path, drive, dir, fname, ext)` |
| 412 | `_wmakepath(path, chars, drive, dir, fname, ext)` |
| 455 | `Path::GetDirectory(dst, src, chars)` |
| 456 | `Path::Append(dst, dir, name, chars)` — `makepath(dir, fname)` |
| 457 | `Path::RemoveExtension(dst, src, chars)` — **off by one, see defect 5** |
| 459 | `Path::SetDefaultExtension(dst, src, ext, chars)` |
| 408 | wide string copy, returns `dst[0] != 0` |
| 410 | `PathIsRelative` — treats both `/` and `\` as separators |

### `File::Open` modes

Mode 1 is the client's open-an-existing-file mode and mode 2 its create-and-write
mode, but both reach `openat` with `O_RDWR | O_CREAT | O_LARGEFILE` (32834).
Captured live:

```
save    openat flags:32834 create:true → fd_pwrite 24/24 → fd_close
rename  openat flags:32834 create:true → fd_close            ← probe, no write
```

`#9757` uses mode 1 to ask whether a rename's destination is taken, so the probe
creates the file it is testing for and answers "taken" every time. The two
signatures above — write versus no write after an identical open — are how to
recognise it in a trace.

Two further behaviours that cost us real time:

- **`_wsplitpath` returns the directory including its trailing separator.** So
  `Path::GetDirectory("Templates/Skills/Test.txt")` is `"Templates/Skills/"`,
  not `"Templates/Skills"`. Measured, not inferred.
- **`_wmakepath` joins with `/`**, and inserts a separator after a non-empty
  directory only when it does not already end in `/` or `\`.

Consequence: the client joins its type directory with `/` onto a record name
that already begins with `\`, so **every file operation on a listed template
arrives with a doubled separator**:

```
Templates/Skills  +  \Test  +  .txt  →  Templates/Skills/\Test.txt
```

That is a redundant separator, not a traversal attempt. A host that rejects it
breaks delete and rename.

## Template name conventions

A template is keyed by **its path below the type directory, in Windows form
with a leading separator**:

| Location | Record name |
| --- | --- |
| `Templates/Skills/Test.txt` | `\Test` |
| `Templates/Skills/Sub/Test.txt` | `\Sub\Test` |

`TemplatesSave.cpp` (17012, 17016) builds exactly this before handing the name
to the account client, which is why the in-game confirmation reads
`The Skills Template named "\Test" has been saved.` — the leading backslash is
the record name, not a display artefact. We spent two rounds treating it as an
escaping bug.

The extension is **not** part of the record name; `9753` re-appends `.txt` when
opening.

### Name sanitiser

Both the save path (9756) and both scans (9746, 9747) run the same filter on the
name:

1. skip leading characters in `1..32`
2. skip leading `.`
3. drop every character `< 32` or in `` .*:/<>|"? ``
4. trim trailing characters `<= 32`

Note what is **absent from the reject set**: backslash. The leading `\` of a
record name survives, by design.

## The list filter

`9738(ctx, type, filterPath, cursor)` yields one template id per call:

```c
while (next_id(ctx, type, 0, cursor)) {
    record = ctx->refArray[*cursor];
    match = wcsstr(record->name, filterPath);
    if (match && !wcschr(match + wcslen(filterPath), L'\\'))
        return 1;                       // direct child of the current directory
}
return 0;
```

`filterPath` is the dialog's current subdirectory, held at `this+0` of the
`TemplatesList` object. `TemplatesList.cpp:16978` appends `<name>\` when
entering a subdirectory and truncates at the last `\` when leaving — and asserts
`subDir` if none is present, so **the root value is a single `\`**, not the empty
string.

This is why a record named `Test` registers correctly and never appears:
`wcsstr("Test", "\\")` is null. It must be `\Test`.

The header shown in the dialog (`Templates/Skills\`) is built separately, from
`9816` → `9742`, and is not the filter.

## Template record layout

Two id-managed collections live in the account template context
(`s_propContext[10] + 36`):

| Collection | Array | Count | Hash | Populated by |
| --- | --- | --- | --- | --- |
| Subdirectories | +8 | +16 | +40 | 9746 (36-byte records) |
| Template files | +76 | +84 | +108 | 9747 and the save paths (180-byte records) |

The list dialog iterates the file collection only.

Template file record, the fields we depend on:

| Offset | Field |
| --- | --- |
| +28 | `wchar_t*` name — the `\Test` form above |
| +32 | store — 0 |
| +36 | type — 0 skills, 1 equipment |
| +40 | template data |

`9736` asserts `record->store == store` and `record->type == type`, which is how
we confirmed the field order.

## Scan state machine

`9745(ctx, type)`:

```c
if (ctx->state[type] != 0) return;   // already scanned
ctx->state[type] = 1;
scan_directories(ctx, type);         // 9746
scan_files(ctx, type);               // 9747
ctx->state[type] = 2;                // "ready"
notify_ui();
```

`AccountCliTemplateIsReady(type)` is `state[type] == 2`. A rescan is a no-op
unless something resets the state first — which `9734` (clear) does, as its last
statement, and which "Refresh List" therefore triggers via
`16982 → 9832 → 9734`.

## Latent defect on the save error path

`9757`, on a failed create, falls through to `Handle::Release(NULL)`, which
asserts `handle` and aborts. In the shipped build this is unreachable because
defect 1 fails first. It is reachable in a build where directory creation
succeeds but the open fails — which is exactly what happened when we first
bypassed the guard naively.

## Enumeration patterns, measured

Replaying the client's own sequence for the skills scan:

```
full path       : "Templates/Skills/Test.txt"
directory arg   : "Templates/Skills/"
files pattern   : "Templates/Skills/*.txt"     flags 17
dirs pattern    : "Templates/Skills/*"         flags 18
```

The `Templates/Skills` and `Templates/Equipment` literals are UTF-16 at
`0x161600` and `0x161622`, reached through the table at `0x161654`
(`s_templateDirs[type]`).
