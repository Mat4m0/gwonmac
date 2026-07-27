# Guild Wars texture decoder

This directory is a source port from
[GWToolbox++](https://github.com/gwdevhub/GWToolboxpp), where it is distributed
under the MIT License. GWToolbox++ identifies these files as derived from
[GuildWarsMapBrowser](https://github.com/Jonathan-Greve/GuildWarsMapBrowser) by
Jonathan Bjørn Greve.

Both grants and the required upstream credit are preserved beside the source:

- `COPYING-GWTOOLBOX`
- `COPYING-GUILDWARSMAPBROWSER`

The application uses only the archive and texture decoding routines. The
wrapper in the parent directory bounds all input and output dimensions before
the derived routines run.

`gwca/Skills.h` is the `SkillID` vocabulary distributed with GWToolbox++'s
vendored GWCA headers under the same MIT grant. It supplies stable English
identifier spellings only; installed-client records remain authoritative for
profession, elite state, and icon file IDs.
