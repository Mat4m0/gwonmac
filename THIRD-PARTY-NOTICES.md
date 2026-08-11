# Third-party notices

The GPL-3.0-only license in `LICENSE` applies to the gwonmac host source code.
It does not grant rights in the third-party names, game content, visual
material, or font described below.

## Guild Wars and Guild Wars Reforged

© ArenaNet LLC. All rights reserved. NCSOFT, ArenaNet, Guild Wars, Guild Wars
2, GW2, Heart of Thorns, Path of Fire, End of Dragons, Secrets of the Obscure,
Janthir Wilds, Visions of Eternity, and all associated logos, designs, and
composite marks are trademarks or registered trademarks of NCSOFT Corporation.
All other trademarks are the property of their respective owners.

This independent interoperability project is not affiliated with, endorsed,
sponsored, or approved by ArenaNet or NCSOFT.

The application does not contain ArenaNet game binaries. It downloads the
official client directly from ArenaNet.

## Application icon

`assets/AppIcon.png` is the 1024 × 1024 Guild Wars Reforged application
artwork published by ArenaNet on the official
[Apple App Store listing](https://apps.apple.com/app/guild-wars-reforged/id820613069).
The committed `assets/AppIcon.icns` was prepared by the independent
[gwnative project](https://github.com/jean-humann/gwnative) from that artwork
for macOS. The artwork and Guild Wars marks remain the property of their
respective owners and are not covered by this project's GPL license.

## Other visual material

Loading-screen photography is credited to
[Snapshot Henchman](https://bloogum.net/guildwars/). Guild Wars imagery,
screenshots, loading artwork, and derived favicons are not relicensed under
GPL-3.0-only. Their inclusion does not grant permission to reuse them
separately.

`docs/assets/gwonmac-game.jpeg` is a screenshot of gwonmac. It includes Guild
Wars marks and loading artwork. The screenshot does not change the rights in
that material.

No cursor artwork is distributed with this application. The required native
cursor reads the bitmap that the player's Guild Wars client decoded in memory.
It draws the bitmap only for that session. The artwork is not copied into this
repository, the packaged application, or a release artifact.

## GWToolbox++ and GuildWarsMapBrowser

`src/native/gw-dat/vendor/` is a source port from
[GWToolbox++](https://github.com/gwdevhub/GWToolboxpp), which distributes it
under the MIT License and identifies it as derived from
[GuildWarsMapBrowser](https://github.com/Jonathan-Greve/GuildWarsMapBrowser) by
Jonathan Bjørn Greve. It decompresses an archive stream and decodes a texture.

Both grants are included as `COPYING-GWTOOLBOX` and
`COPYING-GUILDWARSMAPBROWSER` beside the source and in the packaged
application's Resources directory.

This is decoding machinery, not game content. Every fact the build editor shows
— each skill's name, description, icon, profession, attribute and costs — is
read at runtime out of the Guild Wars installation on the player's own machine
and cached there. As with the game cursor described above, none of it is copied
into this repository, the packaged application, or any release artifact.

## QT Friz Quad

QT Friz Quad is © 1992 QualiType and is distributed under the SIL Open Font
License 1.1. The complete license is included as `COPYING-QUALITYPE` beside the
font in source distributions and in the packaged application's Resources
directory.
