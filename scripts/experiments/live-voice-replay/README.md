# Prefilter voice replay experiment

This isolated experiment tests whether sample-aligned voice contributions can reproduce the adopted SIDLite output through its original shared filter. The [plan](../../../docs/PLAN.md#gapless-voice-follow-up-spike) owns scope and the [study](../../../docs/research/seek-performance.md#follow-up-spike-after-stereo-adoption) owns results and the integration decision. Production playback and its prepared-seek cache are unchanged.

## Run

Use the project's pinned Node.js and installed dependencies, prepared Rambo asset, Python 3.12 or newer and Docker. First build the [adopted raw-chip experiment](../stereo/README.md); this experiment reuses its local Emscripten image and output as an independent oracle. It builds into a separate directory and runs compilation offline.

```sh
python3 scripts/experiments/live-voice-replay/run.py prepare
python3 scripts/experiments/live-voice-replay/run.py toolchain
python3 scripts/experiments/live-voice-replay/run.py red --node /path/to/node
python3 scripts/experiments/live-voice-replay/run.py build
python3 scripts/experiments/live-voice-replay/run.py verify --node /path/to/node
```

`toolchain --image sha256:…` can select the existing local image explicitly. Preparation verifies the upstream source archive through the stereo runner, then applies exact-text guarded patches. The build reuses the adopted build's unchanged libresidfp dependency after checking source, helpers, phase commands, toolchain, successful compiler receipts and the six installed dependency files. After bootstrapping the patched player, it verifies that configuration inputs match the adopted build and reuses that configuration. It then runs `make clean` and rejects any remaining object/archive before compiling the modified SIDLite/player and bindings. Cleaning is required because upstream disables dependency tracking and the experiment changes object layout. Reused configuration does not mean reused player objects.

Bootstrap, compilation and linking each retain a 120-second deadline; cleaning and each model/clock verification have 60-second deadlines. The original 240-second configuration attempts and their failures remain logged; the runner does not extend those limits or accept partial configuration. Logs, phase fingerprints, modified corresponding source, generated WASM and JSON receipts remain in ignored `build/live-voice-replay/`. No generated engine or reference SID is committed.

## Experimental ABI

`SidPlayerContext.renderCapture(cycles)` advances the existing C64 once and returns `{frames, chips, pcm, records, checkpoint}`. Returned typed arrays borrow WASM memory; copy all of them before another WASM call. Capture is limited to 4,096 frames per call. Records interleave chips in native buffer order: each chip/frame contains three little-endian signed Int16 envelope-scaled voice contributions followed by effective `$D415–$D418` bytes, ten bytes in total. Oscillators and envelopes continue to execute together, preserving ring/sync dependencies. Startup-discarded samples are excluded; captured counts must equal returned native buffer counts.

The eight Int32 checkpoint words per chip are version, previous volume, low-pass state, band-pass state, level, meter counter, model/RealSID flags and sample rate. They describe the filter immediately before the first captured frame. `new VoiceReplay(checkpoint)`, `render(records, voiceMask)`, `checkpoint()` and `restore(checkpoint)` replay through the unchanged upstream filter arithmetic and output saturation. Mask bits select three voices per chip. This internal experimental API rejects invalid input; recovery after a rejected restore is outside its contract. It is not included in the adopted TypeScript declarations.

## Oracle and limits

The red guard requires the adopted engine to lack this API. The green guard compares every captured and replayed Int16 sample with a separate adopted raw-chip engine, and additionally with the shipped mono engine for Rambo. Both SID models and PAL/NTSC run through real startup. Non-block checkpoint restoration must reproduce the continuous output exactly. Generated asymmetric dual-chip fixtures exercise sustained voices, ring/sync, noise, filter controls and D418. Deliberately swapped chip records, shifted control samples and corrupted filter history must fail the PCM oracle.

Records and explicit checkpoints stream into a bounded retained ring; full-song raw records and a duplicate full PCM cache are never accumulated. Receipts separate measured typed payloads from reserved scratch space and modeled queued audio. WASM heaps, JavaScript object overhead and the application's overview archive are excluded from that retained-data measurement. This is not a total browser-memory measurement.

Passing establishes exact replay and measured retention costs. It does not establish browser scheduling, audible continuity, acceptable control latency, production seek semantics or human listening acceptance. The GPL-covered modified corresponding source and notices accompany the local output; the original engine remains owned by its upstream authors.
