<p align="center">
  <img src="assets/branding/sid-song-explorer.svg" alt="SID Song Explorer — rainbow sound lens with C64 and SID lettering" width="144" height="144">
</p>

# SID Song Explorer

SID Song Explorer is a browser player and inspector for Commodore 64 SID music. It connects a heard passage to voice/register activity and source-backed explanations, using an existing SID emulator.

## Current state

The first mono proof of concept is implemented, with passing engine and headless Chromium/WebKit interaction checks. It uses a small TypeScript/Vite application over `libsidplayfp-wasm` 1.1.0's SIDLite engine. Real desktop Safari playback through the complete ending and the user's judgment of the explanations remain pending; milestone 1 is not complete. [The plan](PLAN.md) owns status, and [the validation record](docs/validation/mono-poc.md) separates checks from remaining listening and browser gates. No hosted deployment is included.

[View the live interface](assets/screenshots/mono-poc.png), captured by the silent headless WebKit test.

## Implemented POC capabilities

- Load the published Rambo loader main-music reconstruction from pinned, hash-verified files, with its matching generated WAV, attribution, license and source links.
- Open callable mono PSID files locally, with subtune, PAL/NTSC and MOS6581/MOS8580 controls; local files and their hashes stay on the device.
- Play, pause, restart, seek quickly within the prepared audio range, with busy feedback for unprepared positions, and set A–B study loops.
- Mute or solo the three physical SID voices, with the waveform-write intervention and shared hardware dependencies labelled.
- Switch voice activity between **Scroll** (the default fixed ten-second window) and **Fit history** (the former expanding overview) in the graph header; select retained voice/register history while music continues, hold an inspection cursor, and return to following the heard playhead.
- Inspect frequency, waveform, gate, pulse width, ADSR settings, ring/sync, the shared filter and ordered writes, alongside PCM levels, waveform and spectrum.
- Read three evidence-linked Rambo annotations with their exact evidence and listening scope.

The POC accepts a bounded callable mono PSID subset; RSID, ROM/interrupt-driven profiles and additional SID chips are outside it. Seeking and loop continuation require the validation described in [the playback adapter](docs/architecture/playback-adapter.md); a state-restored loop does not promise a seamless audio splice. Dual-SID routing, the full model/count matrix and recent-iPhone compatibility remain product requirements for later gates in [the founding design](docs/design/web-player-and-analyser.md).

## Set up and validate

Use Node.js 24.18.0 (package minimum 24.12) and pnpm 11.20.0. Package versions are pinned in [package.json](package.json) and [the lockfile](pnpm-lock.yaml).

```sh
git clone https://github.com/mbackschat/sid-song-explorer.git
cd sid-song-explorer
pnpm install --frozen-lockfile
pnpm prepare:assets
pnpm dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. Asset preparation downloads the cleared sample files and copies the engine license, notices, modifications and complete corresponding source into ignored `public/generated/`. The build includes those files in `dist/`; prepare them before building or serving the app. No sibling checkout, private cache, ROM download or live emulator bridge is required. [The sample snapshot guide](docs/integration/poc-sources.md) records exact hashes, rights, download limits and the optional explicit local-copy command.

```sh
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:browser
```

The browser tests use Playwright's browsers; WebKit automation does not establish playback in Apple's Safari application. For documentation checks, use Python 3.10 or newer to run `python3 scripts/check-docs.py`, then `git diff --check`. The checker validates local Markdown links and heading fragments, excluding external availability. Logo regeneration is optional; see [branding](assets/branding/README.md).

## Explore the Rambo main entry

1. Leave **Rambo loader — main music** selected and press **Load sample**, then **Play**. This runs the SID live; the retained WAV has separate controls.
2. Click a voice lane to hold an earlier moment while playback continues. Select a voice in **Sound inspector** to inspect its register state and the last ordered writes at or before the cursor. The highlighted held state names the selected voice and time; **View inspector** brings its settings into view on small screens. Press **Resume live** to follow playback again. Chart selection does not seek the audio; use the playback slider above.
3. Try **Solo** on a voice, then **Restore full mix**. The control changes SID waveform writes; shared filtering and oscillator coupling can affect the result.
4. Set A and B around a passage and enable **Loop A–B**. Use the linked evidence cards to inspect the main entrance, score returns and continuing sound lifetimes.
5. Play the retained WAV separately for context and read its scope beside the controls. The accepted underlying phrase and ending do not establish acceptance of the new cold-start entrance or of this browser performance.

**Open local SID** provides the same generic inspection without authored annotations. It does not upload the file, send a file hash or request external metadata. Unsupported profiles fail with a message; unknown durations stay labelled unknown.

## Relationship to SID Song Crafter

[SID Song Crafter](https://github.com/mbackschat/sid-song-crafter) owns composition tools, instrument programs, musical studies, sample generation and publication clearance. Explorer owns browser playback and presentation of matching evidence.

Both repositories can be worked on together in one agent session, with coordinated changes and separate commits. Explorer remains independently cloneable and buildable. This POC consumes an interim pinned [catalog snapshot](config/catalog.json) with a strict versioned parser; it does not implement the future Crafter-owned normalized catalog producer. [The shared-knowledge guide](docs/integration/crafter-handoff.md) defines ownership and coordinated development, and [the POC source record](docs/integration/poc-sources.md) defines this bounded import.

## Documentation

- [Plan](PLAN.md): current scope and next development task.
- [Playback adapter](docs/architecture/playback-adapter.md): app-base choice, engine boundary and timing limits.
- [Mono POC validation](docs/validation/mono-poc.md): technical evidence and outstanding Safari/listening gates.
- [Sample snapshot](docs/integration/poc-sources.md): pinned assets, rights and annotation scope.
- [Founding design](docs/design/web-player-and-analyser.md): product contracts and verification gates.
- [Application research](docs/research/web-music-explorers.md): dated comparisons and reuse alternatives.
- [Contributor guide](CLAUDE.md): development conventions and validation.
- [Branding](assets/branding/README.md): selected logo, exports and reproduction.
- [Documentation index](docs/README.md): navigation.

## License

Copyright (c) 2026 Martin Backschat. Original Explorer work is licensed under **GPL-3.0-or-later**: you may redistribute and modify it under version 3 of the GNU General Public License or any later version, without warranty. See [LICENSE](LICENSE).

Transferred Crafter documents and reused logo geometry retain their MIT notice. The engine is GPL-2.0-or-later and the published Rambo sample is GPL-3.0-only; their notices and corresponding-source routes remain separate. See [third-party notices](THIRD_PARTY_NOTICES.md).
