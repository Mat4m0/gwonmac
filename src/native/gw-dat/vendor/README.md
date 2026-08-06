# Guild Wars archive and texture decoding

This directory is a source port from
[GWToolbox++](https://github.com/gwdevhub/GWToolboxpp), where it is distributed
under the MIT License. GWToolbox++ identifies these files as derived from
[GuildWarsMapBrowser](https://github.com/Jonathan-Greve/GuildWarsMapBrowser) by
Jonathan Bjørn Greve.

Both grants and the required upstream credit are preserved beside the source:

- `COPYING-GWTOOLBOX`
- `COPYING-GUILDWARSMAPBROWSER`

`xentax.cpp` decompresses an archive stream; the three `Atex*` files decode a
texture once decompressed. Skill icons are `DXTL`, which is the `'L'` case in
`ProcessImageFile`.

## Treat this as a black box

These are hand-transcribed from compiled x86 — variables are named after the
registers they occupied (`EBPminus8`, `ESIplus8`). They are not maintained here
and should not be edited to fix a bug; take the upstream change instead. The
wrapper in the parent directory is where this project's own code lives, and it
bounds every input and output dimension before the derived routines run.

Three local build adjustments are required and are applied in `scripts/build.mjs`
rather than by patching the sources, so they stay diffable against upstream:

- `-D__int64="long long"` — `__int64` is an MSVC builtin that clang lacks.
- `-Wno-multichar` — `ProcessImageFile` compares four-character constants.
- `-Wno-constant-logical-operand` — see below.

## The `&&` in `AtexDecompress.cpp:24` is not a bug to fix

    int AlphaDataSize2 = ((ImageFormat && 21) - 1) & 2;

clang warns that the logical `&&` was probably meant to be a bitwise `&`, and
read as English it clearly was. Do not change it.

`AlphaDataSize2` is summed into `BlockSize`, so it affects every decode. As
written, any non-zero `ImageFormat` makes the parenthesised term `1`, so the
whole expression is `0` and the term is dead. With `&`, DXTL — format `0x12`,
which is what skill icons are — would instead yield `2` and shift every block.

Skill icons decode correctly with the code exactly as it stands here, verified
against real archive contents rather than by reading it. This is also the form
GWToolbox++ ships and uses in production. Whatever the original author intended,
`0` is the value that produces correct images, so the warning is silenced rather
than the source corrected.
