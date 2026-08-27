# Investigation lessons

> **Status: resolved historical investigations.** This file is non-normative.
> It preserves failed hypotheses and the measurements that replaced them. Read
> current architecture and verification rules in `docs/`.

## Template management: issue #5

The first report was:

> "The attempt to save the Skills Template named "\f" failed because the file
> could not be created/written to"

The investigation took ten rounds. Static reading produced several plausible
answers. Calling the client's pure functions and tracing the real path shapes
produced the working result.

### Round 1: host filesystem setup was not the cause

**Hypothesis:** IDBFS mounted too late, template directories were missing, and a
mixed separator produced `\f`.

**Built:** mount ownership in `preRun`, both template directories, a `chdir`, and
backslash normalization.

**Measurement:** `_wmakepath` produced `Templates/Skills/Test.txt`. The leading
backslash belonged to the client's record name, not to an escaped path.

The mount, `chdir`, and normalization remained valid for independent reasons.

**Lesson:** measure a small pure helper before building a story around UI text.

### Round 2: bypassing a guard caused an abort

Function 404, the create-directory routine, returned `i32.const 2` for every
call. Skipping the guard did not create the directory. The later open failed,
and the untested error path called `Handle::Release(NULL)` and asserted.

**Lesson:** implement the required operation. Do not bypass its failure check.

### Round 3: a filtered trace did not prove absence

The syscall trace produced only:

```text
[template-fs-trace] {"sequence":1,"operation":"enabled"}
```

The trace recorded only paths that it had already classified as templates, and
the client failed before any syscall. It also read `Module.HEAPU32`, which the
real glue did not publish. The test fixture supplied a fabricated `HEAPU32`, so
the mismatch could not fail.

**Lesson:** a filtered trace cannot prove that no call occurred. Test fixtures
must use the real caller shape.

### Round 4: four stubs required a module transform

A systematic call-graph and tiny-body search found four unimplemented
functions. The module imported no `mkdir`, `getdents`, or `unlink`. JavaScript
could not repair calls that the module never made.

The transform appended forwarders and repointed only certified call sites
through impossible `__syscall_newfstatat` directory-descriptor markers.

### Round 5: the client kept the trailing separator

The first bridge accepted `Templates/Skills` but the client passed
`Templates/Skills/`. Direct calls measured:

```text
full path      : "Templates/Skills/Test.txt"
directory arg  : "Templates/Skills/"
func_404(dir,1): 2
```

**Lesson:** test the shape supplied by the client, not the tidier shape expected
by the host.

### Round 6: the flags argument selected entry type

The two scans used flags 17 for `*.txt` files and 18 for directories. The first
bridge ignored the flag and placed files in the directory collection.

**Lesson:** do not drop an argument before its meaning is measured.

### Round 7: template record names start with a backslash

The bridge supplied five files and five names, but the list stayed empty. A
temporary registry probe found records without the required leading backslash.

At the root, the list filter searches for `\`. A record named `Test` never
matches. The correct record is `\Test`. The original in-game message had shown
this exact form. The temporary memory-layout probe was deleted after use.

**Lesson:** when failure occurs after the host boundary, measure the client's
stored data. Delete one-use probes when the question is answered.

### Round 8: `Path::RemoveExtension` was off by one

The list finally populated, but each name lost its last character. Direct calls
measured:

```text
Path::RemoveExtension("\ASDAs.txt") = "\ASDA"
Path::RemoveExtension("\ASDAs")     = "\ASDAs"
```

The bridge now removes the extension before the client helper runs.

**Lesson:** an implemented upstream helper is not necessarily a correct helper.

### Round 9: a repeated separator was not traversal

The client joined a type directory with a record name that already started with
a backslash:

```text
Templates/Skills + \ASDAs + .txt -> Templates/Skills/\ASDAs.txt
```

Backslash conversion created a repeated slash. The bridge applied its empty
segment guard before collapsing the run, so it rejected an ordinary path. The
offline test had used the cleaner path `Templates/Skills/Test.txt`.

**Lesson:** normalize redundant separators before checking `.` and `..`.

### Round 10: rename failed before write or delete

The bridge trace was silent because rename failed before reaching it. The
client's own log said that every destination already existed.

`File::Open(path, 1, err)` was intended to open an existing file. In the
examined build it used `O_RDWR | O_CREAT | O_LARGEFILE` (32834). The probe
created the destination, found it, refused the rename, and left an empty file.

The final forwarder asked the host whether the destination existed and called
the real `File::Open` only when it did. The write and load calls stayed intact.

**Lesson:** silence at an instrument can mean that the failure happened before
the instrument. Move the observation boundary instead of changing unseen code.

## Template investigation method

Use this evidence ladder:

| Method | What it can prove |
| --- | --- |
| Full instruction decode | A candidate worth testing. |
| Export and call a pure client function | Ground truth for that function. |
| Derived module plus real bridge and offline filesystem | Agreement across the transform boundary. |
| Packaged app plus an opt-in trace | Behavior against the real mounted filesystem. |
| Client log | A failure before the bridge. |
| Temporary live registry probe | A failure after the bridge. |

Use the least expensive method that can decide the question.

## Salvage cursor: one retry was too early

### Round 11: the pipeline was not dropping a cursor

**Report:** after a salvage-kit click, the player held the pointer still and the
new cursor did not appear.

A 50 ms sampler showed that every cursor generation published by the game
reached CSS within one frame. The refresh fired about 15 ms after the click, and
the game answered about 25 ms later with `hidden`. The actual cursor decision
arrived 183 ms, 1,266 ms, or 1,795 ms later after server acknowledgement and the
idle hover cadence.

The correction repeated a zero-distance refresh every 150 ms while the cursor
remained hidden, until art resolved, real movement took over, or 2.5 seconds
passed.

The first correction still failed in real play. Its hold became active only
after the consumer polled, so it missed the frame that applied the hidden
cursor. A one-pixel trusted movement also erased the stored click. The final
wiring used `!expired` before the poll and re-aimed the click on canvas movement.

**Lesson:** record the answer to a workaround, not only that the workaround ran.
Test composition order, not only isolated predicates.

## Control-click: the mouse path was innocent

### Round 12: two host theories were wrong

**Report:** Control-click did not call out enemy targets.

Chromium under Electron 43.2.0 delivered `mousedown button:0, buttons:1,
ctrlKey:true, isTrusted:true`, plus `contextmenu`. It suppressed `click`. macOS
did not turn the left press into a right press before the page saw it.

`contextmenu` occurred zero times in `Gw.jspi.js`, and the client registered no
such callback. The event could not affect the game.

Function 2448 read the mouse button at `+28` and coordinates at `+40` and `+44`.
No mouse callback read modifier bytes `+24` through `+27`. Function 829 instead
filled the press modifier word from global `0x28cf0c`, which the keyboard path
maintained. Control used key code 1 and Shift used key code 2.

**Conclusion:** Control-click depended on the Control keydown path. Mouse-side
changes could not fix it.

**Lesson:** do not write an unmeasured platform claim into a source comment. A
false comment can also corrupt the interpretation of a correct trace.

## Synthetic tap timing: two timers were not a sequence

### Round 13: timer delay overlapped the taps

The trace showed:

```text
388090    0ms  ARMED double-tap pair
388429  339ms  SENT  double-tap 1/2
388449   19ms  SENT  double-tap 2/2
```

Both timers were scheduled in advance for +250 ms and +330 ms. A blocked main
thread made both deadlines expire together. Tap 1 was held for 30 ms, so tap 2
started before tap 1 ended. The client allocated a different touch slot and did
not recognize a double tap.

The correction scheduled tap 2 only after tap 1 ended. A regression test
blocked the renderer for 500 ms and required `start, end, start, end`.

**Lesson:** two independent timers do not define an ordered sequence. Chain the
second action from completion of the first.

This repaired only the old workaround. The exact-build native double-click
transform later removed the synthetic tap mechanism.

## 2026-08-26 client rebuild: Core evidence moved independently

The `9fbfcb1c` generation inserted six functions at function index 12,956 and
relocated the client's mutable and initialized data independently. The mutable
Core state moved by 6,816 bytes, while cursor labels, frame labels, and the
pre-game hash table each moved by different amounts. A shared address delta was
therefore not evidence of unchanged behavior.

The area table also grew from 888 to 897 rows. Its existing records retained
their semantic content and nine new sentinel rows were appended. Qualification
now binds this extension through the area lookup relationship, a normalized
whole-table digest, the expected sentinel cardinality, and independent
producer/consumer witnesses. It does not identify the rebuild by its module
hash or accept a common relocation delta as authority.

Cursor, play-region observation, and pre-game controls are located separately.
Each proof binds typed function, immutable-data, and mutable-state roles. A
broken cursor relation therefore refuses only cursor; a broken play-region
relation refuses play-region and its declared pre-game dependant; and a broken
pre-game frame or hash relation refuses only pre-game controls. Both the
preceding and `9fbfcb1c` retained artifacts pass with exact-build shortcuts
disabled.

**Lesson:** an equivalent rebuild can move related evidence by unrelated
amounts. Prove each role from content and use, then apply dependency closure;
never infer meaning from address movement alone.
