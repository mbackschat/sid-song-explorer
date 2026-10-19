# Seeking performance

The user rejected slow replay-based positioning on 2026-10-18. The question is whether seeking can become responsive without losing identical audio, register observations, profile/mute semantics or bounded memory. This study belongs to Explorer; it does not change Crafter's reference rendering or musical acceptance. [The playback adapter](../architecture/playback-adapter.md) owns the supported runtime contract.

## Alternatives and decision

| Approach | What it changes | Decision |
| --- | --- | --- |
| Replay from initialization | Reconstructs exact state but repeats all earlier execution for every seek. | Retain as an independent oracle and fallback, not the normal interaction for cached audio. |
| Advance from the current producer position | Executes only a missing forward interval. | Use when a target lies ahead of the prepared frontier; it cannot alone solve backward/repeated seeking. |
| Cache PCM and matching observations; render ahead | Moves most preparation off the interaction path. Reuses the same executed timeline for playback and inspection. | Recommended for the POC, with an explicit memory cap, bounded background chunks and foreground priority. A cold distant target can still require preparation. |
| Save/restore complete emulator states | Could jump between checkpoints with less retained audio. | Not exposed by the adopted SIDLite/WASM binding. Requires broader engine work and a complete machine-state contract. |

The [libsidplayfp 3.1.1 public API](https://libsidplayfp.github.io/libsidplayfp/html/classsidplayfp.html) exposes execution/reset but no complete snapshot or seek operation; the [upstream seek issue](https://github.com/libsidplayfp/libsidplayfp/issues/247) describes the same replay limitation. The bundled libresidfp headers contain chip `saveState`/`restoreState`, but this is a different SID implementation and does not provide CPU, RAM, timers, event scheduling, mixer and adapter-buffer state. A SID-register image alone cannot resume a tune correctly.

The pinned WASM package already offers an optional PCM cache through `waitForCacheReady`/`getCachedSegment`, but its [player implementation](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/src/player.ts) builds that cache in a separate reset context. It does not implement Explorer's profile, mute and ordered-observation contract, and `seekSeconds` still replays. Reusing that cache as if it were the live engine timeline would not satisfy the contract. Explorer's cache uses the existing SidSession producer and its exact frame boundaries.

## Experiments and scope

[seek-strategies.ts](../../scripts/experiments/seek-strategies.ts) renders the cleared 193.35884353741497-second PAL/MOS6581 sample and a 35-second NTSC/MOS8580 contrast. At non-block seek targets it compares 4096 frames, ordered writes and endpoint register state with an independent replay session, then verifies a short forward continuation. It measures cache preparation, copied cache reads and missing-interval execution. No audio device is opened. PCM payload size is exact; the reported packed-observation size is an estimate for a possible representation, not JS heap usage or total process memory.

```sh
node scripts/experiments/seek-strategies.ts build/seek-study/corrected-node.json
node scripts/experiments/trace-clock.ts build/seek-study/trace-clock.json
```

Use the repository's Node 24.18.0 pin and prepared local assets. Each experiment enforces a 60-second total budget and the underlying session's execution bounds. These measurements concern one Apple M1 and two profiles of one tune, not a device-wide latency guarantee. A cache-read time excludes worker messaging, browser scheduling and physical audio output latency.

The first run measured a 180.235-second replay at 8014 ms, a roughly 0.907-second forward interval at 38 ms, and the copied cached segment at 0.086 ms. Preparing the complete PAL sample took 9240 ms and retained 17,054,250 PCM bytes (16.3 MiB), plus observations. Cache PCM was exact in all tested cases. That first run deliberately failed the observation-equality check; a second investigation was required before adopting caching. Machine load varied in a later run, so these figures illustrate the mechanism rather than promise fixed wall-clock times.

## Correctness issue found during caching research

`SidSession` originally mapped writes using nominal C64 cycles per second. The pinned SIDLite `SID::setSamplingParameters` in `src/builders/sidlite-builder/sidlite/SID.cpp` instead computes `SampleClockRatio` with four fractional bits (`sl_constants.h`). That produces 983981.25 PCM cycles/s for PAL and 1022568.75 for NTSC at 44.1 kHz. Nominal-clock conversion therefore drifts against generated PCM. Eventually, a render call exhausts its available writes before the nominal timestamp cutoff; the next call returns writes whose timestamps belong to an earlier PCM interval. Exact PCM equality alone did not detect this.

Correcting only cached timestamps failed because it compared the corrected cache against the still-incorrect replay observation boundary. The fix changes both startup-origin calibration and subsequent cycle-to-PCM conversion in the session. It leaves the audio samples, raw `cyclePhi1` and emulation clock unchanged.

[trace-clock.ts](../../scripts/experiments/trace-clock.ts) retains explicit nominal and quantized variants so the defect remains reproducible after the production correction. Its independent oracle bounds each write by the actual sample interval produced by the raw WASM call that emitted it, allowing one sample for startup quantization. Over 35 seconds, nominal timing returned 265 PAL and 22 NTSC observations outside their adapter intervals; corrected timing returned zero. Corrected cache/replay comparisons matched PCM, writes and registers at both tested positions. The raw oracle's largest corrected departure was 0.230 sample PAL and 0.189 sample NTSC. This establishes the clock scale, not exact acoustic latency.

The two new regression guards failed on the old adapter and passed after correction. All twelve engine tests passed in 19.814 seconds, including ordinary raw-library PCM agreement, full-song rendering, seeking and mute restoration. [The engine tests](../../tests/engine.test.ts) own these guards. The application cache has separate integration guards described below.

## Implemented cache measurements

On 2026-10-19, the corrected experiment measured the full PAL preparation at 10062 ms; seeking to 180.235 seconds took 8396 ms by replay and 0.086 ms for a copied cached segment. All five PAL/NTSC targets matched independent replay PCM, ordered writes and endpoint registers, including subsequent forward continuation. The production cache’s separate full-song guard retained 20,314,970 typed-storage bytes within its 32 MiB cap and measured a 177.731234-second cache seek at 0.158 ms versus 7374 ms by replay. These are engine measurements, excluding browser/output latency.

[Cache regression tests](../../tests/cached-session.test.ts) cover backward/repeated/non-block targets, cached-to-live continuation, bounded retention and fallback, missing forward execution, mute/load invalidation, transferred-buffer ownership and preserved cache reads after producer failure. [Transport guards](../../tests/player.test.ts) cover stale coverage, mute during pending seeking and worker-failure recovery. The [validation record](../validation/mono-poc.md) owns browser measurements and the remaining listening gate.

The integrated silent browser trial passed all sixteen interactions. Prepared seeks to 180, 30 and 90 seconds returned the visible transport to playing at its target in 41–80 ms across Chrome/WebKit; subsequent advancement was verified. Preparation remains a prerequisite, and neither these measurements nor exact PCM equality establish physical speaker latency or a human listening verdict.

## Live voice controls: separate audition from replay

The user challenged silence during Listen by voice changes on 2026-10-19. The cause is Explorer's contract: `ExplorerPlayer.setMuted` stops queued sources, `CachedSidSession.mute` resets the producer and rebuilds a new mask from initialization, and the cache stores an already mixed output. Native muting itself does not require that replay. The producer can also be far ahead of the heard cursor, so calling its native mute method directly would change the wrong part of the timeline.

Inspection of the pinned corresponding-source archive shows the binding's `SidPlayerContext::mute` forwards to `Player::mute`, then `sidemu::voice` only changes a bitset. `sidemu::writeReg` subsequently masks waveform/gate bits on writes to control registers 0x04/0x0b/0x12, leaving test/ring/sync bits. It does not immediately change an already sustained voice. The [upstream API](https://github.com/chrisgleissner/libsidplayfp-wasm/blob/c9622e9ce7ffa2ddd3e0568e987b4c6614da8275/README.md) exposes this operation; its existence does not establish immediate output gating.

A silent Node 24.18.0 raw-engine probe created two identically configured PAL/MOS6581 SIDLite contexts with powerOnDelay 0, loaded the prepared Rambo sample, and checked identical 20,000-event render blocks until at least 132,300 PCM frames. Calling `mute(0, 1, true)` on the second context took 0.090292 ms and left `getTimeMs()` unchanged at 2998. Rendering another at-least-quarter-second in both contexts produced equal frame counts: 11,511 compared samples, 9,560 changed values and 11,510 nonzero values in the muted result; the muted context advanced to 3259 ms. This demonstrates live-state muting without reset or a forced silent block for this passage. It does not measure browser latency, sustained-note response, isolation or listening acceptance.

The recommended next design is live audition: apply a voice's output gain before the chip's shared mixing/filter path while continuing oscillator, envelope and CPU execution, using a short gain transition to control switching clicks. The playback engine must stay close to the heard position. This is different from rendering a hypothetical history with that voice muted from initialization; shared-filter history should continue naturally. Immediate response for sustained notes requires engine support beyond the current write-mask API. Preserving fast seeking alongside this behavior requires state restoration/checkpoints or another explicitly verified separation of playback state and preparation; the existing mixed-PCM cache alone cannot supply it. Complete engine snapshots are not currently exposed, so this remains a proposed architecture and feasibility gate, not an implemented fix or a promised latency. Keeping old audio playing until a replacement mix is prepared is a fallback, not the preferred interaction.


## Bounded live-gain prototype and integration decision

On 2026-10-19 the user authorized a bounded prototype, with production integration conditional on success and limited change scope. The native gain experiment passed; the production integration condition did not. Production playback is unchanged, including the current pause when changing voice selection. The recommendation is to treat live audition with fast seeking as a separate architecture change, using this prototype as an executable starting point. Delayed replacement-mix preparation was not substituted for the requested behavior.

### Reproduce the native experiment

Run [the bounded runner](../../scripts/experiments/live-voice/run.py) with Python 3.10+ and `clang++`, after preparing the existing engine assets:

```sh
python3 scripts/experiments/live-voice/run.py
```

It verifies the complete-source archive SHA-256 `d0a3fa551bde2b55733b3c2bfd8ebd6f886ec9d81407c069d2ded15600eef0fb`, extracts only the named SIDLite sources into ignored `build/live-voice-prototype/`, and compiles stock, output-gain and deliberately incorrect mask variants. Every subprocess is capped at 20 seconds within a 60-second execution budget. Logs, native executables, raw synthetic PCM and `result.json` remain in that ignored directory; no audio device is opened. A new run removes the previous success receipt before starting.

The patch touches three extracted upstream files: `SID.h`, `WavGen.h` and `WavGen.cpp`. It applies a per-voice gain after the existing integer envelope multiplication/division and before the filtered/unfiltered sums. Oscillator and envelope execution continue. A 256-sample linear transition takes 5.805 ms at 44.1 kHz; this is generated-audio transition duration, not measured browser or speaker response. The shared filter still processes the changed sum and retains its history.

[The independent probe](../../scripts/experiments/live-voice/probe.cpp) exercises all seven nonempty mute masks on MOS6581 and MOS8580 with sustained saw, triangle ring/sync, swept resonant lowpass, D418 volume changes and noise fixtures. It first rejects a no-op gain control and an always-mute-all mutation. For the uncoupled, unfiltered saw fixture, selected output after the ramp must equal a separately initialized engine with the selected voices' gates never opened. This oracle proves mask selection without implementing a second copy of the gain arithmetic. Gate suppression is valid only for this fixture; it is not proposed as the general live-control implementation.

The successful run completed in 18.67 seconds (final repeat: 9.80 seconds with identical checks and PCM hash) on macOS 27.0.1 arm64 with Apple clang 21.0.0. Across 6,174,000 frames, stock and patched default full-mix PCM were byte-identical (12,348,000 bytes; SHA-256 `ca03ef43df7c590eae231d558e68ef197e06e12a7ed2f92c072ceb31eeff21e4`). All 12,348,000 OSC3/ENV3 readback comparisons and 150,766 independent selection comparisons passed. Sustained all-voice muting reached exact zero without further voice register writes in the unfiltered saw fixture. Restoring unity gain recovered exact reference PCM after the ramp for the unfiltered saw, ring/sync and noise fixtures. Filtered and D418 cases are excluded from that restoration claim because their output history can differ.

These are native synthetic SIDLite results. They do not prove complete internal-state equality, CPU execution equivalence, arbitrary SID compatibility, independent digi isolation, click-free perception, browser scheduling or listening acceptance. The D418 fixture exercises volume changes; it does not establish a separate digi-channel control. Source inspection also found that upstream `WavGen::reset` omits scalar wave state including ring/sync source state and readback fields. The harness uses controlled zero-filled storage to make the native fixture deterministic; it neither repairs that separate upstream issue nor establishes equivalence to reused WASM allocations.

### Why the production change is broader

The corresponding-source archive exposes a possible separation: `SID.cpp` clocks `WavGen`, then `Filter`, then saturates output; CPU SID reads use OSC3/ENV3 rather than filter state. `WavGen.cpp` produces envelope-scaled signed contributions in the range −4080 through 4079 before mixing. Capturing those contributions and sample-exact filter controls could let a filter at the heard cursor apply live gains while the C64 producer prepares ahead. This is a source-backed architecture hypothesis, not an implemented cache or verified replay path.

For the existing 8,527,125-frame sample, payload costs are:

| Representation | Bytes | MiB | Scope |
| --- | ---: | ---: | --- |
| Current mono Int16 PCM | 17,054,250 | 16.26 | Current cache additionally retains observations. |
| Three Int16 voice contributions | 51,162,750 | 48.79 | Excludes controls, observations and filter checkpoints. |
| Three fixed-width 13-bit contributions | 41,569,735 | 39.64 | Ideal packed payload, rounded up; still excludes other state. |
| Current complete typed cache | 20,314,970 | 19.37 | Measured PCM plus observations, within the 32 MiB cap. |

Even fixed-width packing exceeds the current 32 MiB budget before retaining the other required state. Compression could change this tradeoff but has not been measured. Reducing retained coverage would weaken currently prepared seeks; raising the cap changes the memory contract.

Several other boundaries must be settled together:

- **Native/WASM interface and distribution:** expose prefilter contributions, exact control changes and filter state, rebuild the engine and retain its corresponding-source packaging. The current observations do not establish exact filter-write sample boundaries.
- **Filter correctness:** MOS6581 cutoff depends on the input signal, so separately filtered voice stems cannot simply be summed. D418 behavior belongs to the filter/output path. Startup also advances the filter before discarding initial audio; its playback baseline is not a zeroed filter.
- **Seek semantics and cache:** a filter checkpoint depends on earlier audition gains. Seeking must define whether it restores a canonical all-on history or a prior live-audition history, then preserve that contract through accounting, eviction and continuation. Required filter state includes lowpass/bandpass history, volume smoothing and level state; model-dependent tables must be recreated consistently.
- **Adapter and transport:** align raw buffers with observations, separate the heard filter cursor from the producer frontier, and apply changes at the effective playback position. Existing queued audio otherwise delays the result even when native gain changes are cheap. Worker mute/coverage messages and scheduling need corresponding guards.

The small native patch alone cannot satisfy these boundaries. No production integration is justified by this trial under the user's limited-scope condition. A follow-up should first settle seek-history semantics and the memory/coverage contract, then prove exact native replay before replacing the current cache. Complete C64 snapshots are another broader option; neither route is a contained button-handler fix.

## Production feedback fallback and follow-up

On 2026-10-19 the user reported the same gap in actual Safari, authorized continuing toward production, and then explicitly accepted a spinner with explanations if gapless switching proves infeasible or too costly. Source review found no fundamental impossibility. The cost decision is to ship the feedback fallback for the mono POC: true live audition crosses native sample capture, WASM build/distribution, exact filter replay, cache/checkpoints, AudioWorklet transport and browser-output validation. The native gain probe alone establishes none of those integration contracts. [Plan item `VOICE-1`](../../PLAN.md#exit-the-poc-and-continue-production-work) retains uninterrupted switching as the first post-POC task, ahead of dual-SID adoption, subject to the user’s explicit proportionality requirement. A bounded feasibility/equality check and cost decision come before a larger rewrite; disproportionate cost permits documented deferral and continued use of the feedback fallback. Feedback does not close the gapless implementation item.

The proposed implementation keeps CPU/oscillators/envelopes all-on, captures each sample's three envelope-scaled Int16 voice contributions and effective `$D415–$D418` controls, and applies gains plus the existing SIDLite filter/output arithmetic in an AudioWorklet at the heard cursor. Canonical all-on filter checkpoints would preserve prepared seeking; continuous changes would retain live audition filter history, while seeking would restore the declared canonical history and then apply the current selection. The simple ten-byte-per-frame representation costs 81.32 MiB for the current sample before observations/checkpoints; a 96 MiB retained-data cap is a proposed budget, not an implemented allocation or measured peak. Avoid a duplicate mixed-PCM cache and account for worklet queues separately. Compression and complete-C64 snapshots remain alternatives without verified integration evidence.

The first implementation gate is exact raw replay through the extracted upstream filter against shipped-engine PCM, including real WASM startup, complete sample, PAL/NTSC and both models. Capture controls at `SID::generateSample` during the same execution pass: writes clock the chip before changing registers, and SIDLite's stepping is render-partition sensitive. Preserve discarded startup samples' filter history, partial native buffers, voice-three-off routing, volume smoothing and D418 behavior. Export explicit filter state rather than copying a pointer-bearing C++ object. Send raw typed records directly to the worklet at their native 44.1 kHz rate; resample only the completed output if the AudioContext differs. Muted oscillators still participate in ring/sync, and all voices muted does not guarantee zero output when filter tails or D418 digi remain. These are source-backed design constraints, not new execution or listening results.

The fallback distinguishes `voice-mix` preparation from positional seeking. The existing note beneath Listen by voice shows a spinner, the retained position and why sound pauses; the transport says “Preparing voices…” instead of “Seeking…”. Ordinary seek feedback remains separate. Success, failure or a replacement load clears the pending operation; failures appear beside the voice controls with a reload instruction. Reduced motion keeps a static indicator. The audio replay/cache behavior is unchanged, and no no-gap claim is made.
