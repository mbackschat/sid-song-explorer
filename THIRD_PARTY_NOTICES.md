# Third-party and transferred-material notices

Original SID Song Explorer work is GPL-3.0-or-later; see [LICENSE](LICENSE). The player adopts the engine and cleared samples below. Their applicable terms remain separate from the app's license. ROMs and original reference SID binaries are excluded.

## libsidplayfp-wasm 1.1.0 / SIDLite

The pinned [`libsidplayfp-wasm` 1.1.0 package](https://www.npmjs.com/package/libsidplayfp-wasm/v/1.1.0) is **GPL-2.0-or-later**. Explorer builds SIDLite from its pinned complete-source archive with an additive raw-chip output binding and its own worker/transport adapter. The installed npm dependency remains unmodified; the application uses the separately rebuilt engine. Explorer’s binding/build additions are GPL-3.0-or-later and retain the upstream component notices. The [engine source](https://github.com/chrisgleissner/libsidplayfp-wasm/tree/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275) and [adapter record](docs/architecture/playback-adapter.md) identify the adopted boundary. This is an independent distribution and does not imply endorsement by libsidplayfp or the wrapper's authors.

Run `pnpm prepare:engine` with Docker to build and verify the raw-chip engine, then `pnpm prepare:assets` before building or distributing. [The runtime preparer](scripts/prepare-runtime.ts) verifies the artifact fingerprints and passing gate receipt before copying its runtime, license texts, notices, modification record and complete corresponding-source archive. Runtime assets receive Vite fingerprints; source and notices are included under `dist/generated/` and linked from the app. `engine-provenance.json` identifies the build and exact files; `engine-verification.json` binds the raw-output result to that provenance.

| Distributed filename | Build artifact source | Purpose |
| --- | --- | --- |
| `engine-LICENSE.txt` | `LICENSE` | GPL-2.0-or-later declaration and full GPL version 2 text. |
| `engine-NOTICES.txt` | `THIRD-PARTY-NOTICES.md` | Component copyrights and terms, including libsidplayfp, SIDLite, hashlib and the generated runtime/toolchain portions. |
| `engine-MODIFICATIONS.txt` | `MODIFICATIONS.md` | Upstream changes plus Explorer’s raw-chip binding and reproducible build-input adaptations. |
| `engine-EXPLORER-LICENSE.txt` | `EXPLORER-LICENSE.txt` | GPL version 3 text for Explorer’s additions. |
| `engine-complete-source.tar.gz` | `complete-source.tar.gz` | Complete pinned native sources, patched bindings, build scripts, added-source license and reproduction instructions for the rebuilt engine. |

The package's full notices and source archive retain its component-specific terms, including MIT, Emscripten's MIT/NCSA choice and Apache-2.0 with LLVM Exceptions. The archive also contains the package's reSIDfp build sources; Explorer selects the SIDLite engine. Preserve the copied files and source access when redistributing the generated app. Dependency versions and integrity are pinned in [the pnpm lockfile](pnpm-lock.yaml); development tools and test runners retain their own package notices.

## @noble/hashes 2.4.0

The pinned [@noble/hashes 2.4.0](https://github.com/paulmillr/noble-hashes) dependency is MIT-licensed, Copyright (c) 2022 Paul Miller. Explorer uses its MD5 implementation solely to match original library SID bytes against HVSC’s song-length database locally. This identifier is not an authenticity or security check. `pnpm prepare:assets` copies the complete upstream notice to `dist/generated/noble-hashes-LICENSE.txt` through the production build. Dependency integrity is pinned in [the lockfile](pnpm-lock.yaml).

HVSC song-length metadata is fetched from its [official endpoint](https://hvsc.c64.org/download/C64Music/DOCUMENTS/Songlengths.md5) only for library selections and retained in tab memory. Explorer does not bundle or mirror the database or grant rights to the referenced music.

## Rambo loader main-music sample

The catalog's **Rambo loader — main music** is a cleared independent reconstruction of Martin Galway's 1985 loading music, distributed under **GPL-3.0-only**. Composed, arranged and programmed by **Martin Galway**; historical credit: **(C) Ocean Software 1985**. His pinned [ownership statement](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/README.md) states that he later acquired the music/programming rights from Infogrames; his repository supplies [the loader source](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/rambload.asm) and [GPL version 3 license](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/LICENSE).

**Modified version:** SID Song Crafter's independent symbolic score and computed C64 player, packaged 2026-10-15, with the main-entry modification dated 2026-10-16. The combined score, SID and generated WAV are under GPL version 3, without warranty; separately used independently authored tools retain their MIT license. Preserve the attribution, modification notice and sample license, including the prepared `rambo-loader-LICENSE.txt`. The UI supplies attribution, license, listening-scope and corresponding-source links.

The [pinned catalog](config/catalog.json) identifies the exact SID/WAV/license bytes. The [sample source record](docs/integration/poc-sources.md) owns their full provenance, rights basis and evidence limits, with a direct [complete corresponding-source archive](https://github.com/mbackschat/sid-song-crafter/archive/3db086b6963676ef75f34d7f77c3b67232a777fb.tar.gz) and [reproduction instructions](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/README.md). The matching WAV is a generated reconstruction render, not an original recording. Preparation downloads these cleared outputs only into ignored `public/generated/`; source control does not contain the music binaries.

## Bach, Mozart and the original instrument mix

The public Bach Toccata and Mozart Minuet and Trio packages use public-domain compositions/source editions, with Crafter’s arrangements and tools under MIT. The instrument mix uses project-authored notes and instruments under MIT. Their SID-Wizard players retain the separate terms recorded in [Crafter’s pinned notices](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/THIRD_PARTY_NOTICES.md). Each deployed package includes its exact MIT license and those player notices, linked from the application. [The catalog source record](docs/integration/poc-sources.md) identifies the owning manifests, declared hardware, exact SID/WAV hashes and listening scope. The catalog also prepares the cleared Bach stereo SID and reference; Rambo stereo is prepared with its GPL license and an external reference WAV link. The other stereo variants remain links to Crafter’s files.

Local-build material links do not distribute their score/audio binaries or change their publication status.

## SID Song Crafter documentation

The [founding design](docs/design/web-player-and-analyser.md) and [application research](docs/research/web-music-explorers.md) were transferred from [SID Song Crafter at `3db086b6963676ef75f34d7f77c3b67232a777fb`](https://github.com/mbackschat/sid-song-crafter/tree/3db086b6963676ef75f34d7f77c3b67232a777fb), Copyright (c) 2026 Martin Backschat, under the MIT license. The complete [original MIT notice](LICENSES/sid-song-crafter-MIT.txt) is retained. [The provenance manifest](provenance/crafter-handoff.json) identifies original files and checksums; the [handoff guide](docs/integration/crafter-handoff.md) describes adaptations.

Upstream links and research summaries do not bundle the other reviewed projects or grant rights to their code or music. Their license observations remain dated research; adopted dependencies and samples are identified separately above.

## Crafter lettering and palette

The [Explorer logo family](assets/branding/README.md) adapts outlined C64/SID lettering and color values from [Crafter’s SVG](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/assets/branding/sid-song-crafter.svg), Copyright (c) 2026 Martin Backschat, under MIT. Retain the [MIT notice](LICENSES/sid-song-crafter-MIT.txt). The lens silhouette, signal-track composition and compact companion are Explorer work. [Branding provenance](assets/branding/provenance.json) records the source hash and selected direction. No third-party font or original Commodore logo asset is bundled.
