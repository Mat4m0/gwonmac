# Controller-prompt atlas evidence

> **Status: exact-build historical evidence.** These values apply only to the
> client SHA named below. A different client receives ArenaNet's unchanged
> controller prompts until its atlas is independently certified.

## Certified upload

| Fact | Value |
| --- | --- |
| JSPi client SHA-256 | `b8cc509714b82b69fdfd79a26ba257aa4c9ef23d90bca9dfcbbd044e371cfb17` |
| WebGL upload | level 0, 256×512, RGBA/unsigned byte |
| Upload byte length | 524,288 |
| Direct uMod running CRC-32 | `0x74eb6846` |
| Required replacement transform | `direct` |
| Matching candidates in the bounded diagnostic capture | 1 |

The older native TexMod/uMod texture has running CRC-32 `0xa30969c1`, but the
JSPi renderer rebuilds/transposes uploads. That native checksum is research
context only and is deliberately **not** accepted at runtime. Runtime
certification binds the observed WebGL checksum to the exact client SHA.

The hook observes the existing synchronous Emscripten WebGL import. It replaces
the bytes only for that call and restores the WebAssembly heap immediately.
Dimensions alone never authorize replacement. Unsupported, malformed, partial,
compressed, redefined, deleted, or context-reset textures lose their match.

## Recertification

1. First check whether ArenaNet now offers PlayStation symbols. If it does,
   delete the substitution instead of updating it.
2. Start a development build with a real controller or call
   `gwVirtualGamepad.activateUi()` in DevTools.
3. Read `gwControllerPromptTextureStats()` after the controller UI appears.
4. Confirm that exactly one level-zero 256×512 RGBA/unsigned-byte candidate is
   present. Record all four reported hashes; do not choose a nearest match.
5. Visually confirm that replacing only this upload changes controller prompts
   throughout the UI and does not change unrelated textures.
6. Add the new exact client SHA, observed direct hash, and required transform to
   `CONTROLLER_PROMPT_ATLAS_CERTIFICATIONS`. Preserve the old entry only if that
   client remains distributed.
7. Run the focused texture tests, `pnpm check`, integration tests, release tests,
   and a real-client visual check before publishing.

If the candidate is absent or ambiguous, leave the feature disabled for that
client. Do not certify from dimensions, the legacy native checksum, or visual
similarity alone.

## Replacement composition

The reviewed replacement is a fixed 4×8 grid of 64×64 cells, stored as
`src/renderer/images/playstation-controller-prompts.png`. Its SHA-256 is
`d3dcb98fa3bbc9541f6456a36611ebad44e557ef1099aad328393b4eca25f294`.

Source: Kenney Input Prompts 1.1, `PlayStation Series/Default`, from the
`tanuki-billie/kenney-input-prompts` mirror named in `THIRD-PARTY-NOTICES.md`.

| Row | Cells from left to right |
| --- | --- |
| 1 | `playstation_button_color_cross`, `..._circle`, `..._square`, `..._triangle` |
| 2 | `playstation5_button_options`, `playstation5_button_create`, `playstation_trigger_l1`, `..._r1` |
| 3 | `playstation_trigger_l2`, `..._r2`, `playstation_stick_l_press`, `..._r_press` |
| 4 | `playstation_dpad_down`, `..._left`, `..._up`, `..._right` |
| 5 | custom dark label plates: `L4`, `L5`, `R4`, `R5` |
| 6 | four transparent cells |
| 7 | `playstation_stick_l`, `playstation_stick_r`, `playstation_trigger_l2`, `..._r2` |
| 8 | custom dark label plates: `L`, `R`, then two transparent cells |

Kenney's symbols were fitted without changing their aspect ratio. The six
custom labels use the same dark rounded plate treatment because Kenney does not
provide those Guild Wars-specific virtual-button names. The final PNG and its
hash are the reviewed source of truth; changing any cell requires updating this
record, attribution where necessary, the pinned asset test, and live visual QA.
