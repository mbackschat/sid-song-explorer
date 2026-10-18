<p align="center">
  <img src="assets/branding/sid-song-explorer.svg" alt="SID Song Explorer — rainbow sound lens with C64 and SID lettering" width="144" height="144">
</p>

# SID Song Explorer

SID Song Explorer is a browser application project for playing Commodore 64 SID music and examining how its instruments and arrangements work. It aims to connect a heard passage to chip activity, musical roles, sound programs and supporting evidence.

## Current state

The repository is ready for development: it contains the founding design, application research, contributor conventions, project identity and documentation checks. Playback and the user interface are not implemented yet; there is no deployed application. The application stack and final playback-engine choice remain open. [The plan](PLAN.md) owns progress and the first prototype’s completion criteria.

## Intended capabilities

- Play published samples and locally opened SID files without sending local files or their hashes to external services.
- Support MOS6581 and MOS8580, with one SID or two SIDs and explicit chip-to-output routing.
- Inspect retained voice/register history, select phrases and connect sound to instrument information and source-backed explanations.
- Provide voice mute/solo, state-preserving seeking, loops, output levels and spectral views.
- Work in recent Safari on macOS and iOS, prioritizing desktop exploration.

These are product requirements. [The founding design](docs/design/web-player-and-analyser.md) separates required capabilities from optional depth and exclusions.

## Set up and validate

Only Git and Python 3.10 or newer are needed for the current documentation workflow:

```sh
git clone https://github.com/mbackschat/sid-song-explorer.git
cd sid-song-explorer
python3 scripts/check-docs.py
git diff --check
```

Open this directory in Codex or Claude Code. Both read the same [contributor guide](CLAUDE.md) through the relative [AGENTS.md](AGENTS.md) symlink. No sibling checkout, private cache or live emulator bridge is required. Application installation, start, build and test commands will be documented when the first prototype establishes them.

The documentation check validates local Markdown links and heading fragments, not external website availability. GitHub CI runs the documentation and whitespace checks. Logo regeneration is optional; its prerequisites and command are in the [branding guide](assets/branding/README.md).

## First exploration example

The first planned example uses the Rambo loader main-music reconstruction: hear a phrase, inspect its voice and register history, and follow evidence explaining the sound. The [prototype contract](docs/design/web-player-and-analyser.md#milestone-1-first-playable-inspection-with-one-mono-sample) requires full-ending playback, stateful loops, synchronized inspection and a real desktop Safari listening check. A worked application walkthrough and screenshot will accompany the working prototype.

## Relationship to SID Song Crafter

[SID Song Crafter](https://github.com/mbackschat/sid-song-crafter) owns composition tools, instrument programs, musical studies, sample generation and publication clearance. Explorer owns browser playback and presentation of matching evidence.

Both repositories can be worked on together in one agent session, with coordinated changes and separate commits. Explorer remains independently cloneable and buildable. The intended integration uses a versioned catalog and optional analysis packages, pinned and hash-verified by Explorer; those formats are not implemented yet. [The shared-knowledge guide](docs/integration/crafter-handoff.md) defines ownership and coordinated development.

## Documentation

- [Plan](PLAN.md): current scope and next development task.
- [Founding design](docs/design/web-player-and-analyser.md): product contracts and verification gates.
- [Application research](docs/research/web-music-explorers.md): dated comparisons and reuse alternatives.
- [Contributor guide](CLAUDE.md): development conventions and validation.
- [Branding](assets/branding/README.md): selected logo, exports and reproduction.
- [Documentation index](docs/README.md): navigation.

## License

Copyright (c) 2026 Martin Backschat. Original Explorer work is licensed under **GPL-3.0-or-later**: you may redistribute and modify it under version 3 of the GNU General Public License or any later version, without warranty. See [LICENSE](LICENSE).

Transferred Crafter documents and reused logo geometry retain their MIT notice. Music and future dependencies require their own applicable terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
