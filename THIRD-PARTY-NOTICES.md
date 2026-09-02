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

## ArenaNet visual material

The launcher video, poster, and logo in `src/renderer/images/` were published
by ArenaNet for Guild Wars Reforged. The installer, project website, and
documentation also include Guild Wars Reforged logos, backgrounds, and
screenshots that show Guild Wars imagery.

These assets and the Guild Wars marks remain the property of ArenaNet or their
respective owners. They are not relicensed under GPL-3.0-only. Their inclusion
does not grant permission to reuse them separately.

No cursor artwork is distributed with this application. The required native
cursor reads the bitmap that the player's Guild Wars client decoded in memory.
It draws the bitmap only for that session. The artwork is not copied into this
repository, the packaged application, or a release artifact.

## GWToolbox++ and GuildWarsMapBrowser

Trade Chat interoperates with the public read-only Kamadan and Pre-Searing
services operated for GWToolbox++ at `kamadan.gwtoolbox.com` and
`ascalon.gwtoolbox.com`. GWonMac is not affiliated with those services. It uses
their bounded public WebSocket protocol and links back to the selected source.
Release remains conditional on confirming the service owner's permission or
published compatibility expectations.

The Trader prices catalogue includes the small item and profession PNGs that
the Kamadan price interface publishes inline or from its fixed image routes.
Kamadan does not publish dye images, so the dye vial PNGs come from the
[Guild Wars Wiki dye icon gallery](https://wiki.guildwars.com/wiki/Category:Dye_icons).
These images depict ArenaNet game content. They remain the property of ArenaNet
or their respective owners, are not covered by this project's GPL license, and
must not be reused separately. They are included under ArenaNet's current
[Content Terms of Use](https://www.arena.net/en/legal/content-terms-of-use) for
this independent fan project; those terms, not this repository's GPL license,
govern their use.

`src/native/gw-dat/vendor/` is a source port from
[GWToolbox++](https://github.com/gwdevhub/GWToolboxpp), which distributes it
under the MIT License and identifies it as derived from
[GuildWarsMapBrowser](https://github.com/Jonathan-Greve/GuildWarsMapBrowser) by
Jonathan Bjørn Greve. It decompresses an archive stream and decodes a texture.

`src/renderer/cartography-spike/toolbox-cartography-data.ts` contains compact
cell masks converted from GWToolbox++ `CartographyData.h` at commit
`cbe940d3edcc0c47fc02a59079a8f6e08d11f4cf`. They identify standable and
creditable cartography cells without bundling map textures or annotations.
The source file is distributed by GWToolbox++ under its MIT License.

Both grants are included as `COPYING-GWTOOLBOX` and
`COPYING-GUILDWARSMAPBROWSER` beside the source and in the packaged
application's Resources directory.

This is decoding machinery, not game content. Every fact the build editor shows
— each skill's name, description, icon, profession, attribute and costs — is
read at runtime out of the Guild Wars installation on the player's own machine
and cached there. The original Latin UI font is also read from that local game
archive and converted to a browser font in memory. Apart from the explicitly
identified Trader prices artwork above, this game content is not copied into
the repository, packaged application, or a release artifact.

## ws

The main process uses [`ws`](https://github.com/websockets/ws) for bounded
WebSocket client connections. `ws` is copyright its contributors and is
distributed under the MIT License.

## pngjs

The main process uses [`pngjs`](https://github.com/pngjs/pngjs) to decode
bounded PNG entries in local texture packs and to encode local cartography
evidence. `pngjs` is copyright its contributors and is distributed under the
MIT License. Its license is retained in the packaged module.

## QT Friz Quad

QT Friz Quad is © 1992 QualiType and is distributed under the SIL Open Font
License 1.1. The complete license is included as `COPYING-QUALITYPE` beside the
font in source distributions and in the packaged application's Resources
directory.

## Inter

Inter is © 2016 The Inter Project Authors and is distributed under the SIL
Open Font License 1.1 through `@fontsource-variable/inter` 5.3.0. GWonMac
ships the unmodified variable-weight language subsets. The complete license is
included as `COPYING-INTER` in the packaged application's Resources directory.

## Kenney Input Prompts

`src/renderer/images/playstation-controller-prompts.png` is composed from the
PlayStation Series icons in [Kenney Input Prompts](https://kenney.nl/assets/input-prompts),
version 1.1. The selected files came from the public
[`tanuki-billie/kenney-input-prompts`](https://github.com/tanuki-billie/kenney-input-prompts)
mirror, which retains Kenney's included `LICENSE.txt`. The source pack was
created and distributed by Kenney and released under
[Creative Commons Zero 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
GWonMac adds the dark face-button plates and the L4, L5, R4, R5, L, and R label
plates needed by Guild Wars' fixed controller atlas. PlayStation is a trademark
of Sony Interactive Entertainment Inc.; GWonMac is not affiliated with or
endorsed by Sony.
