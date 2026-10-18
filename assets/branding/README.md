# SID Song Explorer identity

[Logo SVG](sid-song-explorer.svg) · [512 px PNG](sid-song-explorer.png) · [Lossless WebP](sid-song-explorer.webp) · [Compact SVG](sid-song-explorer-compact.svg) · [Favicon](favicon.ico)

[Light-background wordmark](sid-song-explorer-wordmark-light.svg) · [Dark-background wordmark](sid-song-explorer-wordmark-dark.svg)

## Selected direction

On 2026-10-18 the user selected **round 2, A — Sound lens**. The whole silhouette is a magnifying glass containing stepped rainbow signal tracks and smaller C64/SID lettering. It relates to [Crafter’s identity](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/assets/branding/README.md) through color and geometric lettering, while its outline and layout distinguish the two projects.

The initial chip-based concepts were rejected because changing only the middle symbol made too little difference. Preserve the full lens silhouette when adapting this identity; do not return to Crafter’s chip frame. The alternative Spectrum E and Song timeline directions were not selected.

## Use the assets

- Use the full SVG in README and at display sizes of 144 px or larger. Its letters are vector outlines, with no font or bitmap dependency.
- Use the compact SVG and its [16 px](favicon-16.png), [32 px](favicon-32.png) and [48 px](favicon-48.png) PNGs at small sizes. It removes lettering while retaining the lens and colored signals. The ICO contains all three sizes.
- Both icon masters have a transparent surround and work on light or dark backgrounds. Wordmark variants change the text color for those backgrounds; their name and description use the system Arial/Helvetica/sans-serif stack, with no bundled font. Glyph rendering can vary by system.
- The five rainbow tracks are a branding motif, not a diagram of SID voice count. The colors are badge-inspired web approximations, not an exact VIC-II palette claim.

## Rebuild and inspect

Install `librsvg`, `webp` and `imagemagick` through Homebrew on macOS, or equivalent packages on another system. These tools are optional for application development and only needed to regenerate raster assets.

```sh
python3 scripts/render-branding.py
```

The script overwrites only the named branding exports and puts 144 px and wordmark previews in ignored `build/branding/`. Review the full logo at 512/144 px and compact icons at 48/32/16 px on light and dark backgrounds. SVG parsing, raster dimensions and local documentation links provide structural checks; visual acceptance remains the user’s decision. Runtime requirements and validation commands live in the [contributor guide](../../CLAUDE.md).

The [provenance record](provenance.json) identifies the accepted preview, source commit, inherited lettering/colors and adaptations. The reused Crafter geometry retains its [MIT notice](../../LICENSES/sid-song-crafter-MIT.txt); see [third-party notices](../../THIRD_PARTY_NOTICES.md). Explorer’s new work follows the project license.
