# Classic frame artwork

These two original Guild Wars UI regions are decorative fan-project assets.
ArenaNet owns them; the repository's GPL license does not cover this artwork.
See [third-party notices](../../../../THIRD-PARTY-NOTICES.md) and
[ArenaNet's content terms](https://www.arena.net/en/legal/content-terms-of-use).
The existing noncommercial fan-project use and required ArenaNet notice apply.

The accepted `gw-ui-study` reconstruction supplied the lossless PNG sources.
They came from the unaltered textures in Minimalus UI Mod 3.2:

| File | Original texture | PNG SHA-256 |
| --- | --- | --- |
| `body.png` | `GW.EXE_0x0BE51B7C.dds` | `be6791877754e79650b29151c826f34d6c7e574131e575943334d09e1cff9e5c` |
| `header.png` | `GW.EXE_0xF820FC56.dds` | `9e83731551add5cc8f344f565b03aa75889ebb1e4d7d42fa150c3210bae831a4` |

The body slices use x = 0/28/96/128 and y = 0/28/98/128. The header
uses x = 0/20/108/128 and y = 5–32. The renderer retains the study's
1.7 horizontal scale, 1.2 body vertical scale, 24-unit body top, 2-pixel
body offset, and tapered upper joins of −7 and −1 pixels. Its clear centre
lets the app's shared material and opacity settings paint once.

This is the accepted reconstruction, not a claim of pixel-perfect game parity.
No runtime path depends on the source study checkout.
