# Third-party notices

The GPL-3.0-only license in `LICENSE` applies to the gwonmac host source code.
It does not grant rights in the third-party names, game content, visual
material, or font described below.

## Guild Wars

Guild Wars and associated game content are © 2005–2026 ArenaNet, Inc. NCsoft,
the interlocking NC logo, ArenaNet, Arena.net, Guild Wars, and associated logos
and designs are trademarks or registered trademarks of NCsoft Corporation.
This independent interoperability project is not affiliated with or endorsed
by ArenaNet or NCSoft.

The application does not contain ArenaNet game binaries. It downloads the
official client directly from ArenaNet.

## Visual material

Loading-screen photography is credited to
[Snapshot Henchman](https://bloogum.net/guildwars/). Guild Wars imagery,
screenshots, loading artwork, the application icon, and derived favicons are
fan-project visual material and are not relicensed under GPL-3.0-only. Their
inclusion does not grant permission to reuse them separately.

No cursor artwork is distributed with this application. When the player turns
on the optional game cursor, the host reads the bitmap the player's own
installed Guild Wars client has already decoded in its own memory and draws it
over the game view for the duration of that session. That artwork is never
copied into this repository, the packaged application, or any release
artifact.

## QT Friz Quad

QT Friz Quad is © 1992 QualiType and is distributed under the SIL Open Font
License 1.1. The complete license is included as `COPYING-QUALITYPE` beside the
font in source distributions and in the packaged application's Resources
directory.

## Guild Wars archive and texture decoder

The isolated skill-icon decoder under `src/native/skill-icons/vendor/gwdat` is
ported from [GWToolbox++](https://github.com/gwdevhub/GWToolboxpp), © 2024 Guild
Wars Dev Hub, under the MIT License. GWToolbox++ identifies that decoder as
derived from
[GuildWarsMapBrowser](https://github.com/Jonathan-Greve/GuildWarsMapBrowser),
© 2023 [Jonathan Bjørn Greve](https://github.com/Jonathan-Greve), under its
custom permissive license.

The complete grants are included beside the source as `COPYING-GWTOOLBOX` and
`COPYING-GUILDWARSMAPBROWSER`, and both are copied into packaged application
Resources. No decoded Guild Wars artwork is distributed; the helper decodes
icons from the player's own local client.
