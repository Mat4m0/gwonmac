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

Two local build adjustments are required and are applied in `scripts/build.mjs`
rather than by patching the sources, so they stay diffable against upstream:

- `-D__int64="long long"` — `__int64` is an MSVC builtin that clang lacks.
- `-Wno-multichar` — `ProcessImageFile` compares four-character constants.
