# SID Song Explorer plan

This file owns scope, priorities and completion. [The founding design](docs/design/web-player-and-analyser.md) owns product contracts; [the integration guide](docs/integration/crafter-handoff.md) owns repository boundaries and provenance.

## Current status

2026-10-18: the standalone repository, public source repository and [sound-lens identity](assets/branding/README.md) are established. The user authorized the first mono POC and required Explorer's implementation, experiments and retained decisions to live here. That POC is implemented, with passing engine and headless Chromium/WebKit interaction checks; real desktop Safari playback through the complete ending and the user's explanation-value judgment remain pending. No GitHub Pages deployment or milestone-1 completion is claimed.

| Stage | State | Completion gate |
| --- | --- | --- |
| Repository handoff | Complete | Standalone guide and plan, GPL-3.0-or-later license, transferred design/research with source pin and MIT notice, working document checks and public repository. |
| 1: mono playback and linked inspection | Active: automated POC checks and uninterrupted playback passed; listening pending | Live Rambo loader main music and local mono SID opening in desktop Safari, three-voice mute/solo, playhead/meter, stateful loops, selectable register history and evidence-linked annotations; full ending and the user's explanation-value verdict. |
| Post-POC: uninterrupted voice audition (`VOICE-1`) | First after milestone 1; bounded feasibility/cost decision before broader implementation | Implement only at proportionate cost. If undertaken, preserve continuous output, position, shared-filter correctness, fast seeking and bounded memory; browser output guards and Safari listening pass. Otherwise record the no-go/defer decision and retain feedback. |
| 2: dual-SID adoption gate | After the `VOICE-1` implementation or explicit cost-based deferral | Both models/counts, verified raw chip routing, six controls, seeking checked against continuous playback, synchronized inspection and recent-iPhone smoke check. |
| Later breadth | Unscheduled | Broader catalog, additional local-file profiles and deeper inspection only after the first two gates; define bounded scope before starting. |

## Active proof of concept

The app uses a small TypeScript shell, Vite 7.3.1, TypeScript 5.9.3 and `libsidplayfp-wasm` 1.1.0/SIDLite, with pnpm 11.20.0 and Node.js 24.18.0 (package minimum 24.12). Use the tested Node.js 24.18.0 pin in [.node-version](.node-version), especially for Playwright. [The adapter decision](docs/architecture/playback-adapter.md) selects this bounded route using the retained [Chip Player JS review](docs/research/web-music-explorers.md#chip-player-js-reusable-player-and-visualizer): adapting its service/UI wiring would still leave the needed trace and engine boundary to implement. No measured extraction-effort advantage is claimed, and mono POC adoption does not settle exact dual-SID routing.

Implemented scope comprises live mono playback, local callable PSID intake, model/clock/subtune controls, three-voice mute/solo, prepared-range seeking with bounded replay fallback and A–B loops, heard-position and emulation-lead display, retained selectable voice/filter history, register/write inspection, PCM meters/waveform/spectrum, and three evidence-linked Rambo annotations. The [validation record](docs/validation/mono-poc.md) owns tested behavior, mismatches and remaining technical checks; implementation alone does not satisfy the listening gates.

The user requested faster seeking on 2026-10-18. The [seeking study](docs/research/seek-performance.md) owns the measured alternatives and correction of SIDLite PCM/trace clock drift. Bounded audio/observation caching and background preparation are implemented. Silent Chrome/WebKit checks measured 41–80 ms visible transport response for prepared forward/backward/repeated seeks; cold targets still require preparation and show busy feedback. The validation record owns full-song and regression evidence.

The [interim POC catalog snapshot](docs/integration/poc-sources.md) pins cleared Rambo main-entry files and source-backed metadata at Crafter revision `3db086b6963676ef75f34d7f77c3b67232a777fb`. The parser and bounded preparation command are implemented, with tested hash verification and network preparation. The normal install/build/runtime has no sibling checkout dependency. `pnpm prepare:assets` also packages the adopted engine's notices and complete corresponding source. Sample acceptance remains scoped to the underlying characteristic phrase and natural ending; the new cold-start entrance is not separately accepted.

The [completion audit](docs/validation/mono-poc.md#completion-audit) on 2026-10-19 verified the public handoff and current automated evidence, restored an inline warning for dropped traces, and requested the remaining human review. No explanation-value acceptance has been recorded. The user subsequently reviewed the current app in Safari and reported that the Listen by voice interruption was still present; this is a rejected interaction, not successful listening acceptance.

## Bounded live-voice prototype

On 2026-10-19 the user authorized a bounded prototype and automatic integration only if it works with limited change scope. Success requires unchanged full-mix PCM, prompt sustained-note output switching without restarting oscillator/envelope execution, preserved shared-filter behavior, and compatibility with fast seeking and bounded storage. The silent native trial is complete; [the owning study](docs/research/seek-performance.md#bounded-live-gain-prototype-and-integration-decision) retains the reproducible runner, passing selective-gain checks and integration decision. Do not substitute delayed replacement-mix preparation for this live-control trial. Human listening remains a separate gate.

Native output gains passed the bounded fixtures, but preserving prepared seeking exceeds the limited-scope condition: the minimum design crosses WASM packaging, raw-buffer alignment, cache storage, filter-history semantics and playback scheduling. Three lossless Int16 voice signals alone require 48.79 MiB for the current sample, beyond the existing 32 MiB cache cap. That bounded trial did not integrate production playback. The user subsequently authorized continuing toward production, then explicitly permitted a spinner with an explanation if uninterrupted switching is infeasible or too costly. The current correction uses that fallback because integration crosses six coupled audio boundaries; [the retained cost decision](docs/research/seek-performance.md#production-feedback-fallback-and-follow-up) owns the assessment. The interruption remains unresolved and is tracked as `VOICE-1` below; shipping feedback does not close it.

## Next completion gates

The user directed on 2026-10-18 to use Playwright and headless validation as much as possible. Prioritize those checks; do not block this POC handoff on enabling Safari automation. Real-device and human listening gates remain explicitly unverified.

- Automated POC verification is complete: engine, catalog, timeline, Chromium/WebKit interaction checks, silent uninterrupted full-song WebKit playback, production build and local documentation checks passed. [Mono POC validation](docs/validation/mono-poc.md) owns the exact evidence; retain these guards for subsequent changes.
- Run the complete Rambo main entry in current desktop Safari, record its exact version and macOS version, and verify local file opening, mute/restoration, seeking, repeated loops, retained inspection, interruption recovery and the natural ending.
- Obtain the user's listening and explanation-value verdict with the matching generated reference available. Automated PCM output or WebKit tests do not supply that verdict.

The [milestone-1 contract](docs/design/web-player-and-analyser.md#milestone-1-first-playable-inspection-with-one-mono-sample) remains the completion authority. Keep this case active until the relevant technical and human gates pass; a browser screenshot or short excerpt does not establish full-ending playback.

## Exit the POC and continue production work

Milestone 1 ends only after the existing mono playback/full-ending and explanation-value gates above pass. The current Safari report rejects the unexplained voice-switch interruption; the newly authorized feedback fallback still needs review in that browser. POC acceptance may accept this explicitly documented limitation, but must not imply that voice switching is gapless. No calendar date is promised: completion depends on those concrete verdicts.

The next delivery order is explicit. Address `VOICE-1` first after POC acceptance, before dual-SID adoption or catalog breadth. The user explicitly requires proportionate effort, not gapless switching at all costs. Start with a bounded feasibility/equality check, then assess implementation complexity, maintenance burden, memory/performance cost and regression risk against the interaction benefit before a broader rewrite. If that cost is disproportionate, stop, record the evidence and recommendation, mark the item deferred rather than complete, and retain the spinner/explanation; subsequent work may then proceed. A future session must use the retained evidence rather than repeat an open-ended investigation or treat the spinner/native prototype as gapless completion.

| Item | State and dependency | Required outcome and closing evidence |
| --- | --- | --- |
| `VOICE-1`: uninterrupted Listen by voice | First post-POC task; native gain feasibility passed. Bounded cost decision precedes production integration; explicit deferral is allowed. | Mute, solo, toggling solo off and restoring the mix must not stop/restart output, freeze the heard cursor or wait for replay. Selection must affect held notes while CPU/oscillator/envelope execution continues. Verify shared-filter history, ring/sync and D418 behavior; retain fast prepared seeking with measured bounded storage. Silent Chrome/macOS WebKit output guards must detect dropped/duplicated frames and unintended silent spans between audible selections; direct Safari listening must confirm the result. Spinner feedback is not a passing result. |
| `STEREO-1`: dual-SID adoption | After `VOICE-1` is implemented or explicitly deferred on cost grounds; founding milestone 2. | Verify raw chip routing, both models, six voice controls, seek continuation, synchronized inspection and the bounded recent-iPhone smoke check in [the design](docs/design/web-player-and-analyser.md#milestone-2-the-dual-sid-gate). |
| `CATALOG-1`: normalized catalog producer/consumer integration | After the interaction and stereo gates; exact implementation scope not yet scheduled. | Crafter owns generation and schema validation; Explorer consumes a pinned version with compatibility checks and no sibling dependency. Replace the interim snapshot through [the integration contract](docs/integration/crafter-handoff.md). |
| Broader local-file support and deeper inspection | Unscheduled, after the above gates. | Define supported profiles and useful inspection outcomes before implementation; do not infer support from a successful generic render. |

`VOICE-1` starts with exact raw-signal/filter replay equality against the shipped engine, using real WASM initialization and complete-song/profile checks. Passing that gate is necessary but does not automatically authorize unlimited implementation: make the proportionality decision before replacing the cache/checkpoints and AudioWorklet transport. [The owning study](docs/research/seek-performance.md#production-feedback-fallback-and-follow-up) retains the proposed split, estimated memory cost and important sample-boundary constraints. Those are design hypotheses to verify, not an implemented backend. If equality or bounded execution fails, record the failing input and decide whether one bounded correction is justified or deferral is preferable. Do not enter an open-ended redesign, close the item as implemented or silently substitute delayed mix replacement.

## Deferred integration and breadth

Crafter still owns the future normalized catalog producer, its schema check and durable analysis-package generation. The manually assembled POC snapshot enables this authorized trial without declaring that producer complete or establishing a competing catalog authority. Replace it through an explicit producer/consumer contract and pin update when that integration is undertaken.

Dual-SID remains behind milestone 1. Verify raw chip routing, both chip models, all six voice controls and seek continuation against continuous playback before accepting that engine contract. The complete [model/count and Safari gates](docs/design/web-player-and-analyser.md#first-step-and-milestones), including the bounded recent-iPhone check, remain required. Broader catalogs and deeper musical analysis stay unscheduled.

## Excluded scope

No composition editor, backend service, accounts, uploads, original emulator, automatic score recovery or musical-quality ranking. Crafter's study corpus and Git history stay there; the POC imports only the pinned metadata described above and retrieves cleared assets into ignored deployment output. ROMs and original reference binaries are excluded. GitHub Pages hosting remains a separate application task.
