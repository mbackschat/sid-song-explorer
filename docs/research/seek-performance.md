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
