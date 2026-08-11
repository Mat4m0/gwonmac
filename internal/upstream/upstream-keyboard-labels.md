# Guild Wars WebAssembly client: every printable key is labelled one position too high

> **Status: confirmed upstream defect; local fix deferred.** This report is
> historical evidence for the examined client build. It does not define current
> gwonmac behavior.

The report is self-contained for ArenaNet. The last section also preserves the
local search record so that the same failed approaches are not repeated.

## Summary

In the published WebAssembly client, the Controls panel and the in-game menus
name the wrong key for any binding whose key is a printable character. The
label shown is the **next character in ASCII order**: a control bound to `K`
reads `L`, one bound to `M` reads `N`, one bound to `1` reads `2`.

Input is not affected. The key that works is the correct one and matches the
Windows client, and the bindings held against the account are correct. The
defect is confined to the code that renders a key id as text.

Keys that have a name rather than a character — `Up Arrow`, `Escape`, `Tab`,
the function keys — are labelled correctly.

Client examined:

| | |
| --- | --- |
| Artifact | `Gw.jspi.wasm` |
| SHA-256 | `3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817` |
| Size | 8,196,702 bytes |
| Build reported in-client | 38,797 (internal) |

## User-visible symptoms

Observed with default bindings, in Options → Control:

| Action | Key that works | Label shown |
| --- | --- | --- |
| Panel: Open Hero | H | `I` |
| Panel: Open Inventory | I | `J` |
| Panel: Open Skills and Attributes | K | `L` |
| Panel: Open Quest Log | L | `M` |
| Panel: Open World Map | M | `N` |
| Action: Use Skill 1 | 1 | `2` |
| Movement: Move Forward | W | `X` |

The practical consequence is that a player who reads the menu and presses the
key it names gets the *adjacent* action. "Hero (I)" opens the Inventory,
because `I` is genuinely the Inventory key and Inventory's own label reads
`J`.

## The measurement that isolates it

One row of the Controls panel, with two keys bound to the same action:

| Action | Bound key | Rendered |
| --- | --- | --- |
| Movement: Move Forward | Up Arrow | `Up Arrow` |
| Movement: Move Forward | W | `X` |

Same action, same binding record, same panel, same draw. One of the two is
correct.

This rules out the binding data, the stored configuration, the keyboard
layout and any difference between the web and Windows binding sets — none of
those can differ between two keys inside a single record. Whatever is wrong
happens after the binding is read, in rendering, and only for keys that are
rendered as a character rather than by name.

## Scope

- **Letters and digits are both affected**, by the same one position.
- **Named keys are not** — `Up Arrow`, `Escape`, `Tab`, `F1`–`F12` read
  correctly. Those names are not present in the module and come from the
  localized text, so they cannot be produced by converting a number.
- **Independent of keyboard layout.** Reproduced on US QWERTY and on German
  QWERTZ, identically. A layout fault would diverge where the layouts
  diverge.
- **Independent of the host.** We ship a macOS Electron host for this client,
  and it forwards key events unmodified; nothing on our side participates in
  drawing these labels.

## The key descriptor table

At `0x1456c0` in the data segment, 20-byte records:

```
{ int32 id; char name[16] }

id  0..43   Alt Control Shift CapsLock Escape NumLock … ArrowUp F1..F12
id 48..57   0..9    + a parallel table of shifted names  ) ! @ # $ % ^ & * (
id 65..90   A..Z    + a parallel table of lowercase names  a..z
```

The names are DOM `KeyboardEvent.key` values — `ArrowUp`, `PageDown`,
`HangulMode`, with `Unidentified` as the fallback — so this is the table that
turns a browser key event into an internal id.

The table's contents are correct and correctly ordered. The defect is not in
this data.

## What we could not determine

We did not locate the function that renders the label, and two readings of
the table remain consistent with every observation above. They imply
different fixes, so we are stating both rather than guessing:

1. **The ids are ASCII+1 and the label is produced by casting the id to a
   character.** Read the records framed from `0x1456c4` — name first, id at
   +16 — and the printable ids come out one above ASCII: `A=66`, `H=73`,
   `0=49`. A cast then yields the observed labels exactly.
2. **The ids are ASCII and the renderer indexes the descriptor table one
   record too far.** Read the records framed from `0x1456c0` — id first — and
   they are exactly ASCII. Reading `name` from the following record yields
   the observed labels exactly.

Both explain every case in this report, including `Up Arrow` remaining
correct. With symbols and source this should be immediate; from a stripped
module it is not.

We did establish that **function #9718** converts a key id to a character
with no offset (`75` gives `K`, `76` gives `L`, `48` gives `0`), and that many
functions in the module perform that identical conversion as generic
one-character string helpers. That means the conversion itself is not
where the extra one is introduced.

## Expected behaviour

The Controls panel and the in-game menus should name the key that actually
triggers the action, for printable keys as they already do for named ones.

## Reproduction

1. Log in and open Options → Control.
2. Select **Movement: Move Forward**. It shows `Up Arrow` and `X`.
3. Press `X` in game. Nothing moves.
4. Press `W`. The character moves forward.
5. Select **Action: Use Skill 1**. It shows `2`; skill 1 fires on `1`.

No configuration change is required and the defect is present with default
bindings.

## Method, and its limits

Unlike our report on template file management, the claims here were **not**
verified by executing the functions involved. The label renderer depends on
an initialised UI and text subsystem, so it cannot be called from a cold
instance the way the pure path helpers could.

What is directly observed: the rendered labels, the keys that actually work,
and the contents and layout of the descriptor table. What is inferred: which
of the two readings above is the real one. We have marked the boundary
between the two deliberately.

## Local investigation record

Exactly one function references the descriptor table: function 2441, the
Emscripten input callback registration. It contains `"#canvas"` and callback
table slots 899 through 909. The function stores the table pointer. It does not
index the table in place. A search for direct references therefore cannot find
the display consumer.

These static anchors were tried and did not identify the renderer:

- The table address had only the one reference above.
- Localized labels such as `Up Arrow`, `Page Up`, and `Num Lock` did not occur
  in the module.
- Range checks for unusual ASCII-plus-one bounds reduced the search but were
  not unique. The strongest candidates were functions 7154, 12320, 10382,
  13674, 12328, and 15906. Function 7154 was 16,590 bytes.

Cold function calls found function 9718. It writes a key id as one character
without applying an offset:

```text
47:/  48:0  49:1  50:2  …  72:H  73:I  74:J  75:K  76:L  77:M  …  90:Z  91:[
```

This did not locate the renderer. Many generic one-character string helpers
have the same body. The eight callers of function 9718 and the other
pointer-returning candidates exited early in a cold instance because the text
and UI state were not initialized.

One cheaper probe remains useful: call the name-to-id direction with `"k"` and
observe whether it returns 75 or 76. This would decide how to frame the table.
It would not prove which live caller renders the label.

To identify the renderer, instrument candidate functions in a live client while
the Controls panel draws. Do not infer the caller from another generic string
helper.

### Why gwonmac does not patch this

The visible defect is small. A local transform would add permanent
recertification work and could damage input if the selected helper is shared
with the working input path.

Do not add a transform unless both conditions are met:

1. Live evidence identifies the exact render-only caller and the source of the
   extra one.
2. A test proves that key input and stored bindings remain unchanged.

Until then, keep the report and let the official client remain authoritative.
