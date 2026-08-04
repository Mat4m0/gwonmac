# Every printable key is labelled one position too high

The Controls panel and the in-game menus name the wrong key. Not a
translation, not a layout: the label is the *next* character. A control on
`K` reads `L`, one on `M` reads `N`, one on `1` reads `2`.

Nothing is misrouted. `K` opens Skills and Attributes exactly as it does on
the Windows client, and the bindings on the account agree with the Windows
client. The only defective thing is the code that renders a key id as text.

## The measurement that settles it

Build 38,797. One row of the Controls panel, two keys bound to the same
action:

| Action | Bound key | Rendered |
| --- | --- | --- |
| Movement: Move Forward | Up Arrow | `Up Arrow` |
| Movement: Move Forward | W | `X` |

Same action, same record, same panel, same draw call — and one of the two is
right. That single row rules out the binding data, the keyboard layout, the
account, and any theory about the web port shipping a different default
scheme. Whatever is wrong happens after the binding is read.

The split is exactly: **keys with a name render correctly; keys that are a
printable character render one too high.**

| Action | Bound | Rendered | id | as a character |
| --- | --- | --- | --- | --- |
| Panel: Open Skills and Attributes | K | `L` | 76 | `L` |
| Panel: Open World Map | M | `N` | 78 | `N` |
| Action: Use Skill 1 | 1 | `2` | 50 | `2` |
| Movement: Move Forward | W | `X` | 88 | `X` |
| Movement: Move Forward | Up Arrow | `Up Arrow` | 32 | not printable |

`Up Arrow` survives because it is not in the module at all — it comes from
the localized text, so it cannot be produced by casting a number.

## The key descriptor table

`0x1456c0`, 20-byte records, `{ int32 id; char name[16] }`. The data is
clean and in order; the defect is not here.

```
id  0..43   Alt Control Shift CapsLock Escape NumLock … ArrowUp F1..F12
id 48..57   0..9        + a parallel table of shifted names  ) ! @ # $ % ^ & * (
id 65..90   A..Z        + a parallel table of lowercase names  a..z
```

The names are DOM `KeyboardEvent.key` values — `ArrowUp`, `PageDown`,
`HangulMode`, and `Unidentified` as the fallback — so this is the table the
input side uses to turn a DOM key into an id.

Read the same bytes framed from `0x1456c4` (name first, id at +16) and the
printable ids come out **one above ASCII**: `A=66`, `H=73`, `0=49`. Which
framing is real decides the shape of the patch, and the two are not
distinguishable from the data alone — see the open question below.

## Where the search stands

Exactly one function references the table: **#2441**, the Emscripten input
callback registration. It carries `"#canvas"` and the callback slots
899–909, including 903, the mouse callback the native double-click work
patches on its own branch — deliberately not linked, because these two
lines of work are independent and either may land first. It *stores* the table
pointer rather than indexing it in place, which is why no other function
carries a constant into the table and why the consumers cannot be found by
searching for one.

Anchors tried and exhausted:

- **Table references.** One function, above.
- **The rendered names.** `Up Arrow`, `Page Up`, `Num Lock` and friends do
  not appear anywhere in the module. They are localized text, so they give
  no address to search from.
- **Range-check constants.** If the ids really are ASCII+1, a printable
  test would use bounds ordinary ASCII code never uses — `92` for the
  letters, `59` for the digits. That ranks the 17,603 bodies down to a
  handful, but `>= 65 && < 91` is also the normal idiom, so the ranking is
  suggestive rather than decisive. Best candidates by that score: #7154
  (16,590 bytes), #12320, #10382, #13674, #12328, #15906.

## What calling their functions established, and what it could not

The module instantiates standalone in Node: all 219 imports are functions, so
a stub returning zero for each is enough, and `memory`, `malloc` and `free`
are already exported. Appending export entries for candidate functions and
calling them works exactly as the templates investigation describes.

It found **#9718**, which writes a key id as a character:

```
47:/  48:0  49:1  50:2  …  72:H  73:I  74:J  75:K  76:L  77:M  …  90:Z  91:[
```

A plain cast, no offset. That is the operation the labels are wrong about —
but #9718 is not the key renderer. Dozens of functions scattered through the
binary do the byte-identical thing (they are generic one-character string
helpers, template instantiations of the same formatting code), so "writes L
when handed 76" does not distinguish the one the Controls panel calls from
any of the others. The property that makes one of them the renderer lives in
its caller.

And the callers cannot be reached cold. The eight functions that call #9718,
and every pointer-returning candidate tried, return zero without writing
anything — they early-out on uninitialised state. That is the difference
from the templates work: `Path::RemoveExtension` and `_wsplitpath` are pure
helpers that need no game state, and a label renderer needs a live text
subsystem and an initialised UI.

So the technique that ended the guessing there does not end it here. Locating
this function needs **live instrumentation** — patching the module to record
which function produced the string while the real Controls panel draws it —
not a cold call.

One cheap probe is still unrun: sweeping for the *name → id* direction, which
does not need UI state. Writing `"k"` into memory and finding the function
that answers 75 or 76 settles the framing question below outright. It was
started and killed by a timeout while the broad sweep was still competing for
the machine; it should be re-run on its own.

## The open question

Two readings survive every static observation, and they need different
patches:

1. **The ids are ASCII+1 and the display casts.** Fix: subtract one before
   the character conversion.
2. **The ids are ASCII and the display indexes the descriptor table one
   record too far.** Fix: correct the index.

Both produce every symptom above, including `Up Arrow` staying correct.

## What settles it

Not more static analysis — that produced two confident, plausible readings
and no way to choose. The technique that ended the guessing during the
templates investigation applies here unchanged: **append export entries for
the candidate functions, instantiate the module in Node with stub imports,
and call them with a key id.** A function that answers `L` to 76 is the one,
and the value it was given says which reading is true.

## Whether to ship a fix at all

Worth stating plainly, because the answer is not obviously yes. The patch
would be one instruction. Against it: a second transform to re-derive and
re-pin against every ArenaNet build, permanently, for a wrong letter on a
label — and a hazard to rule out first, that the function is not shared with
the input path, where the same off-by-one is load-bearing and correct.

The report is worth writing either way. It is specific enough for someone
with symbols to fix in minutes.
