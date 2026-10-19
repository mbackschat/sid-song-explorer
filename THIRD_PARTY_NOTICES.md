# Third-party and transferred-material notices

Original SID Song Explorer work is GPL-3.0-or-later; see [LICENSE](LICENSE). The mono player adopts the engine and cleared samples below. Their applicable terms remain separate from the app's license. ROMs and original reference SID binaries are excluded.

## libsidplayfp-wasm 1.1.0 / SIDLite

The pinned [`libsidplayfp-wasm` 1.1.0 package](https://www.npmjs.com/package/libsidplayfp-wasm/v/1.1.0) is **GPL-2.0-or-later**. Explorer uses its SIDLite WebAssembly build and generated loader, with its own worker/transport adapter; the installed engine package is unmodified. The [engine source](https://github.com/chrisgleissner/libsidplayfp-wasm/tree/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275) and [adapter record](docs/architecture/playback-adapter.md) identify the adopted boundary. This is an independent distribution and does not imply endorsement by libsidplayfp or the wrapper's authors.

Run `pnpm prepare:assets` before building or distributing. [The runtime preparer](scripts/prepare-runtime.ts) copies the package's exact license, third-party notices, modification record and complete corresponding-source archive beside the generated deployment assets. It records their hashes in `public/generated/engine-provenance.json`; Vite includes them in `dist/generated/`, and the app links to them.

| Distributed filename | Package source | Purpose |
| --- | --- | --- |
| `engine-LICENSE.txt` | `LICENSE` | GPL-2.0-or-later declaration and full GPL version 2 text. |
| `engine-NOTICES.txt` | `THIRD-PARTY-NOTICES.md` | Component copyrights and terms, including libsidplayfp, SIDLite, hashlib and the generated runtime/toolchain portions. |
| `engine-MODIFICATIONS.txt` | `MODIFICATIONS.md` | Wrapper upstream modifications used to build the published engines; these are not additional Explorer engine patches. |
| `engine-complete-source.tar.gz` | `dist/complete-source.tar.gz` | Complete upstream pins, modifications, bindings and build instructions corresponding to the package's binaries. |

The package's full notices and source archive retain its component-specific terms, including MIT, Emscripten's MIT/NCSA choice and Apache-2.0 with LLVM Exceptions. The archive also contains the package's reSIDfp build sources; this POC selects the SIDLite engine. Preserve the copied files and source access when redistributing the generated app. Dependency versions and integrity are pinned in [the pnpm lockfile](pnpm-lock.yaml); development tools and test runners retain their own package notices.

## Rambo loader main-music sample

The catalog's **Rambo loader — main music** is a cleared independent reconstruction of Martin Galway's 1985 loading music, distributed under **GPL-3.0-only**. Composed, arranged and programmed by **Martin Galway**; historical credit: **(C) Ocean Software 1985**. His pinned [ownership statement](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/README.md) states that he later acquired the music/programming rights from Infogrames; his repository supplies [the loader source](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/rambload.asm) and [GPL version 3 license](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/LICENSE).

**Modified version:** SID Song Crafter's independent symbolic score and computed C64 player, packaged 2026-10-15, with the main-entry modification dated 2026-10-16. The combined score, SID and generated WAV are under GPL version 3, without warranty; separately used independently authored tools retain their MIT license. Preserve the attribution, modification notice and sample license, including the prepared `rambo-loader-LICENSE.txt`. The UI supplies attribution, license, listening-scope and corresponding-source links.

The [pinned catalog](config/catalog.json) identifies the exact SID/WAV/license bytes. The [sample source record](docs/integration/poc-sources.md) owns their full provenance, rights basis and evidence limits, with a direct [complete corresponding-source archive](https://github.com/mbackschat/sid-song-crafter/archive/3db086b6963676ef75f34d7f77c3b67232a777fb.tar.gz) and [reproduction instructions](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/README.md). The matching WAV is a generated reconstruction render, not an original recording. Preparation downloads these cleared outputs only into ignored `public/generated/`; source control does not contain the music binaries.

## Bach, Mozart and the original instrument mix

The public Bach Toccata and Mozart Minuet and Trio packages use public-domain compositions/source editions, with Crafter’s arrangements and tools under MIT. The instrument mix uses project-authored notes and instruments under MIT. Their SID-Wizard players retain the separate terms recorded in [Crafter’s pinned notices](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/THIRD_PARTY_NOTICES.md). Each deployed package includes its exact MIT license and those player notices, linked from the application. [The catalog source record](docs/integration/poc-sources.md) identifies the owning manifests, declared hardware, exact SID/WAV hashes and listening scope. Stereo variants are linked to Crafter’s published files; the live engine remains mono.

Local-build material links do not distribute their score/audio binaries or change their publication status.

## SID Song Crafter documentation

The [founding design](docs/design/web-player-and-analyser.md) and [application research](docs/research/web-music-explorers.md) were transferred from [SID Song Crafter at `3db086b6963676ef75f34d7f77c3b67232a777fb`](https://github.com/mbackschat/sid-song-crafter/tree/3db086b6963676ef75f34d7f77c3b67232a777fb), Copyright (c) 2026 Martin Backschat, under the MIT license. The complete [original MIT notice](LICENSES/sid-song-crafter-MIT.txt) is retained. [The provenance manifest](provenance/crafter-handoff.json) identifies original files and checksums; the [handoff guide](docs/integration/crafter-handoff.md) describes adaptations.

Upstream links and research summaries do not bundle the other reviewed projects or grant rights to their code or music. Their license observations remain dated research; adopted dependencies and samples are identified separately above.

## Crafter lettering and palette

The [Explorer logo family](assets/branding/README.md) adapts outlined C64/SID lettering and color values from [Crafter’s SVG](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/assets/branding/sid-song-crafter.svg), Copyright (c) 2026 Martin Backschat, under MIT. Retain the [MIT notice](LICENSES/sid-song-crafter-MIT.txt). The lens silhouette, signal-track composition and compact companion are Explorer work. [Branding provenance](assets/branding/provenance.json) records the source hash and selected direction. No third-party font or original Commodore logo asset is bundled.
