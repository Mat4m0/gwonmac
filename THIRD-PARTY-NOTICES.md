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
must not be reused separately.

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
and cached there. The original Latin UI font is also read from that local game
archive and converted to a browser font in memory. Apart from the explicitly
identified Trader prices artwork above, this game content is not copied into
the repository, packaged application, or a release artifact.

## ws

The main process uses [`ws`](https://github.com/websockets/ws) for bounded
WebSocket client connections. `ws` is copyright its contributors and is
distributed under the MIT License.

## QT Friz Quad

QT Friz Quad is © 1992 QualiType and is distributed under the SIL Open Font
License 1.1. The complete license is included as `COPYING-QUALITYPE` beside the
font in source distributions and in the packaged application's Resources
directory.
