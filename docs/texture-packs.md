# Texture packs

Texture packs let a player use classic TexMod interface designs without a
Windows injector. gwonmac reads texture files from a `.tpf`, prepares a private
local generation, and substitutes only textures whose legacy TexMod hash
matches an upload from the official Guild Wars client.

This is a texture compatibility feature. It is not a plugin system: packs
cannot run code, read game state, send input, open the network, or change game
files.

## Player flow

1. Open **Settings → Game → Texture packs**.
2. Choose **Import TPF** and select one `.tpf` file.
3. Review the imported name, texture count, source size, and checksum.
4. Select that pack. The next game window opened for any account uses it.

Import does not activate a pack. One pack can be active globally, or the
player can select **Official textures**. A window keeps the generation it
started with, so changing or removing a pack does not alter an open game. Close
and open that game window to apply a new selection.

Removing a pack asks for confirmation. If it was selected, gwonmac selects
Official textures first. Resetting application settings also selects Official
textures but keeps every installed pack. An exact duplicate import focuses the
existing pack and does not create another copy.

## Compatibility contract

Version 1 accepts legacy 32-bit TexMod TPF archives with a `texmod.def` file.
Mapped textures can be DDS or PNG. The DDS decoder supports uncompressed RGB/A
and DXT1, DXT3, and DXT5 images. Compressed DDS blocks are preserved when the
game uploads the same compressed format; an RGBA fallback covers decoded
uploads.

The complete pack is refused when any mapping or image is unsafe or
unsupported. Version 1 does not accept ordinary ZIP files, 64-bit uMod hashes,
DLLs, scripts, executable mods, texture stacking, URL imports, pack editing,
or partial imports. Supporting ZIP would create a second, ambiguous package
format without helping the available Guild Wars UI catalogue, so it is an
explicit non-goal until real packs require it.

A valid pack can still contain hashes for another Guild Wars client build or
for textures that the player does not encounter. Those entries remain inert.
If a prepared generation cannot be loaded, the affected new window starts
with Official textures.

The explicit controller-prompt setting has higher priority than a pack. When
PlayStation prompts are selected, that certified atlas remains PlayStation even
if the active TPF also maps the original controller atlas.

## Safety limits

Import is local and bounded. The parser rejects split and Zip64 archives,
unknown compression or encryption, unsafe paths, checksum failures, conflicting
target mappings, and missing images. Current upper bounds are:

- 256 MB source TPF;
- 1,024 archive entries;
- 64 MB per expanded entry;
- 256 MB total expanded archive data;
- 4,096 × 4,096 pixels and 64 MB decoded data per texture; and
- 256 MB for one compiled generation.

The parser validates the whole archive before publishing it. Temporary import
data is private and removed on the next start after an interrupted import. One
directory rename publishes the source, metadata, and compiled generation
together, so an interrupted import never becomes an installed pack.

## Storage and ownership

The main process owns all paths and file access. The launcher preload exposes
only import, select, and remove commands. The game renderer receives one opaque
generation ID and can fetch only that generation's exact `manifest.json` and
`textures.rgba` routes. It never receives the downloaded source path.

Data lives below the existing Guild Wars application-support profile in
`texture-packs/`:

- `selection.json` contains only the selected pack ID;
- each valid `packs/<id>/` directory is one installed pack;
- `packs/<id>/source.tpf` is the exact managed source copy;
- `packs/<id>/metadata.json` is its import metadata;
- `packs/<id>/compiled/1/` is its derived, rebuildable runtime generation; and
- `staging/` contains only incomplete import work.

The installed set comes only from complete pack directories. There is no
second catalogue of installed packs. An open game window holds a small lease
on its generation. Removing that pack moves its directory out of the installed
set, then deletes it when the last window closes.

Files are private to the local user. No pack, checksum, path, or usage data is
uploaded by gwonmac. The managed source is kept so a later compiled-format
version can rebuild from the exact imported TPF instead of adding a permanent
compatibility layer.

## Failure and recovery

The launcher gives a specific refusal for damaged archives, unsupported TPF
variants, unsafe paths, invalid definitions, missing images, conflicting
targets, unsupported hashes or images, size limits, disk space, and file
permissions. Import never changes the active pack on failure.

If the managed source is missing, the pack remains visible as unavailable and
cannot be selected. The player can remove it and import the original TPF again.
If all texture packs need to be bypassed, select **Official textures** before
opening a new game window.

## Release proof

Automated tests own archive decoding, checksums, limits, managed-copy fidelity,
deduplication, crash recovery, selection and removal, renderer heap restoration,
compressed and RGBA replacement, preload vocabulary, and launcher behavior.
Every release build also packages the PNG decoder as a runtime dependency.

Live graphics certification remains a human check because the official client
chooses which textures and compressed upload paths occur in a real session.
The live check must import a known Guild Wars UI TPF, select it, open a fresh
game window, confirm representative inventory and shared UI textures, return to
Official textures, and verify a second fresh window. A live failure blocks the
feature claim; it must not be hidden by accepting only part of a pack.
