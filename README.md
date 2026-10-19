<p>
  <img src="assets/branding/sid-song-explorer.svg" alt="SID Song Explorer — rainbow sound lens with C64 and SID lettering" width="96" height="96">
</p>

# SID Song Explorer

SID Song Explorer is a browser player and inspector for Commodore 64 SID music. It connects a heard passage to voice/register activity and source-backed explanations, using an existing SID emulator.

<p>
  <a href="https://mbackschat.github.io/sid-song-explorer/"><img alt="Run in browser" src="https://img.shields.io/badge/Run%20in%20browser-8055c9?style=for-the-badge"></a>
</p>
<p>
  <a href="assets/screenshots/rambo-playing.png"><img src="assets/screenshots/rambo-playing.png" alt="Rambo main music playing live in dual-SID stereo, with six chip-grouped voice lanes, two shared-filter lanes and register inspection." width="560"></a>
</p>

## Related projects

- [<img src="https://raw.githubusercontent.com/mbackschat/sid-song-crafter/main/assets/branding/sid-song-crafter.svg" alt="" width="24" height="24"> **SID Song Crafter**](https://github.com/mbackschat/sid-song-crafter) — arrange and export the music explored here.
- [**Williams Sound Explorer and Designer**](https://github.com/mbackschat/williams-sound-explorer) — explore and design arcade sound effects.

## Current state

The published mono proof of concept is complete, with user acceptance of actual Safari full-ending playback and inspection usefulness on 2026-10-19. [The mono validation record](docs/validation/mono-poc.md) retains its automated and human evidence. The working copy adds the unified timeline and six catalog entries, including two live stereo candidates. **Stereo is local and unpublished; automated routing, browser and full-song checks pass, with actual Safari/iPhone acceptance pending**; [dual-SID validation](docs/validation/stereo.md) owns those gates. The screenshot shows the local stereo implementation. [The plan](docs/PLAN.md) owns delivery status. Local files remain on your device.

## Capabilities in the working copy

- Select the six entries listed below, using pinned, hash-verified SID files, retained WAV references, attribution, licenses and source links. Stereo Rambo’s reference WAV stays external because it exceeds the prepared-asset size cap.
- Keep Moon River, Pink Panther, Axel F and Ghostbusters separate as local-build materials, without unpublished audio downloads. Other stereo arrangements remain external SID/WAV links.
- Open callable mono or dual-SID PSID files locally, with subtune, PAL/NTSC and MOS6581/MOS8580 controls. Dual-SID playback uses one selected model for both chips; automatic opening rejects conflicting concrete model declarations. Local files and their hashes stay on the device.
- Play, pause, restart, seek quickly within the prepared audio range, with busy feedback for unprepared positions, and set A–B study loops.
- Mute or solo three voices for mono or six chip-grouped voices for stereo, with one shared filter per chip. Changing voices pauses sound to prepare the mix; a spinner and explanation appear beside the controls. Uninterrupted switching is explicitly deferred on cost grounds as [`VOICE-1`](docs/PLAN.md#exit-the-poc-and-continue-production-work).
- Use the shared transport/timeline panel: browse with its scrollbar without seeking, click a lane or ruler to seek, **Shift-click** to inspect, **Hold** the heard moment and **Follow** to center playback again. **Scroll** shows past and prepared upcoming activity; **Fit history** shows retained heard activity. Zoom sets time density, so wider charts show more time at the same zoom.
- Inspect frequency, waveform, gate, pulse width, ADSR settings, ring/sync, each chip’s shared filter and chip-indexed ordered writes. Stereo output routes SID 1 left and SID 2 right as an explicit player setting. The shared levels, waveform and spectrum are labelled as a mono monitor of `(L + R) / 2`.
- Read three evidence-linked Rambo annotations with their exact evidence and listening scope.

The input boundary remains a bounded callable PSID subset: RSID, ROM/interrupt-driven profiles, three-SID files and mixed concrete chip-model declarations on automatic local opening are excluded. When one dual-SID model declaration is unknown or accepts either model, a concrete declaration on the other chip supplies the default; intentionally reloading with another model applies it to both chips. Seeking and loop continuation require [adapter validation](docs/architecture/playback-adapter.md); a state-restored loop does not promise a seamless audio splice. The local stereo implementation does not close the [design’s model/count and Safari gates](docs/design/web-player-and-analyser.md#first-step-and-milestones).

## Published library

The [published app](https://mbackschat.github.io/sid-song-explorer/) retains four mono entries from [Crafter’s downloadable samples](https://github.com/mbackschat/sid-song-crafter#downloads), with separate stereo downloads. The working-copy catalog contains six playable entries; the two stereo entries await the adoption and publication gates above. Mono Rambo remains the initial selection and carries three source-linked annotations; the other entries use generic live register inspection.

| Sample | Variant | Chip model | Application status |
| --- | --- | --- | --- |
| Rambo loader — main music | Mono | MOS6581 | Published |
| Bach Toccata | Mono | MOS8580 | Published |
| Mozart Minuet and Trio | Mono | MOS8580 | Published |
| Original instrument mix | Mono | MOS8580 | Published |
| Rambo loader — main music | Dual-SID stereo | MOS6581 × 2 | Local candidate; acceptance pending |
| Bach Toccata | Dual-SID stereo | MOS8580 × 2 | Local candidate; acceptance pending |

The [pinned catalog](config/catalog.json) records exact files and provenance; [source preparation](docs/integration/poc-sources.md) explains updates. Retained sample listening verdicts describe those source performances and do not certify the new browser backend.

The [Application workflow](.github/workflows/app.yml) deploys `main` only after both shards pass on each supported browser/platform. It builds and uploads the cleared assets, license notices and corresponding engine source. [Publication checks](docs/validation/mono-poc.md#github-pages-and-readme-catalog) cover the hosted app separately from local tests.

## Set up and validate

Use Node.js 24.18.0 (package minimum 24.12), pnpm 11.20.0, Python 3.12 or newer and Docker with its daemon running. Python and Docker build the modified raw-chip SIDLite engine; [dual-SID validation](docs/validation/stereo.md) records the bounded native build and its current evidence. Package versions are pinned in [package.json](package.json) and [the lockfile](pnpm-lock.yaml).

```sh
git clone https://github.com/mbackschat/sid-song-explorer.git
cd sid-song-explorer
pnpm install --frozen-lockfile
pnpm prepare:engine
pnpm prepare:assets
pnpm dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. Engine preparation builds from pinned source and runs the raw-routing/mono-equality gate. Asset preparation then verifies the modified artifact, downloads cleared sample files and packages the engine license, notices, modifications and complete corresponding source in ignored `public/generated/`. The build includes these files in `dist/`; prepare them before building or serving the app. No sibling checkout, private cache, ROM download or live emulator bridge is required. [The sample snapshot guide](docs/integration/poc-sources.md) records hashes, rights, download limits and the optional explicit local-copy command.

```sh
pnpm test
pnpm build
pnpm exec playwright install chrome
# On macOS, also install the WebKit test browser:
pnpm exec playwright install webkit
pnpm test:browser
```

Browser checks use Google Chrome on Linux and macOS, plus Playwright WebKit on macOS only. CI runs Chrome on Ubuntu and WebKit on macOS; Linux WebKit is outside the supported test matrix. macOS WebKit automation does not establish playback in Apple's Safari application. For documentation checks, use Python 3.10 or newer to run `python3 scripts/check-docs.py`, then `git diff --check`. The checker validates local Markdown links and heading fragments, excluding external availability. Logo regeneration is optional; see [branding](assets/branding/README.md).

## Explore the Rambo main entry

1. Leave **Rambo loader — main music** selected and press **Load sample**, then **Play**. This runs the SID live; the retained WAV has separate controls.
2. Drag the scrollbar below the timeline to browse continuously without changing playback. Click a voice/filter lane or release the time ruler to seek. **Scroll** returns to centered playback; **Follow** centers it immediately.
3. **Shift-click** a lane to inspect that moment while music continues, or press **Hold** to capture the current heard position. Select a voice in **Sound inspector** to read its registers and ordered writes. **View inspector** brings the held settings into view on small screens; **Follow** releases the held inspection.
4. Try **Solo** on a voice, then **Full mix**. Sound pauses while the replacement mix is prepared. The control changes SID waveform writes; shared filtering and oscillator coupling can affect the result.
5. Expand **Loop A–B**, set A and B around a passage and enable the loop. Use the linked evidence cards to inspect the main entrance, score returns and continuing sound lifetimes.
6. Play the retained WAV separately for context and read its scope beside the controls. The accepted underlying phrase and ending do not establish acceptance of the new cold-start entrance or this browser performance. After the local stereo gate passes, select **Rambo loader — main music, stereo** to explore the six chip-grouped voices and two filters; stereo browser/listening acceptance remains separate.

**Open local SID** provides the same generic inspection without authored annotations. It does not upload the file, send a file hash or request external metadata. Unsupported profiles fail with a message; unknown durations stay labelled unknown.

## Relationship to SID Song Crafter

[SID Song Crafter](https://github.com/mbackschat/sid-song-crafter) owns composition tools, instrument programs, musical studies, sample generation and publication clearance. Explorer owns browser playback and presentation of matching evidence.

Both repositories can be worked on together in one agent session, with coordinated changes and separate commits. Explorer remains independently cloneable and buildable. This POC consumes an interim pinned [catalog snapshot](config/catalog.json) with a strict versioned parser; it does not implement the future Crafter-owned normalized catalog producer. [The shared-knowledge guide](docs/integration/crafter-handoff.md) defines ownership and coordinated development, and [the POC source record](docs/integration/poc-sources.md) defines this bounded import.

## Documentation

- [Plan](docs/PLAN.md): current scope and next development task.
- [Playback adapter](docs/architecture/playback-adapter.md): app-base choice, engine boundary and timing limits.
- [Mono POC validation](docs/validation/mono-poc.md): technical evidence, Safari/listening acceptance and remaining limitations.
- [Dual-SID validation](docs/validation/stereo.md): local raw-routing implementation, execution status and outstanding stereo acceptance.
- [Sample snapshot](docs/integration/poc-sources.md): pinned assets, rights and annotation scope.
- [Founding design](docs/design/web-player-and-analyser.md): product contracts and verification gates.
- [Application research](docs/research/web-music-explorers.md): dated comparisons and reuse alternatives.
- [Contributor guide](CLAUDE.md): development conventions and validation.
- [Screenshot harness](docs/validation/screenshots.md): reproduce and refresh the live Rambo README image.
- [Branding](assets/branding/README.md): selected logo, exports and reproduction.
- [Documentation index](docs/README.md): navigation.

## License

Copyright (c) 2026 Martin Backschat. Original Explorer work is licensed under **GPL-3.0-or-later**: you may redistribute and modify it under version 3 of the GNU General Public License or any later version, without warranty. See [LICENSE](LICENSE).

Transferred Crafter documents and reused logo geometry retain their MIT notice. The engine is GPL-2.0-or-later and the published Rambo sample is GPL-3.0-only; their notices and corresponding-source routes remain separate. See [third-party notices](THIRD_PARTY_NOTICES.md).
