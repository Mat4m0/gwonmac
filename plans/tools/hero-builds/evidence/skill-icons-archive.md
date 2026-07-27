# Where skill icons live, and what it costs to read them

Date: 2026-07-27
Status: **historical discovery record**. The current implementation and
verification state live in
[`plans/research/skills/00-overview.md`](../../../research/skills/00-overview.md).
This document intentionally preserves the hypotheses and open questions that
were true during discovery.

Originally measured against the 4.2 GB archive in this machine's own profile.
Everything below was read from `~/Library/Application Support/Guild Wars/game/`,
not inferred from GWToolbox or the wiki.

## The headline

The web port's `Gw.snapshot` **is a Guild Wars `.dat` archive**. Not a
WebGL-native repack, not a converted asset bundle — the same container the
desktop client uses, byte for byte, magic and all.

That answers the open question in `primitives.md` the expensive way. There was a
real chance ArenaNet had converted textures to something GPU-native for WebGL,
which would have made icons a header parse. They did not.

## How the archive is addressed

`artifacts/manifest.json` says `compressionMode: "none"`, so the chunk store
concatenates to the archive with no transformation: chunk *i* is bytes
`[i × 262144, …)` of a 4,200,311,296-byte file. Reading any offset is a matter
of picking the chunk and slicing.

### Archive header, 32 bytes

Field offsets **measured**, and two of them are not what a first reading
suggests — the value that looks like an MFT offset is its size:

| Offset | Size | Field | Value here |
| --- | --- | --- | --- |
| `0x00` | 4 | magic | `3AN\x1a` |
| `0x04` | 4 | header size | 32 |
| `0x08` | 4 | sector size | 512 |
| `0x0C` | 4 | crc | `0x4ccbad70` |
| `0x10` | 8 | **MFT offset** | 4,196,085,248 |
| `0x18` | 4 | **MFT size** | 4,225,992 |
| `0x1C` | 4 | flags | 0 |

Confirmed rather than assumed: the MFT's own magic `Mft\x1a` was found by
scanning, and it sits at exactly `0x10`'s value. MFT entry 3 then describes the
MFT itself — offset 4196085248, size 4225992 — which independently confirms both
the header fields and the entry layout below.

### MFT

Header record, 24 bytes: magic `Mft\x1a`, then **entry count at `0x0C`** —
**176,083 files**. (Not at `0x10`, which reads 0.)

Each subsequent 24-byte record:

| Offset | Size | Field |
| --- | --- | --- |
| `0x00` | 8 | offset into the archive |
| `0x08` | 4 | size |
| `0x0C` | 4 | flags / compression |
| `0x10` | 4 | — |
| `0x14` | 4 | type or hash |

## What the textures are

Census over 12,577 evenly-spaced entries — evenly spaced deliberately, since
file types are grouped and a prefix sample sees only one kind:

| Container / codec | Count |
| --- | --- |
| `ATEX` / `DXT1` | 121 |
| `ATEX` / `DXT5` | 2 |

Dimensions: **119 of 123 are 32×32**, the rest 64×64. 32×32 is the skill-icon
size, and 64×64 is consistent with GWToolbox's `icon_file_id_hi_res`. These are
the icons.

Also present: `ffna` at 18.4% of all files (the model/data container) and a
large majority whose first bytes are non-ASCII.

## The cost, and the thing that decides it

**The ATEX payload is custom-compressed. It is not raw DXT blocks.**

A raw 32×32 DXT1 image is always 512 bytes of blocks, so 524 with the header, or
708 with a full mip chain. Measured file sizes for 32×32 `ATEX/DXT1`:

```
436   484   88   144   320   276   116   284      (and 572 for a DXT5)
```

Variable, and mostly *below* the raw block size. That is compression, so the
`DXT1` fourcc names what the payload decompresses **to**, not what it is.

So reading an icon is two decoders, not one:

1. **ATEX decompression** → DXT blocks. The expensive half. GuildWarsMapBrowser
   solved it (`AtexAsm`, `AtexDecompress`); GWToolbox vendors that under a
   **custom licence**, so it is readable for format knowledge and must be
   reimplemented rather than copied.
2. **DXT1 / DXT5 → RGBA**. Public, standard block compression, ~100 lines each.

## What this is good for

Both halves are pure functions over bytes: no Electron, no game, no
certification. And there are **176,083 real fixtures sitting on disk** — a
decoder can be run against thousands of real textures and asserted to produce
plausible RGBA without crashing, which is a better test corpus than most codecs
ever get.

## The mapping — ANSWERED, and better than expected

**The skill table is static data inside `Gw.jspi.wasm`.** Not in memory, not in
the archive: in the client binary, which we already have on disk. So reading it
needs no companion kernel, no certified read domain, and no running game.

3,443 records of 164 bytes (GWCA's `Skill`, `sizeof == 0xa4`), indexed by skill
id, at offset **7,520,290** in this build. Fields that matter:

| Offset | Field |
| --- | --- |
| `0x00` | skill id (equals the record index) |
| `0x08` | campaign |
| `0x0C` | type |
| `0x10` | special — `& 0x4` is elite |
| `0x28` | profession (byte) |
| `0x29` | attribute (byte) |
| `0x8C` | **icon file id** |
| `0x94` | hi-res icon file id |
| `0x98` | name *string id* — text lives in another table, not read yet |

### Found by shape, not pinned

The offset is build-specific, but unlike the `Layout` constants it does not need
live evidence: the table has a shape nothing else in the binary has.
`src/tools/skill-table.ts` searches for it, so a new ArenaNet build moves the
table and the extractor still finds it.

The signature has to be composite. Scanning for "plausible icon file ids" alone
returned **2,559 false windows**, and the first one printed convincing garbage.
Four weak fields together — ids ascending, campaign small, profession in range,
attribute real or the sentinel — are specific enough to find it on the first hit.

### It resolves

Every one of the 3,439 non-zero icon file ids resolves to a stream in the
archive. **Zero missing.** A hit rate that clean is itself the confirmation that
the table, the id index, and the chain walk are all correct.

- 391 skills are elite, which matches the game's real elite count.
- Every icon is stream 0, GWDat-compressed, and declares a decompressed size of
  **exactly 4,648 bytes** — uniform across all 3,439.

## Still open: the pixels

Three decoders, in order, none written:

1. **GWDat decompression.** The gateway; nothing works without it. GWToolbox's
   copy is ~770 lines of transliterated x86 (`ESIplus8`, `EBPminus18`), plus
   three constant tables — a direct port of the client's own routine.
2. **ATEX decompression** → DXT blocks. ~1,000 lines.
3. **DXT1 / DXT5 → RGBA.** Public and standard; the easy one.

All three are pure functions over bytes, and there are 3,439 real fixtures with
a known expected output size, which makes the first one self-checking: correct
output starts with `ATEX` and is 4,648 bytes long.
