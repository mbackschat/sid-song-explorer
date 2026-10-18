# SID Song Explorer plan

This file owns scope, priorities and completion. [The founding design](docs/design/web-player-and-analyser.md) owns product contracts; [the integration guide](docs/integration/crafter-handoff.md) owns repository boundaries and provenance.

## Current status

2026-10-18: the standalone repository, public source repository and [sound-lens identity](assets/branding/README.md) are established. The user authorized the first mono POC and required Explorer's implementation, experiments and retained decisions to live here. That POC is implemented, with passing engine and headless Chromium/WebKit interaction checks; real desktop Safari playback through the complete ending and the user's explanation-value judgment remain pending. No GitHub Pages deployment or milestone-1 completion is claimed.

| Stage | State | Completion gate |
| --- | --- | --- |
| Repository handoff | Complete | Standalone guide and plan, GPL-3.0-or-later license, transferred design/research with source pin and MIT notice, working document checks and public repository. |
| 1: mono playback and linked inspection | Active: automated POC checks and uninterrupted playback passed; listening pending | Live Rambo loader main music and local mono SID opening in desktop Safari, three-voice mute/solo, playhead/meter, stateful loops, selectable register history and evidence-linked annotations; full ending and the user's explanation-value verdict. |
| 2: dual-SID adoption gate | After milestone 1 | Both models/counts, verified raw chip routing, six controls, seeking checked against continuous playback, synchronized inspection and recent-iPhone smoke check. |
| Later breadth | Unscheduled | Broader catalog, additional local-file profiles and deeper inspection only after the first two gates; define bounded scope before starting. |

## Active proof of concept

The app uses a small TypeScript shell, Vite 7.3.1, TypeScript 5.9.3 and `libsidplayfp-wasm` 1.1.0/SIDLite, with pnpm 11.20.0 and Node.js 24.18.0 (package minimum 24.12). Use the tested Node.js 24.18.0 pin in [.node-version](.node-version), especially for Playwright. [The adapter decision](docs/architecture/playback-adapter.md) selects this bounded route using the retained [Chip Player JS review](docs/research/web-music-explorers.md#chip-player-js-reusable-player-and-visualizer): adapting its service/UI wiring would still leave the needed trace and engine boundary to implement. No measured extraction-effort advantage is claimed, and mono POC adoption does not settle exact dual-SID routing.

Implemented scope comprises live mono playback, local callable PSID intake, model/clock/subtune controls, three-voice mute/solo, forward-emulated seeking and A–B loops, heard-position and emulation-lead display, retained selectable voice/filter history, register/write inspection, PCM meters/waveform/spectrum, and three evidence-linked Rambo annotations. The [validation record](docs/validation/mono-poc.md) owns tested behavior, mismatches and remaining technical checks; implementation alone does not satisfy the listening gates.

The [interim POC catalog snapshot](docs/integration/poc-sources.md) pins cleared Rambo main-entry files and source-backed metadata at Crafter revision `3db086b6963676ef75f34d7f77c3b67232a777fb`. The parser and bounded preparation command are implemented, with tested hash verification and network preparation. The normal install/build/runtime has no sibling checkout dependency. `pnpm prepare:assets` also packages the adopted engine's notices and complete corresponding source. Sample acceptance remains scoped to the underlying characteristic phrase and natural ending; the new cold-start entrance is not separately accepted.

## Next completion gates

The user directed on 2026-10-18 to use Playwright and headless validation as much as possible. Prioritize those checks; do not block this POC handoff on enabling Safari automation. Real-device and human listening gates remain explicitly unverified.

- Automated POC verification is complete: engine, catalog, timeline, six Chromium/WebKit interaction checks, silent uninterrupted full-song WebKit playback, production build and local documentation checks passed. [Mono POC validation](docs/validation/mono-poc.md) owns the exact evidence; retain these guards for subsequent changes.
- Run the complete Rambo main entry in current desktop Safari, record its exact version and macOS version, and verify local file opening, mute/restoration, seeking, repeated loops, retained inspection, interruption recovery and the natural ending.
- Obtain the user's listening and explanation-value verdict with the matching generated reference available. Automated PCM output or WebKit tests do not supply that verdict.

The [milestone-1 contract](docs/design/web-player-and-analyser.md#milestone-1-first-playable-inspection-with-one-mono-sample) remains the completion authority. Keep this case active until the relevant technical and human gates pass; a browser screenshot or short excerpt does not establish full-ending playback.

## Deferred integration and breadth

Crafter still owns the future normalized catalog producer, its schema check and durable analysis-package generation. The manually assembled POC snapshot enables this authorized trial without declaring that producer complete or establishing a competing catalog authority. Replace it through an explicit producer/consumer contract and pin update when that integration is undertaken.

Dual-SID remains behind milestone 1. Verify raw chip routing, both chip models, all six voice controls and seek continuation against continuous playback before accepting that engine contract. The complete [model/count and Safari gates](docs/design/web-player-and-analyser.md#first-step-and-milestones), including the bounded recent-iPhone check, remain required. Broader catalogs and deeper musical analysis stay unscheduled.

## Excluded scope

No composition editor, backend service, accounts, uploads, original emulator, automatic score recovery or musical-quality ranking. Crafter's study corpus and Git history stay there; the POC imports only the pinned metadata described above and retrieves cleared assets into ignored deployment output. ROMs and original reference binaries are excluded. GitHub Pages hosting remains a separate application task.
