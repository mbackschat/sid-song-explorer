# SID Song Explorer

SID Song Explorer is a planned browser application for playing Commodore 64 SID music and exploring its instruments and arrangements. It connects a heard passage to chip activity, musical roles, sound programs and supporting evidence.

This repository is ready for development: the founding design, application research, contributor conventions and first implementation gates are in place. There is no application, playback engine, dependency installation or deployed site yet. The technology stack remains open.

## Intended capabilities

- Play published samples and locally opened SID files, without sending local files or their hashes to external services.
- Support MOS6581 and MOS8580, with one SID or two SIDs and explicit chip-to-output routing.
- Connect playback to retained voice/register history, phrase selection, instrument information and evidence-linked explanations.
- Provide voice mute/solo, state-preserving navigation, loops, output levels and spectral views.
- Work in recent Safari on macOS and iOS, with desktop exploration as the design priority.

These are requirements, not implemented features. [The founding design](docs/design/web-player-and-analyser.md) defines required, optional and excluded functionality; [PLAN.md](PLAN.md) owns progress.

## Start working

```sh
git clone https://github.com/mbackschat/sid-song-explorer.git
cd sid-song-explorer
python3 scripts/check-docs.py
```

Only Python 3.10 or newer and Git are needed for the current documentation checks. Open this directory in Codex or Claude Code; both use the same [contributor guide](CLAUDE.md) through the relative [AGENTS.md](AGENTS.md) symlink. No sibling checkout, inherited cache, private files or live emulator bridge is required.

Read [PLAN.md](PLAN.md), then the [founding design](docs/design/web-player-and-analyser.md) and [application research](docs/research/web-music-explorers.md). The first implementation milestone is a mono Rambo playback/inspection prototype; it must record the smallest justified application/engine/stack choice and pass the design's Safari and listening checks. Do not treat the existing source reviews as runtime validation.

## Relationship to SID Song Crafter

[SID Song Crafter](https://github.com/mbackschat/sid-song-crafter) owns composition tools, instrument programs, musical studies, sample generation and publication clearance. Explorer owns the browser application and presentation of matching evidence. Its sources and future build must not require a relative path to Crafter.

The recommended integration is a versioned static catalog and optional analysis packages, pinned and hash-verified by Explorer. Musical knowledge remains in Crafter and is linked rather than copied. The catalog is not implemented yet. See [ownership and shared knowledge](docs/integration/crafter-handoff.md) for the contract and when shared code would be justified.

## Documentation and license

- [Documentation index](docs/README.md): design, research and integration.
- [Contributor guide](CLAUDE.md): development, validation and publication rules.
- [Plan](PLAN.md): current scope, milestones and completion gates.
- [Third-party notices](THIRD_PARTY_NOTICES.md): transferred material and dependency boundaries.

Copyright (c) 2026 Martin Backschat. Original Explorer work is licensed under **GPL-3.0-or-later**: you may redistribute and modify it under version 3 of the GNU General Public License or any later version, without warranty. See [LICENSE](LICENSE). Transferred Crafter documents retain their MIT notice; music and future dependencies require their own applicable terms.
