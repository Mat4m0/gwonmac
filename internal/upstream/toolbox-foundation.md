# Toolbox foundation evidence — build 38,797

This is the investigation record. The executable certificate is
`src/main/core/enhancement-builds.ts`.

## Module identity

- official SHA-256:
  `3229678d3fd7d2f0e309530086a614d97f02e7eeb3ca12650ababfd2eb360817`
- post-template SHA-256:
  `9ee332604a9b2adbdfa1a8ab217f4fd1dac58b01a2443e037bc5bd11f279d094`
- game program/build: `1` / `38797`
- function imports: 219
- table min=max: 4683; slot 0 is the sole empty slot

The normal template recertifier produced the post-template identity. Applying
the production three-entry transform to that exact module validates as
WebAssembly and leaves both table limits unchanged.

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
owned HeroIDs are accepted. The developer command uses only the first current
owned HeroID and executes through the relocated UI original on the game tick.

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
