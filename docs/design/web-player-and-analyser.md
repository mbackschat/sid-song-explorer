# Web SID player and arrangement analyser

Status: founding design, originally recorded 2026-10-16 and transferred on 2026-10-18 after the user authorized a standalone public repository. Repository setup is complete; application implementation has not begun. [The Explorer plan](../PLAN.md) owns current status. Technology stack and final playback-library selection remain open.

## Purpose and user requirements

Build a GitHub Pages application where visitors can select and play the project's published samples, in mono and native multi-SID stereo, while reading descriptions and musical analysis drawn from the project's material. Develop it toward the project's eventual web UI.

The application should help people understand instruments, arrangements and how master composers make SID music work. Ordinary player controls are necessary, but insufficient: the visitor should be able to connect what they hear to sound programs, phrasing, musical roles, voice allocation and changes across the song.

The user's requirements, rephrased without changing their scope:

- Initially prefer our own application presentation and analysis interactions, with existing SID playback/emulation. The user's later clarification explicitly permits adopting an existing application and adapting its gaps; evaluate that route before committing to a custom shell. No original SID emulator is proposed.
- Support both MOS6581 and MOS8580, each in single-SID and dual-SID stereo configurations, matching the project's scope. These are mandatory capabilities for catalog and locally opened songs, not optional library features.
- Treat correct dual-SID stereo as a decisive library-selection requirement. Generic claims of multi-SID or two-channel output are insufficient; preserve the actual arrangement's chip routing.
- Offer sample selection, playback, song descriptions and analysis from existing project research. Include instrument information, standard voice mute/unmute, spectrum visualization, a playhead, level meters and useful additional ways to see what is happening.
- Treat Safari on iOS and macOS as a hard requirement. Supporting only recent Safari versions is acceptable. A recording fallback does not satisfy the live SID requirement on these platforms.
- Prioritize the desktop experience. Mobile Safari should work, but initially avoid substantial iPhone-specific design, optimization or testing effort; support does not require an equally polished mobile workbench.
- Make instruments and arrangements central. Fill the gap between a regular SID player and an analyser that helps explain masters' songs; suggest useful views and interactions beyond the requested controls.
- Include useful seeking that preserves running state.
- Support optional analysis packages for studied songs, but make most features useful without one.
- Provide a file-opening/upload control so visitors can at least play their own mono and stereo SID files.
- Use a C64-inspired visual character, taking inspiration from Chip Player JS's retro presentation, while retaining modern mouse, touch and keyboard interaction. Styling must not reduce readability or usability.
- Consider the user's existing [Williams Sound Explorer](https://github.com/mbackschat/williams-sound-explorer) as a reference for individual sound/instrument inspection. It covers only part of this application's scope; whole-song and arrangement analysis remain central. This does not select its stack or expand this proposal into a sound editor.
- Preserve findings, alternatives and recommendations with their rationale in this proposal. Leave technology-stack discussion open.

## Project identity and repository boundary

The separate-repository direction was discussed and accepted for this proposal on 2026-10-16. Recommended working name: **SID Song Explorer**, with `sid-song-explorer` as the corresponding repository name. It conveys the whole-song scope, accommodates playback and deeper analysis, and pairs with SID Song Crafter and Williams Sound Explorer. A GitHub repository search on 2026-10-17 found no public repository matching `sid-song-explorer`; organization names and trademarks were not checked. The user confirmed this name on 2026-10-18 and authorized creation and publication of the standalone repository; [the handoff record](../integration/crafter-handoff.md) records the transfer.

The browser application warrants its own repository because playback integration, Safari compatibility, visualization, interaction design and deployment form a substantial product with its own dependencies and release cycle. It should also serve visitors exploring arbitrary local SID files independently of the composing workflow. SID Song Crafter remains focused on composition and the musical knowledge that supports it. Separation also gives the application its own distribution terms: both leading reuse candidates carry copyleft obligations ([libsidplayfp-wasm](#playback-library-findings-and-alternatives) declares GPL-2.0-or-later; the combined [Chip Player JS application](#choose-reuse-by-the-remaining-gaps) is generally GPLv3), while Crafter's original project work stays under its [MIT license](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/LICENSE).

| SID Song Crafter owns | SID Song Explorer owns |
| --- | --- |
| Composition and export tools. | Browser playback and engine integration. |
| Editable instrument programs and arrangements. | Interactive instrument and arrangement inspection. |
| Master studies, source evidence and scoped listening verdicts. | Presentation of matching evidence alongside playback. |
| SID chip, mixing and engine-behavior findings, such as stereo crossfeed and muting semantics. | Application decisions: app base, interaction design, Safari support and catalog presentation. |
| Sample generation, attribution and publication decisions. | Sample browsing, local SID opening and application deployment. |
| A versioned, normalized sample catalog index: variants, files with SHA-256 hashes, chip/clock/routing, rights and license, publication scope, scoped listening verdicts and links to owning package READMEs. | Rendering of that catalog and deployment of the cleared files it lists. |
| Production of optional analysis packages. | Consumption of those packages; generic inspection when absent, with its live derived observations labelled as Explorer-derived. |

Keep one authoritative copy of musical knowledge. Explorer should consume the catalog index and analysis packages and link back to owning studies and recipes; it should not maintain a second copy of the research. The current sample manifests do not yet share one schema (for example, Bach's [manifest](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/bach-toccata/manifest.json) records `rights`, Mozart's [manifest](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/mozart-minuet/manifest.json) does not), so the index is new Crafter work rather than an existing contract. Explorer pins a Crafter revision or catalog version, fetches the listed cleared files at build time, verifies their hashes and places them only in its deployment output, never in its source tree; a publication withdrawn in Crafter therefore leaves the site at Explorer's next pin update. The index carries a schema version, bumped on breaking changes, so the repositories can release independently. Explorer's live derivations and Crafter's package measurements may come from different implementations; do not present them as equivalent unless a shared algorithm is extracted. Static files and explicit data contracts are sufficient for the initial integration; separating repositories does not require a backend service, published packages or a framework decision.

Historical handoff recommendation, fulfilled on 2026-10-18: establish the application repository when [PLAN.md](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/PLAN.md) queues Explorer work, as a separate track from the plan's single active musical case. [First step and milestones](#first-step-and-milestones) orders the handoff and the first prototype. Composition studies and source evidence remain in Crafter. Keep browser-engine adaptations with Explorer initially; extract a shared library only when demonstrated reuse warrants it. The user subsequently authorized repository setup and public GitHub publication. That setup does not implement the application milestones below.

Any later editing UI in Explorer would remain a client of Crafter-owned formats and toolchain, and needs its own proposal.

## Scope and priorities

### Required product capabilities

- A selectable public sample catalog, with mono/stereo variants, descriptions, analysis, attribution and available downloads.
- Local SID opening, including multi-SID files, without requiring an analysis package.
- Live playback, subtune selection, voice mute/unmute, navigation and synchronized audio/chip inspection on supported Safari versions.
- An arrangement overview and sound inspection that remain useful for unfamiliar files.
- Optional analysis packages that add verified instrument identities, musical roles, section boundaries, explanations and links to evidence.
- Clear separation of measured behavior, recovered source facts, musical interpretation and uncertain automatic detection.

The required hardware coverage is:

| Chip model | Single-SID | Dual-SID stereo |
| --- | --- | --- |
| MOS6581 | Required: three voices, one chip output. | Required: six voices, two chip outputs with the declared stereo routing. |
| MOS8580 | Required: three voices, one chip output. | Required: six voices, two chip outputs with the declared stereo routing. |

This matrix applies to live playback and the associated controls and inspection on supported Safari platforms, with or without an analysis package. The chosen engine must implement both chip models rather than merely relabel one emulation. Honor declared models and addresses, expose the actual configuration, and allow explicit overrides when declarations are absent or a visitor intentionally changes the playback setup.

### Recommended initial boundary

Include the catalog, local file opening, live mono/two-SID playback, voice mute/solo, state-preserving seeking, contextual phrase loops, playhead, output meters, spectrum, retained voice activity and selected-sound inspection. The linked-selection, chip-ownership and explanation interactions below are part of this initial boundary. Include instrument cards and named arrangement sections where annotations exist, while keeping raw inspection available without them.

Rationale: the first useful version must already explain sound and arrangement. Deferring every analyser feature would produce an ordinary player and postpone the project's defining purpose.

### Optional depth

Add richer dependency diagrams, recurring sound-pattern discovery, spectrograms, phrase comparisons, verified mechanism comparisons, personal annotations and score-following where source-backed note data exists. These remain proposals, not promises of automatic decoding for arbitrary drivers.

### Excluded from this proposal

An original SID emulator, automatic recovery of every instrument/score, automatic musical-quality judgments, server uploads/accounts, cloud storage, arbitrary audio stem separation, and a complete composition editor or build-service backend. The eventual web UI may grow into editing and export, but those contracts need a separate proposal. GitHub Pages cannot itself execute our existing Python/native toolchain.

## Application sketch

On desktop, use a persistent transport, a sample/file area, a central timeline and an inspector for the selected passage, voice or instrument. The following is a conceptual layout; visual direction is specified separately below and no framework is selected:

```text
SID Song Explorer                           [Open SID…]
──────────────────────────────────────────────────────────────
Samples / local file   Rambo — centered-lead arrangement
                       [Mono] [Stereo]   PAL · 2 × MOS6581
Bach Toccata           Description · Instruments · Analysis
Instrument mix
Rambo                  [Play] [Restart] [Loop A–B]  0:42 / 3:45
…                      ────────────────●─────────────────────
                       Intro | Main theme | … | Ending

                       Arrangement / voice timeline
                       [Follow playback] [Return to playing]
                       Chip A: V1 / V2 / V3   [Mute] [Solo]
                       Chip B: V1 / V2 / V3   [Restore full mix]
                       Role labels and occurrences where known
                       Shared filters · Coupling · A/B → L/R

                       Selected sound / phrase  [Hear with context]
                       Instrument · Pitch · Pulse · Gate
                       Waveform changes · Filter · Dependencies
                       [Occurrences] [Recipe] [Evidence]

                       Output: [L meter] [R meter] [Spectrum]
                       “Listen here…” · Sources · Downloads
```

Labels, time and section names above are illustrative. Actual duration, variants and verified form come from the selected file/package; do not assign the complete Rambo duration to its separately exported main-music version.

Use a basic responsive layout on smaller screens, retaining usable file/sample selection, transport and access to inspection panels. Essential controls must work by touch and not depend on hover. Stacking or collapsing the existing desktop panels is sufficient initially; a dedicated iPhone layout, custom gesture system and equivalent mobile workflow polish are outside the initial scope. Rationale: mobile compatibility is required, while design and development effort should concentrate on desktop exploration.

### Visual direction

Use a restrained C64-inspired presentation: a blue/violet foundation, crisp panel borders and selective pixel or monospace accents in headings and transport. Chip Player JS's retro player/visualizer is a reference for character, not an exact template; the user's settings screenshot labels its theme “MS-DOS.” Keep consistent chip/voice colours across timeline, controls and inspector, with text labels and selection outlines so colour is never the only identifier.

Modern usability takes priority: scalable, readable prose and measurements; clear selected/disabled/focus states; adequate contrast and control targets; ordinary mouse selection, keyboard navigation and touch controls. Do not impose a 40-column layout, all-uppercase text or tiny bitmap body type. CRT distortion, flicker and scanlines are not part of the initial design. Detailed plots may use a quieter background than the surrounding panels so the retro palette does not obscure data. This direction does not require a theme system, change the desktop priority or decide the application base.

### Main interactions

| Visitor action | Application response |
| --- | --- |
| Select a project sample | Show its available variants, configuration, description and listening scope; make playback immediately accessible. |
| Choose mono or stereo | Load the corresponding export with its own identity and timeline. Do not imply every variant differs only in panning or can switch seamlessly. |
| Open a local SID | Read it locally, expose header metadata and subtunes, and offer playback and generic inspection immediately. Missing annotations do not block it. |
| Select a voice or sound occurrence | Retain the selection across aligned parameter views while playback can continue. Show verified instrument identity and recipe links when available; otherwise show observed behavior without inventing an instrument name. |
| Select a phrase | Recall its A–B boundaries, hear visible lead-in/tail context and retain the span while switching between full mix and a mute/solo intervention. |
| Select an instrument card | Highlight its known occurrences and musical roles; jump to an example and open its recipe or owning study. |
| Select a guided listening marker | Hear the passage and reveal one audible decision, its selected event/voice and supporting evidence; offer a return to full context. |
| Compare two passages | Inspect differences in instrument selection, register, articulation and accompaniment; preserve their separate timing and context. |
| Change mute/model/clock settings | Update live sound and measurements together; indicate when authored analysis no longer matches the reference configuration. |

Recommended file control: **Open SID…**, with desktop drag-and-drop and the iOS file picker. Although requested as an upload button, the proposed behavior is local file loading: no file leaves the device. Rationale: server storage is unnecessary for playback and would expand scope. Reload/session persistence is not yet specified.

### Selection and retained history

Maintain one selected time span across the voice timeline, pitch/frequency, gate, waveform, pulse/filter trajectories and available write records. The heard playhead and inspection cursor are separate: holding an inspection stops the view from following without pausing the music or seeking it. **Follow** restores centered playback. Explicit playback/seek actions move the heard position.

Retain timestamped observations within a bounded history, show the available interval, and identify missing or dropped records. Keep the selected span inspectable while it is held, including its observation coverage; do not silently replace it as live history advances. Retention capacity and observation cadence remain engine-dependent and must be visible rather than implying unlimited or cycle-complete recording. Unknown future regions require emulation before inspection. This makes a fleeting attack useful evidence without requiring an analysis package.

The centered Scroll view requested on 2026-10-19 places heard playback halfway through the visible time window, with equal past and upcoming space. The subsequent zoom request uses fixed time density: doubling drawable width doubles visible duration at the same zoom. Zoom in/out changes density by a factor of two; the duration label reflects the current width. Zooming or resizing a held view centers its selected cursor and preserves the captured observations. Upcoming activity must come from prepared observations; unavailable time is shaded, including before initialization and beyond the ending. Preparation must not delay playback. Fit history remains an overview of retained heard observations. Holding a prepared future moment preserves its configuration and identifies that it was ahead of playback when captured. A loop preview stops at the repeat boundary until wrapped preview is separately implemented. [The plan](../PLAN.md#centered-timeline-spike-timeline-1) owns the bounded trial and acceptance gate.

The unified-panel POC places playback, zoom and Follow with the voice timeline. A proportional scrollbar represents the visible fraction of the song and browses independently of sound; normal clicks on voice/filter lanes seek playback and release held inspection without moving the clicked point. Paused seeking preserves the visible range. In Scroll, a left-side playhead advances naturally to center before scrolling starts; a right-side playhead moves left toward center at the same steady rate, then centered scrolling continues. The return closes one timeline second of distance per second heard, without easing. Fit resumes fitting heard history when playback advances. Shift-click inspects a point without seeking. Hold captures the current heard position without pausing sound. The time ruler also seeks on release. Scrolling preserves captured inspector data. Follow returns immediately to centered heard playback and releases inspection. Continuous dragging reuses prepared observations, with unavailable ranges shaded. Setup and loop editing expand on demand. [The POC plan](../PLAN.md#unified-timeline-and-transport-timeline-3) owns edge semantics and the pending browser review.

## Views that explain the music

| View | Content and interaction | Musical value |
| --- | --- | --- |
| Arrangement timeline | Voice activity, entrances, gaps and register changes for any supported file; named roles and sections when available. Select and loop a span. | Shows density, contrast, recurring material and allocation of musical space. |
| Instrument palette | Verified programs and characteristic behavior when annotated; provisional recurring sound patterns when discovery is available. Select occurrences. | Connects sound identity to its use throughout an arrangement. |
| Sound microscope | Aligned histories for the selected event's frequency/pitch, waveform controls, pulse-width motion, gate/retrigger events and filter settings; deeper available writes. | Explains attack, body, movement, release and the next onset. |
| Voice allocation | Three stable voice lanes within each chip, explicit mute/solo and restore-full-mix controls, with time-dependent role labels where known. | Exposes voice borrowing, alternating bass/percussion and interrupted support. |
| Dependency map | Ring/sync relationships, shared filter routing and chip-output placement. | Explains why sounds cannot always be isolated or moved independently. |
| Phrase comparison | Two selected passages, with available note/program evidence and sound trajectories. | Distinguishes patch changes from changes in register, phrasing and context. |
| Audio monitor | Waveform scope, spectrum, optional spectrogram, L/R peak and RMS meters in dBFS and clipping indication. | Shows transients, brightness, balance and silence without claiming instrument identification. |
| Guided listening | One audible decision per passage card: hear → select → observe → return to context, with the owning study and evidence scope one step away. | Makes accumulated research usable while the relevant music is heard. |

The preferred exploration sequence is: **hear a phrase → select it → inspect the sound and allocation → compare another occurrence → read the explanation or reusable recipe**.

Structure explanation cards as **what to hear → what to watch → why it happens → evidence/recipe**, borrowing from Williams Sound Explorer. When a matching package contains source/program attribution, the selected event can reveal that reference directly. Keep observed timing distinct from proven cause: a register change near a spectral feature is not sufficient evidence of its mechanism. Missing source attribution leaves generic inspection intact.

Choose visualization by available evidence. Audio spectrum works without recovered note data; SID frequency trajectories are derived observations, and a score-like piano roll needs appropriately labelled note evidence. A keyboard-labelled spectrum locates frequency bands rather than identifying played notes. Keep the main view focused, with exact writes and detailed configuration revealed through selection rather than displaying every panel at once.

For example, the [Hülsbeck study](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/songs/axel-f/huelsbeck-study.md#targeted-role-study-lead-support-and-the-apparent-switch) records a perceived change near one minute while the executed lead program remains the same. Shorter articulation, higher register and surrounding development change the result. A useful UI highlights those changes and shows that short notes restart before the pulse trajectory develops fully. This is a bounded finding about that source passage, not a composer-wide rule or permission to publish its audio.

Other useful annotations include “the bass enters here,” “support yields to the lead's modulator,” and “this instrument returns in a higher register.” Each needs song-specific evidence; these examples are suggested editorial forms, not findings for arbitrary files.

## Useful without an analysis package

| Capability | Any supported SID | Added by a matching analysis package |
| --- | --- | --- |
| Playback | Transport, subtunes, voice mute/solo and configured mono/multi-SID output. | Suggested passages and retained listening comparisons. |
| Configuration | Header title/credits, chip declarations, addresses and clock where present; explicit overrides for unknown or alternative settings. | Verified configuration, intended mix and source identity. |
| Navigation | Elapsed time, state-preserving seek and user-selected loops. | Known duration, named sections and verified phrase boundaries. |
| Visualization | Audio displays and observable chip-state trajectories. | Interpretation of the behavior and links to recovered mechanisms. |
| Arrangement | Voice activity, frequency/register movement, entrances and gaps. | Source-backed notes, roles, instrument changes, harmony and form. |
| Instruments | Observable sound characteristics; optional detected patterns. | Recovered program identity, editable parameters, dependencies and reuse examples. |
| Notes | User bookmarks and descriptions, if included. | Curated commentary, evidence and scoped listening verdicts. |

“Any supported SID” means a file admitted by the chosen engine and declared format/profile support. Malformed files and unsupported formats should receive a useful explanation. Compatibility with ROM-dependent RSID, unusual timing, digi playback and three-SID files needs an explicit library decision; do not silently promise all SID files from mono/two-SID success.

### Automatic sound-pattern discovery

Recommendation: explore grouping recurring waveform sequences, pulse movement, pitch behavior and articulation into entries such as “Sound pattern 1,” with clickable occurrences and optional user names. Rationale: this bridges the gap between generic registers and an instrument-oriented experience for unfamiliar songs.

Treat these as provisional patterns. One instrument can produce different trajectories depending on pitch, duration and prior state; unrelated programs can produce similar ones. A verified instrument definition may replace or refine a pattern label, but detection must not claim recovered source identity. The feasibility and usefulness of grouping remain untested, and it should not block basic inspection.

## Analysis packages and evidence

An analysis package enriches a precise song/export identity. It should reference existing owners rather than duplicate score, instrument or research definitions. The representation and schema remain open; the semantic contract is:

| Information | Required meaning |
| --- | --- |
| Identity and configuration | File fingerprint, selected subtune, clock, chip models/addresses, engine/settings relevant to the evidence, and output routing. |
| Time reference and coverage | Event timestamps and their time basis; analysed regions; how they correspond to the playable export. |
| Musical annotations | Sections, phrases, instrument occurrences, role assignments and source-backed notes where available. |
| Mechanisms and dependencies | Recovered instrument behavior, physical voice allocation, coupling/filter ownership and links to editable examples. |
| Provenance and verdicts | Source attribution, owning studies, evidence references, publication scope and precisely scoped listening findings. |

Display three evidence categories: **verified** source/execution facts, **derived** measurements or detections, and **interpretation** of musical purpose/effect. An absence of evidence stays unknown. Automatic derived pitch is not necessarily the score note, especially during arpeggios, modulation or noise.

Live playback supplies sound and exposed chip state; retained score/program/execution records supply deeper explanation. Register snapshots are not complete ordered-write traces and may miss rapid changes. Keep observation cadence and coverage explicit in detailed inspection. Existing reference traces must be aligned to the declared configuration and time basis rather than presented as fresh live measurements.

Programmed ADSR settings are not measured envelope amplitude, GATE clear is not silence, and voice activity is not necessarily audible contribution. A shared nonlinear filter also prevents casually treating isolated voice recordings as additive stems. Output meters should report measured PCM; do not disguise a register-derived activity indicator as a per-instrument dB meter. The [instrument-program explanation](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/composition/instruments-as-programs.md) and [execution workflow](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/tools/sid-program-analysis.md) own these distinctions.

## Comparable tools and the case for adaptation

**Recommendation: evaluate adaptation first, concentrating new work on linked musical explanation.** Existing applications already cover much of the requested player, scope, spectrum and mute baseline. Those features do not distinguish this proposal. Its strongest contribution to this project would connect retained observations to verified programs, their occurrences and roles, dependency-aware two-chip allocation, provenance and editable reuse examples. This is a useful gap in the reviewed workflows, not a claim of worldwide uniqueness. The [overall research record](../research/web-music-explorers.md) preserves detailed findings, sources, alternatives and limitations. The following comparison used primary documentation and source on 2026-10-16, supplemented by the user's Chip Player JS screenshots; no hands-on usability, implementation-effort or Safari results were measured.

### What the references contribute

| Tool | Established features | Adaptation and limits for this proposal |
| --- | --- | --- |
| DeepSID | Piano/Graph connect pitch, waveform, pulse/filter behavior and voice controls; Stats tentatively detects movement, and contextual tabs link source information. [Help](https://deepsid.chordian.net/), [visualization source](https://github.com/Chordian/deepsid/blob/master/js/viz.js). | Keep immediate listening controls beside visible activity. Its reviewed Graph shifts sampled canvas pixels rather than retaining selectable event records; Stats covers the first chip only, and multi-SID Piano controls combine voices by chip. Our history and six explicit voice lanes would extend this baseline. |
| JSIDPlay2 | The desktop UI separates oscilloscope, note-oriented SID Dump and timed SID-register capture; status identifies chip models/addresses, with up to nine voice-mute shortcuts. [Official guide](https://haendel.ddns.net/~ken/UserGuide.html). | Separate readable events from exact writes, linked by one selected span. The [project site](https://haendel.ddns.net/~ken/) offers a browser player separately: the desktop analysis tools are not established browser features. Neither edition was tested against our routing or Safari requirements. |
| SID Factory II | Song overview jumps into three sequence tracks; instrument selection highlights occurrences, and table pointers navigate to waveform/pulse/filter definitions. [Official manual, pp. 5–12](https://files.chordian.net/sf2/SIDFactoryII_20260314_User_Manual.pdf). | Borrow occurrence → program → table navigation and readable descriptions, without recreating a hex editor. This works because SF2 owns editable source; arbitrary SID binaries do not automatically provide those identities or driver-specific tables. |
| Furnace | Separate arrangement/pattern views, optional playback following, parameter macros, channel scopes and register inspection; SID volume automation is explicitly chip-global. [Interface](https://tildearrow.org/furnace/doc/latest/2-interface/index.html), [instrument editor](https://tildearrow.org/furnace/doc/latest/4-instrument/index.html), [SID documentation](https://github.com/tildearrow/furnace/blob/master/doc/4-instrument/c64.md). | Use aligned parameter lanes and distinct chip/audio panels. Separate programmed automation from observed trajectories and measured amplitude. The development manual establishes UI vocabulary, not automatic SID recovery or a browser application base. |
| Sonic Visualiser | Time-aligned panes/layers share navigation; overview movement can leave playback unchanged. Selected spans can loop and be recalled through labelled boundaries. [Reference manual](https://www.sonicvisualiser.org/doc/reference/5.2.1/en/), [selection tutorial](https://www.sonicvisualiser.org/doc/tutorial/en/selections-inspection.html). | Borrow linked time selection, explicit follow modes and repeatable passage study. Independent SID-state restoration and a bounded live trace history are our additional requirements; neither follows from a desktop audio-analysis selection. |
| Chip Player JS | Browser transport, local files, subtunes, grouped voice controls and spectral displays already meet ordinary player needs. [Pinned application](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/components/App.js), [voice controls](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/components/PlayerParams.js). | Strongest reviewed app-base candidate. Its scrolling spectrogram is visual history; its [piano/chord analysis](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/components/Visualizer.js) is MIDI-only, not SID note extraction. Timestamped, selectable SID history and our evidence layer remain additions. |
| Ableton Learning Synths | “Matching envelopes” pairs familiar instruments with synth examples and one audible parameter lesson, including a case where decay has no effect at full sustain. [Lesson](https://learningsynths.ableton.com/envelopes/matching-envelopes). | Use focused listening cards: hear a passage, select a voice, observe one behavior, return to context. This is an explanatory pattern, not SID evidence or a reason to add a complete synthesis course/editor. |
| Williams Sound Explorer | The user's related project connects sound/state/code, captured history, routine views and explanation cards for individual sounds/programs. [Project](https://github.com/mbackschat/williams-sound-explorer), [detailed review](../research/web-music-explorers.md#williams-sound-explorer-individual-sound-inspection). | Reference for the sound microscope and explanation cards, not the whole-song/arrangement layer. Its captured-DAC scrubber does not establish live SID state restoration; source links depend on known mappings. Reuse selected components/patterns, without importing the 6802 engine, full designer or assuming Safari support. |

### Refinements adopted into this proposal

The most valuable research lessons are now part of the initial design, rather than additional optional panels. They are our synthesis, not features verified together in one existing product:

| Selected refinement | Rationale and owning contract |
| --- | --- |
| Retained, linked event selection | Makes fleeting behavior inspectable: [selection and retained history](#selection-and-retained-history). |
| Occurrence ↔ program navigation | Connects the arrangement to reusable knowledge while preserving unknowns: [main interactions](#main-interactions). |
| Recallable phrases with context | Makes full-mix/intervention listening comparable: [seeking and loops](#seeking-and-loops). |
| Chip ownership beside controls | Makes shared resources and stereo allocation intelligible: [voice controls and stereo](#voice-controls-and-stereo). |
| Focused explanation cards | Makes research approachable through an audible example: [music views](#views-that-explain-the-music). |

### Choose reuse by the remaining gaps

**Sound-inspection reference: our Williams Sound Explorer.** Review its linked inspection, bounded history and explanation cards for the individual instrument/program portion. Its MIT application offers concrete component candidates, though extraction effort and SID portability are unmeasured. Whole-song form, recurring instrument occurrences, changing musical roles, voice sharing and dual-chip arrangement need a separate song-level design, informed by the tracker/navigation references and our studies. Preserve actual song timing rather than adopting Williams' optional gap-compacted sound-effect timeline. This is partial reuse, not an overall application base or a proposal to merge two applications. [Retained findings and limits](../research/web-music-explorers.md#williams-sound-explorer-individual-sound-inspection).

**First candidate: a pruned Chip Player JS adaptation.** Its own `src/` code has MIT terms, while upstream describes the combined application as generally GPLv3; these are different reuse boundaries, not a blanket MIT application. It documents GitHub Pages deployment but also uses separate catalog/account services. Reusing integrated transport, local-file and visualization UI is credible; savings have not been measured. [Pinned README and license explanation](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/README.md).

Its [SID wrapper](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/bindings/libsidplayfp-wrapper.cpp) exposes mixed stereo PCM and playback controls, without raw chip buses, a routing matrix, registers or ordered-write access. An app fork therefore inherits the same engine-integration questions. Its [SID loader](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/players/SIDPlayer.js) sends a file hash for external metadata and applies a 150-second fallback that ends playback; its [app](https://github.com/mmontag/chip-player-js/blob/e90f505ccea598fb91cf08b02c4dbb41f0785632/src/components/App.js) hides visualization on phones. These behaviors need changing for the proposed local-file, unknown-duration and bounded-mobile contracts. Hash lookup is not file upload, but it is still an external disclosure.

**Conditional alternative: DeepSID extraction or adaptation.** Its rich SID inspection makes it a valuable reference. However, [documented setup](https://github.com/Chordian/deepsid/blob/master/README.md) depends on PHP/MySQL; the reviewed [local-test handler](https://github.com/Chordian/deepsid/blob/master/js/main.js) uploads files to a server. No blanket application reuse grant was located in the reviewed [repository](https://github.com/Chordian/deepsid); that is unresolved permission, not a conclusion that reuse is forbidden or that bundled-library terms license the app. A static/local edition and reuse permission must be established before preferring this route.

**Fallback: a small project layer over a suitable player API, reusing existing UI where appropriate.** Prefer this if pruning an app and replacing its engine boundary creates more coupling than it removes. It concentrates our work on retained analysis and curated explanations but leaves transport/view assembly to us. The choice remains between an adapted application and this smaller layer; owning every control is not a product requirement. Compare them against exact stereo, observation/trace access, state-preserving seeking, local privacy and Safari evidence. Select neither from feature lists alone, and do not treat this recommendation as implementation authorization or a technology-stack decision.

## Playback, routing and navigation contracts

### Voice controls and stereo

Standard voice mute/solo is required. Musical “mute lead” controls are optional and need verified time-dependent role mappings: a lead can occupy voices on both chips, and a voice can change roles. Muting must preserve oscillator execution and required dependencies where the engine permits; verify semantics before describing it as harmless isolation. Retain the full mix as context.

Keep three stable voice identities under each chip, with explicit mouse/touch-accessible solo and **Restore full mix** controls rather than modifier shortcuts alone. Show the chip's shared filter, ring/sync relationships and output routing beside the selected voice; richer dependency diagrams remain optional. Label any diagnostic audio tap point and listening intervention, without implying independent post-filter stems.

Each chip has one mono output and a shared filter; there is no native per-voice pan register. Preserve the declared chip-to-output matrix. Our accepted Rambo stereo rendering deliberately uses separate chip buffers because the native library's default mixer crossfeeds them. Multi-SID playback alone therefore does not establish the correct image. See the [hardware/mixing contract](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/sid/dual-sid.md#plan-the-sound-hardware-and-the-mix-together) and [renderer](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/scripts/render-sid.cpp).

For unannotated files, identify the player-selected output routing as a playback setting, not recovered composer intent. Recommend a visible, deterministic chip-bus routing default; finalize its exact behavior with the engine's capabilities.

### Seeking and loops

Seeking must reach the state that continuous playback from initialization would have reached under the same configuration, including CPU/player, oscillator, envelope and filter history. Moving a counter or calling the music routine at the destination is insufficient. Execution to the destination is acceptable; complete emulator snapshots are an optimization only if supported and verified. Show progress when a seek takes time.

Offer click/touch seeking, named section jumps when known, previous/next annotated phrase, and A/B loops. Recommend study loops that re-enter the same passage state each time, so repeated listening is comparable. Account for any audio-boundary discontinuity separately; restoring state does not promise a seamless loop splice.

Recall selected A–B spans within the session, including their inspection view. **Hear with context** plays visible lead-in/tail extents around the selection without changing its boundaries; entering the audible lead-in still requires the correct prior emulator state. Keep boundaries and context fixed while switching between full mix and mute/solo for comparison, with the intervention labelled. Cross-session bookmark storage and automatic alignment of different performances are outside the initial contract.

SID metadata generally lacks duration. Unknown-length playback should have elapsed time and a growing explored timeline, without invented completion percentages or endings. Reaching an unexplored destination can require additional emulation. Known project durations should come from the matching package rather than an unrelated database entry.

The playhead and the inspection cursor while following must track audio heard, including buffering, rather than the furthest point already emulated. A held selection keeps its own timestamp and captured configuration. Seeking, muting and configuration changes must not leave historical or stale observations presented as current; label retained evidence and start a distinct observation interval where needed.

### Live SID and accepted recording

Recommend two clearly labelled modes for catalog entries with both assets: **Live SID** for interaction and **Accepted recording** for the retained reviewed performance. Voice controls apply to live playback. Recording mode must not display unrelated live chip state; matching retained analysis can be shown with its provenance.

Rationale: the accepted WAV remains a useful reference and fallback, while engine/version/settings can affect live sound. A recording does not substitute for Safari live-player compatibility or prove emulator equivalence.

## Safari and hosting requirements

Safari on iOS and macOS is mandatory, with desktop as the primary design and validation target. Recommendation: initially target current stable Safari on each platform, with exact versions recorded when implementation begins; broader version coverage can follow if needed. Rationale: the user accepts recent Safari and explicitly wants limited iPhone-specific effort.

Recent Safari supports the needed [AnalyserNode](https://github.com/mdn/browser-compat-data/blob/main/api/AnalyserNode.json) and [AudioWorklet](https://github.com/mdn/browser-compat-data/blob/main/api/AudioWorklet.json) APIs. That establishes API availability, not the performance or reliability of the assembled app. Validate the full exploration workflow on Mac Safari. Use a bounded smoke check on a recent iPhone for local file opening, live mono/stereo playback, basic seek/mute controls, visible analysis and recovery after an interruption. Fix blocking compatibility defects, but defer a broad iPhone/device matrix, mobile performance tuning beyond usable operation and bespoke interaction polish. Background/locked-screen playback is not yet a promised capability.

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) supports a static application with browser-side playback and local file access. Select a browser execution approach compatible with the hosting environment; do not assume particular response headers or shared-memory facilities are available. No framework, language, bundler, UI toolkit, plotting library, worker arrangement or server architecture is selected here.

## Playback-library findings and alternatives

Findings include upstream documentation and the pinned source review below. No candidate was executed against our samples or tested in Safari during this review. Source inspection establishes specific API/mixing behavior, not runtime compatibility or musical equivalence.

| Candidate | Finding | Recommendation and rationale |
| --- | --- | --- |
| [libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm) | Independent WASM distribution with TypeScript bindings, PCM streaming, SIDLite/reSIDfp, multiple chips, muting, register readout and timestamped writes. Current binding uses a crossfeeding mixer and lacks raw chip output; its seek wrapper discards the final block remainder. | Preferred engine family, conditional on a small binding/transport correction and verification. The current package is not an exact-routing drop-in. |
| [WebSID](https://www.wothke.ch/websid/) | Browser SID engine, now maintained on [Bitbucket](https://bitbucket.org/wothke/websid/), with multi-chip emulation, explicit per-voice panning and visualization access. Its README declares CC BY-NC-SA 4.0. | Retain as an alternative, with a less suitable distribution license and a different sound path to assess. Panning controls alone do not establish our accepted chip-bus sound. |
| [jsSID](https://github.com/og2t/jsSID) | Small JavaScript implementation with multi-SID support; its README documents omitted digi playback and imperfect interrupt emulation. | Not the preferred foundation: those limitations narrow the range of masters' material we could inspect. Retain it as an evaluated alternative, not a selected fallback. |
| [DeepSID](https://github.com/Chordian/deepsid) | Complete player application whose documented setup uses PHP and MySQL. | Retain as an interaction reference and conditional reuse candidate; static/local adaptation and application reuse permission remain unresolved. See the app-base assessment above. |

libsidplayfp-wasm declares GPL-2.0-or-later and supplies corresponding source; it is not an MIT dependency. Confirm the combined web distribution's terms before adoption. This does not change the project's existing tool or sample licenses. A small binding extension could remain within the library approach; developing an original emulator remains outside scope, whether the application is adapted or newly assembled.

### Dual-SID source review, 2026-10-16

The unresolved question was whether a browser library can reproduce our native dual-SID placement for both chip models while providing useful inspection. This blocks final engine selection. Review pinned libsidplayfp-wasm [commit c9622e9](https://github.com/chrisgleissner/libsidplayfp-wasm/tree/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275), package version 1.1.0, whose [upstream manifest](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/upstream.json) pins libsidplayfp 3.1.1 and libresidfp 1.2.3. This is a source-level review only; no playback, audio comparison or Safari validation is claimed.

**Concrete routing mismatch:** `SidPlayerContext::render()` calls `player.mix()`. The exported binding has no raw-chip-buffer or mixing-matrix method. The pinned upstream [SimpleMixer](https://github.com/libsidplayfp/libsidplayfp/blob/732fa8ec8131fc75aafc2eaea583ddcdeea2a3cc/src/simpleMixer.h) mixes two chips approximately as `L = (A + 0.5 B) / sqrt(2)` and `R = (0.5 A + B) / sqrt(2)`, with integer scaling/rounding. This is stereo, but not our required `L = A, R = B`. It places each chip in the opposite channel at roughly −6 dB relative to its contribution in the main channel. Both MOS6581 and MOS8580 use this host mixer. See the [binding source](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/src/bindings/bindings.cpp#L796).

Recommendation: retain libsidplayfp as the leading engine family, but require raw per-chip PCM from one shared emulated C64 instance, or an equivalent verified output-matrix API. This is a binding/output integration requirement, not a new SID emulator. Prefer an upstreamable extension. Do not approximate dual-SID by running independent mono players, reconstruct raw buses by inverting rounded mixed PCM, or add artificial widening: those approaches weaken timing, signal or placement guarantees. Preserving complete chip buses also preserves shared-filter behavior within each chip.

**Inspection is stronger than initially established:** the binding exposes per-chip status and bounded timestamped write traces, including chip index, register address, value and `cyclePhi1`, plus a dropped-record count. The [trace-hook modification](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/MODIFICATIONS.md) places the hook immediately before the emulated chip write. This offers a promising basis for inspecting unfamiliar songs without authored analysis. Drain traces with playback and disclose overflow. Since muting/filter bypass can modify writes before this hook, distinguish observed emulator input from the unmodified program's writes.

**Muting is an intervention:** upstream [sidemu.cpp](https://github.com/libsidplayfp/libsidplayfp/blob/732fa8ec8131fc75aafc2eaea583ddcdeea2a3cc/src/sidemu.cpp) masks waveform/GATE bits on subsequent control-register writes while preserving TEST/ring/sync bits. It is not a post-filter fader and may not act immediately on an already-held sound. Validate coupled passages and restoration before promising clean isolation; keep the application's six controls explicit about their voice and chip.

**Seeking needs a more precise contract than the method name suggests:** [player.ts](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/src/player.ts#L719) reloads and emulates forward, which preserves evolving state in principle. However, `fastForwardContext()` discards whole blocks until the target is passed, then clamps the reported count without retaining the final block's remainder. Source inspection therefore predicts a block-boundary offset for non-aligned targets; the current tests establish advancement, not exact continuation samples. Require a seek comparison against continuous playback and retain the remainder in the transport before calling seeking sample-accurate. Record deterministic startup settings and reapply inspection/control state consistently after reload.

**Safari evidence is narrower than real-device audio:** the pinned [Playwright configuration](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/playwright.config.ts) includes WebKit with an iPhone device profile. Its [browser tests](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/test/browser/loader.spec.ts) check PCM generation from a test tone and worker operation. They do not certify actual Safari speaker playback, our two-SID material or our routing. Preserve the bounded mobile checks above; desktop Safari remains the main validation target.

**WebSID alternative:** inspected [revision 977457f](https://bitbucket.org/wothke/websid/src/977457f172bc52907953850827d110b8c4e9f31b/). Its [SID implementation](https://bitbucket.org/wothke/websid/src/977457f172bc52907953850827d110b8c4e9f31b/src/sid.cpp) handles per-chip model declarations and pans voice contributions into stereo. The [postprocessor](https://bitbucket.org/wothke/websid/src/977457f172bc52907953850827d110b8c4e9f31b/src/Postprocess.cpp) uses level 0 for panning without the enhancement effect; level −1 disables panning. Assigning all three voices of chip A left and chip B right is a plausible tonal routing setup, not yet a verified replacement for raw chip buses. Special digi paths can feed both channels, and the [documented limitations](https://bitbucket.org/wothke/websid/src/977457f172bc52907953850827d110b8c4e9f31b/src/KnownLimitations.txt) include filter/combined-waveform accuracy limitations. Its [CC BY-NC-SA declaration](https://bitbucket.org/wothke/websid/src/977457f172bc52907953850827d110b8c4e9f31b/README.md) adds a noncommercial restriction. These are material reasons to prefer resolving the bounded libsidplayfp binding gap first, without claiming WebSID is incapable of useful stereo.

### Evidence required before adopting the stereo backend

| Required property | Decisive check |
| --- | --- |
| Both chip models and counts | Load MOS6581 and MOS8580 single/dual exports; confirm actual installed models, addresses and independent activity on both chips. |
| Correct stereo separation | A-only/B-only diagnostic input must reach its assigned output without hidden crossfeed; verify gain and clipping separately from stereo width. |
| Real arrangement behavior | Compare [Bach stereo](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/bach-toccata/README.md) for MOS8580 and [Rambo stereo](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-stereo/README.md) for MOS6581 against their retained renders, including the duplicated lead, accompaniment separation, shared filtering and coupled Rambo passages. Full playback and endings must work; PCM identity is only a valid expectation under matched engine/build/settings. |
| Complete session controls | Verify all six voice controls, stop/reload, seek and loop behavior; check resumed audio against continuous playback with the same startup/configuration. |
| Synchronized analysis | Both chips' observations align with heard output and seek position; trace drops and diagnostic mutations are visible. |
| Safari usability | Validate the complete desktop audio path and the bounded recent-iPhone smoke check, not just successful WASM rendering. |

Correct dual-SID playback is a selection gate, not optional polish. Final library adoption remains open until these checks pass; neither reviewed candidate is currently certified for this app.

## Catalog and publication boundary

Use the [sample library](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/README.md), its owning package READMEs and manifests as the current source of truth. The catalog expanded during this discussion: it now includes additional stereo exports and local-build-only material. Do not freeze the earlier four-entry inventory into application requirements.

Represent every sample package with its actual availability and scope. Offer online playback/downloads only for publication-cleared files. Materials-only entries can explain the work and point to reproducible local recipes; they must not expose uncleared music. A user may open a locally obtained file without it becoming part of the public catalog. Preserve the [publication boundary](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/workflows/publication-boundary.md) and song-specific attribution/licenses.

Keep full versions, excerpts and separately exported entrances distinct. The [current Rambo packages](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/README.md#rambo-entrance) include native main-music exports with fresh SID oscillator/envelope history; those are not equivalent to seeking through the complete original-introduction version. Both can be useful, but their timelines and explanations must match their exact files.

## Open decisions for later pickup

No further user clarification is required to retain this proposal. These decisions remain open rather than silently settled:

| Decision | Current recommendation and rationale | Evidence needed |
| --- | --- | --- |
| Application base | Compare a Chip Player JS player-shell adaptation with a small project layer over a suitable API; evaluate Williams components for individual sound inspection. Both routes need the broader song/arrangement layer. | Compare inherited service/UI coupling and the routing, trace, seek, privacy and Safari gaps; no measured extraction/effort comparison or final selection exists. |
| Playback library | Prefer the libsidplayfp family if the raw-output and seek gaps can be resolved with a bounded binding/transport change. | The stereo adoption checks above; licensing fit. Do not adopt the current mixed-output wrapper as an exact-routing solution. |
| Safari version floor | Current stable Safari on macOS and iOS initially; keep mobile effort bounded and extend coverage only when needed. | Full desktop validation and a recent-iPhone compatibility smoke check, with exact versions recorded. |
| File compatibility beyond required hardware coverage | Both MOS6581 and MOS8580 in single-SID and dual-SID stereo are fixed requirements; declare additional format/profile support individually. | Engine handling of PSID/RSID, ROM requirements, timing, digi and three-SID cases. |
| Sound-pattern discovery | Optional provisional grouping, with editable labels. | Useful results on unfamiliar material without false claims of recovered instruments. |
| Deeper inspection | Prefer exposed live state plus matching retained execution evidence. | Available event resolution, buffering alignment and missing binding capabilities. |
| Analysis-package format | Preserve the semantic contract above; reuse existing owners. | What the UI and existing manifests can share without duplicate sources of truth. |
| Explorer license | GPL-3.0-or-later, adopted at repository creation on 2026-10-18. It can combine libsidplayfp-wasm's GPL-2.0-or-later and the generally GPLv3 Chip Player JS application, so both leading routes stay open. WebSID's noncommercial CC BY-NC-SA terms are not GPL-compatible; selecting it would reopen this decision. | Exact license declarations of the adopted app base, playback library and reused components. |
| Technology stack | Leave open in this proposal; milestone 1 records only the choices its prototype needs, in Explorer. | Compatibility with Safari, static hosting and the selected playback API. |

The decisive feasibility evidence is playback and inspection across the required MOS6581/MOS8580 × single-SID/dual-SID stereo matrix on Safari, covering annotated project samples and unannotated local files, correct model selection and routing, mute dependencies and a seek checked against continuous playback. Retain the desktop-focused validation and bounded mobile compatibility checks described above. The analyser must remain useful when annotations are absent. The milestones below order these checks; they do not authorize starting.

## First step and milestones

The order below is retained from the proposal. Step 1 was authorized, including public GitHub publication, on 2026-10-18. [The Explorer plan](../PLAN.md) owns current readiness and remaining work; the later application milestones remain unimplemented.

### Step 1: establish the repository (documentation only)

Completed at the 2026-10-18 handoff. The following checklist preserves the original boundary; see the [handoff record](../integration/crafter-handoff.md) for provenance and the current shared-knowledge recommendation.

Move the design before writing application code, so Explorer's first commits already follow the boundary above.

- Create a local `sid-song-explorer` repository with a README stating its purpose and relationship to Crafter, a short agent guide, its own plan and the recommended GPL-3.0-or-later license.
- Move this proposal, which becomes Explorer's founding design document, and the [application research record](../research/web-music-explorers.md), including the libsidplayfp-wasm and WebSID source reviews. Convert their relative links into Crafter URLs pinned to the commit at move time, and preserve their dates and source citations.
- Do not move engine facts Crafter already owns: the [audio workflow](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/workflows/audio-workflow.md) records the pinned libsidplayfp stereo crossfeed and its control-write muting. Explorer links them instead of restating them.
- Leave short stubs at both old paths linking to the new location, and update the [docs navigation](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/README.md) and [tools research index](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/tools/README.md). Crafter's PLAN.md records the handoff and the catalog-index work Crafter owns; Explorer's plan owns its milestones.

Done when every moved and stub link resolves, Explorer's documents link Crafter-owned facts rather than copying them, and the old paths are stubs.

### Milestone 1: first playable inspection with one mono sample

Test whether live playback with linked inspection explains a documented master's finding, before investing in exact stereo.

- Sample: the [Rambo loader main music](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-loader/README.md). It is published, uses MOS6581, belongs to a Galway study with [decoded programs](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/docs/research/composition/instruments/rambo-decoded-programs.md), and its GPLv3 terms travel with its catalog entry. Mono avoids the binding's stereo crossfeed, so the current libsidplayfp-wasm binding can be used unchanged.
- Crafter: catalog index version 1 containing that one entry, with a schema check.
- Explorer, in current stable desktop Safari: live playback to the ending, local mono SID opening, three-voice mute/solo with the intervention labelled, playhead, output meter, and A–B loops re-entered by forward emulation. Register lanes for the three voices and the filter come from the binding's timestamped writes, with retained, selectable history and visible trace drops. Add two or three annotations from the owning Rambo studies, labelled verified, derived or interpretation and linked to their owners.
- Select only the technology this prototype needs, and record that decision in Explorer.
- Accepted limit: the binding's seek can stop at a block boundary instead of the exact target. Label the offset rather than claim sample-accurate seeking.

Done when playback reaches the ending without an unexplained audible difference from the retained render, loop re-entry matches continuous playback apart from the labelled offset, and the lanes follow the audio heard rather than the emulation lead. The decisive check is the user's judgment that the prototype makes a documented Rambo finding clearer than the study and its clips. If it does not, record why before deciding on milestone 2.

### Milestone 2: the dual-SID gate

- Extend the binding to deliver raw per-chip PCM from one shared emulated C64, preferably as an upstreamable change, and retain the final block's remainder when seeking.
- Add catalog entries and six chip-owned voice lanes for [Bach stereo](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/bach-toccata/README.md) on MOS8580 and [Rambo stereo](https://github.com/mbackschat/sid-song-crafter/blob/3db086b6963676ef75f34d7f77c3b67232a777fb/samples/rambo-stereo/README.md) on MOS6581.
- Run the bounded recent-iPhone smoke check.

Done when every row of the [stereo-backend evidence table](#evidence-required-before-adopting-the-stereo-backend) passes; that result settles the playback-library decision. Later work, such as catalog breadth, unannotated-file inspection and sound-inspection components, is planned in Explorer.
