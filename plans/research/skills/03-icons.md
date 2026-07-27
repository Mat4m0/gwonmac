# Skill icons

Status: **3,439 of 3,439 non-zero icon IDs resolve**

## Addressing

The installed `Gw.snapshot` is a Guild Wars `.dat` archive. Its manifest uses
uncompressed linear chunks, so an archive range maps directly to chunk-store
ranges.

`src/main/core/gw-archive.ts` owns:

- the 32-byte archive header;
- the MFT header and 24-byte slots;
- the file-ID expansion index;
- stream-chain lookup.

The skill table supplies each icon's archive file ID. `findStream` resolves it
without scanning or assembling the 4.2 GB snapshot.

## Decode pipeline

```text
GWDat-compressed stream
  -> UnpackGWDat
  -> ATEX texture
  -> DXT1/DXT5 blocks
  -> four-channel pixels
  -> 32-bit BMP response
```

The native helper is `src/native/skill-icons/decoder-main.cpp`; attributed
decoder sources and their license are in
`src/native/skill-icons/vendor/`.

The helper accepts at most 1 MiB of input, bounds decoded data to 1 MiB, and
bounds icon dimensions to 256 × 256. The parent process applies a five-second
timeout and a separate output limit.

`SkillAssets` keeps only the 256 most recently requested BMPs in memory. This is
derived, rebuildable data; the installed archive remains canonical.

## RGB565 channel order

Guild Wars stores BC1 endpoints as:

```text
BBBBB GGGGGG RRRRR
```

The attributed decoder labels the low five bits red, so its output bytes are
actually B, G, R, A. A BMP also stores B, G, R, A. `decodedIconToBmp`
therefore preserves the decoder byte order instead of applying a conventional
RGBA-to-BGRA swap.

This is an exact decode-boundary correction. Do not compensate with CSS hue,
saturation, or filter changes.

## Elite frame

The elite frame is UI state derived from the skill record's elite bit, not part
of the icon bitmap. `src/shared/ui/components.css` renders it above the image
with a dedicated pseudo-element and shared theme tokens. The catalogue also
uses a textual `Elite` badge, so the distinction is not color-only.

## Historical measurements

The first archive census and field discovery are retained in
[the original evidence note](../../tools/hero-builds/evidence/skill-icons-archive.md).
Its “still open” section is historical; the implementation and this document
own the current state.
