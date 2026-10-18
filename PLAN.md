# SID Song Explorer plan

This file owns scope, priorities and completion. [The founding design](docs/design/web-player-and-analyser.md) owns product contracts; [the integration guide](docs/integration/crafter-handoff.md) owns repository boundaries and provenance.

## Current status

2026-10-18: the user authorized a standalone sibling project and public GitHub repository and confirmed the name `sid-song-explorer`. The documentation bootstrap is complete. The user subsequently accepted the contributor/README improvements, authorized coordinated work across both repositories, and selected the [sound-lens identity](assets/branding/README.md); those setup refinements are complete. No application code, engine adoption, package installation or GitHub Pages deployment is included in this checkpoint.

| Stage | State | Completion gate |
| --- | --- | --- |
| Repository handoff | Complete | Standalone guide and plan, GPL-3.0-or-later license, transferred design/research with source pin and MIT notice, working document checks and public repository. |
| 1: mono playback and linked inspection | Ready to start; unimplemented | Live Rambo loader main music and local mono SID opening in desktop Safari, three-voice mute/solo, playhead/meter, stateful loops, selectable register history and evidence-linked annotations; full ending and the user's explanation-value verdict. |
| 2: dual-SID adoption gate | After milestone 1 | Both models/counts, verified raw chip routing, six controls, seeking checked against continuous playback, synchronized inspection and recent-iPhone smoke check. |
| Later breadth | Unscheduled | Broader catalog, additional local-file profiles and deeper inspection only after the first two gates; define bounded scope before starting. |

## Next development task

Start with [milestone 1 in the design](docs/design/web-player-and-analyser.md#milestone-1-first-playable-inspection-with-one-mono-sample). Compare a pruned Chip Player JS shell with a small layer over a suitable engine API, using the retained source review as evidence rather than repeating broad research. Record the chosen app base, runtime, package manager and engine pins, the exact Safari version and remaining selection risks. Implement only the technology needed for the mono prototype.

Crafter owns the prerequisite normalized catalog version 1 and its schema check, initially for the rights-cleared Rambo loader main-music entry. Coordinate that work in Crafter's plan; do not invent a separate Explorer-owned catalog authority or scrape inconsistent sample manifests. The next milestone needs that contract; reading and developing this repository do not require a Crafter checkout.

The current libsidplayfp-wasm binding may be used unchanged for the mono trial with its block-boundary seek offset labelled. It is not certified for exact dual-SID output. The full [milestone completion criteria](docs/design/web-player-and-analyser.md#first-step-and-milestones), including human judgment and real Safari audio, remain mandatory.

## Excluded from this bootstrap

No composition editor, backend service, accounts, uploads, original emulator, automatic score recovery or musical-quality ranking. No research corpus, samples, binaries, audio, private runtime state or Crafter Git history was copied. GitHub Pages hosting is a future application milestone, separate from publishing this source repository.
