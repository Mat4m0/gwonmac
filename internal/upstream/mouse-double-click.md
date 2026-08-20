# The client's mouse double-click channel is complete and never fed

> **Status: confirmed upstream defect with an exact-build local workaround.**
> This is historical evidence. Current transform and input code define gwonmac
> behavior.

This record explains why the old synthetic touch-tap workaround was deleted.

Client examined:

| | |
| --- | --- |
| Artifact | `Gw.jspi.wasm` |
| Build | 38735 (`version.json`: 1.1.7) |
| Size | 8,196,702 bytes |

Function index = local code-section index + 219 (the function import count).
Source attribution comes from the assertion strings embedded in each
translation unit; every offset below is a byte offset into the named function
body and was produced by full instruction decode, not by byte matching.

## The finding in one line

The client carries a per-press double-click flag all the way from its
Emscripten input record to `FrMouse`, and the Emscripten glue never writes it,
because `MouseEvent.detail` is not marshalled and the record byte is memset to
zero.

## The channel, end to end

```text
Chromium MouseEvent
  detail                                        ← dropped here, never marshalled
  ↓ fillMouseEventData (Gw.jspi.js)             writes 0,8,12,16,20,24-27,28,30,32,36,40,44
  ↓ of a 64-byte struct; bytes 48-63 are never written by any path
#2448  table slot 903, the mousedown callback
         memset(rec, 0, 24)                     ← #267 -> #17666, two-argument memset-zero
         rec[0]  = 18                           kind: mouse button down
         rec[4]  = targetX * devicePixelRatio
         rec[8]  = targetY * devicePixelRatio
         rec[12] = event.button                 (u16 at struct+28)
         rec[16] = -- never written --          ← the flag's slot
         #791 enqueue                           Base/Os/Emscripten/EmscriptenInput.cpp
  ↓
#794   dequeue, #828 per-frame pump, driven by the event loop #883 (Engine/Event/EvtApi.cpp)
  ↓
#829   translate record -> engine message, 36-way br_table on rec[0]
         kind 18 -> engine message 30, payload 24 bytes:
           msg[0]     = rec[12]                 button
           msg[4]     = rec[16]                 ← the flag, structurally zero
           msg[8..15] = cursor x, y as f32
           msg[16]    = button state bitfield
           msg[20]    = modifier state
  ↓
#6293  table slot 1736, bound to engine message 30 by #6659 (Engine/Frame/FrApi.cpp init)
         sets pointer mode 0 (mouse), then
         #6269(msg + 8, msg[0], msg[4] & 1)
                                    ^^^^^^^^^^  the double-click argument
```

`#6269` is `Engine/Frame/FrMouse.cpp` (it asserts `underMouse` at line 736) and
is the one click-delivery routine. Its signature is
`(Vec2* pos, unsigned button, bool doubleClick)`, and at `+182…+201` the third
argument is what sets the flag:

```wasm
local.get 2          ;; doubleClick
i32.eqz
br_if                ;; leave the word alone when it is false
i32.load  offset=12
i32.const 1
i32.or
i32.store offset=12  ;; selectFlags |= FLAG_DBL_CLICK
```

The flag values fall out of `#15917`'s two asserts, which the compiler folded
into `(flags & 3) == 1`, and out of the `br_table` at `#6269+93` that ORs in
`2` or `4` by pointer mode:

| Flag | Value |
| --- | --- |
| `FLAG_DBL_CLICK` | `0x1` |
| `FLAG_DUE_TO_CLICK` | `0x2` |
| `FLAG_NO_INTERACT` | `0x4` |

`#6270` (`FrMouse.cpp:192`) then lifts the bit into its own field —
`msg[40] = evt[4] & 1` — before posting to the widget under the cursor.

`#6269` has exactly three callers, each supplying that argument from its own
source:

| Caller | Pointer mode | Where its double-click bit comes from |
| --- | --- | --- |
| `#6293` | 0, mouse | `msg[4] & 1` — **always 0 on the web client** |
| `#6304` | 1, gamepad | `FrGamepad.cpp` `#6372`, a 400 ms window (`i32.const 399`) |
| `#6309` | 2, touch | the `FrTouch` double-tap detector, below |

So the mouse path is not missing a feature. It is missing one byte.

Worth recording because it looks like the answer and is not: `#6293` does keep
press timestamps (`+44/+51` saves the previous press time, `+213` stamps the
current one) and `#6290` returns the difference. Its only consumers are three
`FrGamepad` functions comparing against `i32.const 2001` — a "has the mouse
been used recently" idle check. Nothing in `FrMouse.cpp` performs timing
arithmetic; every `i32.sub` in the file is stack-frame setup or intrusive-list
pointer math.

## The touch double-tap detector

`#6614`, table slot 1752, `Engine/Frame/FrTouch.cpp`. The detector runs only
for the first touch down (`s_activeTouchId == -1`) and requires all three:

| Condition | Constant | Address |
| --- | --- | --- |
| same touch slot as the previous tap | — | `0x283bd0` current, `0x283bd4` previous |
| `now - lastTapTime <= 499` ms | `i32.const 499`, unsigned | `0x5a21b4` |
| `dx² + dy² < slopX² + slopY²` | `0x3d086595` = 0.0333f each | `0x5a21b4`, `0x5a21b8` |

The slop is set once by `#6618` and is in the client's normalised coordinate
space, not pixels. The "same touch slot" test is satisfied by consecutive
single taps because `#2454` maps browser touch identifiers onto small slot
indices and frees the slot on `touchend`, so a second tap reclaims the first
tap's slot. A host that overlaps its two taps would allocate two slots and the
detector would refuse.

## What a tap costs, which is why it is the wrong mechanism

`#6309` is the whole touch-to-click bridge:

```c
FrTouchTap(pos, isDouble) {
    Frame::SetCursorPos(pos, 1);            // #6264 — warps the cursor to the tap
    if (s_pointerMode != 2) {                // 0 mouse, 1 gamepad, 2 touch
        while (s_captureList) release(...);  // #6276 — force-releases every captured button
        s_pointerMode = 2;
    }
    s_buttonFlags |= 2;
    if (!(prev & 4)) { s_buttonFlags |= 6; FrCursor::Update(0); ... }
    else FrMouse::BeginDrag(pos);            // #6273, asserts s_dragSource
    FrMouse::Click(pos, 0, isDouble);        // #6269
}
```

Three consequences, and each one matches a report from players:

- **The cursor is warped and every held button is force-released.** A tap
  delivered while a button is down desynchronises the client's button state
  from the OS's. `input.ts` already defends against this with `tapsSafe()`.
- **The pointer mode is switched to touch and stays there** until a real press
  restores it. Real mouse releases are dropped in that window.
- **`#6273` enters the drag machinery.** This is the mechanism behind
  "double-clicking in my inventory moves the item to a random slot": the tap
  pair picks the item up and drops it wherever the drag resolves.

None of that happens on the mouse path. `#6293` sets pointer mode 0, releases
nothing, warps nothing, and calls `#6269` directly.

## Why two fast single clicks become a double-click

This is not a defect in the client, and it is worth stating plainly because it
is the shape of four of the five click reports.

Chromium's `detail` counts a click run under the user's macOS double-click
interval and distance preferences. Windows' `WM_LBUTTONDBLCLK` counts the same
run under the same kind of preference. Neither can distinguish a deliberate
double-click from two quick single clicks on the same spot, and neither is
supposed to: the decision belongs to the widget under the cursor. The Windows
client makes it per widget — a vendor's Sell button treats the second press as
another click, an inventory slot treats it as "use".

gwonmac's synthetic tap pair takes that decision away from the widget. It
converts the second press of *any* fast click run into a touch double-tap,
which is a different interaction with the side effects above. Selling two
items in a row, or spending two attribute points in a row, hits the same
screen position inside the double-click interval, so it produces `detail === 2`
and therefore a spurious tap pair.

Feeding `msg[4]` instead would hand the widget the same signal Windows hands
it, and the widget would go on deciding.

## How this was established

Twice, independently, from the module bytes alone — once forward from the
Emscripten callbacks and once backward from the `FLAG_DBL_CLICK` assert. Both
derivations produced the same chain and the same missing byte. Every function
index, offset and constant above came from full instruction decode
(`tools/wasmscan.py`), never from byte matching, because the module's
constants use LLVM's zero-padded LEB128 and a byte search for a canonical
encoding silently finds nothing.

Two supporting negatives: the import list contains no
`emscripten_set_dblclick_callback` (all seventeen `emscripten_set_*_callback`
imports were enumerated), and the strings `dblclick`, `clickCount` and
`DblClick` appear nowhere in the binary.

## Reproduction

No host modification is required to observe the dead channel:

1. Instrument `fillMouseEventData` in `Gw.jspi.js` — `e.detail` is read
   nowhere in the file.
2. Decode `#2448`. The 24-byte record is zeroed by `#267` and only four fields
   are written; offset 16 is not one of them.
3. Decode `#6293`. It reads `msg[4] & 1` and passes it to `#6269`.

## The ask for ArenaNet

`fillMouseEventData` should marshal `MouseEvent.detail`, and the mousedown
callback should set the double-click bit at record offset 16 when the count is
even — the same condition Windows uses to raise `WM_LBUTTONDBLCLK`. Everything
downstream of that byte already works.

## The cost nobody had counted: four clicks per double-click

`#6614` calls `#6309` once per first-touch-down — that is, once per tap — and
`#6309` ends in `#6269`, which is the client's one click-delivery routine. A
tap is therefore not a hint that a double-click happened. It is a click.

So a synthesised double-click delivers **four** clicks to whatever is under
the cursor:

| Source | Delivered by | `FLAG_DBL_CLICK` |
| --- | --- | --- |
| the player's first press | `#6293` → `#6269` | 0 |
| the player's second press | `#6293` → `#6269` | 0 |
| synthetic tap 1 | `#6309` → `#6269` | 0 |
| synthetic tap 2 | `#6309` → `#6269` | 1 |

The Windows client receives two, the second carrying the flag.

This is the whole of the vendor and attribute-point reports, and it is not a
tuning problem. The holdback and the burst cancellation decide *whether* a pair
is sent; they cannot make a sent pair cost less than two extra clicks. Any
widget that acts on a plain click — a Sell button, an attribute `+`, a dialogue
option — is activated twice more than the player asked for, every single time
they deliberately double-click.

Feeding `msg[4]` removes both extra clicks by construction, because then the
double-click is a property of the player's own second press and no additional
press exists.

## What this project now does about it

The certified chain's last stage appends one exported mutable `i32` global and
one store to the mousedown callback:

```wasm
local.get 3          ;; the frame pointer the record already lives on
global.get $flag     ;; what the host wrote before this press
i32.store offset=24  ;; record+16, the word #829 copies into msg[4]
```

It adds no function, moves no function index, and touches no table entry. The
guard is the callback's own body hash: the store depends on local 3 being the
frame pointer and the record sitting at frame+8, and a body that hashes to the
certified value *is* that body. Because neither the template-save nor the
Enhancement transform touches that function, one proof covers every predecessor
the stage can consume, which is why it can run last and leave both existing
build tables untouched.

`src/renderer/native-double-click.ts` writes Chromium's click count into the
global on every trusted press — set on each even click of a run, cleared
otherwise — so the client receives exactly what Windows receives, under the
player's own macOS double-click preferences. The synthetic tap pair is deleted
rather than kept beside it, and an Electron spec refuses any touch event so it
cannot return as a fallback.

`pnpm certification double-click` re-runs the same structural proof from the
official bytes. Unknown parsing stays in the bounded utility process;
production repeats the record-driven transform and checks the exact output.
