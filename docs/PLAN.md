# SID Song Explorer plan

This file owns scope, priorities and completion. [The founding design](design/web-player-and-analyser.md) owns product contracts; [the integration guide](integration/crafter-handoff.md) owns repository boundaries and provenance.

## Current status

`COMPOSITION-1` is implemented across Crafter and Explorer: the source-backed Rambo mono package connects parts and instrument programs to two listening passages and their recurrence. Its [musical usefulness review](validation/composition-exploration.md) remains open. The [library picker](validation/library-picker.md) still needs its own actual Safari/iPhone review. Earlier stereo playback acceptance does not close either new-interface gate.

| Item | State | Owning scope and evidence |
| --- | --- | --- |
| Mono player and linked inspection | Accepted | [Mono validation](validation/mono-poc.md); actual Safari full-ending playback and inspection usefulness accepted on 2026-10-19. |
| `TIMELINE-1/2/3`: upcoming activity, width-aware zoom, unified transport | Implemented; upcoming preview and playhead handoff accepted | [Timeline scope](#unified-timeline-and-transport-timeline-3), [validation](validation/mono-poc.md). |
| `STEREO-1/2`: dual SID and compact L/R output | Implemented; Safari/iPhone stereo accepted on 2026-10-20 | [Stereo validation](validation/stereo.md). |
| `CATALOG-1`: normalized producer/consumer | Implemented | [Pinned integration contract](integration/crafter-handoff.md#normalized-catalog-integration). |
| `LIBRARY-1`: online SID selection | Implemented; actual Safari/iPhone review open | [Picker scope](#online-sid-library-picker-library-1), [validation](validation/library-picker.md). |
| `COMPOSITION-1`: Rambo parts and programs | Implemented; usefulness review open | [Design](design/composition-exploration.md), [review route](validation/composition-exploration.md). |
| Release validation | Implemented | [Candidate identity, POC smoke/compatibility checks and publication gates](validation/mono-poc.md#release-validation); software checks run once on Linux, verified engine output is reused, and only browser compatibility requires macOS. Broader browser regressions run when relevant to a change. Exact-commit results remain in CI. |
| `VOICE-1`: gapless voice switching | Deferred; existing pause-and-rebuild controls retained | [Cost decision and retained experiments](#gapless-voice-follow-up-spike). |
| `ANALYSIS-1`: generic headless analysis | Parked; no production integration | [Retained spike](#headless-sid-analysis-spike-analysis-1). |
| Broader catalog/profiles, stereo/Bach composition packages, deeper inspection | Unscheduled | Define bounded scope before implementation. |

The plan tracks product scope and open acceptance gates. Exact-commit build and deployment results belong in [GitHub Actions](https://github.com/mbackschat/sid-song-explorer/actions); they do not substitute for listening or usefulness verdicts.

## Accepted proof of concept

The mono POC is accepted for live Rambo main-music playback, local callable PSID intake, model/clock/subtune controls, voice audition, stateful seek/loops and useful register/write inspection. Actual Safari full-ending playback and inspection usefulness were accepted on 2026-10-19. Voice changes still pause and rebuild the prepared mix; this accepted limitation remains visible in the UI.

The [adapter decision](architecture/playback-adapter.md) owns the adopted engine and small-shell architecture. [Mono validation](validation/mono-poc.md) owns behavioral oracles and acceptance limits; [seeking research](research/seek-performance.md) owns cache/latency measurements. Normal installation, build and runtime do not require a sibling checkout.

## Centered timeline spike (`TIMELINE-1`)

Implemented and accepted: Scroll places the heard playhead approximately halfway between past and upcoming activity, using actual prepared observations. Startup, ending and unavailable coverage remain explicit; no notes are extrapolated and playback does not wait for the preview. Hold captures inspection independently of playback. An off-screen observation margin covers movement between refreshes.

The [preview validation](validation/mono-poc.md#centered-timeline-spike) owns continuous-rendering comparisons, cache/position invariants and refresh-cost evidence. Width-aware zoom supersedes the spike's original fixed ten-second viewport; configurable past/future ratios remain excluded.

## Timeline zoom (`TIMELINE-2`)

Implemented: zoom changes time density by a factor of two across seven levels. At equal zoom, twice the drawable width shows twice the duration. Resizing preserves density; held views preserve their captured observations. Fit song provides a separate whole-song overview. Pinch/wheel gestures, persistent preferences and a configurable past/upcoming split remain excluded. [Zoom validation](validation/mono-poc.md#timeline-zoom) owns resize, playback and cost evidence.

## Unified timeline and transport (`TIMELINE-3`)

Implemented with the playhead handoff accepted on 2026-10-20. The shared panel combines playback/zoom controls, lane mute/solo and a proportional scrollbar. Restart releases held inspection and starts Scroll at zero, then resumes centered following as playback reaches the middle; [restart validation](validation/mono-poc.md#restart-viewport) owns the guard. Browsing updates continuously without seeking. Normal timeline clicks seek; Shift-click inspects; Hold freezes inspection without pausing audio; Follow centers current playback and releases browsing/inspection. The [interaction principle and detailed design](design/web-player-and-analyser.md#interaction-principle) own the agreed behavior, including the clicked-note return to center at song speed.

Selected A/B bounds are visible independently of playback repetition, using a violet ruler bracket, draggable handles and dashed lane boundaries without additional background shading. Clear removes the selection without collapsing allocated ruler space. Hear phrase uses fresh destination observations, expands loop controls and shows Loop on beside transport time. The chart remains a linear song view beyond B while playback repeats at B. [Loop validation](validation/mono-poc.md#loop-bracket-and-handles) and [phrase listening](validation/composition-exploration.md#phrase-listening-and-live-observations) own the guards and acceptance scope.

Chart labels describe the visible time window; scrollbar labels describe the whole song. Unknown-duration files use a stable **Fit timeline** range captured on demand. [Unified-panel validation](validation/mono-poc.md#unified-timeline-panel) owns browsing, seeking and layout invariants.

## Bounded live-voice prototype

The retained [native gain trial](research/seek-performance.md#bounded-live-gain-prototype-and-integration-decision) proves bounded selective-gain behavior, not browser continuity or production integration. Maintaining prepared seeking couples raw-signal storage, filter history, cache and scheduling; those costs are part of the [final deferral decision](#gapless-voice-follow-up-spike). Keep this implementation as evidence and retain the existing pause-and-rebuild player.

## Next completion gates

1. Review the Rambo composition explanation: passages, part/program selection, timeline highlights and comparison, using the [prepared review route](validation/composition-exploration.md).
2. Review the library picker on actual Safari/iPhone, separately from accepted stereo playback, using its [validation gates](validation/library-picker.md).
3. For each authorized release, require exact-commit CI and verify the hosted app's assets/routes. Report results through CI and the release response rather than appending them to this plan.

No additional feature is automatically scheduled by closing these gates. Generic analysis and gapless switching remain deferred.

## Public application and README-aligned catalog

The [Application workflow](../.github/workflows/app.yml) deploys the production artifact to GitHub Pages after Chrome/Ubuntu and WebKit/macOS checks pass. [Hosted-route validation](validation/mono-poc.md#github-pages-and-readme-catalog) owns publication checks.

The bounded catalog includes cleared Rambo, Bach, Mozart and original instrument-mix material, with supported stereo variants. Moon River, Pink Panther, Axel F and Ghostbusters remain materials-only entries; no uncleared audio is deployed. Catalog expansion and other hosting providers require separate scope.

## Exit the POC and continue production work

The accepted POC has been extended with the implemented timeline, stereo, output-monitor and catalog features listed in [current status](#current-status). The [design](design/web-player-and-analyser.md) remains their regression baseline. Gapless switching is deliberately deferred under its cost condition; feedback during a voice change is not a claim of uninterrupted switching.

Future work must preserve the accepted player interactions, raw chip routing, bounded preparation, local-file privacy and standalone producer/consumer boundary. Broader catalog, local-file profiles and musical analysis require a bounded proposal rather than continuation of an obsolete delivery sequence.

## Fit song follow-up

Fit song keeps the known full duration visible while playback and seeking advance. For unknown duration, Fit timeline captures the current limit on click and retains that scale until another explicit fit. Prepared future activity remains visible; missing data is shaded. Sampled overview history survives PCM eviction independently of whether Fit was previously selected, while Hold retains exact inspection separately.

The user accepted the view and the corrected late-switch/held-shading behavior. [Overview validation](validation/mono-poc.md#whole-song-overview), [history/shading guards](validation/mono-poc.md#late-fit-song-and-held-shading-corrections) and [duration lookup](validation/library-picker.md#song-lengths-and-stable-fitting) own the evidence and privacy boundary.

## Dual-SID implementation checkpoint

Implemented: raw chip routing, frame-correct interleaved transport/cache storage, six chip-owned voice controls, independent filter histories and Rambo/Bach stereo entries. Both chip models are covered by mono-equality, channel-separation and seek-continuation oracles. Dense observation pagination preserves chart coverage. The compact output panel provides L/R meters and waveforms plus a shared colour-labelled spectrum; mono retains its single-channel presentation.

The user accepted Safari/iPhone stereo on 2026-10-20; exact device/browser versions were not supplied. [Stereo validation](validation/stereo.md) owns the scope, independent oracles and remaining limitations. Audio output sits directly below the compact Sound inspector, with shared-filter settings collapsed by default and ordered writes expandable. Expanded filter settings use stable labelled rows to avoid moving subsequent content as values change. Broader workspace reordering remains deferred.

## Catalog integration and deferred breadth

Crafter owns the normalized version-1 producer, curator input and schema validation; Explorer owns the pinned importer and runtime adaptation. The migration preserves the existing playable/materials entries, downloads, hashes, ordering, listening scopes and Rambo annotations. Asset/evidence provenance is independent of the producer/index revision. Development, builds and preparation require the verified catalog without a sibling checkout.

The [integration guide](integration/crafter-handoff.md#normalized-catalog-integration) owns commands, pin updates and exact migration verification. Additional catalog breadth and local-file profiles remain unscheduled; the separate composition package does not alter catalog v1.

## Implementation completion audit

The implemented items are listed once in [current status](#current-status). Their validation owners are [mono/timeline](validation/mono-poc.md), [stereo](validation/stereo.md), [catalog integration](integration/crafter-handoff.md#migration-verification), [library picker](validation/library-picker.md) and [composition](validation/composition-exploration.md).

Implementation completion, automated validation, hosted deployment and human acceptance are distinct claims. The open product reviews are listed in [next completion gates](#next-completion-gates); routine test counts, release attempts and local-versus-remote checkpoint history are not maintained here.

## Gapless voice follow-up spike

Deferred by the user's final decision: retain the existing player and accept its voice-switch interruption. Preserve both spike implementations and their evidence. Do not proceed with production integration, a larger cache or another storage-efficiency spike unless explicitly reopened. [The decision and alternatives](research/seek-performance.md#final-decision-retain-existing-voice-switching-2026-10-20) own the rationale.

The isolated real-WASM replay gate covers the unchanged SIDLite filter, both models/clocks, complete Rambo, asymmetric stereo, non-block continuation and independent voice selections. Measured retention is about 70.6–71.4 seconds mono and 36.1 seconds stereo within the modeled 32 MiB typed-data budget. The separate browser POC preserves the proven core and establishes continuous scheduling with approximately 225–260 ms selection delay. These are bounded evidence, not an adopted transport or a new Safari/iPhone verdict.

The user accepted the browser POC on 2026-10-20 without naming a device. The [study](research/seek-performance.md#follow-up-spike-after-stereo-adoption) and [executable browser spike](../scripts/experiments/live-voice-browser/README.md) retain the equality, memory and continuity oracles and the reopening boundary.

## Online SID library picker (`LIBRARY-1`)

On 2026-10-20 the user requested online library discovery alongside local SID opening. Search and catalog browsing must belong to an existing service; implementing another browser/search interface exceeds Explorer’s intended scope. Manual download followed by local file opening is not an acceptable online-library workflow. The [research record](research/sid-library-picker.md) recommends SIDquake’s documented file-mode iframe and retains the successful live Chrome transfer, source pin, metadata limits and provider terms.

Recommended interaction: **Browse SID library → dialog containing SIDquake’s existing browser → search and select → receive the SID and available metadata → close the dialog and load the tune in Explorer.** The existing transport owns subsequent playback behavior; the embedded widget is a picker with its player, visualizer and autoplay disabled.

Required:

- Place **Browse SID library** beside **Open SID**. Load the third-party widget when the user opens it. Search and selection remain inside the provider interface, with its attribution visible.
- Receive file bytes through the documented file-mode handoff and pass valid selections through the existing loader and format checks. Preserve the existing sample catalog and local-file workflow. A library selection does not grant support for an otherwise unsupported SID profile.
- Retain supplied title, author, release and STIL where available, with library provenance. Treat missing metadata as normal and provider text as inert content; derive playback configuration from the SID and existing controls. Do not invent durations or treat library notes as verified Explorer annotations.
- Retain the provider browser within the Explorer tab: search, library folder, results and scroll position survive closing and selection, without another confirmation step. Close hides it and restores focus; messages received while hidden or from discarded frames are ignored. Explicit **Reload library** and Explorer reload reset the session. SIDquake cannot identify a pre-close request completing after the same frame reopens; the [validation record](validation/library-picker.md#interaction) records this protocol limit and the user’s retention priority. Loading, unsupported files and provider failures have clear feedback; local opening remains available.
- Accept messages only from the expected provider origin and active iframe, with valid bounded payloads. Local files, hashes and metadata remain device-local; no automatic lookup or upload accompanies local opening.

HVSC reference lengths are looked up from its official database for library selections, using original file bytes and the chosen subtune at its intended clock. Fetch once into tab memory, match locally, and continue with unknown length on missing/unavailable/unsupported metadata. Local files do not trigger lookup. Provider-selected subtunes remain deferred; Explorer’s existing subtune controls remain available after loading.

Excluded: Explorer-owned library indexing/search, provider forks, a proxy/backend, music/index mirroring, bulk downloading, accounts, expanded SID-format support and manual download/upload as an integration substitute. Provider service changes that prevent the supported handoff require reassessment rather than silently expanding scope.

Completion evidence: red/green receiver and integration guards cover valid selection, wrong origin/window, malformed or oversized payloads, discarded-frame messages, missing metadata, hidden-message rejection and retained browsing state. Silent Chrome/macOS WebKit checks verify dialog/focus behavior, narrow layout and attribution, and selection through loading to supported playback. Retain a bounded live-provider check separately from deterministic tests, including the deployed Explorer origin when available. Actual Safari and recent-iPhone verification must cover this new workflow; earlier stereo acceptance does not establish third-party picker compatibility. No manual file transfer is permitted in the acceptance path.

Status: implemented. The [integration validation](validation/library-picker.md) owns deterministic and live-provider Chrome/macOS WebKit evidence. Actual Safari/iPhone review remains open; release checks are separate.

Source controls distinguish the pending sample from the loaded tune. **Open SID file** and its visible drop target share the device-local intake path. [Source-control validation](validation/library-picker.md#source-controls-and-repeated-selection) covers initial state, repeated library selection and local file replacement.

## Headless SID analysis spike (`ANALYSIS-1`)

Parked at the user's request. Preserve the [proposal](design/headless-sid-analysis.md), [research](research/sid-analysis-capabilities.md), [bounded spike](validation/headless-sid-analysis-spike.md) and headless/UI boundary. The spike covers navigable changes, voice/chip summaries and PCM statistics through a Node JSON runner and thin report viewer. Human usefulness review and production integration are not accepted or scheduled; do not continue unless reopened.

## Excluded scope

No composition editor, backend service, accounts, uploads, original emulator, automatic score recovery or musical-quality ranking. Crafter's study corpus and Git history stay there; the POC imports only the pinned metadata described above and retrieves cleared assets into ignored deployment output. ROMs and original reference binaries are excluded from committed/deployed assets. GitHub Pages hosting and the README-aligned catalog were explicitly authorized on 2026-10-19; other hosting services and expansion of Explorer’s own published catalog remain outside this task. The separate `LIBRARY-1` retrieves user-selected files through a provider’s existing picker without importing its collection into Explorer’s catalog.
