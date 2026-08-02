# Toolbox foundation evidence — build 38,797

This is the investigation record. The executable certificate is
`src/main/certification/enhancement-builds.ts`.

## Module identity

- official SHA-256:
  `3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817`
- post-template SHA-256:
  `9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094`
- game program/build: `1` / `38797`
- function imports: 219
- input table min=max: 4683; slot 0 is the sole statically empty slot

The normal template recertifier produced the post-template identity. Applying
the production three-entry transform to that exact module validates as
WebAssembly and extends both table limits once, reserving new terminal slot
4683.

The original plan treated static slot 0 as reusable. A bounded live login on
this exact build disproved that assumption: character entry reached an indirect
call expecting a game callback and trapped with `function signature mismatch`
when slot 0 contained the six-argument companion dispatcher. Slot 0 is therefore
a dynamic game sentinel. The transform ABI 8 correction leaves every input
entry untouched and owns only the appended slot.

The next live login exposed a separate `TextParser.cpp:724 IsParam(data)`
assertion. The trap stack contained only game functions because the corruption
preceded the parser: the original Rust kernel was a normal imported-memory
module whose data segment and stack pointer were both linked at `0x100000`.
Instantiation wrote 28 bytes there and every callback used that unreserved
game region as its stack. The kernel is now a position-independent WebAssembly
side module. The renderer reserves one 64 KiB block with the game allocator and
injects its data base and stack pointer; the side module receives a separate
empty table. ABI 5 verification pins a 268-byte, four-byte-aligned `dylink.0`
memory requirement, no table entries, deterministic bytes, and proves that
instantiation does not change the former fixed region.

## Tick and cursor

The exported `EmscriptenExeThreadMainLoop` remains absolute function 446 with
signature `(i32) -> void`. The cursor boundary is absolute function 2469 with
signature `(i32, i32, i32, i32, i32) -> void`; existing table slot 922 points
to it. The two previously recovered producer functions remain 2828 and 2834.

Live proof on build 38,797 observed item, ground-arrow, salvage, and restored
arrow transitions. A click can change interaction mode without a new cursor
callback until hit-testing runs. The renderer's bounded trusted-click refresh
produced two cursor events and the salvage bitmap without moving the physical
pointer.

## Player chat

Absolute function 8947 contains exactly three decoded
`i32.const 0x10000082` sites. Each directly calls absolute function 6842.
Nearby producers 8942 and 8945 emit `0x1000007f` and `0x10000080` to the same
target. Function 6842 retains `(i32, i32, i32) -> void` and the recovered
`FrApi.cpp` / `msgId >= FRAME_MSG_EX` assertion shape.

The live proof displayed one ordinary player message once and advanced the
counter once. `/age` did not advance it. No message text or pointer entered the
companion ABI.

## Hero panel

Current GWCA/GWToolbox headers name Hide/Show hero panel as `0x100001a3` and
`0x100001a4`; the archived header used different values, so these remain inside
this exact certificate. The minimal validated path is:

```text
GameContext + 0x4c -> PartyContext
PartyContext + 0x54 -> current PartyInfo
PartyInfo + 0x24 -> heroes Array
HeroPartyMember stride 0x18
  +0x00 AgentID
  +0x04 owner player number
  +0x08 HeroID
```

Ownership is compared with `CharacterContext + 0x2ac`. At most seven unique
owned HeroIDs are accepted. Only these scalars are published.

The relocated UI dispatcher is safe for preserving a game-owned dispatch, but
not as a naked tick-time sender. A live Show attempt from the main-loop hook
aborted at `EmscriptenExeProp.cpp`'s `s_propContext` assertion, and deferring it
until the next game-owned UI dispatch avoided the abort but introduced a
visible multi-second delay.

Static function 228 identifies the missing boundary: `PropGet` loads the active
context from `0x28cc20` and asserts at `EmscriptenExeProp.cpp:32` when the slot
is null. Functions 230/231 get and set it, and official scoped wrappers perform
save → install → call → restore. That proves the mechanism exists, but not that
an arbitrary post-main-loop call has the correct lifecycle and parser state.

A later live report again reached `TextParser.cpp:724 IsParam(data)`. A
game-owned UI dispatch is not automatically a safe command gateway: its caller
may still be a nested text-parser producer, and the cached hero can become stale
between a tick and that event. ABI 5 therefore makes the companion strictly
passive. Every wrapper calls its game clone first and only then notifies Rust;
all clones remain private, the side module imports no game function, and the
Show/Hide command and synthetic mouse nudge are removed. No tick-time
PropContext write or companion-to-game re-entry remains. A fresh-process live
run must confirm login, cursor, chat, and read-only hero/panel observation; it
must not automate Show/Hide.

## Live correction and update policy

The first static candidate named `contextRoot` as `0x5a0ed4`. The bounded live
hero proof disproved it: that global resolves into `FcArchive` state and leaves
the expected game-context slot null. `0x5a0ee0` resolves to a context array,
slot 6 points to a GameContext, and its character and party chains jointly
validated map 449, player number 1, and Koss as `{agent: 323, owner: 1,
hero: 6}`. The exact certificate now uses `0x5a0ee0`.

This correction does not authorize automatic Enhancement relocation. A shared
delta cannot prove three hook semantics and every structure field. Unknown
builds keep template recovery where it is independently proven and run the
official game without Toolbox until every required hook and address is
re-derived.
