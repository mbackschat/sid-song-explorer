# Mono POC sample snapshot

[The POC catalog](../../config/catalog.json) is a bounded, manually assembled consumer snapshot of SID Song Crafter at public revision [`3db086b6963676ef75f34d7f77c3b67232a777fb`](https://github.com/mbackschat/sid-song-crafter/tree/3db086b6963676ef75f34d7f77c3b67232a777fb). It enables the first playable mono prototype without requiring a sibling checkout. It is not the normalized Crafter-owned catalog producer described by [the handoff](crafter-handoff.md); that producer and its final shared schema remain separate work. Crafter retains authority for the score, rights, evidence, musical interpretation and listening verdicts. Advance the snapshot deliberately against its pinned owners rather than inferring a new canonical producer contract from this POC.

## Prepare and verify the sample

Run from the Explorer root with its pinned Node runtime:

```sh
node --experimental-strip-types scripts/prepare-samples.ts
node --experimental-strip-types --test tests/catalog.test.ts
```

Preparation fetches only the three pinned files below into ignored `public/generated/`. Every download has a 30-second cancellation deadline, a declared byte-length bound and a 25 MiB hard ceiling. It verifies both byte length and SHA-256 before writing a file. Existing files are reused only after the same checks; a mismatch fails and requires explicitly removing or correcting that local file. HTTP errors, redirects, missing bodies, oversized streams and truncated files fail. The module can be imported by tests without starting the CLI.

The 2026-10-18 network smoke on Node 26.10.0 reproduced the public license response with `Content-Encoding: gzip`, wire `Content-Length: 12130` and 35,149 decoded bytes. Node fetch exposes the decoded body while retaining those wire headers. The preparer therefore compares Content-Length only for unencoded responses and always bounds, measures and hashes the decoded stream. A regression retains this distinction; the initial unconditional header comparison rejected valid license bytes.

For explicitly selected local development, exact-byte copying uses the same checks and never updates the source repository:

```sh
node --experimental-strip-types scripts/prepare-samples.ts --source-root /path/to/sid-song-crafter
```

The default command has no sibling path or runtime dependency. The current SID, WAV and license are ordinary Git blobs at the pinned revision; their `raw.githubusercontent.com` URLs return the actual bytes. GitHub `blob` pages return HTML and are unsuitable downloads. Future LFS objects need a pinned `media.githubusercontent.com/media/OWNER/REPOSITORY/REVISION/PATH` URL; the preparer accepts that form and still checks the materialized object hash, so an LFS pointer fails verification.

| Generated file | Bytes | SHA-256 | Pinned owner |
| --- | ---: | --- | --- |
| `rambo-loader-main.sid` | 6,580 | `99c61d30de4a27e800d185709192de0af92e6d1f2b2350ff8b80f47d8dc4a8cc` | [Main manifest](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/main-manifest.json) |
| `rambo-loader-main.wav` | 17,054,294 | `4d3f3c78a89a384a14244f4ca6a36efe0022ea2f636327619ebc00be93909544` | [Main manifest](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/main-manifest.json) |
| `rambo-loader-LICENSE.txt` | 35,149 | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` | [Complete-package manifest](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/manifest.json) |

`rambo-loader-main` targets PAL, one MOS6581 at `$D400`, subtune 1. The WAV is a 193.35884353741497-second, 44.1 kHz mono PCM16 render of that reconstructed main-entry SID, not an original reference recording. The manifest's frame count is the duration authority; the package README's rounded duration differs slightly. No original reference SID, original recording or unknown-rights material is downloaded.

## Rights and corresponding source

Composed, arranged and programmed by **Martin Galway**, 1985; historical credit: **(C) Ocean Software 1985**. Galway's [upstream ownership statement](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/README.md), dated 2026-04-14, states that he acquired the music and programming rights from Infogrames. The [upstream loader source](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/rambload.asm) and [GPL version 3 license](https://github.com/MartinGalway/C64_music/blob/a458a3687e27a63647bbe41968094f0e6d0965a0/LICENSE) supply the package's scoped publication basis.

**Modified version:** SID Song Crafter independently reconstructed the symbolic score and computed C64 player, packaged 2026-10-15; the main-entry change is dated 2026-10-16. The combined score, SID and generated WAV are distributed under **GPL-3.0-only**, without warranty. Independently authored reusable tools retain their separate MIT license when used separately. Preserve this attribution, modification notice, license and access to corresponding source with the playable files. Explorer's app license does not replace the sample's license.

The catalog provides a direct [complete corresponding-source archive](https://github.com/mbackschat/sid-song-crafter/archive/3db086b6963676ef75f34d7f77c3b67232a777fb.tar.gz), plus the [package instructions](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/README.md) and [sample license](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/LICENSE). The archive includes the editable `songs/rambo-loader.json`, player assembly, compiler, transitive local imports, [entry preparer](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/scripts/studies/rambo/prepare-main-entry.py), [main recipe](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/main.recipe.json), renderer source and [setup instructions](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/README.md#requirements-and-setup). The [main manifest](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/main-manifest.json) retains build-input and renderer fingerprints. Reproducing the SID does not require an original reference SID or evidence archives; reproducing the exact WAV additionally requires the pinned renderer/library build. The preparation command copies the cleared outputs rather than rebuilding or rendering them.

## Annotation and listening limits

The [strict POC parser](../../src/catalog.ts) checks the schema version, exact declared fields, immutable source/file URLs, safe unique filenames, hashes, bounded byte sizes, the supported mono target, matching analysis identity, one-based physical voice numbers and finite in-range annotation spans. Its target restriction describes this POC, not a claim that the eventual catalog is mono-only. Times use `seconds-from-init` and are rebased from source call 1586 using the declared rate of 50.12457321485099 calls per second: `(sourceCall - 1586) / callRate`. The three annotations are labelled **derived** because they map documented execution into this entry's timeline; they are not live measurements or recovered instrument identities.

| Annotation | Source calls | POC seconds | Evidence |
| --- | --- | --- | --- |
| Restored main entry | `[1586,1587)` | `[0,0.019950295)` | [Main-entry description](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/README.md#main-music-demo-2026-10-16) and [verification](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/main-verification.json): software state retained, fresh SID history. |
| Score streams return | `[10544,10561)` | `[178.714738609,179.053893617)` | [Finite traversal](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/composition/rambo-preparation.md#finite-traversal-and-natural-stop): voices 2/3/1 return at 10544/10559/10560. |
| Sound lifetimes continue | `[10560,10815)` | `[179.033943322,184.121268433)` | [Lifetime mechanism](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/composition/rambo-preparation.md#ongoing-sound-lifetime-and-programmed-motion): final stores at 10660/10799/10814; no further stores from 10815. |

The [main-entry verification](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/main-verification.json) records equality of all 9,414 remaining calls' 80,847 ordered play stores. CPU equality, selected VICE checks, rendered signal checks and listening verdicts remain separate evidence. Times identify scheduled calls, not within-call bus timestamps or a measured audible release boundary. Annotations make no role or patch claims transferred from the separate [Für Elise instrument study](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/composition/instruments/rambo-decoded-programs.md).

The retained 2026-10-13 verdict covers the complete reconstruction's characteristic phrase and natural ending: the listener heard no difference in those comparisons. It does not establish a full-song perceptual comparison, PCM identity or hardware equivalence. The [new cold-start entrance has not received a separate listening verdict](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/README.md#main-music-demo-2026-10-16). Using the matching generated WAV as the POC reference does not enlarge that acceptance or certify browser audio.
