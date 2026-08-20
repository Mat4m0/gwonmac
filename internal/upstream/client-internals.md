# Client internals evidence

> **Status: historical and non-normative.** This file preserves exact-build
> measurements. Current certification tables and code are authoritative. Read
> [WASM host](../../docs/wasm-host.md) for the current runtime model.

## Template subsystem: build `b0319704…`

This is the template reference that the original workaround required. All
indices and offsets in this section are build-specific.

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

## Enhancement foundation: build 38,797

This section preserves the unique evidence from the retired Toolbox foundation
record. It does not describe the current Tools feature set.

### Module identity

| Fact | Measured value |
| --- | --- |
| Official SHA-256 | `3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817` |
| Post-template SHA-256 | `9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094` |
| Program and build | `1` and `38797` |
| Function imports | 219 |
| Input table limits | minimum 4683, maximum 4683 |

The original transform plan reused table slot 0 because it was statically
empty. A bounded live login disproved that plan. Character entry trapped with
`function signature mismatch` after the transform put the six-argument
dispatcher in slot 0. The game uses slot 0 as a dynamic sentinel. Transform ABI
8 kept all input entries and appended terminal slot 4683.

**Do not repeat:** a statically empty table slot is not proof that the running
client leaves the slot unused.

### Side-module memory collision

The first Rust kernel was a normal imported-memory module. Its data segment and
stack pointer were both linked at `0x100000`. Instantiation wrote 28 bytes into
that unreserved game region. Every callback then used the same region as its
stack. The next live login reached this assertion:

```text
TextParser.cpp:724 IsParam(data)
```

The corrected side module was position-independent. The renderer reserved one
64 KiB block with the game allocator and supplied the data base and stack
pointer. The side module received a separate empty table. ABI 5 verification
pinned these properties:

- a 268-byte memory requirement;
- four-byte alignment;
- no table entries;
- deterministic module bytes; and
- no write to the former fixed region during instantiation.

**Do not repeat:** an imported-memory module cannot choose an address inside
game memory unless the game allocator reserved that address.

### Tick, cursor, and chat boundaries

The measured exact-build facts were:

- `EmscriptenExeThreadMainLoop`: absolute function 446, signature
  `(i32) -> void`;
- cursor boundary: absolute function 2469, signature
  `(i32, i32, i32, i32, i32) -> void`;
- cursor table slot: 922;
- cursor producer functions: 2828 and 2834;
- player-chat producer: absolute function 8947, with exactly three decoded
  `i32.const 0x10000082` sites, each calling function 6842; and
- nearby producers 8942 and 8945 used `0x1000007f` and `0x10000080` with the
  same target.

Function 6842 had signature `(i32, i32, i32) -> void` and the recovered
`FrApi.cpp` / `msgId >= FRAME_MSG_EX` assertion shape. A live proof showed one
ordinary player message once and advanced the counter once. `/age` did not
advance it. No message text or pointer crossed the companion ABI.

Live cursor proof observed item, ground-arrow, salvage, and restored-arrow
transitions. A click could change interaction mode without a new cursor callback
until hit-testing ran. A bounded trusted-click refresh produced two cursor
events and the salvage bitmap without moving the physical pointer.

### Hero observation and unsafe command attempts

The exact build used `0x100001a3` for Hide Hero Panel and `0x100001a4` for Show
Hero Panel. The measured party path was:

```text
GameContext + 0x4c -> PartyContext
PartyContext + 0x54 -> current PartyInfo
PartyInfo + 0x24 -> heroes Array
HeroPartyMember stride 0x18
  +0x00 AgentID
  +0x04 owner player number
  +0x08 HeroID
```

Ownership was compared with `CharacterContext + 0x2ac`. The observer accepted
at most seven unique owned HeroIDs and published only these scalar values.

Two command attempts failed for different reasons:

1. Sending Show from the main-loop hook aborted on the
   `EmscriptenExeProp.cpp` `s_propContext` assertion.
2. Deferring until the next game-owned UI dispatch avoided that abort but could
   run inside a nested text-parser producer. A later live run reached
   `TextParser.cpp:724 IsParam(data)`.

Function 228 showed why. `PropGet` loaded the active context from `0x28cc20` and
asserted when it was null. Functions 230 and 231 got and set that context.
Official wrappers used save, install, call, and restore. This proved that the
mechanism existed. It did not prove that an arbitrary callback had the correct
lifecycle or parser state.

The foundation ABI therefore became passive. Each wrapper called the game clone
first and then notified Rust. The side module imported no game function. Show,
Hide, and synthetic mouse-nudge commands were removed. Later command features
needed separate, bounded evidence; this foundation did not authorize them.

### Corrected context root

Static analysis first selected `0x5a0ed4` as `contextRoot`. Live hero proof
showed that it resolved into `FcArchive` state. The corrected address was
`0x5a0ee0`. Slot 6 then pointed to a `GameContext`, and the character and party
chains jointly measured map 449, player number 1, and Koss as
`{agent: 323, owner: 1, hero: 6}`.

**Do not repeat:** a plausible global address needs a live invariant across more
than one related structure before certification.

## Build 38,833 patch carry-forward

ArenaNet published official module
`f19daa7e1293cbd14891411e15124b1be21d70b94195ef9ba5e3eec6fc3e618c`.
The certified template transform produced
`7d0ced840d3dc167b823ed0ad6ed411319faf97316345c8e37620e86d86f536e`.
Function 477 changed its returned build constant from 38,797 to 38,833.

The patch added one defined function but did not move the certified Tools
boundaries. The following facts matched the preceding post-template module
exactly:

- 219 imports and table limits of 4,683;
- main-loop function 446;
- cursor callback 2469 in active table slot 922 and producer bodies 2828/2834;
- UI dispatcher 6842 and the certified message IDs and call sites;
- command sender 5951, drain 6661 in table slot 1721, and every named command
  builder body hash;
- native double-click callback 2448 in table slot 903; and
- all certified memory roots, strides, limits and lifecycle fields.

The static data section retained its size and placement. Its only changed byte
range was `0x15a318..0x15a397`, outside every certified layout root. The
recomputed outputs for all seven capability profiles, native double-click and
extended memory were pinned rather than copied from build 38,797.

The general review report still describes the cursor callback as unavailable:
its broad heuristic looks for direct calls, while this callback is reached
through the active table. Automatic cursor recovery therefore uses a separate,
narrow proof. It requires one exported main-loop body, one callback with its
exact signature and active table neighbourhood, and the two measured producer
body fingerprints. Both certified builds must agree on all semantic anchors.
Changing or duplicating any anchor rejects recovery. That original result
authorized only the cursor. Target Distance now has a separate proof for its
selector, bounded context and agent readers, and immutable area table. Party
observation and actions remain exact-build-only until their own proof layers.
