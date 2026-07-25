# Investigation log

Issue #5, "Can't save builds", from first report to working CRUD. Kept because
the wrong turns are more instructive than the answer, and because anyone
revisiting this area will be tempted by the same ones.

Ten rounds. One of them was right first time. Every correction came from
measuring the running client, never from reading more disassembly.

## Round 0 — the reported bug

> "The attempt to save the Skills Template named "\f" failed because the file
> could not be created/written to"

M3 MacBook Air, macOS 26.5.1.

## Round 1 — wrong: host filesystem setup

**Hypothesis.** The renderer mounts IDBFS at `app:` too late, does not create
`Templates/Skills`, and the client builds mixed `Templates/Skills\Test.st`
paths that Emscripten's POSIX layer cannot resolve. The `\f` in the message
looked like the smoking gun.

**Built.** Owning the mount in `preRun`, creating both template directories,
`chdir` into the mount, and normalising backslashes at every public `FS`
operation.

**Wrong because** the client's `_wmakepath` joins with `/`. Measured later by
executing it: the path is `Templates/Skills/Test.txt`, no backslash anywhere.
The `\` in the message is the record name's leading separator (see round 7),
not an escaping artefact.

**Kept anyway** — owning the mount and the `chdir` are correct invariants on
their own merits, and the backslash normalisation turned out to be load-bearing
later, for a different reason.

**Lesson.** A plausible story that explains the symptom is not evidence. The
path builder was three lines of WASM away from being measured.

## Round 2 — wrong: bypassing the guard

**Found.** `func_404`, the create-directory routine, is four bytes:
`i32.const 2`. It always fails. The save checks it before opening, so no
syscall is ever attempted.

**Built.** A patch that skipped the guard.

**Result.** The client crashed on save.

**Why.** Skipping the check is not the same as creating the directory. With the
directory still missing, the open failed, and the client's untested error path
calls `Handle::Release(NULL)`, which asserts and aborts.

**Lesson.** When a stub gates an operation, implement it. A bypass sends the
client down paths its author never ran.

## Round 3 — wrong: reading a filtered trace as absence

A syscall tracer was added over `openat`, `fd_write` and friends. A full
session, with a save attempt, produced exactly one line:

```
[template-fs-trace] {"sequence":1,"operation":"enabled"}
```

**Read as** "the client performs no filesystem activity at all".

**Actually** the tracer only recorded paths it classified as template paths, and
the failure happens before any syscall. Both facts were true; the conclusion did
not follow from the trace.

Two defects in the instrument itself, found later:

- it read `Module.HEAPU32`, which the generated glue never assigns — only
  `HEAPU8` is published. Every byte count and open mode in the trace was
  silently `undefined`.
- its unit test passed a fabricated `HEAPU32` in the fixture, so the shape
  mismatch could never surface.

**Lesson.** A trace that filters cannot prove absence. And a fixture that hands
the code under test a shape the real caller does not provide tests nothing.

## Round 4 — right: the four stubs

Systematic sweep instead of hypotheses. Reverse call graph from the syscall
imports, forward from the template UI, then a scan for tiny bodies and for
`assert("not implemented")`.

Result: four unimplemented routines, listed in
[upstream-defects.md](upstream-defects.md). Also the observation that the module
imports no `mkdir`, `getdents` or `unlink` — so no JavaScript-only fix exists and
the module bytes have to change.

Built the transform: append forwarders, repoint certified call sites, route
through `__syscall_newfstatat` behind impossible dirfd markers.

## Round 5 — wrong: the trailing separator

**Built.** The bridge matched the incoming directory against an allowlist of
`Templates/Skills` and `Templates/Equipment`.

**Result.** Save still failed, identically.

**Why.** `_wsplitpath` returns the directory *including* its trailing separator
and `_wmakepath` puts it back, so the client passes `Templates/Skills/`. The
allowlist missed and the bridge returned error 2 — the same error the stub had
returned, which is why the symptom did not change at all.

Confirmed by executing the client's own helpers:

```
full path      : "Templates/Skills/Test.txt"
directory arg  : "Templates/Skills/"
func_404(dir,1): 2
```

**This is where the method changed.** From here on, every claim about client
behaviour was measured by appending exports and calling the function. It found
the remaining four bugs.

**Lesson.** Test the shape the client actually passes, not the shape that seems
reasonable. The old tests asserted the bare directory name, which is why the bug
survived them.

## Round 6 — wrong: ignoring the flags argument

Save worked. The list stayed empty.

Both template scans call find-files, and the only difference between them is the
third argument: `17` for `Templates/Skills/*.txt` and `18` for
`Templates/Skills/*`. Bit 0 means files, bit 1 means directories.

The bridge ignored it and answered both with files, filling the subdirectory
collection with phantom folders named after the templates.

**Lesson.** An argument you do not understand is not an argument you can drop.

## Round 7 — wrong: the record name form

The list was still empty even though the bridge was provably delivering: five
files found, five names written. So the failure had to be past the bridge, in
the client's own bookkeeping — which we could not see.

**What broke the deadlock.** A temporary probe that walked the client's template
registry from the renderer, using the layout recovered from the disassembly. It
reported three records with the right store and type, and:

```
"backslash": false
```

The client keys a template by its path below the type directory in Windows form
with a leading separator — `\Test` — and its list filter matches records against
the current subdirectory, which is `\` at the root. `wcsstr("Test", "\\")` is
null, so every record registered correctly and none was ever listed.

The in-game message had been telling us this from the first screenshot:
`The Skills Template named "\Test" has been saved.` We spent two rounds treating
that backslash as a UI artefact.

**Lesson.** When a failure is past your own code, read the other side's data
structures. And re-read the error text after you understand the system; it
usually turns out to have been literal.

The probe was removed once it had done its job — it hardcoded client memory
offsets and had no business shipping.

## Round 8 — wrong: keeping the extension

The list populated. Every name was one character short — `ASDAs` showed as
`ASDA` — and loading failed with "This Template's Template Code does not appear
to be valid", because the client was opening `ASDA.txt`, which does not exist.

The scan calls `Path::RemoveExtension` on the name. Measured:

```
Path::RemoveExtension("\ASDAs.txt") = "\ASDA"
Path::RemoveExtension("\ASDAs")     = "\ASDAs"
```

The client's own helper is off by one: it removes the extension *and* the
character before it. Not our bug, but ours to avoid — the bridge now strips the
extension itself, leaving that function nothing to trim.

**Lesson.** Reused helpers in the host code are not necessarily correct helpers.
This one had presumably never been exercised, because nothing that calls it ever
ran.

## Round 9 — wrong: rejecting a redundant separator

Delete aborted the client; the fourth stub, `assert("not implemented")` followed
by `unreachable`, was the cause. Bridged it to `FS.unlink`.

Delete then failed cleanly instead of crashing, and rename failed with it.

**Why.** The client joins its type directory with `/` onto a record name that
already begins with `\`:

```
Templates/Skills  +  \ASDAs  +  .txt  →  Templates/Skills/\ASDAs.txt
```

Normalising the backslash produced `Templates/Skills//ASDAs.txt`. The empty
middle segment tripped the bridge's `.`/`..`/empty traversal guard, so the path
was refused.

The integration check had passed because it was fed `Templates/Skills/Test.txt`
— a cleaner path than the client ever produces.

**Lesson.** Repeat of round 5, at a different layer. Fixtures must use the real
shape. Separator runs are redundant, not hostile; collapse them the way
`PATH.normalize` does, then apply the traversal guard.

## Round 10 — wrong: assuming rename was delete plus write

Delete worked. Rename still failed, and the trace showed why it was hard to see:
the bridge was never called at all. Rename fails *before* it reaches either the
write or the delete, so every bridge-side hypothesis was unfalsifiable from the
trace we had.

**What broke the deadlock.** Redirecting the client's own log to a file and
reading what the rename path did, rather than what the bridge saw. It reported
the destination as already taken — for a name that did not exist.

`#9757` asks that question by calling `File::Open(path, 1, err)`. Mode 1 is
documented as open-existing, but in this build it opens `O_RDWR | O_CREAT` (see
defect 6). The probe created the file it was testing for, then found it, then
refused the rename. Every attempt also left an empty file behind.

Fixed with a fifth marker and the only branching forwarder in the transform: ask
the host whether the file exists, and call the real `File::Open` only when it
does. The write call five instructions later, and the load path, keep the real
function untouched.

**Lesson.** When the instrument shows nothing, the failure is upstream of the
instrument. Two rounds went into bridge-side theories that the trace had already
ruled out — it recorded no bridge call, and we read that as "the bridge answered
wrongly" instead of "the bridge was never asked". Round 3's lesson, inverted and
unlearned.

## What we would do differently

1. **Measure the contract before writing the host side.** Executing the client's
   path helpers takes minutes and needs no login. Every round from 5 onward
   would have collapsed into one.
2. **Enumerate the whole surface first.** The four stubs were all findable in one
   sweep on day one. Discovering them one failure at a time cost four
   build-and-test cycles with the user in the loop. But note what the sweep
   cannot find: a stub has a recognisable shape, and defects 5 and 6 are
   implemented functions that behave wrongly. Only measurement finds those.
3. **Distrust silence from instruments.** Round 3's empty trace was the single
   most expensive wrong conclusion, and the instrument had two independent
   defects of its own.
4. **Re-read the user's error text after understanding the system.** `"\f"` and
   `"\Test"` were the answer to round 7, printed in the very first report.

## Verification ladder that ended up working

| Level | Proves | Cost |
| --- | --- | --- |
| `wasmscan` disassembly | a hypothesis worth testing | seconds |
| export-and-call probe | ground truth for any pure client function | minutes |
| derived module + real bridge in Node | the two halves agree | minutes |
| packaged app + opt-in trace | it works against the real filesystem | one live run |
| client log redirected to a file | what the client thinks happened | one live run |
| registry probe | attributes a failure past the bridge | one live run |

Use the lowest level that can actually decide the question. Levels 1 and 2 cost
nothing; the ones with a human in the loop are the expensive ones and should be
spent on questions the cheap levels cannot answer.
