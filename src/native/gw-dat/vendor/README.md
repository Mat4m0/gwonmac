# Guild Wars archive and texture decoding

This directory is a source port from
[GWToolbox++](https://github.com/gwdevhub/GWToolboxpp). GWToolbox++ distributes
the source under the MIT License. GWToolbox++ identifies these files as derived
from
[GuildWarsMapBrowser](https://github.com/Jonathan-Greve/GuildWarsMapBrowser) by
Jonathan Bjørn Greve.

Keep both grants and the required upstream credit beside the source:

- `COPYING-GWTOOLBOX`
- `COPYING-GUILDWARSMAPBROWSER`

`xentax.cpp` decompresses an archive stream. The three `Atex*` files decode a
texture after decompression. Skill icons use `DXTL`. This is the `'L'` case in
`ProcessImageFile`.

## Do not modify the vendored algorithm

> [!CAUTION]
> Treat these files as a black box. Take an upstream change instead of cleaning
> up or correcting the transcribed code.

The source was transcribed by hand from compiled x86 code. Some variables have
register-based names such as `EBPminus8` and `ESIplus8`. Put project-owned
validation and fixes in the wrapper in the parent directory. The wrapper must
bound each input and output dimension before it calls the vendored code.

`scripts/build.mjs` applies three required compiler adjustments:

- `-D__int64="long long"` supplies the MSVC integer type to Clang.
- `-Wno-multichar` permits the four-character constants in `ProcessImageFile`.
- `-Wno-constant-logical-operand` permits the verified expression below.

## Preserve the logical AND expression

`AtexDecompress.cpp` contains this expression:

```cpp
int AlphaDataSize2 = ((ImageFormat && 21) - 1) & 2;
```

Do not change `&&` to `&`. The expression looks suspicious, but the current
result is required. For each nonzero `ImageFormat`, the expression makes
`AlphaDataSize2` equal to zero.

Changing it to `&` makes DXTL format `0x12` add two bytes to each block. This
shifts the decoded data. Real archive tests show that skill icons decode
correctly with the current expression. GWToolbox++ also ships and uses this
form. Silence the warning; do not change the result.
