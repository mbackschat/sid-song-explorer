# Headless SID analysis spike

This bounded experiment implements [the headless proposal](../../../docs/design/headless-sid-analysis.md), informed by [the capability research](../../../docs/research/sid-analysis-capabilities.md). It uses the existing `SidSession` and prepared raw-chip SIDLite runtime without playback devices, browser injection, network requests or a second emulator. The pure [accumulator](analysis.ts) consumes ordered writes and PCM, then discards each processed chunk. This is an experiment, not Explorer integration or a listening verdict.

Run from the repository root with Node.js 24.18.0, existing dependencies, `build/engine/libsidplayfp.js` and its adjacent WASM, and the existing cleared samples in `public/generated/`. The commands below do not install dependencies, prepare assets or rebuild the engine. Run engine jobs serially, separately from browser tests.

```sh
mkdir -p build/sid-analysis
node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 scripts/experiments/sid-analysis/analysis.test.ts scripts/experiments/sid-analysis/runner.test.ts > build/sid-analysis/software-checks.log 2>&1
node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 scripts/experiments/sid-analysis/engine.test.ts > build/sid-analysis/engine-tests.log 2>&1
node --experimental-strip-types scripts/experiments/sid-analysis/run.ts --input public/generated/rambo-loader-main.sid --seconds 30 --clock PAL --model MOS6581 --subtune 1 --output build/sid-analysis/rambo-mono-30.json > build/sid-analysis/rambo-mono-30.log 2>&1
node --experimental-strip-types scripts/experiments/sid-analysis/run.ts --input public/generated/rambo-stereo-main.sid --seconds 60 --clock PAL --model MOS6581 --subtune 1 --output build/sid-analysis/rambo-stereo-60.json > build/sid-analysis/rambo-stereo-60.log 2>&1
```

Generate the thin review UI from those same JSON reports, then serve it locally:

```sh
node --experimental-strip-types scripts/experiments/sid-analysis/review.ts build/sid-analysis/rambo-mono-30.json build/sid-analysis/rambo-stereo-60.json
python3 -m http.server 4180 --bind 127.0.0.1 --directory build/sid-analysis
```

Open [the local report viewer](http://127.0.0.1:4180/). It displays and selects supplied findings without SID bytes, emulation, audio playback or analysis logic. The underlying JSON is also usable independently. The [real-engine oracle](engine.test.ts) checks program-defined controls, channel PCM statistics and loss-free report equality at different consumer chunk boundaries; after trace loss, reliable-prefix coverage and retained findings can depend on the affected block's boundaries.

All six CLI flags are required. `--seconds` must be finite, greater than zero, at most 600 and cover at least one 44,100 Hz PCM frame; fractional durations round down to complete frames. Clock is `PAL` or `NTSC`, model is `MOS6581` or `MOS8580`, and subtune is one-based. Actual supported format, song count and engine configuration remain `SidSession`'s contract. The recorded profile is an independent, unmuted execution.

The host caps input at 65,662 bytes, renders 16,384-frame consumer chunks, caps serialized JSON at 4 MiB and gives each worker process a 45-second wall deadline. The parent can kill and reap a worker blocked in synchronous WASM. A timeout, render error or incomplete interval fails the command without writing a partial successful report. A previously completed output remains available if a replacement fails. Successful reports are written atomically under ignored `build/sid-analysis/`; the runner rejects output symlinks, paths escaping that directory and input clobbering.

Each JSON envelope has `schemaVersion: 1`, `input`, `runtime`, `measurement` and `analysis`. Input identity hashes the original bytes before subtune selection; it contains a basename, SHA-256 and byte length, without SID bytes. Runtime identity records SHA-256 and byte length of the prepared JavaScript loader and WASM. Measurement records the requested profile, `SidSession` load information, requested and actual frame coverage, `requested-duration` stop reason, wall time, worker and host peak RSS, report bytes and job deadline. Wall time covers input reading and worker execution through receipt of the complete result; output serialization and disk writing are excluded. Peak RSS comes from Node's process resource usage, in bytes; it is per process, not a summed concurrent peak. Report size includes its own size field and trailing newline.

The analysis report separates observed counts, calculated time-weighted settings and PCM levels from heuristic moments. Its definitions and coverage fields carry interpretation and loss limits. Trace loss invalidates derived register metrics; PCM metrics still describe the rendered output. A duration bound does not establish a song ending, gate time does not establish audible time, and a programmed waveform does not identify an instrument. The viewer consumes the JSON findings and supporting values; it owns no analysis rules. Keep reports local and review useful moments by listening before deciding whether to adopt the analyser.
